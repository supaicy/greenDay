/**
 * haru 할일 ↔ 캘린더 일정 매핑과 동기화 계획.
 *
 * 전부 순수 함수다 — 네트워크도 파일도 건드리지 않는다. 실제 요청은 호출하는 쪽이
 * 계획(plan)을 보고 수행한다. 그래야 "무엇을 올릴지"를 서버 없이 검증할 수 있다.
 */

import { usesWallClock, type CalendarEvent, type EventOverride } from './ical'
import { occursOn, toRRule } from '../../shared/recurrence'

/** 회차별로 다르게 잡은 시간 블록. null이면 그 회차를 없앤 것이다. */
export type ScheduledOverrides = Record<string, { start: string; end: string } | null>

/** database.ts가 돌려주는 행에서 동기화에 필요한 부분만. */
export interface TaskRow {
  id: string
  title: string
  description?: string | null
  completed?: unknown
  due_date?: string | null
  due_time?: string | null
  start_date?: string | null
  scheduled_start?: string | null
  scheduled_end?: string | null
  deleted_at?: string | null
  parent_id?: string | null
  /**
   * 반복 관련 세 열. **예전에는 이 인터페이스에 아예 없었다** — 그래서 매주 반복하는
   * 할일이 한 번짜리 고정 일정으로 나갔고, 회차를 옮기거나 리사이즈해도 내보낸
   * 캘린더는 그대로였다. 화면은 이미 회차별 오버라이드를 우선해서 그리고 있었다.
   *
   * DB는 `is_recurring`을 0/1 정수로, `scheduled_overrides`를 JSON 문자열로 준다.
   * 렌더러를 거쳐 온 객체일 수도 있어서 둘 다 받는다.
   */
  is_recurring?: unknown
  recurring_pattern?: string | null
  scheduled_overrides?: unknown
}

export interface SyncEntry {
  /** 서버 리소스 경로 */
  href: string
  etag: string | null
  /** 마지막으로 올린 내용의 지문. 같으면 다시 올리지 않는다. */
  fingerprint: string
  /** 마지막으로 올린 SEQUENCE. 갱신할 때마다 1씩 올린다. */
  sequence: number
}

/** taskId → 마지막 동기화 상태 */
export type SyncState = Record<string, SyncEntry>

export interface SyncPlan {
  creates: { taskId: string; href: string; event: CalendarEvent }[]
  updates: { taskId: string; href: string; etag: string | null; event: CalendarEvent }[]
  deletes: { taskId: string; href: string; etag: string | null }[]
  /** 날짜가 없어 캘린더에 올릴 수 없는 할일 수. 사용자에게 왜 안 올라갔는지 알린다. */
  skippedNoDate: number
}

/** 일정 하나가 차지하는 기본 길이(분). 마감 시각만 있고 종료가 없을 때 쓴다. */
const DEFAULT_DURATION_MIN = 60

/**
 * 캘린더 일정의 UID.
 *
 * 이 문자열은 사용자의 캘린더에 영구히 기록된다. 한 번 내보낸 뒤에 형식을 바꾸면
 * 기존 일정과의 연결이 끊겨 전부 고아가 되고, 다음 동기화에서 같은 할일이 새 일정으로
 * 다시 만들어진다(= 캘린더에 중복이 쌓인다).
 *
 * 그래서 APP_BUNDLE_ID 같은 상수에서 유도하지 않고 여기에 직접 적어 둔다 —
 * 앱 이름이나 번들 ID가 또 바뀌더라도 이 값은 따라 바뀌면 안 된다.
 */
export function eventUid(taskId: string): string {
  return `greenday-${taskId}@supaicy.github.io`
}

/** 서버에 둘 파일 이름. UID 기준이라 같은 할일은 항상 같은 경로다. */
export function eventHref(calendarUrl: string, taskId: string): string {
  const base = calendarUrl.endsWith('/') ? calendarUrl : `${calendarUrl}/`
  return `${base}${encodeURIComponent(eventUid(taskId))}.ics`
}

