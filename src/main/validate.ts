// IPC 경계 입력 검증 — 렌더러 페이로드를 DB에 넘기기 전 최소 방어

/**
 * 할일 id로 받아들이는 모양.
 *
 * 예전에는 "빈 문자열이 아니다"만 봤다. 그런데 이 값은 CalDAV로 나갈 때
 * `UID:greenday-<id>@…` 한 줄에 그대로 실린다 — **개행이 섞인 id 하나면
 * 사용자의 캘린더에 임의 iCalendar 속성을 끼워 넣을 수 있다.** 같은 파일이
 * 날짜를 정규식으로 못 박는 이유(아래 `validateRangeAndPin`)가 정확히 그
 * 위협인데, 정작 id만 그 방어에서 빠져 있었다.
 *
 * 앱이 만드는 id는 전부 uuid v4라(`uuid()` — 렌더러의 모든 생성 경로) 이
 * 문자 집합이 기존 데이터를 전부 통과시킨다. 128은 uuid(36)에 넉넉한 여유다.
 *
 * (`ical.ts`의 UID 이스케이프는 별도로 필요하다 — 방어는 두 겹이어야 한다.
 *  그쪽은 이 워크트리 소유가 아니다.)
 */
const TASK_ID = /^[A-Za-z0-9_-]{1,128}$/

export function isValidTaskId(value: unknown): value is string {
  return typeof value === 'string' && TASK_ID.test(value)
}

export function validateTaskInput(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Invalid task payload')
  }
  const obj = input as Record<string, unknown>
  if (!isValidTaskId(obj.id)) {
    throw new Error('Invalid task payload')
  }
  if (typeof obj.title !== 'string') {
    throw new Error('Invalid task payload')
  }
  // 생성 경로도 같은 검사를 받는다 — createTask가 이 값을 그대로 직렬화한다.
  if ('scheduledOverrides' in obj) validateScheduledOverrides(obj.scheduledOverrides)
  validateRangeAndPin(obj)
  return obj
}

/**
 * 진짜 달력에 있는 날짜인가. 모양만 보면 '2026-13-45'가 통과해
 * DTSTART;VALUE=DATE:20261345 같은 깨진 iCal이 되고, 서버가 그 이벤트를
 * 거부해 그 할일만 조용히 동기화되지 않는다.
 */
function isRealIsoDate(value: unknown): boolean {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/**
 * 날짜·정렬·고정 필드. 이 값들은 그대로 디스크에 남고, 날짜는 CalDAV로 나갈 때
 * iCal 본문에 거의 그대로 실린다(ical.ts toDateStamp은 하이픈만 지운다) —
 * 개행이 섞인 날짜 하나면 사용자의 캘린더에 임의 속성을 끼워 넣을 수 있다.
 * ISO_DATE는 앵커돼 있어 개행을 막고, isRealIsoDate가 달력까지 확인한다.
 *
 * (기간의 앞뒤 순서는 검사하지 않는다 — 부분 페이로드라 상대편 값을 모른다.
 *  그 불변식은 스토어의 normalizeDateRange가 지킨다.)
 */
function validateRangeAndPin(obj: Record<string, unknown>): void {
  for (const key of ['startDate', 'dueDate'] as const) {
    if (key in obj && obj[key] !== null && !isRealIsoDate(obj[key])) {
      throw new Error('Invalid task payload')
    }
  }
  if ('pinned' in obj && typeof obj.pinned !== 'boolean') {
    throw new Error('Invalid task payload')
  }
  // NaN/Infinity는 JSON에 null로 적혀, 재시작하면 정렬이 무너진다.
  if ('sortOrder' in obj && !Number.isFinite(obj.sortOrder)) {
    throw new Error('Invalid task payload')
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
/** 회차 오버라이드 맵의 최대 키 수. 한 시리즈가 이보다 많은 예외를 가질 일이 없다. */
const MAX_OVERRIDE_KEYS = 1000

/**
 * 회차 오버라이드 맵 검증. 렌더러가 보내는 유일한 중첩 페이로드이고, 통과하면
 * 그대로 JSON으로 직렬화돼 디스크에 남는다(database.ts updateTask) — 모양 검사는
 * 렌더러가 아니라 이 신뢰 경계에 있어야 한다.
 */
function validateScheduledOverrides(value: unknown): void {
  if (value === null) return
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid task payload')
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > MAX_OVERRIDE_KEYS) throw new Error('Invalid task payload')
  for (const [key, pair] of entries) {
    if (!ISO_DATE.test(key)) throw new Error('Invalid task payload')
    if (pair === null) continue
    if (typeof pair !== 'object' || Array.isArray(pair)) throw new Error('Invalid task payload')
    const { start, end } = pair as Record<string, unknown>
    if (typeof start !== 'string' || typeof end !== 'string') throw new Error('Invalid task payload')
  }
}

// 업데이트는 부분 페이로드 허용 — id만 필수, title은 선택(있으면 문자열)
export function validateTaskUpdate(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Invalid task payload')
  }
  const obj = input as Record<string, unknown>
  if (!isValidTaskId(obj.id)) {
    throw new Error('Invalid task payload')
  }
  if ('title' in obj && typeof obj.title !== 'string') {
    throw new Error('Invalid task payload')
  }
  if ('scheduledOverrides' in obj) validateScheduledOverrides(obj.scheduledOverrides)
  validateRangeAndPin(obj)
  return obj
}
