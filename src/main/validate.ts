// IPC 경계 입력 검증 — 렌더러 페이로드를 DB에 넘기기 전 최소 방어
export function validateTaskInput(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Invalid task payload')
  }
  const obj = input as Record<string, unknown>
  if (typeof obj.id !== 'string' || obj.id.length === 0) {
    throw new Error('Invalid task payload')
  }
  if (typeof obj.title !== 'string') {
    throw new Error('Invalid task payload')
  }
  return obj
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
  if (typeof obj.id !== 'string' || obj.id.length === 0) {
    throw new Error('Invalid task payload')
  }
  if ('title' in obj && typeof obj.title !== 'string') {
    throw new Error('Invalid task payload')
  }
  if ('scheduledOverrides' in obj) validateScheduledOverrides(obj.scheduledOverrides)
  return obj
}
