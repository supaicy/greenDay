import { describe, it, expect } from 'vitest'
import { daysLeft } from './useLicense'

/**
 * 카운트다운 문구가 전부 이 함수 하나에서 나온다. 특히 23시간 59분 → 0은
 * "오늘이 마지막 날" 문구를 고르는 분기라, 하나 어긋나면 화면에 "0일 남음"이
 * 뜨는데 그 문구는 두 로케일 어디에도 없다.
 */
describe('daysLeft', () => {
  const NOW = Date.UTC(2026, 7, 18)
  const DAY = 86_400_000

  it('마감이 없으면 0', () => {
    expect(daysLeft(null, NOW)).toBe(0)
  })

  it('이미 지난 마감은 음수가 아니라 0', () => {
    // 음수가 나오면 화면에 "-3일 남음"이 뜬다.
    expect(daysLeft(NOW - 5 * DAY, NOW)).toBe(0)
    expect(daysLeft(NOW, NOW)).toBe(0)
  })

  it('하루가 채 안 남았으면 0 — 여기서 "오늘이 마지막 날"이 갈린다', () => {
    expect(daysLeft(NOW + DAY - 1000, NOW)).toBe(0)
    expect(daysLeft(NOW + DAY, NOW)).toBe(1)
  })

  it('30일 창은 시작 순간에 30이다', () => {
    expect(daysLeft(NOW + 30 * DAY, NOW)).toBe(30)
    expect(daysLeft(NOW + 30 * DAY - 3_600_000, NOW)).toBe(29)
  })
})
