/**
 * 반복 패턴의 **발생일 계산 코어** — 순수 함수만. 캘린더 내보내기가 쓴다.
 *
 * 왜 여기(`src/shared`)인가. 지금까지 반복 규칙을 아는 코드는 렌더러에만 있었고
 * (`renderer/src/utils/recurrence.ts`), 캘린더 내보내기(`main/caldav/sync.ts`)는
 * 그 존재를 몰랐다. 그래서 매주 반복하는 할일이 **한 번짜리 고정 일정 하나**로
 * 나갔고, 회차를 옮기거나 리사이즈해도(`scheduledOverrides`) 내보낸 캘린더는
 * 조용히 갈라졌다. 두 프로세스가 같은 답을 내야 하는 규칙이므로 shared에 둔다.
 *
 * **아직 렌더러가 이걸 쓰지는 않는다.** `renderer/src/utils/recurrence.ts`는 다른
 * 워크트리 소유라 이번에 옮기지 못했다. 아래 구현은 그 파일의 규칙을 그대로 옮긴
 * 것이고, `recurrence.test.ts`가 두 구현이 같은 답을 내는지 대조해 드리프트를 막는다.
 * 렌더러를 이 파일로 이관하는 것은 후속 작업이다.
 *
 * 패턴 형식 (RecurringPicker.tsx가 만든다):
 *   daily            매일
 *   weekly:1,3,5     그 요일마다 (0=일 … 6=토)
 *   monthly:15       매달 15일 — **없는 날은 말일로 당긴다**
 *   yearly:7-21      매년 7월 21일 — 2/29는 평년에 말일로 당긴다
 *
 * 시각 계산은 전부 로컬 `Date(y, m, d)`로 한다. `Date.now()`나 무인자 `new Date()`는
 * 쓰지 않는다 — 결과가 호출 시점에 따라 달라지면 지문이 매번 바뀌어 모든 항목이
 * 매 동기화마다 다시 올라간다.
 */

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
  const date = new Date(y, m, d)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * 'weekly:1,3' → [1,3]. 빈 세그먼트는 버린다 — `''.split(',')`는 `['']`이고
 * `Number('')`는 0이라, 요일을 하나도 안 고른 'weekly:'가 일요일 반복으로 둔갑한다.
 */
export function parseWeeklyDays(pattern: string): number[] {
  return pattern
    .slice('weekly:'.length)
    .split(',')
    .filter((part) => part.trim() !== '')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
}

/** 'yearly:7-21' → [6, 21]. 픽커는 0을 채우지 않으므로 숫자로 비교한다. */
export function parseYearlyMonthDay(pattern: string): [number, number] | null {
  const parts = pattern.slice('yearly:'.length).split('-')
  if (parts.length !== 2) return null
  const month = Number(parts[0]) - 1
  const day = Number(parts[1])
  if (Number.isNaN(month) || Number.isNaN(day)) return null
  return [month, day]
}

/**
 * 그 날짜가 이 반복의 발생일인가.
 *
 * `renderer/src/utils/recurrence.ts`의 `occursOn`과 **같은 답을 내야 한다.**
 * 화면이 블록을 그리는 규칙과 캘린더로 내보내는 규칙이 갈리면, 사용자는 앱에서
 * 본 것과 다른 일정을 자기 캘린더에서 보게 된다.
 */
export function occursOn(pattern: string | null, anchorDueDate: string | null, dateStr: string): boolean {
  if (!pattern) return true
  if (anchorDueDate) {
    if (dateStr < anchorDueDate) return false
    // 앵커는 패턴과 무관하게 언제나 발생일이다(그 할일의 자기 회차).
    if (dateStr === anchorDueDate) return true
  }
  if (pattern === 'daily') return true
  const [y, m, d] = parseDate(dateStr)
  if (pattern.startsWith('weekly:')) {
    // 요일이 비었으면 '매주'로 볼 근거가 없다 — 위에서 걸러진 앵커만 발생일이다.
    return parseWeeklyDays(pattern).includes(new Date(y, m, d).getDay())
  }
  if (pattern.startsWith('monthly:')) {
    const day = Number(pattern.slice('monthly:'.length))
    if (Number.isNaN(day)) return true
    return d === Math.min(day, lastDayOfMonth(y, m))
  }
  if (pattern.startsWith('yearly:')) {
    const parsed = parseYearlyMonthDay(pattern)
    if (!parsed) return true
    const [month, day] = parsed
    return m === month && d === Math.min(day, lastDayOfMonth(y, month))
  }
  return true
}

