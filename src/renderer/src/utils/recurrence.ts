/**
 * 반복 task 다음 발생일 계산 유틸
 *
 * 패턴 형식 (RecurringPicker.tsx 기준):
 *   daily            → fromISODate + 1일
 *   weekly:1,3,5     → from 이후 가장 가까운 해당 요일 (0=일 ~ 6=토)
 *   monthly:15       → from 이후 가장 가까운 15일 (이번 달에 남아 있으면 이번 달)
 *   yearly:MM-DD     → from 이후 가장 가까운 해당 월일 (올해에 남아 있으면 올해)
 *
 * TZ 드리프트 방지를 위해 Date(y, m, d) 로컬 생성, Date.now()/new Date() 비인수 호출 금지.
 */
import i18n, { tList } from '../i18n'
import type { AddTaskOptions, Task } from '../types'

/** 'YYYY-MM-DD' → [year, month(0-based), day] */
function parseDate(iso: string): [number, number, number] {
  const parts = iso.split('-')
  return [Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])]
}

/** 그 달의 마지막 날(1-31). 다음 달 0일 = 이번 달 말일. */
function lastDayOfMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate()
}

/** [year, month(0-based), day] → 'YYYY-MM-DD' */
function formatDate(y: number, m: number, d: number): string {
  const date = new Date(y, m, d) // 로컬 날짜로 정규화
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * 'weekly:1,3' → [1,3]. 빈 세그먼트는 버린다 — `''.split(',')`는 `['']`이고
 * `Number('')`는 0이라, 요일을 하나도 안 고른 'weekly:'가 일요일 반복으로
 * 둔갑했다(표시는 "매주 일", 발생일 판정은 매주 일요일 참).
 */
export function parseWeeklyDays(pattern: string): number[] {
  return pattern
    .slice('weekly:'.length)
    .split(',')
    .filter((part) => part.trim() !== '')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
}

/**
 * 'yearly:7-21' → [6, 21]. 픽커는 0을 채우지 않고 만드는데(RecurringPicker의
 * buildPattern) 날짜 문자열은 늘 패딩돼 있다 — 문자열로 비교하면 1~9월 매년
 * 반복이 영영 발생일로 인식되지 않았다. 파싱을 한곳에 모아 숫자로 비교한다.
 */
export function parseYearlyMonthDay(pattern: string): [number, number] | null {
  const parts = pattern.slice('yearly:'.length).split('-')
  if (parts.length !== 2) return null
  const month = Number(parts[0]) - 1
  const day = Number(parts[1])
  if (Number.isNaN(month) || Number.isNaN(day)) return null
  return [month, day]
}

/**
 * 반복 패턴과 기준일로부터 다음 발생일(YYYY-MM-DD)을 반환한다.
 * 인식 불가 패턴은 null.
 */
export function nextRecurringDate(pattern: string, fromISODate: string, notBefore?: string): string | null {
  let next = computeNextRecurringDate(pattern, fromISODate)
  if (!notBefore || !next) return next
  // 오래 밀린 반복은 따라잡는다. 1월 기한의 매일 할일을 8월에 완료하면 예전에는
  // 다음 회차가 1월 2일이라 여전히 연체였고, 비우려면 227번을 완료해야 했다.
  let guard = 0
  // 오늘을 포함해 이하인 동안 전진한다 — 오늘 완료한 회차를 다시 오늘로 잡지 않게.
  while (next <= notBefore && guard++ < MAX_CATCH_UP_STEPS) {
    const advanced = computeNextRecurringDate(pattern, next)
    if (!advanced || advanced === next) break
    next = advanced
  }
  return next
}

/** 따라잡기 루프 상한. 매일 반복이라도 3년치면 충분하고, 잘못된 패턴에 매달리지 않는다. */
const MAX_CATCH_UP_STEPS = 1200

function computeNextRecurringDate(pattern: string, fromISODate: string): string | null {
  if (!pattern) return null

  const [y, m, d] = parseDate(fromISODate)

  // ── daily ──────────────────────────────────────────────
  if (pattern === 'daily') {
    return formatDate(y, m, d + 1)
  }

  // ── weekly:d[,d,...] ───────────────────────────────────
  if (pattern.startsWith('weekly:')) {
    const targetDays = parseWeeklyDays(pattern)
    if (targetDays.length === 0) return null

    // from 날짜의 요일 (0=일)
    const fromDate = new Date(y, m, d)
    const fromDow = fromDate.getDay()

    // from 이후(strictly after) 가장 가까운 요일 탐색 (최대 7일)
    for (let offset = 1; offset <= 7; offset++) {
      const candidate = new Date(y, m, d + offset)
      const dow = candidate.getDay()
      if (targetDays.includes(dow)) {
        return formatDate(candidate.getFullYear(), candidate.getMonth(), candidate.getDate())
      }
    }
    // 이론상 도달 불가 (7일 내에 반드시 매칭)
    void fromDow
    return null
  }

  // ── monthly:N ─────────────────────────────────────────
  if (pattern.startsWith('monthly:')) {
    const day = Number(pattern.slice('monthly:'.length))
    if (Number.isNaN(day)) return null
    // 그 달에 없는 날짜는 말일로 당긴다. 넘치게 두면 formatDate가 2월 31일을
    // 3월 3일로 정규화하고, 그 값이 다음 회차의 기준일이 되어 드리프트가 쌓인다.
    // 같은 클램프를 이번 달 후보에도 쓴다 — occursOn이 2월 28일을 발생일로 보므로
    // 한쪽만 클램프하면 거기서 또 갈린다.
    //
    // 이번 달에 아직 회차가 남아 있으면 그게 다음 회차다 — 건너뛴 회차 방지 가드.
    // 무조건 m+1 하던 시절에는 9/10 마감 할일에 '매월 28일'을 걸면 9/28이 통째로
    // 사라졌다. 픽커의 날짜는 마감일과 무관하게 정해지므로(기본값 1일) 흔한 설정이다.
    // occursOn과 내보낸 RRULE(BYMONTHDAY)은 9/28에 블록을 그리는데, 정작 그 날
    // 할 일만 없었다.
    const thisMonthDay = Math.min(day, lastDayOfMonth(y, m))
    if (thisMonthDay > d) return formatDate(y, m, thisMonthDay)
    // 다음 달 (12월 → 1월 / 연도 +1)
    const nextMonth = m + 1
    const nextYear = nextMonth > 11 ? y + 1 : y
    const normalizedMonth = nextMonth > 11 ? 0 : nextMonth
    return formatDate(nextYear, normalizedMonth, Math.min(day, lastDayOfMonth(nextYear, normalizedMonth)))
  }

  // ── yearly:MM-DD ──────────────────────────────────────
  if (pattern.startsWith('yearly:')) {
    const parsed = parseYearlyMonthDay(pattern)
    if (!parsed) return null
    const [targetMonth, targetDay] = parsed
    // 2월 29일 생일은 평년에 말일로 당긴다(넘치면 3월 1일로 굳는다).
    // 올해 안에 그 월일이 아직 남아 있으면 그게 다음 회차다 — monthly와 같은
    // 건너뛴 회차 방지 가드. 무조건 y+1 하던 시절에는 9/25 마감에 '매년 12월 25일'을
    // 걸면 2026-12-25를 잃고 2027-12-25가 나왔다 — 1년치 알림이 조용히 사라진다.
    const thisYearDay = Math.min(targetDay, lastDayOfMonth(y, targetMonth))
    if (targetMonth > m || (targetMonth === m && thisYearDay > d)) {
      return formatDate(y, targetMonth, thisYearDay)
    }
    return formatDate(y + 1, targetMonth, Math.min(targetDay, lastDayOfMonth(y + 1, targetMonth)))
  }

  return null
}

/**
 * ISO 날짜시간 문자열을 wholeDays일만큼 이동한 새 ISO 문자열 반환.
 * 시간대 드리프트 방지: 날짜 부분은 로컬 생성, 시간 부분은 원본 그대로.
 * @param iso  'YYYY-MM-DDTHH:MM:SS.sssZ' 또는 'YYYY-MM-DD' 형식
 * @param days 이동할 일 수 (음수 허용)
 */
export function shiftIsoByDays(iso: string, days: number): string {
  // 날짜 부분과 시간 부분 분리
  const tIdx = iso.indexOf('T')
  const datePart = tIdx >= 0 ? iso.slice(0, tIdx) : iso
  const timePart = tIdx >= 0 ? iso.slice(tIdx) : ''     // 'T...' or ''
  const [y, m, d] = parseDate(datePart)
  const shifted = new Date(y, m, d + days)
  const yyyy = shifted.getFullYear()
  const mm = String(shifted.getMonth() + 1).padStart(2, '0')
  const dd = String(shifted.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}${timePart}`
}

/**
 * ISO 순간(UTC 저장값)을 로컬 벽시계 기준으로 days일 이동한다.
 *
 * shiftIsoByDays는 날짜 문자열만 밀고 시간 부분을 그대로 둔다 — 'YYYY-MM-DD'
 * 같은 날짜 값에는 맞지만, 리마인더처럼 toISOString()으로 저장된 순간에 쓰면
 * UTC 시각이 보존돼 서머타임을 건너는 순간 사용자가 보는 시각이 한 시간
 * 어긋난다(실측: New York에서 3/7 09:00 알림이 3/8에 10:00이 됐다).
 */
export function shiftInstantByDays(iso: string, days: number): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

/**
 * 두 YYYY-MM-DD 날짜 사이의 정수 일 차이를 반환 (to - from).
 */
export function daysBetween(fromISODate: string, toISODate: string): number {
  const [fy, fm, fd] = parseDate(fromISODate)
  const [ty, tm, td] = parseDate(toISODate)
  const fromMs = new Date(fy, fm, fd).getTime()
  const toMs = new Date(ty, tm, td).getTime()
  return Math.round((toMs - fromMs) / 86400000)
}

/**
 * 반복 패턴을 사람이 읽는 문구로. RecurringPicker의 트리거 버튼과 TaskDetail의
 * 칩이 같은 문구를 쓰도록 한곳에 둔다.
 */
export function formatRecurringPattern(pattern: string | null): string | null {
  if (!pattern) return null

  if (pattern === 'daily') return i18n.t('recurring.daily')

  if (pattern.startsWith('weekly:')) {
    const names = tList('date.weekdaysShort')
    const targetDays = parseWeeklyDays(pattern)
    // 고른 요일이 없으면 없는 요일을 지어내지 않고 일반 라벨로 떨어진다.
    if (targetDays.length === 0) return i18n.t('recurring.label')
    return i18n.t('recurring.weeklyOn', { days: targetDays.map((d) => names[d]).join(', ') })
  }

  if (pattern.startsWith('monthly:')) {
    return i18n.t('recurring.monthlyOn', { day: pattern.replace('monthly:', '') })
  }

  if (pattern.startsWith('yearly:')) {
    const [month, day] = pattern.replace('yearly:', '').split('-')
    return i18n.t('recurring.yearlyOn', { month, day })
  }

  return i18n.t('recurring.label')
}

/**
 * 완료된 반복 task가 스폰할 다음 인스턴스. 스토어의 `addTask(title, opts)` 옵션
 * 타입을 그대로 파생한다 — 손으로 두 번 선언하던 시절엔 시간블록 템플릿을 잇느라
 * 양쪽에 각각 필드를 더해야 했고, 한쪽만 늘어도 컴파일러가 잡지 못했다.
 *
 * 시간블록 템플릿은 시리즈 소유라 다음 인스턴스로 잇는다(시각만 의미, 날짜 무시).
 * 회차별 scheduledOverrides는 지난 날짜 것이라 잇지 않는다.
 */
export type RecurrenceSpawn = AddTaskOptions & {
  title: string
  dueDate: string
  isRecurring: true
  recurringPattern: string
}

/**
 * task 완료 시 만들어야 할 다음 반복 인스턴스를 계산한다. 만들 것이 없으면 null.
 * 같은 패턴·제목·기한의 미완료 인스턴스가 existing에 이미 있으면 중복 스폰하지 않는다.
 */
/** 시리즈 정체성 키. 지금은 패턴+제목+기한 — 시리즈 id가 생기면 여기만 바뀐다. */
function seriesKey(pattern: string, title: string, dueDate: string): string {
  return `${pattern}\u0000${title}\u0000${dueDate}`
}

/**
 * 미완료 반복 인스턴스 색인. 같은 키가 여럿일 수 있어(중복 데이터) 개수를 센다.
 * 일괄 완료가 태스크마다 전체 배열을 훑지 않도록 한 번만 만들어 재사용한다.
 */
function buildRecurrenceIndex(tasks: Task[]): Map<string, number> {
  const index = new Map<string, number>()
  for (const t of tasks) {
    if (t.completed || !t.isRecurring || !t.recurringPattern || !t.dueDate) continue
    const key = seriesKey(t.recurringPattern, t.title, t.dueDate)
    index.set(key, (index.get(key) ?? 0) + 1)
  }
  return index
}

export function nextRecurrenceSpawn(
  task: Task,
  existing: Task[] | Map<string, number>,
  today: string,
  /**
   * 원본의 하위작업. 색인(Map)으로 부를 때는 전체 배열이 없어 여기서 찾을 수
   * 없으므로 호출처가 준다 — 빠뜨리면 체크리스트만 조용히 안 실린다.
   */
  subtasks: Task[] = []
): RecurrenceSpawn | null {
  if (!task.isRecurring || !task.recurringPattern) return null
  // today를 하한으로 준다 — 밀린 시리즈가 계속 연체 상태로 스폰되지 않게.
  const next = nextRecurringDate(task.recurringPattern, task.dueDate ?? today, today)
  if (!next) return null
  const index = existing instanceof Map ? existing : buildRecurrenceIndex(existing)
  const exists = (index.get(seriesKey(task.recurringPattern, task.title, next)) ?? 0) > 0
  if (exists) return null
  const reminderAt =
    task.reminderAt && task.dueDate ? shiftInstantByDays(task.reminderAt, daysBetween(task.dueDate, next)) : null
  return {
    title: task.title,
    listId: task.listId,
    dueDate: next,
    // 메모·첨부·체크리스트는 시리즈의 내용이지 그 회차의 것이 아니다. 안 실으면
    // 다음 회차가 제목만 남은 껍데기로 태어나고, 내용은 화면에서 가려지는
    // 완료본에만 남아 사용자에게는 지워진 것과 구별되지 않는다.
    description: task.description,
    // 원본과 같은 참조 문자열을 그대로 나눠 갖는다. 복사하지 않는 이유는 아래
    // tags와 같다 — 첨부를 고치는 자리는 전부 새 배열을 만들어 갈아 끼우고
    // (AttachmentList), 메인의 첨부 청소는 어느 행이든 그 이름을 적어 두고 있으면
    // 파일을 남긴다(unreferencedAttachments). 여기서 펼치면 attachments가 없는
    // 옛 행·부분 Task에 대해 터진다(실측: recurrence.test.ts 3건).
    attachments: task.attachments,
    // 체크리스트는 전부 미완료로 다시 선다(`addTasks`가 completed: false로 굽는다).
    subtasks: subtasks.map((s) => ({ title: s.title, description: s.description, priority: s.priority })),
    // 기간은 길이를 지킨 채 통째로 옮긴다 — 시작일만 두고 오면 다음 회차가
    // 하루짜리로 쪼그라들고, 완료된 회차는 화면에서 가려져 흔적도 없다.
    startDate:
      task.startDate && task.dueDate ? shiftIsoByDays(next, -daysBetween(task.startDate, task.dueDate)) : null,
    dueTime: task.dueTime ?? undefined,
    priority: task.priority,
    // 고정은 "이걸 계속 위에 두겠다"는 뜻이다. 완료할 때마다 풀리면 매번 다시 고정해야 한다.
    pinned: task.pinned,
    isRecurring: true,
    recurringPattern: task.recurringPattern,
    tags: task.tags,
    reminderAt,
    scheduledStart: task.scheduledStart,
    scheduledEnd: task.scheduledEnd,
    // 다음 인스턴스가 소유할 회차(= 그 기한 이후)의 오버라이드는 함께 넘긴다.
    // 안 넘기면, 사용자가 미리 고쳐둔 미래 회차 시간이 완료하는 순간 조용히
    // 템플릿으로 되돌아간다(완료본의 미래 날짜는 화면에서 가려지므로 흔적도 없다).
    scheduledOverrides: pickOverridesFrom(task.scheduledOverrides, next)
  }
}

/** date 이상인 오버라이드만 남긴다. 없으면 null(필드 자체를 만들지 않는다). */
export function pickOverridesFrom(
  overrides: Task['scheduledOverrides'],
  from: string
): Record<string, { start: string; end: string } | null> | null {
  if (!overrides) return null
  const kept = Object.entries(overrides).filter(([date]) => date >= from)
  return kept.length > 0 ? Object.fromEntries(kept) : null
}

/**
 * 일괄 완료가 만들 스폰 목록. 기한 오름차순으로 하나씩 완료 처리한 것과 같은 결과를
 * 보장해야 한다 — 같은 시리즈의 8/15·8/16 회차를 함께 완료할 때 8/16이 아직 미완료인
 * 시점 기준으로 중복 판정하지 않으면 8/16 인스턴스가 한 번 더 생긴다.
 */
export function collectRecurrenceSpawns(completing: Task[], existing: Task[], today: string): RecurrenceSpawn[] {
  // 반복이 하나도 없으면(흔한 경우) 정렬도 색인도 만들지 않는다.
  if (!completing.some((t) => t.isRecurring && t.recurringPattern)) return []

  const ordered = [...completing].sort((a, b) => (a.dueDate ?? today).localeCompare(b.dueDate ?? today))
  // 색인을 한 번 만들고 완료/스폰을 반영해 나간다. 예전에는 태스크마다 전체
  // 배열을 복사하고 다시 훑어 O(n·m)이었다(3,000건 전체 선택 시 ~50ms).
  const index = buildRecurrenceIndex(existing)
  // 부모별 하위작업을 한 번만 모은다. 태스크마다 전체 배열을 훑으면 색인을 만든
  // 이유(O(n·m) 회피)가 없어진다.
  const childrenOf = new Map<string, Task[]>()
  for (const t of existing) {
    if (!t.parentId) continue
    const kids = childrenOf.get(t.parentId)
    if (kids) kids.push(t)
    else childrenOf.set(t.parentId, [t])
  }
  const spawns: RecurrenceSpawn[] = []
  for (const task of ordered) {
    const spawn = nextRecurrenceSpawn(task, index, today, childrenOf.get(task.id) ?? [])
    if (spawn) {
      spawns.push(spawn)
      // 스폰한 회차를 색인에 올려, 같은 기한의 중복 인스턴스가 또 스폰하지 않게 한다.
      const key = seriesKey(spawn.recurringPattern, spawn.title, spawn.dueDate)
      index.set(key, (index.get(key) ?? 0) + 1)
    }
    // 이 태스크는 이제 완료 — 색인에서 뺀다.
    if (task.isRecurring && task.recurringPattern && task.dueDate) {
      const ownKey = seriesKey(task.recurringPattern, task.title, task.dueDate)
      const left = (index.get(ownKey) ?? 0) - 1
      if (left > 0) index.set(ownKey, left)
      else index.delete(ownKey)
    }
  }
  return spawns
}

/**
 * dateStr이 이 반복 인스턴스의 발생일인지. 캘린더가 시간블록 템플릿을 어느 날에
 * 그릴지 정한다 — 전에는 이 게이트가 없어 비발생일에도 매일 블록이 떴다.
 * 인스턴스 자신의 dueDate는 패턴과 어긋나도 발생일로 친다(뒤로 미룬 회차).
 * 미해석 패턴은 관용적으로 true — 레거시 데이터의 블록을 숨기지 않는다.
 */
export function occursOn(pattern: string | null, anchorDueDate: string | null, dateStr: string): boolean {
  if (!pattern) return true
  if (anchorDueDate) {
    if (dateStr < anchorDueDate) return false
    if (dateStr === anchorDueDate) return true
  }
  if (pattern === 'daily') return true
  const [y, m, d] = parseDate(dateStr)
  if (pattern.startsWith('weekly:')) {
    // 요일이 비었으면 '매주'로 볼 근거가 없다 — 위에서 걸러진 자기 dueDate만 발생일.
    return parseWeeklyDays(pattern).includes(new Date(y, m, d).getDay())
  }
  if (pattern.startsWith('monthly:')) {
    const day = Number(pattern.slice('monthly:'.length))
    if (Number.isNaN(day)) return true
    // nextRecurringDate와 같은 클램프를 쓴다 — 안 그러면 스포너가 잡는 2월 28일에
    // 블록이 안 그려진다.
    return d === Math.min(day, lastDayOfMonth(y, m))
  }
  if (pattern.startsWith('yearly:')) {
    const parsed = parseYearlyMonthDay(pattern)
    if (!parsed) return true
    const [month, day] = parsed
    // 그 해에 없는 날(평년 2/29)은 말일을 발생일로 본다 — nextRecurringDate와 같은 규칙.
    return m === month && d === Math.min(day, lastDayOfMonth(y, month))
  }
  return true
}
