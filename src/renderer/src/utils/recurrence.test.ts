import { describe, it, expect } from 'vitest'
import { nextRecurringDate, shiftIsoByDays, daysBetween } from './recurrence'

describe('nextRecurringDate', () => {
  // ── daily ──────────────────────────────────────────────
  it('daily: 하루 뒤 날짜 반환', () => {
    expect(nextRecurringDate('daily', '2026-07-21')).toBe('2026-07-22')
  })

  it('daily: 월말 → 다음 달 1일', () => {
    expect(nextRecurringDate('daily', '2026-07-31')).toBe('2026-08-01')
  })

  it('daily: 12월 31일 → 다음 해 1월 1일', () => {
    expect(nextRecurringDate('daily', '2026-12-31')).toBe('2027-01-01')
  })

  // ── weekly ─────────────────────────────────────────────
  it('weekly: 단일 요일 — 다음 월요일(1) 반환', () => {
    // 2026-07-21 화요일(2) → 다음 월요일(1)은 2026-07-27
    expect(nextRecurringDate('weekly:1', '2026-07-21')).toBe('2026-07-27')
  })

  it('weekly: 복수 요일 — 가장 가까운 다음 날짜', () => {
    // 2026-07-21 화요일(2) → weekly:1,3,5 → 다음은 수(3) 2026-07-22
    expect(nextRecurringDate('weekly:1,3,5', '2026-07-21')).toBe('2026-07-22')
  })

  it('weekly: 주 내 마지막 요일이면 다음 주로 넘어감', () => {
    // 2026-07-24 금요일(5) → weekly:1,3,5 → 다음은 월(1) 2026-07-27
    expect(nextRecurringDate('weekly:1,3,5', '2026-07-24')).toBe('2026-07-27')
  })

  it('weekly: 일요일(0) 포함 시 주 경계 처리', () => {
    // 2026-07-25 토요일(6) → weekly:0 → 다음 일요일(0) 2026-07-26
    expect(nextRecurringDate('weekly:0', '2026-07-25')).toBe('2026-07-26')
  })

  it('weekly: from 요일과 동일한 날은 건너뜀 (strictly after)', () => {
    // 2026-07-21 화요일(2) → weekly:2 → 다음 화요일 2026-07-28
    expect(nextRecurringDate('weekly:2', '2026-07-21')).toBe('2026-07-28')
  })

  // ── monthly ────────────────────────────────────────────
  it('monthly: 다음 달 해당일 반환', () => {
    expect(nextRecurringDate('monthly:15', '2026-07-21')).toBe('2026-08-15')
  })

  it('monthly: 패딩 없는 숫자 — monthly:5', () => {
    expect(nextRecurringDate('monthly:5', '2026-07-21')).toBe('2026-08-05')
  })

  it('monthly: 12월이면 다음 해 1월', () => {
    expect(nextRecurringDate('monthly:10', '2026-12-05')).toBe('2027-01-10')
  })

  // ── yearly ─────────────────────────────────────────────
  it('yearly: 내년 같은 월일 반환', () => {
    expect(nextRecurringDate('yearly:07-21', '2026-07-21')).toBe('2027-07-21')
  })

  it('yearly: 항상 +1년 (해당일 이전이어도)', () => {
    expect(nextRecurringDate('yearly:01-01', '2026-07-21')).toBe('2027-01-01')
  })

  it('yearly: 패딩 없는 월일 — yearly:7-21', () => {
    expect(nextRecurringDate('yearly:7-21', '2026-07-21')).toBe('2027-07-21')
  })

  // ── 인식 불가 패턴 ──────────────────────────────────────
  it('unknown pattern: null 반환', () => {
    expect(nextRecurringDate('biweekly', '2026-07-21')).toBeNull()
  })

  it('빈 문자열: null 반환', () => {
    expect(nextRecurringDate('', '2026-07-21')).toBeNull()
  })
})

describe('shiftIsoByDays', () => {
  it('날짜만 있을 때 N일 이동', () => {
    expect(shiftIsoByDays('2026-07-21', 3)).toBe('2026-07-24')
  })

  it('시간 부분 보존', () => {
    expect(shiftIsoByDays('2026-07-21T09:00:00.000Z', 3)).toBe('2026-07-24T09:00:00.000Z')
  })

  it('월 경계 넘김', () => {
    expect(shiftIsoByDays('2026-07-30', 5)).toBe('2026-08-04')
  })

  it('연 경계 넘김', () => {
    expect(shiftIsoByDays('2026-12-30', 5)).toBe('2027-01-04')
  })

  it('음수 이동', () => {
    expect(shiftIsoByDays('2026-07-21', -10)).toBe('2026-07-11')
  })
})

describe('daysBetween', () => {
  it('같은 날 → 0', () => {
    expect(daysBetween('2026-07-21', '2026-07-21')).toBe(0)
  })

  it('순방향 7일 차이', () => {
    expect(daysBetween('2026-07-21', '2026-07-28')).toBe(7)
  })

  it('역방향 → 음수', () => {
    expect(daysBetween('2026-07-28', '2026-07-21')).toBe(-7)
  })

  it('월 경계 넘김', () => {
    expect(daysBetween('2026-07-28', '2026-08-04')).toBe(7)
  })

  it('연 경계 넘김', () => {
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
  })
})
