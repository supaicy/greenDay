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