/**
 * 반복 패턴을 iCalendar RRULE로. 규칙으로 못 담는 회차는 `extraDates`로 나온다.
 *
 * **왜 나머지가 생기는가.** 이 앱의 `monthly:31`은 "31일, 없으면 말일"인데
 * RFC 5545의 `BYMONTHDAY=31`은 **31일이 없는 달을 그냥 건너뛴다.** 즉 앱은 2월 28일에
 * 회차를 보여 주는데 캘린더에는 아무것도 없다. `yearly:2-29`도 같다 — 평년에 앱은
 * 2월 28일을 쓰고 RRULE은 건너뛴다.
 *
 * 그 차이를 한 RRULE로 표현할 방법이 없다(`BYSETPOS`로도 안 된다 — 짧은 달에 후보가
 * 아예 비어 버린다). 그래서 **규칙으로 정확히 담기는 부분은 RRULE**로, 클램프 때문에
 * 생기는 예외만 **RDATE**로 따로 낸다.
 *
 * `extraDates`는 앵커로부터 `horizonYears`년까지만 낸다. 무한할 수 없으니 유한해야
 * 하고, **`now`가 아니라 앵커 기준**이라 언제 계산해도 같은 값이 나온다 — 시각에
 * 의존하면 지문이 매번 달라져 모든 항목이 매 동기화마다 다시 올라간다.
 *
 * 표현할 수 없는 패턴(요일 없는 `weekly:` 등)은 `rrule: null`이다. 그때는 앵커
 * 하나짜리 일정으로 나가는데, 그게 `occursOn`의 답과도 일치한다.
 */
export function toRRule(
  pattern: string | null,
  anchorDate: string,
  horizonYears = 5
): { rrule: string | null; extraDates: string[] } {
  if (!pattern) return { rrule: null, extraDates: [] }

  if (pattern === 'daily') return { rrule: 'FREQ=DAILY', extraDates: [] }

  if (pattern.startsWith('weekly:')) {
    const days = parseWeeklyDays(pattern)
    if (days.length === 0) return { rrule: null, extraDates: [] }
    const byDay = [...new Set(days)].sort((a, b) => a - b).map((d) => WEEKDAYS[d])
    return { rrule: `FREQ=WEEKLY;BYDAY=${byDay.join(',')}`, extraDates: [] }
  }

  if (pattern.startsWith('monthly:')) {
    const day = Number(pattern.slice('monthly:'.length))
    if (!Number.isInteger(day) || day < 1 || day > 31) return { rrule: null, extraDates: [] }
    return {
      rrule: `FREQ=MONTHLY;BYMONTHDAY=${day}`,
      // 28일 이하는 모든 달에 있으므로 클램프가 일어나지 않는다.
      extraDates: day <= 28 ? [] : clampedMonthlyDates(day, anchorDate, horizonYears)
    }
  }

  if (pattern.startsWith('yearly:')) {
    const parsed = parseYearlyMonthDay(pattern)
    if (!parsed) return { rrule: null, extraDates: [] }
    const [month, day] = parsed
    if (month < 0 || month > 11 || day < 1 || day > 31) return { rrule: null, extraDates: [] }
    return {
      rrule: `FREQ=YEARLY;BYMONTH=${month + 1};BYMONTHDAY=${day}`,
      extraDates: clampedYearlyDates(month, day, anchorDate, horizonYears)
    }
  }

  return { rrule: null, extraDates: [] }
}

/** RRULE의 BYDAY 약어. 인덱스가 `Date.getDay()`와 같아야 한다. */
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/** `monthly:N`에서 N일이 없는 달의 말일들. RRULE이 건너뛰는 자리를 메운다. */
function clampedMonthlyDates(day: number, anchorDate: string, horizonYears: number): string[] {
  const [anchorY, anchorM] = parseDate(anchorDate)
  const dates: string[] = []
  for (let i = 0; i < horizonYears * 12; i++) {
    const y = anchorY + Math.floor((anchorM + i) / 12)
    const m = (anchorM + i) % 12
    const last = lastDayOfMonth(y, m)
    if (last >= day) continue
    const date = formatDate(y, m, last)
    // 앵커 자신은 DTSTART가 이미 담당한다.
    if (date > anchorDate) dates.push(date)
  }
  return dates
}

/** `yearly:MM-DD`에서 그 해에 DD가 없는 해(평년 2/29)의 말일들. */
function clampedYearlyDates(month: number, day: number, anchorDate: string, horizonYears: number): string[] {
  const [anchorY] = parseDate(anchorDate)
  const dates: string[] = []
  for (let i = 0; i <= horizonYears; i++) {
    const y = anchorY + i
    const last = lastDayOfMonth(y, month)
    if (last >= day) continue
    const date = formatDate(y, month, last)
    if (date > anchorDate) dates.push(date)
  }
  return dates
}
