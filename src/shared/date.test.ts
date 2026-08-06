import { describe, it, expect } from 'vitest'
import { toLocalDateString } from './date'

describe('toLocalDateString', () => {
  it('formats as yyyy-MM-dd', () => {
    expect(toLocalDateString(new Date(2026, 7, 5))).toBe('2026-08-05')
  })

  it('zero-pads single-digit months and days', () => {
    expect(toLocalDateString(new Date(2026, 0, 9))).toBe('2026-01-09')
  })

  // toISOString()이 UTC로 앞당기던 그 시각. 로컬 달력 날짜를 그대로 돌려줘야 한다.
  it('keeps the local calendar day in the early-morning window that UTC shifts back', () => {
    const earlyMorning = new Date(2026, 7, 6, 2, 0, 0)
    expect(toLocalDateString(earlyMorning)).toBe('2026-08-06')
  })

  it('keeps the local calendar day late at night', () => {
    expect(toLocalDateString(new Date(2026, 7, 6, 23, 59, 0))).toBe('2026-08-06')
  })
})