function addDays(yyyyMmDd: string, days: number): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number)
  const date = new Date(y, m - 1, d + days)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * 날짜로 못 읽는 값을 UTC ISO로 바꾸려다 **동기화 전체가 멈추는** 것을 막는 변환기.
 * 읽히면 ISO, 아니면 null — 절대 던지지 않는다.
 *
 * `new Date('nope').toISOString()`은 `RangeError: Invalid time value`를 던진다.
 * 여기서 던지면 `planSync`가 통째로 죽어 **망가진 행 하나 때문에 멀쩡한 할일까지
 * 하나도 안 올라가고**(CalDAV·Google 둘 다 이 계획을 쓴다), `calendar:sync-now`의
 * catch는 CalDavError가 아닌 예외를 "알 수 없는 오류"로 뭉개므로 어느 할일이
 * 문제인지도 안 나온다. `parseOverrides`가 이미 같은 이유로 모양 아닌 값을 조용히
 * 버리는데("여기서 던지면 동기화 전체가 멈춘다"), 정작 날짜 변환만 그 규칙 밖이었다.
 *
 * 검사는 IPC가 아니라 여기여야 한다. `validate.ts`는 오버라이드의 start/end가
 * **문자열인지만** 보고 scheduled_start/due_time은 아예 안 보며(due_date/start_date와
 * 달리 `database.ts`의 부팅 복구도 이 세 열은 건드리지 않는다), 이미 디스크에 남은
 * 행은 어차피 그 경계를 다시 지나지 않는다. 호출처가 전부 여기를 지난다.
 */
