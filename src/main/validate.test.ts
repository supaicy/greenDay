import { describe, it, expect } from 'vitest'
import { validateTaskInput, validateTaskUpdate } from './validate'

describe('validateTaskInput', () => {
  it('id와 title이 있으면 통과', () => {
    const out = validateTaskInput({ id: 't1', title: '할일', extra: 1 })
    expect(out.id).toBe('t1')
    expect(out.title).toBe('할일')
  })

  it('객체가 아니면 throw', () => {
    expect(() => validateTaskInput(null)).toThrow('Invalid task payload')
    expect(() => validateTaskInput('x')).toThrow('Invalid task payload')
  })

  it('id가 문자열이 아니면 throw', () => {
    expect(() => validateTaskInput({ id: 1, title: 'a' })).toThrow('Invalid task payload')
  })

  it('title이 없으면 throw', () => {
    expect(() => validateTaskInput({ id: 't1' })).toThrow('Invalid task payload')
  })
})

describe('validateTaskUpdate', () => {
  it('id만 있으면 통과 (부분 업데이트)', () => {
    expect(validateTaskUpdate({ id: 't1', completed: true }).id).toBe('t1')
    expect(validateTaskUpdate({ id: 't1', priority: 'high' }).id).toBe('t1')
  })
  it('title이 있으면 문자열이어야 통과', () => {
    expect(validateTaskUpdate({ id: 't1', title: 'x' }).title).toBe('x')
  })
  it('title이 문자열이 아니면 throw', () => {
    expect(() => validateTaskUpdate({ id: 't1', title: 5 })).toThrow('Invalid task payload')
  })
  it('id가 없거나 비면 throw', () => {
    expect(() => validateTaskUpdate({ completed: true })).toThrow('Invalid task payload')
    expect(() => validateTaskUpdate({ id: '' })).toThrow('Invalid task payload')
  })
  it('객체가 아니면 throw', () => {
    expect(() => validateTaskUpdate(null)).toThrow('Invalid task payload')
    expect(() => validateTaskUpdate([])).toThrow('Invalid task payload')
  })
})

// scheduledOverrides는 렌더러가 보내는 중첩 페이로드다. IPC 경계에서 모양을
// 확인하지 않으면 그대로 디스크에 직렬화된다(database.ts updateTask).
// 신뢰 경계의 방어는 렌더러가 아니라 여기 있어야 한다.
describe('validateTaskUpdate — scheduledOverrides 모양', () => {
  it('정상 페이로드는 통과시킨다', () => {
    const ok = {
      id: 't1',
      scheduledOverrides: { '2026-08-17': { start: '2026-08-17T08:00:00', end: '2026-08-17T09:00:00' } }
    }
    expect(validateTaskUpdate(ok)).toBe(ok)
    expect(validateTaskUpdate({ id: 't1', scheduledOverrides: { '2026-08-17': null } })).toBeTruthy()
    expect(validateTaskUpdate({ id: 't1', scheduledOverrides: null })).toBeTruthy()
  })

  it('날짜 형식이 아닌 키를 거부한다', () => {
    expect(() => validateTaskUpdate({ id: 't1', scheduledOverrides: { 'not-a-date': null } })).toThrow()
    // JSON.parse는 리터럴과 달리 '__proto__'를 실제 own 키로 만든다. 이 맵은
    // 저장 후 다시 파싱되므로, 그런 키가 디스크까지 가지 않게 막아야 한다.
    const polluted = JSON.parse('{"__proto__": {"start": "x", "end": "y"}}')
    expect(() => validateTaskUpdate({ id: 't1', scheduledOverrides: polluted })).toThrow()
  })

  it('start/end가 문자열이 아닌 값을 거부한다', () => {
    expect(() => validateTaskUpdate({ id: 't1', scheduledOverrides: { '2026-08-17': { start: 1, end: 2 } } })).toThrow()
    expect(() => validateTaskUpdate({ id: 't1', scheduledOverrides: { '2026-08-17': {} } })).toThrow()
  })

  it('배열이나 원시값을 오버라이드 맵으로 받지 않는다', () => {
    expect(() => validateTaskUpdate({ id: 't1', scheduledOverrides: [] })).toThrow()
    expect(() => validateTaskUpdate({ id: 't1', scheduledOverrides: 'x' })).toThrow()
  })

  it('키 개수를 제한한다 — 무한히 커지는 맵이 디스크로 가지 않게', () => {
    const huge: Record<string, null> = {}
    for (let i = 0; i < 1001; i++) huge[`2026-01-${String((i % 28) + 1).padStart(2, '0')}-${i}`] = null
    expect(() => validateTaskUpdate({ id: 't1', scheduledOverrides: huge })).toThrow()
  })
})
