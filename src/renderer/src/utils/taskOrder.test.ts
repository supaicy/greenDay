import { describe, it, expect } from 'vitest'
import { orderTasks, reorderWithinPinGroup } from './taskOrder'
import type { Task } from '../types'

const task = (over: Partial<Task>): Task =>
  ({
    id: 't',
    title: 'task',
    description: '',
    completed: false,
    priority: 'none',
    dueDate: null,
    dueTime: null,
    startDate: null,
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

const ids = (ts: Task[]): string[] => ts.map((t) => t.id)

describe('orderTasks — 정렬', () => {
  it("'default'는 배열 순서를 그대로 둔다", () => {
    const list = [task({ id: 'c' }), task({ id: 'a' }), task({ id: 'b' })]
    expect(ids(orderTasks(list, 'default', 'asc'))).toEqual(['c', 'a', 'b'])
  })

  it('마감일 오름차순 — 날짜 없는 것은 뒤로', () => {
    const list = [task({ id: 'none' }), task({ id: 'late', dueDate: '2026-09-01' }), task({ id: 'soon', dueDate: '2026-08-20' })]
    expect(ids(orderTasks(list, 'dueDate', 'asc'))).toEqual(['soon', 'late', 'none'])
  })

  it('마감일 내림차순에서도 날짜 없는 것은 뒤에 남는다', () => {
    const list = [task({ id: 'none' }), task({ id: 'late', dueDate: '2026-09-01' }), task({ id: 'soon', dueDate: '2026-08-20' })]
    // 방향을 뒤집는 것은 '값이 있는 것들'의 순서지, 빈 값의 자리가 아니다.
    expect(ids(orderTasks(list, 'dueDate', 'desc'))).toEqual(['late', 'soon', 'none'])
  })

  it('우선순위는 높은 것부터', () => {
    const list = [task({ id: 'low', priority: 'low' }), task({ id: 'high', priority: 'high' }), task({ id: 'mid', priority: 'medium' })]
    expect(ids(orderTasks(list, 'priority', 'asc'))).toEqual(['high', 'mid', 'low'])
  })

  it('제목은 한국어 순서로', () => {
    const list = [task({ id: '2', title: '나' }), task({ id: '1', title: '가' })]
    expect(ids(orderTasks(list, 'title', 'asc'))).toEqual(['1', '2'])
  })

  it('생성일 정렬 — 최신이 먼저', () => {
    const list = [
      task({ id: 'old', createdAt: '2026-08-01T00:00:00.000Z' }),
      task({ id: 'new', createdAt: '2026-08-10T00:00:00.000Z' })
    ]
    expect(ids(orderTasks(list, 'createdAt', 'asc'))).toEqual(['new', 'old'])
    expect(ids(orderTasks(list, 'createdAt', 'desc'))).toEqual(['old', 'new'])
  })

  it('내림차순은 우선순위·제목에도 걸린다', () => {
    const byP = [task({ id: 'low', priority: 'low' }), task({ id: 'high', priority: 'high' })]
    expect(ids(orderTasks(byP, 'priority', 'desc'))).toEqual(['low', 'high'])
    const byT = [task({ id: '1', title: '가' }), task({ id: '2', title: '나' })]
    expect(ids(orderTasks(byT, 'title', 'desc'))).toEqual(['2', '1'])
  })

  it('원본 배열을 건드리지 않는다', () => {
    const list = [task({ id: 'b', priority: 'low' }), task({ id: 'a', priority: 'high' })]
    orderTasks(list, 'priority', 'asc')
    expect(ids(list)).toEqual(['b', 'a'])
  })
})

describe('orderTasks — 고정', () => {
  it('고정한 할일은 정렬이 없어도 맨 위로 온다', () => {
    const list = [task({ id: 'a' }), task({ id: 'b' }), task({ id: 'pinned', pinned: true })]
    expect(ids(orderTasks(list, 'default', 'asc'))).toEqual(['pinned', 'a', 'b'])
  })

  it('고정끼리는 원래 순서를 지킨다', () => {
    const list = [task({ id: 'p2', pinned: true }), task({ id: 'a' }), task({ id: 'p1', pinned: true })]
    // 고정은 '위로 올린다'는 뜻이지 '다시 줄 세운다'는 뜻이 아니다.
    expect(ids(orderTasks(list, 'default', 'asc'))).toEqual(['p2', 'p1', 'a'])
  })

  it('고정은 어떤 정렬 기준보다도 앞선다', () => {
    const list = [
      task({ id: 'high', priority: 'high' }),
      task({ id: 'pinnedNone', pinned: true, priority: 'none' })
    ]
    // 고정을 정렬에 맡기면 '높음' 하나만 생겨도 고정한 것이 아래로 밀린다 —
    // 그러면 고정이라는 말이 무의미해진다.
    expect(ids(orderTasks(list, 'priority', 'asc'))).toEqual(['pinnedNone', 'high'])
  })

  it('고정한 것이 없으면 배열을 그대로 돌려준다', () => {
    const list = [task({ id: 'a' }), task({ id: 'b' })]
    expect(ids(orderTasks(list, 'default', 'asc'))).toEqual(['a', 'b'])
  })
})

describe('reorderWithinPinGroup', () => {
  const list = [
    task({ id: 'p1', pinned: true }),
    task({ id: 'p2', pinned: true }),
    task({ id: 'a' }),
    task({ id: 'b' }),
    task({ id: 'c' })
  ]

  it('같은 묶음 안에서는 자리를 바꾼다', () => {
    expect(reorderWithinPinGroup(list, 'c', 'a')).toEqual(['c', 'a', 'b'])
  })

  it('고정된 것끼리도 바꿀 수 있다', () => {
    expect(reorderWithinPinGroup(list, 'p2', 'p1')).toEqual(['p2', 'p1'])
  })

  it('고정 경계를 넘는 드롭은 거절한다', () => {
    // 화면 순서를 그대로 넘기면 applyReorder가 고정이 만든 배치를 sortOrder에
    // 구워버려, 고정을 풀어도 그 항목이 맨 위에 남는다.
    expect(reorderWithinPinGroup(list, 'a', 'p1')).toBeNull()
    expect(reorderWithinPinGroup(list, 'p1', 'a')).toBeNull()
  })

  it('제자리 드롭과 모르는 id는 거절한다', () => {
    expect(reorderWithinPinGroup(list, 'a', 'a')).toBeNull()
    expect(reorderWithinPinGroup(list, 'a', 'nope')).toBeNull()
  })

  it('고정이 없으면 보이는 목록 전체가 대상이다', () => {
    const plain = [task({ id: 'a' }), task({ id: 'b' }), task({ id: 'c' })]
    expect(reorderWithinPinGroup(plain, 'a', 'c')).toEqual(['b', 'c', 'a'])
  })
})