function toIsoOrNull(value: string | null | undefined): string | null {
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/**
 * `localToIso`에 넣어도 안전한 로컬 시각의 모양. 'nope'나 ''를 넘기면
 * `Number('')`=0, `Number('nope')`=NaN이라 Invalid Date가 만들어지고,
 * 그 `.toISOString()`이 다시 동기화 전체를 멈춘다.
 */
const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/

/** 로컬 날짜+시각을 UTC ISO로. 'YYYY-MM-DD' + 'HH:MM' */
export function localToIso(date: string, time: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  return new Date(y, m - 1, d, hh, mm, 0, 0).toISOString()
}

/**
 * 할일을 캘린더 일정으로. 캘린더에 올릴 수 없는 할일은 null.
 *
 * - scheduledStart/End가 있으면 그 시간 블록 그대로
 * - dueDate + dueTime이면 그 시각부터 한 시간
 * - dueDate만 있으면 종일 일정
 * - 날짜가 전혀 없으면 null (캘린더에 놓을 자리가 없다)
 */
export function taskToEvent(task: TaskRow, sequence = 0): CalendarEvent | null {
  const completed = Boolean(task.completed)
  const base = {
    uid: eventUid(task.id),
    summary: task.title || '(제목 없음)',
    description: task.description ?? '',
    rrule: null,
    rdates: [],
    exdates: [],
    overrides: [],
    lastModified: null,
    sequence,
    completed
  }

  const single = ((): CalendarEvent | null => {
    // 읽히는 블록일 때만 블록으로 낸다. 못 읽으면 아래 마감일 규칙으로 흘려보낸다 —
    // 예전에는 여기서 바로 던져 그 할일만이 아니라 동기화 전체가 죽었다.
    const blockStart = toIsoOrNull(task.scheduled_start)
    const blockEnd = toIsoOrNull(task.scheduled_end)
    if (blockStart && blockEnd) {
      return { ...base, start: blockStart, end: blockEnd, allDay: false }
    }

    // 시각 모양이 아닌 due_time은 시각이 없는 것으로 본다(= 종일). 그대로 넘기면
    // `localToIso`가 Invalid Date를 만들어 `.toISOString()`에서 던진다.
    if (task.due_date && task.due_time && TIME_OF_DAY.test(task.due_time)) {
      // 기간이 붙어 있으면 그 기간을 시각으로 잇는다. 여기서 마감일 하나만 보면
      // 8/18~8/20 할일이 8/20의 60분짜리로 쪼그라들어, 기간을 넣은 의미가 사라진다.
      const ranged = task.start_date && task.start_date < task.due_date ? task.start_date : null
      const start = localToIso(ranged ?? task.due_date, task.due_time)
      return {
        ...base,
        start,
        end: ranged
          ? localToIso(task.due_date, task.due_time)
          : new Date(new Date(start).getTime() + DEFAULT_DURATION_MIN * 60_000).toISOString(),
        allDay: false
      }
    }

    if (task.due_date) {
      // 종일 일정의 DTEND는 배타적이다 — 하루짜리면 다음 날을 넣어야 한다.
      // 기간이 있으면 시작일부터 걸친다. 마감일만 보내면 8/18~8/20 할일이
      // 캘린더에 8/20 하루로 올라가, 동기화한 쪽에서는 기간이 없던 일이 된다.
      const start = task.start_date && task.start_date <= task.due_date ? task.start_date : task.due_date
      return { ...base, start, end: addDays(task.due_date, 1), allDay: true }
    }

    return null
  })()

  if (!single) return null
  if (!task.is_recurring || !task.recurring_pattern) return single
  // 완료한 회차는 시리즈가 아니다 — 자기 회차 하루짜리로 내보낸다.
  if (completed) return completedOccurrence(single, task)
  return withRecurrence(single, task)
}

/**
 * 완료한 반복 회차를 **자기 회차 하루짜리 일정**으로 만든다.
 *
 * 왜 필요한가. `toggleTask`는 완료한 행의 `is_recurring`/`recurring_pattern`을 그대로
 * 두고 다음 회차를 **새 행**으로 스폰한다. 완료본은 영영 남는다(`database.ts`에
 * 정리 경로가 없다). 그래서 완료할 때마다 **끝이 없는 RRULE을 가진 행이 하나씩**
 * 늘었고, 한 달 쓴 매일 습관은 캘린더의 모든 날에 같은 일정 서른 개를 그렸다.
 * `toRRule`이 내는 규칙에는 UNTIL도 COUNT도 없으니 과거로도 미래로도 끝없이 이어진다.
 *
 * 화면은 이미 반대로 그린다 — `getScheduledForOccurrence`가 완료한 반복 인스턴스를
 * 자기 회차에만 남긴다. 내보내기가 화면과 갈리면 사용자는 앱에서 본 적 없는 일정을
 * 자기 캘린더에서 본다.
 *
 * 자리도 화면과 같은 규칙으로 고른다: 그 날짜의 오버라이드가 있으면 그 블록,
 * 없으면 템플릿의 **로컬 시각**을 자기 회차 날짜에 얹는다. 템플릿의 날짜를 그대로
 * 쓰면 안 된다 — `nextRecurrenceSpawn`이 `scheduledStart`를 그대로 복사하므로 그
 * 날짜는 시리즈가 처음 시작한 날에 멈춰 있고, 규칙만 떼면 완료본 전부가 그 하루에
 * 쌓인다. 쌓이는 자리만 바뀔 뿐 고친 게 아니다.
 */
function completedOccurrence(event: CalendarEvent, task: TaskRow): CalendarEvent {
  const date = task.due_date
  // 기한이 없으면 어느 회차인지 지목할 수 없다. 규칙만 떼고 자리는 그대로 둔다 —
  // 시리즈로 내보내는 것보다는 자리가 어긋난 한 건이 낫다.
  if (!date) return event

  const override = parseOverrides(task.scheduled_overrides)[date]
  if (override) {
    const start = new Date(override.start)
    const end = new Date(override.end)
    if (Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())) {
      return { ...event, start: start.toISOString(), end: end.toISOString(), allDay: false }
    }
  }

  // 시간블록이 없으면 `single`은 이미 마감일(+기간) 위에 있다 — 옮길 것이 없다.
  if (!task.scheduled_start || !task.scheduled_end) return event

  const timeOfDay = localTimeOfDay(task)
  if (timeOfDay === null) return event
  const start = localToIso(date, timeOfDay)
  const durationMs = new Date(event.end).getTime() - new Date(event.start).getTime()
  return { ...event, start, end: new Date(new Date(start).getTime() + durationMs).toISOString(), allDay: false }
}

/**
 * 회차 템플릿의 **로컬** 시각('HH:MM'). 종일이면 null.
 *
 * `event.start`에서 잘라 쓰면 안 된다 — 그건 UTC ISO다. UTC 시각을 로컬 날짜에
 * 붙이면 두 프레임이 섞여, 날짜 경계 근처의 회차가 하루씩 어긋난다(KST 09:00
 * 회차는 UTC로 전날이다). 원본 열에서 로컬 시각을 그대로 가져온다.
 */
