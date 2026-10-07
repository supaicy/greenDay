import { describe, it, expect } from 'vitest'
import { dueReminders } from './reminders'

// 기준 시각 (from, to] 구간 테스트에 사용할 고정 ISO 문자열
const FROM = '2026-07-21T09:00:00.000Z'
const TO = '2026-07-21T09:01:00.000Z'
const INSIDE = '2026-07-21T09:00:30.000Z' // FROM < INSIDE < TO

// 기본 태스크 팩토리: reminder_at만 변경해서 테스트
function makeTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'task-1',
    title: '테스트 할일',
    completed: 0,
    deleted_at: null,
    reminder_at: INSIDE,
    ...overrides
  }
}

describe('dueReminders', () => {
  it('(from, to] 구간 안 reminder_at → 포함', () => {
    const result = dueReminders([makeTask({ reminder_at: INSIDE })], FROM, TO)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('task-1')
  })

  it('reminder_at === fromISO → 제외 (열린 경계)', () => {
    const result = dueReminders([makeTask({ reminder_at: FROM })], FROM, TO)
    expect(result).toHaveLength(0)
  })

  it('reminder_at < fromISO → 제외', () => {
    const before = '2026-07-21T08:59:59.999Z'
    const result = dueReminders([makeTask({ reminder_at: before })], FROM, TO)
    expect(result).toHaveLength(0)
  })

  it('reminder_at > toISO → 제외', () => {
    const after = '2026-07-21T09:01:00.001Z'
    const result = dueReminders([makeTask({ reminder_at: after })], FROM, TO)
    expect(result).toHaveLength(0)
  })

  it('reminder_at === toISO → 포함 (닫힌 경계)', () => {
    const result = dueReminders([makeTask({ reminder_at: TO })], FROM, TO)
    expect(result).toHaveLength(1)
  })

  it('completed === 1 (truthy) → 제외', () => {
    const result = dueReminders([makeTask({ completed: 1 })], FROM, TO)
    expect(result).toHaveLength(0)
  })

  it('completed === true (truthy) → 제외', () => {
    const result = dueReminders([makeTask({ completed: true })], FROM, TO)
    expect(result).toHaveLength(0)
  })

  it('deleted_at non-null → 제외', () => {
    const result = dueReminders([makeTask({ deleted_at: '2026-07-20T00:00:00.000Z' })], FROM, TO)
    expect(result).toHaveLength(0)
  })

  it('reminder_at === null → 제외', () => {
    const result = dueReminders([makeTask({ reminder_at: null })], FROM, TO)
    expect(result).toHaveLength(0)
  })

  it('reminder_at === 빈 문자열 → 제외', () => {
    const result = dueReminders([makeTask({ reminder_at: '' })], FROM, TO)
    expect(result).toHaveLength(0)
  })

  it('여러 도래 태스크 → 모두 반환', () => {
    const tasks = [
      makeTask({ id: 'a', reminder_at: INSIDE }),
      makeTask({ id: 'b', reminder_at: TO }),
      makeTask({ id: 'c', reminder_at: FROM }), // 제외 (경계 열린 쪽)
    ]
    const result = dueReminders(tasks, FROM, TO)
    expect(result).toHaveLength(2)
    const ids = result.map((t) => t.id)
    expect(ids).toContain('a')
    expect(ids).toContain('b')
    expect(ids).not.toContain('c')
  })
})
