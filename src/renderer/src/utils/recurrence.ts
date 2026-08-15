/**
 * 반복 task 다음 발생일 계산 유틸
 *
 * 패턴 형식 (RecurringPicker.tsx 기준):
 *   daily            → fromISODate + 1일
 *   weekly:1,3,5     → from 이후 가장 가까운 해당 요일 (0=일 ~ 6=토)
 *   monthly:15       → 다음 달 15일
 *   yearly:MM-DD     → 내년 해당 월일
 *
 * TZ 드리프트 방지를 위해 Date(y, m, d) 로컬 생성, Date.now()/new Date() 비인수 호출 금지.
 */
import i18n, { tList } from '../i18n'
import type { Task } from '../types'

/** 'YYYY-MM-DD' → [year, month(0-based), day] */
function parseDate(iso: string): [number, number, number] {
  const parts = iso.split('-')
  return [Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])]
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
 * 반복 패턴과 기준일로부터 다음 발생일(YYYY-MM-DD)을 반환한다.
 * 인식 불가 패턴은 null.
 */
export function nextRecurringDate(pattern: string, fromISODate: string): string | null {
  if (!pattern) return null

  const [y, m, d] = parseDate(fromISODate)

  // ── daily ──────────────────────────────────────────────
  if (pattern === 'daily') {
    return formatDate(y, m, d + 1)
  }

  // ── weekly:d[,d,...] ───────────────────────────────────
  if (pattern.startsWith('weekly:')) {
    const dayParts = pattern.slice('weekly:'.length).split(',')
    const targetDays = dayParts.map(Number).filter((n) => !Number.isNaN(n))
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
    // 다음 달 (12월 → 1월 / 연도 +1)
    const nextMonth = m + 1
    const nextYear = nextMonth > 11 ? y + 1 : y
    const normalizedMonth = nextMonth > 11 ? 0 : nextMonth
    return formatDate(nextYear, normalizedMonth, day)
  }

  // ── yearly:MM-DD ──────────────────────────────────────
  if (pattern.startsWith('yearly:')) {
    const mmdd = pattern.slice('yearly:'.length) // 예: '07-21'
    const parts = mmdd.split('-')
    if (parts.length !== 2) return null
    const targetMonth = Number(parts[0]) - 1 // 0-based
    const targetDay = Number(parts[1])
    if (Number.isNaN(targetMonth) || Number.isNaN(targetDay)) return null
    return formatDate(y + 1, targetMonth, targetDay)
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
    const days = pattern
      .replace('weekly:', '')
      .split(',')
      .map((d) => names[Number(d)])
      .filter(Boolean)
      .join(', ')
    return i18n.t('recurring.weeklyOn', { days })
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

/** 완료된 반복 task가 스폰할 다음 인스턴스의 addTask 인자. */
export interface RecurrenceSpawn {
  title: string
  listId: string
  dueDate: string
  dueTime?: string
  priority: Task['priority']
  isRecurring: true
  recurringPattern: string
  tags: string[]
  reminderAt: string | null
  // 시간블록 템플릿은 시리즈 소유라 다음 인스턴스로 잇는다(시각만 의미, 날짜 무시).
  // 회차별 scheduledOverrides는 지난 날짜 것이라 잇지 않는다.
  scheduledStart: string | null
  scheduledEnd: string | null
}

/**
 * task 완료 시 만들어야 할 다음 반복 인스턴스를 계산한다. 만들 것이 없으면 null.
 * 같은 패턴·제목·기한의 미완료 인스턴스가 existing에 이미 있으면 중복 스폰하지 않는다.
 */
export function nextRecurrenceSpawn(task: Task, existing: Task[], today: string): RecurrenceSpawn | null {
  if (!task.isRecurring || !task.recurringPattern) return null
  const next = nextRecurringDate(task.recurringPattern, task.dueDate ?? today)
  if (!next) return null
  const exists = existing.some(
    (t) =>
      !t.completed &&
      t.isRecurring &&
      t.recurringPattern === task.recurringPattern &&
      t.title === task.title &&
      t.dueDate === next
  )
  if (exists) return null
  let reminderAt: string | null = null
  if (task.reminderAt && task.dueDate) {
    reminderAt = shiftIsoByDays(task.reminderAt, daysBetween(task.dueDate, next))
  }
  return {
    title: task.title,
    listId: task.listId,
    dueDate: next,
    dueTime: task.dueTime ?? undefined,
    priority: task.priority,
    isRecurring: true,
    recurringPattern: task.recurringPattern,
    tags: task.tags,
    reminderAt,
    scheduledStart: task.scheduledStart,
    scheduledEnd: task.scheduledEnd
  }
}

/**
 * 일괄 완료가 만들 스폰 목록. 기한 오름차순으로 하나씩 완료 처리한 것과 같은 결과를
 * 보장해야 한다 — 같은 시리즈의 8/15·8/16 회차를 함께 완료할 때 8/16이 아직 미완료인
 * 시점 기준으로 중복 판정하지 않으면 8/16 인스턴스가 한 번 더 생긴다.
 */
export function collectRecurrenceSpawns(completing: Task[], existing: Task[], today: string): RecurrenceSpawn[] {
  const ordered = [...completing].sort((a, b) => (a.dueDate ?? today).localeCompare(b.dueDate ?? today))
  let working = existing
  const spawns: RecurrenceSpawn[] = []
  for (const task of ordered) {
    const spawn = nextRecurrenceSpawn(task, working, today)
    if (spawn) {
      spawns.push(spawn)
      // 유령의 id는 원본과 달라야 한다 — 같으면 바로 아래 완료 표시에 휩쓸려,
      // 같은 기한의 중복 인스턴스가 이 유령을 미완료 dup으로 못 보고 또 스폰한다.
      working = [...working, { ...task, id: `${task.id}:spawn`, completed: false, dueDate: spawn.dueDate }]
    }
    working = working.map((t) => (t.id === task.id ? { ...t, completed: true } : t))
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
    const targetDays = pattern
      .slice('weekly:'.length)
      .split(',')
      .map(Number)
      .filter((n) => !Number.isNaN(n))
    if (targetDays.length === 0) return true
    return targetDays.includes(new Date(y, m, d).getDay())
  }
  if (pattern.startsWith('monthly:')) {
    const day = Number(pattern.slice('monthly:'.length))
    return Number.isNaN(day) ? true : d === day
  }
  if (pattern.startsWith('yearly:')) {
    const mmdd = pattern.slice('yearly:'.length)
    const pad = (n: number): string => String(n).padStart(2, '0')
    return `${pad(m + 1)}-${pad(d)}` === mmdd
  }
  return true
}
