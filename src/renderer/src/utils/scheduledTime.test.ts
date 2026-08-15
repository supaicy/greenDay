import { describe, it, expect } from 'vitest'
import { snapTo15Min, getScheduledForOccurrence, isValidSchedulePair, resolveTimeBlockDrop } from './scheduledTime'
import type { Task } from '../types'

describe('snapTo15Min', () => {
  it('snaps 14:07 down to 14:00', () => {
    expect(snapTo15Min('2026-04-22T14:07:00')).toBe('2026-04-22T14:00:00')
  })
  it('snaps 14:08 up to 14:15', () => {
    expect(snapTo15Min('2026-04-22T14:08:00')).toBe('2026-04-22T14:15:00')
  })
  it('snaps 14:22 down to 14:15', () => {
    expect(snapTo15Min('2026-04-22T14:22:00')).toBe('2026-04-22T14:15:00')
  })
  it('snaps 14:23 up to 14:30', () => {
    expect(snapTo15Min('2026-04-22T14:23:00')).toBe('2026-04-22T14:30:00')
  })
  it('snaps 14:58 up to 15:00 (hour rollover)', () => {
    expect(snapTo15Min('2026-04-22T14:58:00')).toBe('2026-04-22T15:00:00')
  })
  it('leaves 14:00 unchanged', () => {
    expect(snapTo15Min('2026-04-22T14:00:00')).toBe('2026-04-22T14:00:00')
  })
  it('clamps to 23:45 when snapping would roll past midnight', () => {
    expect(snapTo15Min('2026-04-22T23:53:00')).toBe('2026-04-22T23:45:00')
  })
})

const baseTask: Task = {
  id: 't1',
  title: 'weekly sync',
  description: '',
  completed: false,
  priority: 'none',
  dueDate: null,
  dueTime: null,
  reminderAt: null,
  listId: 'inbox',
  parentId: null,
  tags: [],
  createdAt: '2026-04-21T00:00:00',
  completedAt: null,
  deletedAt: null,
  sortOrder: 0,
  isRecurring: true,
  recurringPattern: 'weekly',
  attachments: [],
  scheduledStart: '2026-04-21T14:00:00',
  scheduledEnd: '2026-04-21T15:00:00'
}

describe('getScheduledForOccurrence', () => {
  it('returns null when task has no scheduledStart', () => {
    const t = { ...baseTask, scheduledStart: null, scheduledEnd: null }
    expect(getScheduledForOccurrence(t, '2026-04-28')).toBeNull()
  })

  it('projects template time onto the occurrence date', () => {
    const result = getScheduledForOccurrence(baseTask, '2026-04-28')
    expect(result).toEqual({
      start: '2026-04-28T14:00:00',
      end: '2026-04-28T15:00:00'
    })
  })

  it('preserves duration across occurrences', () => {
    const t = {
      ...baseTask,
      scheduledStart: '2026-04-21T09:30:00',
      scheduledEnd: '2026-04-21T11:15:00' // 1h 45m duration
    }
    const result = getScheduledForOccurrence(t, '2026-05-05')
    expect(result).toEqual({
      start: '2026-05-05T09:30:00',
      end: '2026-05-05T11:15:00'
    })
  })

  it('non-recurring task: returns raw start/end regardless of date arg', () => {
    const t = { ...baseTask, isRecurring: false, recurringPattern: null }
    const result = getScheduledForOccurrence(t, '2026-05-05')
    expect(result).toEqual({
      start: '2026-04-21T14:00:00',
      end: '2026-04-21T15:00:00'
    })
  })
})

describe('isValidSchedulePair', () => {
  it('accepts both null', () => {
    expect(isValidSchedulePair(null, null)).toBe(true)
  })
  it('accepts both set with end > start', () => {
    expect(isValidSchedulePair('2026-04-22T14:00:00', '2026-04-22T14:30:00')).toBe(true)
  })
  it('rejects one set, one null', () => {
    expect(isValidSchedulePair('2026-04-22T14:00:00', null)).toBe(false)
    expect(isValidSchedulePair(null, '2026-04-22T14:30:00')).toBe(false)
  })
  it('rejects end <= start', () => {
    expect(isValidSchedulePair('2026-04-22T14:00:00', '2026-04-22T14:00:00')).toBe(false)
    expect(isValidSchedulePair('2026-04-22T14:30:00', '2026-04-22T14:00:00')).toBe(false)
  })
  it('rejects block shorter than 15 min', () => {
    expect(isValidSchedulePair('2026-04-22T14:00:00', '2026-04-22T14:10:00')).toBe(false)
  })
})

