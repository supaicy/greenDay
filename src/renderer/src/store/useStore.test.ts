import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useStore } from './useStore'
import type { Task } from '../types'

/**
 * 2026-08-05 검증에서 고친 스토어 동작을 고정한다.
 * 그 전에는 스토어 생성 시점에 localStorage를 바로 읽어서 import만으로 죽었고,
 * 그래서 이 로직 전체가 테스트 없이 굴러갔다.
 */

const task = (over: Partial<Task>): Task =>
  ({
    id: 't1',
    title: 'task',
    description: '',
    completed: false,
    priority: 'none',
    dueDate: null,
    dueTime: null,
    reminderAt: null,
    listId: 'inbox',
    parentId: null,
    tags: [],
    createdAt: '2026-08-05T00:00:00.000Z',
    completedAt: null,
    deletedAt: null,
    sortOrder: 0,
    isRecurring: false,
    recurringPattern: null,
    attachments: [],
    scheduledStart: null,
    scheduledEnd: null,
    ...over
  }) as Task

beforeEach(() => {
  // 스토어는 window.api(IPC)로 영속화한다. 테스트에서는 호출만 삼킨다.
  vi.stubGlobal('window', {
    api: {
      updateTask: vi.fn(),
      addScoreEvent: vi.fn(),
      addScoreEvents: vi.fn(),
      batchUpdateTasks: vi.fn(),
      createTask: vi.fn(),
      reorderTasks: vi.fn(),
      toggleHabitLog: vi.fn(),
      deleteTask: vi.fn()
    }
  })
  useStore.setState({ tasks: [], score: { total: 10, events: [] }, batchSelectedIds: [], batchMode: false })
})

describe('toggleTask scoring', () => {
  it('nets to zero over a complete → uncomplete round trip', async () => {
    useStore.setState({ tasks: [task({ id: 'a', priority: 'high' })] })
    await useStore.getState().toggleTask('a')
    expect(useStore.getState().score.total).toBe(13)
    await useStore.getState().toggleTask('a')
    expect(useStore.getState().score.total).toBe(10)
  })

  it('pays by priority', async () => {
    useStore.setState({ tasks: [task({ id: 'a', priority: 'medium' })] })
    await useStore.getState().toggleTask('a')
    expect(useStore.getState().score.total).toBe(12)
  })

  // 지급 기록이 없으면(예: 이 기능이 생기기 전에 완료된 항목) 회수하지 않는다.
  // 현재 우선순위로 되돌리면 준 적 없는 점수를 깎아 총점이 흘렀다.
  it('does not revoke points it has no record of awarding', async () => {
    useStore.setState({
      tasks: [task({ id: 'a', priority: 'high', completed: true })],
      score: { total: 1, events: [] }
    })
    await useStore.getState().toggleTask('a')
    expect(useStore.getState().score.total).toBe(1)
  })

  // 완료 후 우선순위를 바꿔도 준 만큼만 회수해야 한다.
  it('revokes what was actually awarded, not what the current priority is worth', async () => {
    useStore.setState({ tasks: [task({ id: 'a', priority: 'high' })] })
    await useStore.getState().toggleTask('a') // +3
    useStore.setState((s) => ({ tasks: s.tasks.map((t) => ({ ...t, priority: 'none' as const })) }))
    await useStore.getState().toggleTask('a') // -3, not -1
    expect(useStore.getState().score.total).toBe(10)
  })
})

describe('batchComplete scoring', () => {
  it('awards once for the whole selection, counting only tasks that were incomplete', async () => {
    useStore.setState({
      tasks: [
        task({ id: 'a', priority: 'high' }),
        task({ id: 'b', priority: 'low' }),
        task({ id: 'c', priority: 'high', completed: true })
      ],
      batchSelectedIds: ['a', 'b', 'c']
    })
    await useStore.getState().batchComplete()
    // high(3) + low(1) = 4. 이미 완료였던 c는 세지 않는다 — 세면 나중에 하나씩
    // 완료 취소할 때 준 적 없는 점수가 회수된다.
    expect(useStore.getState().score.total).toBe(14)
    // 태스크별로 남기되(회수 계산에 필요) 스토어 쓰기는 한 번이다.
    expect(useStore.getState().score.events).toHaveLength(2)
    expect(useStore.getState().score.events.map((e) => e.taskId)).toEqual(['a', 'b'])
  })
})

