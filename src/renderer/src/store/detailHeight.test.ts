import { describe, it, expect } from 'vitest'
import { clampDetailHeight } from './detailHeight'

describe('clampDetailHeight', () => {
  it('keeps a value inside the range', () => {
    expect(clampDetailHeight(500, 900)).toBe(500) // range [240, 740]
  })
  it('floors at 240', () => {
    expect(clampDetailHeight(100, 900)).toBe(240)
  })
  it('caps at contentHeight - 160', () => {
    expect(clampDetailHeight(1000, 900)).toBe(740)
  })
  it('handles inverted range on tiny windows (contentH - 160 < 240)', () => {
    // contentHeight 300 -> ceil = max(240, 140) = 240, so result never below 240
    expect(clampDetailHeight(50, 300)).toBe(240)
    expect(clampDetailHeight(999, 300)).toBe(240)
  })
})