function localTimeOfDay(task: TaskRow): string | null {
  // 모양을 확인하고 돌려준다. 날짜로 안 읽히는 scheduled_start를 자르면 ''가 나오고,
  // 그 ''가 stampFor → localToIso로 흘러 Invalid Date가 된다 — 종일도 아닌데 시각이
  // 없는 셈이라, 검사 없이 넘기면 회차 하나가 동기화 전체를 멈춘다. 예전에는
  // scheduled_start가 있기만 하면 거기서 끝나 due_time으로 내려오지도 못했다.
  const fromBlock = task.scheduled_start ? timeAt(task.scheduled_start) : null
  if (fromBlock) return fromBlock
  if (task.due_time && TIME_OF_DAY.test(task.due_time)) return task.due_time
  return null
}

/**
 * 로컬 ISO('YYYY-MM-DDTHH:mm:ss')에서 'HH:MM'만. UTC ISO를 넣으면 프레임이 섞인다.
 * 'HH:MM' 모양이 아니면 null — 자른 값을 그대로 믿으면 'nope'는 ''가, 날짜만 있는
 * 값도 ''가 되어 `localToIso`에서 Invalid Date로 되살아난다.
 */
function timeAt(localIso: string): string | null {
  const time = localIso.slice(11, 16)
  return TIME_OF_DAY.test(time) ? time : null
}

/**
 * 한 번짜리 일정에 반복 규칙과 회차 예외를 얹는다.
 *
 * 앵커는 화면과 같은 것을 쓴다 — `dueDate`가 있으면 그것, 없으면 이 일정이 놓인
 * 날짜. `occursOn`이 앵커를 무조건 발생일로 치고, RFC 5545도 DTSTART를 반복 집합에
 * 포함하므로 두 규칙이 여기서 맞물린다.
 */
