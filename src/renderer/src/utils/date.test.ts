import { describe, it, expect } from 'vitest'
import { format, addDays } from 'date-fns'
import { isOverdue, isDueToday, isDueInNext7Days } from './date'

// Regression: ISSUE-001 — "다음 7일" sidebar badge counted overdue tasks that
// the list view (which uses isDueInNext7Days) correctly hid, so the badge showed
// a number while the list was empty. Found by /qa on 2026-07-24.
// Report: .gstack/qa-reports/qa-report-haru-2026-07-24.md
// These tests pin the smart-list date predicates that BOTH the badge counter
// (Sidebar.tsx taskCounts) and the list filter (TaskList.tsx) now share.

// dueDates are stored as 'yyyy-MM-dd' strings (utils/date.toDateString).
const day = (offset: number) => format(addDays(new Date(), offset), 'yyyy-MM-dd')

describe('smart-list date predicates', () => {
  it('isDueToday: only the current day', () => {
    expect(isDueToday(day(0))).toBe(true)
    expect(isDueToday(day(-1))).toBe(false)
    expect(isDueToday(day(3))).toBe(false)
    expect(isDueToday(null)).toBe(false)
  })

  it('isOverdue: strictly past days only', () => {
    expect(isOverdue(day(-1))).toBe(true)
    expect(isOverdue(day(-30))).toBe(true)
    expect(isOverdue(day(0))).toBe(false)
    expect(isOverdue(day(3))).toBe(false)
    expect(isOverdue(null)).toBe(false)
  })

  it('isDueInNext7Days: includes today..+week, EXCLUDES overdue', () => {
    expect(isDueInNext7Days(day(0))).toBe(true)
    expect(isDueInNext7Days(day(3))).toBe(true)
    expect(isDueInNext7Days(day(6))).toBe(true)
    // the regression: overdue tasks must NOT be in the next-7-days set
    expect(isDueInNext7Days(day(-1))).toBe(false)
    expect(isDueInNext7Days(day(-30))).toBe(false)
    // and beyond the window
    expect(isDueInNext7Days(day(10))).toBe(false)
    expect(isDueInNext7Days(null)).toBe(false)
  })

  it('badge/list agreement: an overdue task belongs to 오늘, never to 다음 7일', () => {
    const overdue = day(-30)
    // 다음 7일 badge and list both use isDueInNext7Days → overdue excluded from both
    expect(isDueInNext7Days(overdue)).toBe(false)
    // 오늘 badge and list both use (isDueToday || isOverdue) → overdue included in both
    expect(isDueToday(overdue) || isOverdue(overdue)).toBe(true)
  })
})

// useToday() 훅의 타이머 계산. 자정을 넘겨도 '오늘'이 마운트 시점에 고정돼
// KanbanView가 어제 날짜를 데이터에 박던 버그의 회귀 방지 (TODOS 2026-08-05).
describe('msUntilNextLocalMidnight', () => {
  it('counts down to the next local midnight', async () => {
    const { msUntilNextLocalMidnight } = await import('./date')
    expect(msUntilNextLocalMidnight(new Date(2026, 7, 15, 23, 59, 30))).toBe(30_000)
    expect(msUntilNextLocalMidnight(new Date(2026, 7, 15, 0, 0, 0))).toBe(86_400_000)
  })

  it('lands strictly in the next day at millisecond edges', async () => {
    const { msUntilNextLocalMidnight } = await import('./date')
    expect(msUntilNextLocalMidnight(new Date(2026, 7, 15, 23, 59, 59, 999))).toBe(1)
  })
})