// 2026-08-15 제품 결정: 반복 할일의 시간블록은 (a) 템플릿 — 실제 반복 발생일에만
// 표시하고, (b) 회차별 오버라이드 — 특정 날짜만 다른 시각(또는 없음)으로 잡는다.
// 그 전에는 날짜를 버리고 시각만 써서 비발생일에도 매일 블록이 떴다.
describe('getScheduledForOccurrence — 발생일 게이트와 회차 오버라이드', () => {
  const weeklyMon: Task = { ...baseTask, recurringPattern: 'weekly:1', dueDate: '2026-08-10' } // 월 anchor

  it('shows the template only on occurrence dates', () => {
    expect(getScheduledForOccurrence(weeklyMon, '2026-08-17')).toEqual({
      start: '2026-08-17T14:00:00',
      end: '2026-08-17T15:00:00'
    })
    expect(getScheduledForOccurrence(weeklyMon, '2026-08-18')).toBeNull() // 화 — 발생일 아님
    expect(getScheduledForOccurrence(weeklyMon, '2026-08-03')).toBeNull() // anchor 이전
  })

  it('always shows on the instance own dueDate even off-pattern', () => {
    const t: Task = { ...weeklyMon, dueDate: '2026-08-12' } // 수 anchor인데 패턴은 weekly:1(월)
    expect(getScheduledForOccurrence(t, '2026-08-12')).toEqual({
      start: '2026-08-12T14:00:00',
      end: '2026-08-12T15:00:00'
    })
  })

  it('per-date override wins over the template', () => {
    const t: Task = {
      ...weeklyMon,
      scheduledOverrides: { '2026-08-17': { start: '2026-08-17T08:00:00', end: '2026-08-17T09:00:00' } }
    }
    expect(getScheduledForOccurrence(t, '2026-08-17')).toEqual({
      start: '2026-08-17T08:00:00',
      end: '2026-08-17T09:00:00'
    })
  })

  it('a null override suppresses only that occurrence', () => {
    const t: Task = { ...weeklyMon, scheduledOverrides: { '2026-08-17': null } }
    expect(getScheduledForOccurrence(t, '2026-08-17')).toBeNull()
    expect(getScheduledForOccurrence(t, '2026-08-24')).not.toBeNull()
  })

  it('an override renders even on a non-occurrence date (moved occurrence)', () => {
    const t: Task = {
      ...weeklyMon,
      scheduledOverrides: { '2026-08-18': { start: '2026-08-18T14:00:00', end: '2026-08-18T15:00:00' } }
    }
    expect(getScheduledForOccurrence(t, '2026-08-18')).toEqual({
      start: '2026-08-18T14:00:00',
      end: '2026-08-18T15:00:00'
    })
  })
})

// 주/일 캘린더 onDrop 중복(~40줄)을 추출한 순수 리졸버. 스냅·클램프·길이 보존과
// 반복 할일의 회차 오버라이드 이동을 여기서 판정한다.
describe('resolveTimeBlockDrop', () => {
  const plain: Task = { ...baseTask, isRecurring: false, recurringPattern: null, scheduledStart: null, scheduledEnd: null }

  it('rail drop: snaps to the 15-min grid with a 30-min default block', () => {
    const patch = resolveTimeBlockDrop({
      yPx: 125, dayStr: '2026-08-17', startHour: 6, pxPerMin: 1,
      task: plain, isBlockMove: false, sourceDate: null
    })
    expect(patch).toEqual({ id: 't1', scheduledStart: '2026-08-17T08:00:00', scheduledEnd: '2026-08-17T08:30:00' })
  })

  it('block move: preserves the original duration', () => {
    const t: Task = { ...plain, scheduledStart: '2026-08-16T10:00:00', scheduledEnd: '2026-08-16T11:45:00' }
    const patch = resolveTimeBlockDrop({
      yPx: 0, dayStr: '2026-08-17', startHour: 9, pxPerMin: 1,
      task: t, isBlockMove: true, sourceDate: '2026-08-16'
    })
    expect(patch).toEqual({ id: 't1', scheduledStart: '2026-08-17T09:00:00', scheduledEnd: '2026-08-17T10:45:00' })
  })

  it('clamps to the end of the day so the minimum block still fits', () => {
    const patch = resolveTimeBlockDrop({
      yPx: 24 * 60, dayStr: '2026-08-17', startHour: 0, pxPerMin: 1,
      task: plain, isBlockMove: false, sourceDate: null
    })
    expect(patch?.scheduledStart).toBe('2026-08-17T23:44:00')
    expect(patch?.scheduledEnd).toBe('2026-08-17T23:59:00')
  })

  it('recurring block move on the same day: overrides only that occurrence', () => {
    // baseTask: weekly:1 템플릿 14:00-15:00, anchor 8/10(월)
    const t: Task = { ...baseTask, recurringPattern: 'weekly:1', dueDate: '2026-08-10' }
    const patch = resolveTimeBlockDrop({
      yPx: 8 * 60, dayStr: '2026-08-17', startHour: 0, pxPerMin: 1,
      task: t, isBlockMove: true, sourceDate: '2026-08-17'
    })
    expect(patch).toEqual({
      id: 't1',
      scheduledOverrides: { '2026-08-17': { start: '2026-08-17T08:00:00', end: '2026-08-17T09:00:00' } }
    })
  })

  it('recurring block move to another day: suppresses the source occurrence', () => {
    const t: Task = { ...baseTask, recurringPattern: 'weekly:1', dueDate: '2026-08-10' }
    const patch = resolveTimeBlockDrop({
      yPx: 8 * 60, dayStr: '2026-08-18', startHour: 0, pxPerMin: 1,
      task: t, isBlockMove: true, sourceDate: '2026-08-17'
    })
    expect(patch).toEqual({
      id: 't1',
      scheduledOverrides: {
        '2026-08-17': null,
        '2026-08-18': { start: '2026-08-18T08:00:00', end: '2026-08-18T09:00:00' }
      }
    })
  })

  it('moving an already-moved occurrence drops the stale override key', () => {
    const t: Task = {
      ...baseTask,
      recurringPattern: 'weekly:1',
      dueDate: '2026-08-10',
      scheduledOverrides: {
        '2026-08-17': null,
        '2026-08-18': { start: '2026-08-18T08:00:00', end: '2026-08-18T09:00:00' }
      }
    }
    const patch = resolveTimeBlockDrop({
      yPx: 10 * 60, dayStr: '2026-08-19', startHour: 0, pxPerMin: 1,
      task: t, isBlockMove: true, sourceDate: '2026-08-18'
    })
    // 8/18은 발생일이 아니므로 null 대신 키 삭제, 8/17 억제는 유지
    expect(patch?.scheduledOverrides).toEqual({
      '2026-08-17': null,
      '2026-08-19': { start: '2026-08-19T10:00:00', end: '2026-08-19T11:00:00' }
    })
  })
})