function withRecurrence(event: CalendarEvent, task: TaskRow): CalendarEvent {
  const anchor = task.due_date ?? event.start.slice(0, 10)
  const pattern = task.recurring_pattern ?? null
  const { rrule, extraDates } = toRRule(pattern, anchor)

  // 그 날짜의 회차가 원래 놓이는 지점. 종일이면 날짜, 아니면 로컬 시각을 UTC로.
  const timeOfDay = localTimeOfDay(task)
  const stampFor = (date: string): string =>
    event.allDay || timeOfDay === null ? date : localToIso(date, timeOfDay)

  // 시간 블록은 **시각 템플릿**이다 — 화면은 회차마다 날짜만 갈아 끼워 그린다
  // (`scheduledTime.ts`의 `getScheduledForOccurrence`). 그런데 `scheduled_start`에
  // 적힌 날짜는 블록을 처음 잡은 날에 얼어붙어 있고, `nextRecurrenceSpawn`이 그 값을
  // 손대지 않은 채 다음 회차에 물려준다(의도한 동작이다 — 시각만 템플릿이니까).
  //
  // 그 얼어붙은 날짜를 DTSTART로 내보내면 RRULE이 **거기서부터** 펼쳐지는데,
  // 화면은 앵커 이전을 통째로 숨긴다(`occursOn`: `dateStr < anchorDueDate`면 false).
  // 8/1에 블록을 잡고 기한이 9/1까지 전진한 매일 반복이 iCloud에는 8/1부터 나가
  // **앱에 없는 한 달치 유령 회차**가 됐다. 반대로 미래 회차에 블록을 떨어뜨리면
  // 캘린더 쪽에 구멍이 생긴다. DTSTART를 앵커 회차로 되돌려 둘을 다시 물린다.
  //
  // 끝시각도 앵커 날짜에 붙인다 — 화면이 하는 것과 같은 계산이다. 블록은 잡을 때
  // 그 날 23:59로 잘리므로(`resolveTimeBlockDrop`) 보통은 자정을 넘지 않지만,
  // 넘은 값이 들어오면 날짜만 갈아 끼울 때 DTEND가 DTSTART보다 앞서 **서버가 일정
  // 전체를 거부한다**. 그때는 길이를 지켜 옮긴다 — 어긋난 날짜보다 못 올라가는
  // 일정이 나쁘다. `due_date`가 없으면 앵커 자체가 이 블록에서 나온 값이라
  // 어긋날 일이 없다. 종일·기간 일정은 건드리지 않는다 — 거기서 `start`는 시각
  // 템플릿이 아니라 기간의 시작일이라, 앵커로 당기면 기간이 통째로 밀린다.
  const anchored =
    task.due_date && task.scheduled_start && task.scheduled_end && !event.allDay && timeOfDay !== null
      ? reanchor(event, anchor, timeOfDay, timeAt(task.scheduled_end))
      : { start: event.start, end: event.end }

  const rdates = extraDates.map(stampFor)
  const exdates: string[] = []
  const overrides: EventOverride[] = []

  for (const [date, block] of Object.entries(parseOverrides(task.scheduled_overrides))) {
    const isOccurrence = occursOn(pattern, task.due_date ?? null, date)
    if (block === null) {
      // 없앤 회차. 애초에 발생일이 아니면 뺄 것도 없다.
      if (isOccurrence) exdates.push(stampFor(date))
      continue
    }
    // **변환 전에** 검사한다. 순서가 반대면 `new Date('nope').toISOString()`이
    // 먼저 던져 바로 아래 가드가 영영 실행되지 않는 죽은 코드였다.
    const start = toIsoOrNull(block.start)
    const end = toIsoOrNull(block.end)
    if (!start || !end) continue
    if (isOccurrence) {
      // 원래 있던 회차를 옮기거나 늘렸다 — RECURRENCE-ID로 그 회차를 지목한다.
      overrides.push({ recurrenceId: stampFor(date), start, end })
    } else {
      // 발생일이 아닌 날로 끌어다 놓은 회차. 규칙 밖이라 RDATE로 자리를 만들고,
      // 그 자리를 다시 지목해 시각·길이를 준다.
      rdates.push(start)
      overrides.push({ recurrenceId: start, start, end })
    }
  }

  return {
    ...event,
    ...anchored,
    rrule,
    rdates: [...new Set(rdates)].sort(),
    exdates: [...new Set(exdates)].sort(),
    overrides: overrides.sort((a, b) => a.recurrenceId.localeCompare(b.recurrenceId))
  }
}

/**
 * 시간 블록을 앵커 회차 날짜 위로 옮긴다. 시각은 그대로, 날짜만 간다.
 *
 * 끝이 시작보다 앞서면(자정을 넘는 블록) 날짜만 갈아 끼우는 순간 DTEND < DTSTART가
 * 되고, 그런 VEVENT는 서버가 통째로 거부한다. 그 한 경우만 길이를 지켜 옮긴다.
 */
function reanchor(
  event: CalendarEvent,
  anchorDate: string,
  startTime: string,
  endTime: string | null
): { start: string; end: string } {
  const start = localToIso(anchorDate, startTime)
  // endTime이 null = scheduled_end가 시각으로 안 읽힌다(시작만 멀쩡한 행이면 여기까지
  // 온다). 자정을 넘는 블록과 같이 길이를 지켜 옮긴다 — localToIso에 넣으면 Invalid
  // Date가 되어 동기화 전체가 멈춘다.
  if (endTime !== null && endTime > startTime) return { start, end: localToIso(anchorDate, endTime) }
  const durationMs = new Date(event.end).getTime() - new Date(event.start).getTime()
  return { start, end: new Date(new Date(start).getTime() + durationMs).toISOString() }
}

/**
 * `scheduled_overrides`를 객체로. DB는 JSON 문자열로 주고, 렌더러를 거쳐 온 값은
 * 이미 객체다. 형태가 아니면 빈 것으로 본다 — 여기서 던지면 동기화 전체가 멈춘다.
 */
