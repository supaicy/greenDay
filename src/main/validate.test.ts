import { describe, it, expect } from 'vitest'
import { validateTaskInput } from './validate'

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
