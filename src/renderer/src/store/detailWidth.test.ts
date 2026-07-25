import { describe, it, expect } from 'vitest'
import { clampDetailWidth } from './detailWidth'

describe('clampDetailWidth', () => {
  it('keeps a value inside the range', () => {
    expect(clampDetailWidth(500, 1400)).toBe(500) // range [320, 824]
  })
  it('floors at 320', () => {
    expect(clampDetailWidth(100, 1400)).toBe(320)
  })
  it('caps at windowWidth - 576', () => {
    expect(clampDetailWidth(2000, 1400)).toBe(824)
  })
  it('handles inverted range on narrow windows (windowWidth - 576 < 320)', () => {
    // windowWidth 700 -> ceil = max(320, 124) = 320, so result never below 320
    expect(clampDetailWidth(50, 700)).toBe(320)
    expect(clampDetailWidth(999, 700)).toBe(320)
  })
})
