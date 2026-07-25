import { describe, it, expect } from 'vitest'
import { isVirtualSmartList, smartListPredicate, SMART_LIST_PREDICATES } from './smartLists'
import { todayString, tomorrowString } from './date'
import type { Task } from '../types'

// 판별식은 completed/dueDate 만 참조하므로 최소 형태로 캐스팅해 검증한다.
const task = (dueDate: string | null, completed = false): Task =>
  ({ completed, dueDate }) as unknown as Task

describe('isVirtualSmartList', () => {
  it('treats inbox as a real container, date/utility lists as virtual', () => {
    expect(isVirtualSmartList('inbox')).toBe(false)
    expect(isVirtualSmartList('some-user-list')).toBe(false)
    for (const id of ['today', 'tomorrow', 'next7days', 'all', 'summary', 'completed', 'trash']) {
      expect(isVirtualSmartList(id)).toBe(true)
    }
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