describe('batchComplete recurrence', () => {
  // toggleTask는 완료 시 다음 인스턴스를 만들지만 batchComplete는 안 만들어
  // 일괄 완료가 반복 시리즈를 조용히 끝냈다 (TODOS 2026-08-05 /review).
  it('spawns the next instance of a recurring task, like toggleTask does', async () => {
    useStore.setState({
      tasks: [task({ id: 'r', title: '운동', isRecurring: true, recurringPattern: 'daily', dueDate: '2026-08-15' })],
      batchSelectedIds: ['r']
    })
    await useStore.getState().batchComplete()
    const next = useStore.getState().tasks.find((t) => !t.completed)
    expect(next?.title).toBe('운동')
    expect(next?.dueDate).toBe('2026-08-16')
    expect(next?.isRecurring).toBe(true)
    expect(next?.recurringPattern).toBe('daily')
  })

  // 템플릿은 시리즈 소유(2026-08-15 제품 결정) — 완료로 다음 인스턴스가 생겨도
  // 시간블록 템플릿이 이어져야 한다. 회차별 오버라이드는 지난 날짜 것이라 잇지 않는다.
  it('carries the schedule template (not overrides) to the spawned instance', async () => {
    useStore.setState({
      tasks: [
        task({
          id: 'r',
          title: '운동',
          isRecurring: true,
          recurringPattern: 'daily',
          dueDate: '2026-08-15',
          scheduledStart: '2026-08-15T07:00:00',
          scheduledEnd: '2026-08-15T08:00:00',
          scheduledOverrides: { '2026-08-15': null }
        })
      ]
    })
    await useStore.getState().toggleTask('r')
    const next = useStore.getState().tasks.find((t) => !t.completed)
    expect(next?.scheduledStart).toBe('2026-08-15T07:00:00')
    expect(next?.scheduledEnd).toBe('2026-08-15T08:00:00')
    expect(next?.scheduledOverrides ?? null).toBeNull()
  })

  // 같은 시리즈의 두 회차(8/15, 8/16)를 함께 완료하면, 하나씩 완료했을 때와
  // 같아야 한다: 8/16 중복 스폰 없이 8/17 하나만 생긴다.
  it('matches sequential-toggle semantics for two occurrences of one series', async () => {
    useStore.setState({
      tasks: [
        task({ id: 'r1', title: '운동', isRecurring: true, recurringPattern: 'daily', dueDate: '2026-08-15' }),
        task({ id: 'r2', title: '운동', isRecurring: true, recurringPattern: 'daily', dueDate: '2026-08-16' })
      ],
      batchSelectedIds: ['r1', 'r2']
    })
    await useStore.getState().batchComplete()
    const spawned = useStore.getState().tasks.filter((t) => !t.completed)
    expect(spawned.map((t) => t.dueDate)).toEqual(['2026-08-17'])
  })
})

describe('batchComplete recurrence — duplicate instances', () => {
  // 같은 시리즈의 같은 기한 인스턴스 2개(중복 데이터)를 함께 완료해도,
  // 하나씩 완료했을 때처럼 다음 회차는 하나만 생겨야 한다.
  it('spawns only one next instance for duplicate same-day occurrences', async () => {
    useStore.setState({
      tasks: [
        task({ id: 'd1', title: '운동', isRecurring: true, recurringPattern: 'daily', dueDate: '2026-08-15' }),
        task({ id: 'd2', title: '운동', isRecurring: true, recurringPattern: 'daily', dueDate: '2026-08-15' })
      ],
      batchSelectedIds: ['d1', 'd2']
    })
    await useStore.getState().batchComplete()
    const spawned = useStore.getState().tasks.filter((t) => !t.completed)
    expect(spawned.map((t) => t.dueDate)).toEqual(['2026-08-16'])
  })
})

describe('reorderTasks', () => {
  it('reflects the new order in the array itself, not only in sortOrder', async () => {
    useStore.setState({
      tasks: [task({ id: 'a', sortOrder: 0 }), task({ id: 'b', sortOrder: 1 }), task({ id: 'c', sortOrder: 2 })]
    })
    await useStore.getState().reorderTasks(['c', 'a', 'b'])
    expect(useStore.getState().tasks.map((t) => t.id)).toEqual(['c', 'a', 'b'])
  })

  it('leaves tasks outside the reordered view in a stable relative order', async () => {
    useStore.setState({ tasks: [task({ id: 'a', sortOrder: 5 }), task({ id: 'x', sortOrder: 5 })] })
    await useStore.getState().reorderTasks(['a'])
    expect(useStore.getState().tasks.map((t) => t.id)).toEqual(['a', 'x'])
  })
})

describe('toggleHabitLog scoring', () => {
  it('revokes the point when the check is undone', async () => {
    await useStore.getState().toggleHabitLog('h1', '2026-08-05')
    expect(useStore.getState().score.total).toBe(11)
    await useStore.getState().toggleHabitLog('h1', '2026-08-05')
    expect(useStore.getState().score.total).toBe(10)
  })
})