function parseOverrides(raw: unknown): ScheduledOverrides {
  const value = typeof raw === 'string' ? safeJson(raw) : raw
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: ScheduledOverrides = {}
  for (const [date, block] of Object.entries(value as Record<string, unknown>)) {
    if (block === null) {
      out[date] = null
      continue
    }
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>
    if (typeof b.start === 'string' && typeof b.end === 'string') out[date] = { start: b.start, end: b.end }
  }
  return out
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * 다시 올릴지 판단할 지문. 우리가 서버에 쓰는 필드만 넣는다 — sequence는 넣지 않는다
 * (넣으면 올릴 때마다 지문이 바뀌어 매번 다시 올리게 된다).
 *
 * **반복 필드도 들어간다.** 예전에는 start/end만 봤는데, 회차를 옮기면 바뀌는 것은
 * `scheduledOverrides`뿐이고 템플릿의 start/end는 그대로다. 그래서 지문이 같아
 * **재업로드를 시도조차 하지 않았고**, 로컬과 내보낸 캘린더가 조용히 갈라졌다.
 */
export function fingerprint(event: CalendarEvent): string {
  return JSON.stringify([
    event.summary,
    event.description,
    event.start,
    event.end,
    event.allDay,
    event.completed,
    event.rrule,
    event.rdates,
    event.exdates,
    event.overrides,
    // **프레임도 지문에 넣는다.** 반복 시리즈를 UTC로 내보내던 시절의 항목은 필드
    // 값이 하나도 안 바뀌어 지문이 같고, 그러면 고친 직렬화가 영영 서버에 닿지
    // 않는다(= 이미 올라간 스탠드업은 계속 한 시간 밀린 채로 남는다). 참일 때만
    // 덧붙여, 반복 없는 항목의 지문은 한 글자도 바뀌지 않게 한다.
    ...(usesWallClock(event) ? ['wallclock'] : [])
  ])
}

/** 캘린더에 올릴 대상인가. 삭제됨·하위작업은 제외한다. */
export function isSyncable(task: TaskRow): boolean {
  if (task.deleted_at) return false
  // 하위 작업까지 올리면 캘린더가 잘게 쪼개진 항목으로 뒤덮인다. 상위 항목만 올린다.
  if (task.parent_id) return false
  return true
}

/**
 * 현재 할일 목록과 지난 동기화 상태를 비교해 무엇을 만들고/고치고/지울지 계산한다.
 *
 * 지문이 같으면 건드리지 않는다. 서버에서 사라진 항목을 되살리는 일은 하지 않는다 —
 * 사용자가 Calendar.app에서 지운 것을 앱이 계속 되돌려 놓으면 지울 방법이 없어진다.
 */
export function planSync(tasks: TaskRow[], state: SyncState, calendarUrl: string): SyncPlan {
  const plan: SyncPlan = { creates: [], updates: [], deletes: [], skippedNoDate: 0 }
  const seen = new Set<string>()

  for (const task of tasks) {
    if (!isSyncable(task)) continue

    const previous = state[task.id]
    // 지문 비교용으로는 이전 sequence 그대로 만든다 (지문에 sequence는 안 들어가지만,
    // 갱신으로 확정되기 전에 값을 올려 두면 변경 없는 항목의 sequence까지 올라간다).
    const event = taskToEvent(task, previous?.sequence ?? 0)
    if (!event) {
      plan.skippedNoDate++
      // 날짜가 지워진 할일은 캘린더에서도 내려야 한다.
      if (previous) {
        seen.add(task.id)
        plan.deletes.push({ taskId: task.id, href: previous.href, etag: previous.etag })
      }
      continue
    }

    seen.add(task.id)
    const href = previous?.href ?? eventHref(calendarUrl, task.id)

    if (!previous) {
      plan.creates.push({ taskId: task.id, href, event })
    } else if (previous.fingerprint !== fingerprint(event)) {
      // 일부 서버는 SEQUENCE가 줄거나 같으면 갱신을 거부한다.
      const bumped = { ...event, sequence: previous.sequence + 1 }
      plan.updates.push({ taskId: task.id, href, etag: previous.etag, event: bumped })
    }
  }

  // 상태에는 있는데 이번 목록에 없는 것 = 삭제되었거나 휴지통으로 갔다.
  for (const [taskId, entry] of Object.entries(state)) {
    if (seen.has(taskId)) continue
    plan.deletes.push({ taskId, href: entry.href, etag: entry.etag })
  }

  return plan
}
