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

// 벽시계 분을 epoch ms에 더하면 서머타임 전환일 이후가 통째로 한 시간 밀린다.
// 앱은 en 로케일을 지원하므로 KST 밖에서도 맞아야 한다.
describe('resolveTimeBlockDrop — 서머타임', () => {
  it('전환일에도 그리드 행과 저장 시각이 일치한다', () => {
    const plain: Task = { ...baseTask, isRecurring: false, recurringPattern: null, scheduledStart: null, scheduledEnd: null }
    // 2026-03-08은 미국 DST 시작일. startHour 9 + 0px = 09:00 행.
    const patch = resolveTimeBlockDrop({
      yPx: 0, dayStr: '2026-03-08', startHour: 9, pxPerMin: 1,
      task: plain, isBlockMove: false, sourceDate: null
    })
    expect(patch?.scheduledStart).toBe('2026-03-08T09:00:00')
  })
})

// 반복을 끈 뒤 남은 오버라이드는 무시해야 한다. 이 게이트가 없으면 유령 블록이
// 뜬다 — 그런데 기존 케이스가 전부 반복 task라 게이트를 지워도 초록이었다.
describe('getScheduledForOccurrence — 반복이 아닌 task', () => {
  it('반복을 끈 뒤 남은 오버라이드 대신 템플릿을 쓴다', () => {
    const t: Task = {
      ...baseTask,
      isRecurring: false,
      recurringPattern: null,
      scheduledOverrides: { '2026-08-17': null }
    }
    expect(getScheduledForOccurrence(t, '2026-08-17')).toEqual({
      start: baseTask.scheduledStart,
      end: baseTask.scheduledEnd
    })
  })
})

// 완료한 반복 인스턴스는 자기 날짜에만 남아야 한다. 완료해도 템플릿이 미래
// 발생일을 계속 주장하면, 스폰된 다음 인스턴스와 나란히 블록이 두 개 뜨고
// 회차를 완료할 때마다 하나씩 늘어난다.
describe('getScheduledForOccurrence — 완료한 반복 인스턴스', () => {
  const doneMon: Task = {
    ...baseTask,
    recurringPattern: 'weekly:1',
    dueDate: '2026-08-10',
    completed: true,
    completedAt: '2026-08-10T15:00:00'
  }

  it('완료한 회차는 자기 날짜에만 그린다', () => {
    // 자기 발생일 — 한 일을 보여주는 건 유지
    expect(getScheduledForOccurrence(doneMon, '2026-08-10')).not.toBeNull()
    // 다음 발생일은 새로 스폰된 인스턴스의 몫이다
    expect(getScheduledForOccurrence(doneMon, '2026-08-17')).toBeNull()
    expect(getScheduledForOccurrence(doneMon, '2026-08-24')).toBeNull()
  })

  it('미완료 회차는 그대로 발생일마다 그린다', () => {
    const open: Task = { ...doneMon, completed: false, completedAt: null }
    expect(getScheduledForOccurrence(open, '2026-08-17')).not.toBeNull()
  })

  it('완료한 회차의 오버라이드는 자기 날짜에서 존중된다', () => {
    const t: Task = {
      ...doneMon,
      scheduledOverrides: { '2026-08-10': { start: '2026-08-10T08:00:00', end: '2026-08-10T09:00:00' } }
    }
    expect(getScheduledForOccurrence(t, '2026-08-10')).toEqual({
      start: '2026-08-10T08:00:00',
      end: '2026-08-10T09:00:00'
    })
  })
})

// 레일에서 반복 할일을 비발생일에 놓으면, 템플릿만 세팅돼 레일에서는 빠지는데
// occursOn 게이트에 막혀 블록도 안 그려진다 — 양쪽 화면에서 사라진다.
describe('resolveTimeBlockDrop — 레일에서 비발생일로', () => {
  const weeklyMonUnscheduled: Task = {
    ...baseTask,
    recurringPattern: 'weekly:1',
    dueDate: null,
    scheduledStart: null,
    scheduledEnd: null
  }

  it('놓은 날이 발생일이 아니면 그날 오버라이드도 함께 남긴다', () => {
    // 2026-08-19는 수요일 — weekly:1(월)의 발생일이 아니다
    const patch = resolveTimeBlockDrop({
      yPx: 9 * 60, dayStr: '2026-08-19', startHour: 0, pxPerMin: 1,
      task: weeklyMonUnscheduled, isBlockMove: false, sourceDate: null
    })
    expect(patch?.scheduledStart).toBe('2026-08-19T09:00:00')
    expect(patch?.scheduledOverrides).toEqual({
      '2026-08-19': { start: '2026-08-19T09:00:00', end: '2026-08-19T09:30:00' }
    })
    // 실제로 그날 그려지는지 확인
    const after = { ...weeklyMonUnscheduled, ...patch } as Task
    expect(getScheduledForOccurrence(after, '2026-08-19')).not.toBeNull()
  })

  it('발생일에 놓으면 템플릿만 세팅한다', () => {
    const patch = resolveTimeBlockDrop({
      yPx: 9 * 60, dayStr: '2026-08-17', startHour: 0, pxPerMin: 1,
      task: { ...weeklyMonUnscheduled, dueDate: '2026-08-10' }, isBlockMove: false, sourceDate: null
    })
    expect(patch?.scheduledOverrides).toBeUndefined()
  })
})
