import { describe, it, expect } from 'vitest'
import { shiftIsoByDays } from './recurrence'
import {
  isVirtualSmartList,
  isActiveTopLevel,
  isTopLevel,
  smartListPredicate,
  SMART_LIST_PREDICATES,
  tagListId,
  tagFromListId
} from './smartLists'
import { todayString, tomorrowString } from './date'
import type { Task } from '../types'

// 판별식이 참조하는 필드만 담아 캐스팅한다. parentId/deletedAt을 빼 두면
// 하위작업·휴지통 제외가 검증되지 않은 채 통과하므로 기본값을 명시한다.
const task = (dueDate: string | null, completed = false, over: Partial<Task> = {}): Task =>
  ({ completed, dueDate, parentId: null, deletedAt: null, ...over }) as unknown as Task

describe('isVirtualSmartList', () => {
  it('treats inbox as a real container, date/utility lists as virtual', () => {
    expect(isVirtualSmartList('inbox')).toBe(false)
    expect(isVirtualSmartList('some-user-list')).toBe(false)
    for (const id of ['today', 'tomorrow', 'next7days', 'all', 'summary', 'completed', 'trash']) {
      expect(isVirtualSmartList(id)).toBe(true)
    }
  })
  it('treats tag views as virtual (a task never has a tag id as its listId)', () => {
    expect(isVirtualSmartList(tagListId('work'))).toBe(true)
  })
})

describe('tag list ids', () => {
  it('round-trips a tag through the list id', () => {
    expect(tagListId('work')).toBe('tag:work')
    expect(tagFromListId(tagListId('work'))).toBe('work')
  })
  it('returns null for non-tag ids', () => {
    expect(tagFromListId('today')).toBeNull()
    expect(tagFromListId('inbox')).toBeNull()
    expect(tagFromListId('some-user-list')).toBeNull()
  })
  it('preserves colons inside a tag name', () => {
    expect(tagFromListId(tagListId('a:b'))).toBe('a:b')
  })
})

describe('smartListPredicate', () => {
  it('resolves date-based lists and returns undefined otherwise', () => {
    expect(typeof smartListPredicate('today')).toBe('function')
    expect(typeof smartListPredicate('tomorrow')).toBe('function')
    expect(typeof smartListPredicate('next7days')).toBe('function')
    expect(typeof smartListPredicate('summary')).toBe('function')
    expect(smartListPredicate('all')).toBeUndefined()
    expect(smartListPredicate('inbox')).toBeUndefined()
    expect(smartListPredicate('completed')).toBeUndefined()
  })
})

describe('SMART_LIST_PREDICATES', () => {
  it('classifies today / tomorrow by local date', () => {
    expect(SMART_LIST_PREDICATES.today(task(todayString()))).toBe(true)
    expect(SMART_LIST_PREDICATES.today(task(tomorrowString()))).toBe(false)
    expect(SMART_LIST_PREDICATES.tomorrow(task(tomorrowString()))).toBe(true)
    expect(SMART_LIST_PREDICATES.tomorrow(task(todayString()))).toBe(false)
  })
  it('summary includes today and next-7-days', () => {
    expect(SMART_LIST_PREDICATES.summary(task(todayString()))).toBe(true)
    expect(SMART_LIST_PREDICATES.summary(task(tomorrowString()))).toBe(true)
  })
  it('excludes completed tasks from every date list', () => {
    expect(SMART_LIST_PREDICATES.today(task(todayString(), true))).toBe(false)
    expect(SMART_LIST_PREDICATES.summary(task(todayString(), true))).toBe(false)
  })
  it('excludes tasks without a due date', () => {
    expect(SMART_LIST_PREDICATES.today(task(null))).toBe(false)
    expect(SMART_LIST_PREDICATES.summary(task(null))).toBe(false)
  })
})

describe('isTopLevel / isActiveTopLevel', () => {
  it('isTopLevel rejects only subtasks', () => {
    expect(isTopLevel(task(null))).toBe(true)
    expect(isTopLevel(task(null, true))).toBe(true) // 완료돼도 최상위는 최상위 (칸반 '완료' 칼럼)
    expect(isTopLevel(task(null, false, { parentId: 'p' }))).toBe(false)
  })

  it('isActiveTopLevel rejects completed, trashed, and subtasks', () => {
    expect(isActiveTopLevel(task(null))).toBe(true)
    expect(isActiveTopLevel(task(null, true))).toBe(false)
    expect(isActiveTopLevel(task(null, false, { deletedAt: '2026-08-05T00:00:00.000Z' }))).toBe(false)
    expect(isActiveTopLevel(task(null, false, { parentId: 'p' }))).toBe(false)
  })
})

describe('date smart lists exclude subtasks and trashed tasks', () => {
  // 이 조건이 빠져 있어서 사이드바 뱃지가 목록보다 많이 세었다(2026-08-05 검증).
  it('today', () => {
    expect(SMART_LIST_PREDICATES.today(task(todayString()))).toBe(true)
    expect(SMART_LIST_PREDICATES.today(task(todayString(), false, { parentId: 'p' }))).toBe(false)
    expect(SMART_LIST_PREDICATES.today(task(todayString(), false, { deletedAt: '2026-08-05T00:00:00.000Z' }))).toBe(
      false
    )
  })

  it('tomorrow / next7days / summary', () => {
    expect(SMART_LIST_PREDICATES.tomorrow(task(tomorrowString(), false, { parentId: 'p' }))).toBe(false)
    expect(SMART_LIST_PREDICATES.next7days(task(tomorrowString(), false, { parentId: 'p' }))).toBe(false)
    expect(SMART_LIST_PREDICATES.summary(task(todayString(), false, { parentId: 'p' }))).toBe(false)
  })
})

/**
 * 기간(startDate~dueDate)은 하루가 아니라 구간이다. 마감일만 보면 8/18~8/20
 * 할일이 8/19에는 어느 화면에도 없다 — 진행 중인 그날 정작 안 보인다.
 */
describe('기간 할일 — 진행 중인 날에도 보인다', () => {
  const ranged = (over: Partial<Task>): Task =>
    ({
      id: 'r',
      title: '스프린트',
      description: '',
      completed: false,
      priority: 'none',
      dueTime: null,
      reminderAt: null,
      listId: 'inbox',
      parentId: null,
      tags: [],
      createdAt: '2026-08-01T00:00:00.000Z',
      completedAt: null,
      deletedAt: null,
      sortOrder: 0,
      pinned: false,
      isRecurring: false,
      recurringPattern: null,
      attachments: [],
      scheduledStart: null,
      scheduledEnd: null,
      ...over
    }) as Task

  it('오늘이 기간 안이면 오늘에 든다', () => {
    const today = todayString()
    const t = ranged({ startDate: shiftIsoByDays(today, -2), dueDate: shiftIsoByDays(today, 3) })
    expect(SMART_LIST_PREDICATES.today(t)).toBe(true)
  })

  it('기간이 아직 시작 전이면 오늘에 들지 않는다', () => {
    const today = todayString()
    const t = ranged({ startDate: shiftIsoByDays(today, 1), dueDate: shiftIsoByDays(today, 3) })
    expect(SMART_LIST_PREDICATES.today(t)).toBe(false)
  })

  it('기간이 끝났으면 연체 규칙이 맡는다', () => {
    const today = todayString()
    const t = ranged({ startDate: shiftIsoByDays(today, -5), dueDate: shiftIsoByDays(today, -1) })
    expect(SMART_LIST_PREDICATES.today(t)).toBe(true)
  })
})
