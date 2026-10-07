import { describe, it, expect } from 'vitest'
import { fromLocalDateString, toLocalDateString } from './date'

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

/**
 * Regression: 진단 2.2 — 쓸 때는 로컬, 읽을 때는 UTC라 하루가 어긋났다.
 * Found by /qa on 2026-09-25
 * Report: docs/reports/2026-09-25-전체-진단.html
 *
 * 이 describe는 seoul·west 두 프로젝트에서 모두 돈다(vitest.config.ts).
 * 왕복 불변식은 시간대와 무관하게 성립해야 하는 성질이라, 어느 쪽에서든
 * 깨지면 바로 드러난다.
 */
describe('fromLocalDateString', () => {
  it('로컬 자정으로 읽는다 (UTC 자정이 아니라)', () => {
    const d = fromLocalDateString('2026-09-25')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(8)
    expect(d.getDate()).toBe(25)
    expect(d.getHours()).toBe(0)
  })

  it('toLocalDateString과 왕복한다 — 이 성질이 깨진 것이 버그였다', () => {
    // `new Date('2026-09-25')`는 UTC 자정이라, 오프셋이 음수인 지역에서
    // 되돌리면 하루 전(2026-09-24)이 나왔다.
    for (const s of ['2026-01-01', '2026-02-28', '2026-03-01', '2026-09-25', '2026-12-31']) {
      expect(toLocalDateString(fromLocalDateString(s))).toBe(s)
    }
  })

  it('윤년 2월 29일도 왕복한다', () => {
    expect(toLocalDateString(fromLocalDateString('2028-02-29'))).toBe('2028-02-29')
  })

  it('날짜 형식이 아니면 예전 동작(new Date)으로 돌려보낸다', () => {
    // 시각이 붙은 ISO 문자열은 그대로 해석돼야 한다 — 이 헬퍼는 날짜 전용이다.
    const withTime = fromLocalDateString('2026-09-25T13:30:00Z')
    expect(Number.isNaN(withTime.getTime())).toBe(false)
  })
})
