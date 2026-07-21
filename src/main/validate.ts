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
  return obj
}
