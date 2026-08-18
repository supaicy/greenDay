import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
    startDate: null,
    reminderAt: null,
    pinned: false,
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

// 반복 스폰은 '오늘'을 하한으로 쓴다(밀린 시리즈 따라잡기). 실제 시계에 기대면
// 기대값이 날짜마다 달라지므로 고정한다.
describe('batchComplete recurrence', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

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

describe('batchComplete recurrence — 스토어 쓰기 횟수', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  // 바로 위 addScores 주석이 지적한 것과 같은 이유: 건당 addTask는 선택 수만큼
  // 스토어 쓰기(=전체 재렌더)와 IPC를 만든다. 스폰도 한 번에 반영해야 한다.
  it('writes the store once for the whole batch, however many spawns', async () => {
    useStore.setState({
      tasks: [
        task({ id: 'a', title: '운동', isRecurring: true, recurringPattern: 'daily', dueDate: '2026-08-15' }),
        task({ id: 'b', title: '독서', isRecurring: true, recurringPattern: 'daily', dueDate: '2026-08-15' }),
        task({ id: 'c', title: '명상', isRecurring: true, recurringPattern: 'daily', dueDate: '2026-08-15' })
      ],
      batchSelectedIds: ['a', 'b', 'c']
    })
    let writes = 0
    const unsub = useStore.subscribe(() => {
      writes++
    })
    await useStore.getState().batchComplete()
    unsub()

    const spawned = useStore.getState().tasks.filter((t) => !t.completed)
    expect(spawned.map((t) => t.title).sort()).toEqual(['독서', '명상', '운동'])
    // 완료 반영 1 + 스폰 추가 1 + 점수 1 = 3. 스폰 3건이 각자 쓰면 5가 된다.
    expect(writes).toBe(3)
  })

  it('gives spawns distinct sortOrder within a list', async () => {
    useStore.setState({
      tasks: [
        task({ id: 'a', title: '운동', isRecurring: true, recurringPattern: 'daily', dueDate: '2026-08-15' }),
        task({ id: 'b', title: '독서', isRecurring: true, recurringPattern: 'daily', dueDate: '2026-08-15' })
      ],
      batchSelectedIds: ['a', 'b']
    })
    await useStore.getState().batchComplete()
    const orders = useStore
      .getState()
      .tasks.filter((t) => !t.completed)
      .map((t) => t.sortOrder)
    expect(new Set(orders).size).toBe(orders.length)
  })
})

describe('batchComplete recurrence — duplicate instances', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

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

// 시간블록 오버라이드는 반복 시리즈에 딸린 개념이다. 배정을 해제하거나 반복을
// 끄면 함께 사라져야 하는데, 규칙이 호출처에 흩어져 있어 한 곳(레일 드롭)이
// 빠졌고 거기서 유령 블록이 남았다. 규칙은 스토어가 갖는다.
describe('updateTask — scheduledOverrides 불변식', () => {
  const recurringWithOverride = () =>
    task({
      id: 'r',
      isRecurring: true,
      recurringPattern: 'weekly:1',
      dueDate: '2026-08-10',
      scheduledStart: '2026-08-10T14:00:00',
      scheduledEnd: '2026-08-10T15:00:00',
      scheduledOverrides: { '2026-08-17': { start: '2026-08-17T08:00:00', end: '2026-08-17T09:00:00' } }
    })

  it('배정을 해제하면 회차 오버라이드도 지운다', async () => {
    useStore.setState({ tasks: [recurringWithOverride()] })
    await useStore.getState().updateTask({ id: 'r', scheduledStart: null, scheduledEnd: null })
    expect(useStore.getState().tasks[0].scheduledOverrides ?? null).toBeNull()
  })

  it('반복을 끄면 회차 오버라이드도 지운다', async () => {
    useStore.setState({ tasks: [recurringWithOverride()] })
    await useStore.getState().updateTask({ id: 'r', isRecurring: false, recurringPattern: null })
    expect(useStore.getState().tasks[0].scheduledOverrides ?? null).toBeNull()
  })

  it('반복 패턴이 바뀌면 이전 발생일 기준 오버라이드를 버린다', async () => {
    useStore.setState({ tasks: [recurringWithOverride()] })
    await useStore.getState().updateTask({ id: 'r', recurringPattern: 'weekly:3' })
    expect(useStore.getState().tasks[0].scheduledOverrides ?? null).toBeNull()
  })

  it('무관한 수정은 오버라이드를 건드리지 않는다', async () => {
    useStore.setState({ tasks: [recurringWithOverride()] })
    await useStore.getState().updateTask({ id: 'r', title: '이름만 변경' })
    expect(Object.keys(useStore.getState().tasks[0].scheduledOverrides ?? {})).toEqual(['2026-08-17'])
  })
})

describe('updateTask — scheduledOverrides 불변식 (마감일·정리)', () => {
  const withOverrides = (over: Record<string, { start: string; end: string } | null>) =>
    task({
      id: 'r',
      isRecurring: true,
      recurringPattern: 'weekly:1',
      dueDate: '2026-08-10',
      scheduledStart: '2026-08-10T14:00:00',
      scheduledEnd: '2026-08-10T15:00:00',
      scheduledOverrides: over
    })

  // occursOn은 dueDate를 기준점으로 쓴다. 마감일이 바뀌면 발생일 집합 자체가
  // 다시 매핑되므로, 옛 날짜 키는 유령 블록이 되거나(값이 있으면) 이제 진짜
  // 발생일인 날을 영영 가린다(값이 null이면).
  it('마감일이 바뀌면 회차 오버라이드를 버린다', async () => {
    useStore.setState({ tasks: [withOverrides({ '2026-08-17': { start: '2026-08-17T08:00:00', end: '2026-08-17T09:00:00' } })] })
    await useStore.getState().updateTask({ id: 'r', dueDate: '2026-09-07' })
    expect(useStore.getState().tasks[0].scheduledOverrides ?? null).toBeNull()
  })

  it('같은 마감일로 다시 저장하는 것은 버리지 않는다', async () => {
    useStore.setState({ tasks: [withOverrides({ '2026-08-17': null })] })
    await useStore.getState().updateTask({ id: 'r', dueDate: '2026-08-10', title: '제목만 변경' })
    expect(Object.keys(useStore.getState().tasks[0].scheduledOverrides ?? {})).toEqual(['2026-08-17'])
  })
})

describe('updateTask — 오버라이드 보존 기간', () => {
  // 정리 대상은 '이미 저장돼 있고 이번에 손대지 않은 채 그대로 실려 온 옛 키'다.
  // 새로 쓰는 키는 아무리 옛날 날짜여도 남긴다 — 캘린더를 되짚어가 옛 회차를
  // 옮기는 것이 실제 사용 경로이고, 거기서 저장이 조용히 무효가 되면 안 된다.
  it('손대지 않은 옛 키는 털어내되 최근 이력은 남긴다', async () => {
    const recent = new Date()
    recent.setDate(recent.getDate() - 10)
    const recentKey = recent.toISOString().slice(0, 10)
    const stored = { '2020-01-05': null, [recentKey]: { start: `${recentKey}T08:00:00`, end: `${recentKey}T09:00:00` } }
    useStore.setState({
      tasks: [
        task({ id: 'r', isRecurring: true, recurringPattern: 'daily', dueDate: '2020-01-01', scheduledOverrides: stored })
      ]
    })
    // 저장된 맵을 그대로 다시 넘긴다(무관한 수정에 딸려 오는 형태)
    await useStore.getState().updateTask({ id: 'r', scheduledOverrides: { ...stored } })
    const keys = Object.keys(useStore.getState().tasks[0].scheduledOverrides ?? {})
    expect(keys).toEqual([recentKey])
  })
})

describe('updateTask — 잘못된 오버라이드 쌍은 거부한다', () => {
  it('최소 블록보다 짧은 회차는 저장하지 않고 기존 값을 그대로 둔다', async () => {
    useStore.setState({
      tasks: [
        task({
          id: 'r',
          isRecurring: true,
          recurringPattern: 'weekly:1',
          dueDate: '2026-08-10',
          scheduledStart: '2026-08-10T14:00:00',
          scheduledEnd: '2026-08-10T15:00:00',
          scheduledOverrides: { '2126-08-17': { start: '2126-08-17T08:00:00', end: '2126-08-17T09:00:00' } }
        })
      ]
    })
    await useStore.getState().updateTask({
      id: 'r',
      scheduledOverrides: { '2126-08-24': { start: '2126-08-24T08:00:00', end: '2126-08-24T08:10:00' } }
    })
    // 절반만 적용되거나 조용히 덮어써지면 안 된다.
    expect(Object.keys(useStore.getState().tasks[0].scheduledOverrides ?? {})).toEqual(['2126-08-17'])
    expect(window.api.updateTask).not.toHaveBeenCalled()
  })
})

describe('batchComplete recurrence — 기한 없는 반복', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('기한이 없으면 오늘을 기준으로 다음 회차를 만든다', async () => {
    useStore.setState({
      tasks: [task({ id: 'n', title: '스트레칭', isRecurring: true, recurringPattern: 'daily', dueDate: null })],
      batchSelectedIds: ['n']
    })
    await useStore.getState().batchComplete()
    const spawned = useStore.getState().tasks.filter((t) => !t.completed)
    expect(spawned.map((t) => t.dueDate)).toEqual(['2026-08-16'])
  })
})

describe('updateTask — 보존 기간이 지금 쓰는 키를 버리지 않는다', () => {
  it('90일보다 오래된 날짜라도 이번에 쓰는 회차는 저장된다', async () => {
    const old = '2020-03-05'
    useStore.setState({
      tasks: [
        task({
          id: 'r',
          isRecurring: true,
          recurringPattern: 'daily',
          dueDate: '2020-03-01',
          scheduledStart: '2020-03-01T14:00:00',
          scheduledEnd: '2020-03-01T15:00:00'
        })
      ]
    })
    // 아주 오래된 날짜를 캘린더에서 되짚어가 리사이즈하는 경우
    await useStore.getState().updateTask({
      id: 'r',
      scheduledOverrides: { [old]: { start: `${old}T08:00:00`, end: `${old}T09:00:00` } }
    })
    expect(useStore.getState().tasks[0].scheduledOverrides).toEqual({
      [old]: { start: `${old}T08:00:00`, end: `${old}T09:00:00` }
    })
  })

  it('이번에 안 건드린 오래된 키는 그대로 턴다', async () => {
    useStore.setState({
      tasks: [
        task({
          id: 'r',
          isRecurring: true,
          recurringPattern: 'daily',
          dueDate: '2020-03-01',
          scheduledOverrides: { '2020-03-05': null, '2020-03-06': null }
        })
      ]
    })
    // 한 키만 새로 쓰고 나머지는 그대로 넘긴다 → 안 건드린 옛 키는 정리 대상
    await useStore.getState().updateTask({
      id: 'r',
      scheduledOverrides: { '2020-03-05': null, '2020-03-06': null, '2020-03-07': null }
    })
    expect(Object.keys(useStore.getState().tasks[0].scheduledOverrides ?? {})).toEqual(['2020-03-07'])
  })
})

describe('완료 시 미래 회차 오버라이드 인계', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 7, 10, 12, 0, 0))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  // 사용자가 캘린더를 앞으로 넘겨 8/24 회차 시간을 고쳐두고, 8/17 회차를 완료하면
  // 새로 스폰된 8/17 인스턴스는 템플릿만 물려받아 8/24 편집이 조용히 사라졌다.
  it('스폰될 인스턴스가 소유할 미래 오버라이드를 함께 넘긴다', async () => {
    useStore.setState({
      tasks: [
        task({
          id: 'r',
          title: '운동',
          isRecurring: true,
          recurringPattern: 'weekly:1',
          dueDate: '2026-08-10',
          scheduledStart: '2026-08-10T14:00:00',
          scheduledEnd: '2026-08-10T15:00:00',
          scheduledOverrides: {
            '2026-08-03': { start: '2026-08-03T08:00:00', end: '2026-08-03T09:00:00' },
            '2026-08-24': { start: '2026-08-24T08:00:00', end: '2026-08-24T09:00:00' }
          }
        })
      ]
    })
    await useStore.getState().toggleTask('r')

    const spawned = useStore.getState().tasks.find((t) => !t.completed)
    expect(spawned?.dueDate).toBe('2026-08-17')
    // 8/24는 새 인스턴스의 회차다 → 넘어가야 한다
    expect(spawned?.scheduledOverrides).toEqual({
      '2026-08-24': { start: '2026-08-24T08:00:00', end: '2026-08-24T09:00:00' }
    })

    const done = useStore.getState().tasks.find((t) => t.completed)
    // 8/03은 지난 기록이라 완료본에 남고, 넘긴 8/24는 중복되지 않게 빠진다
    expect(Object.keys(done?.scheduledOverrides ?? {})).toEqual(['2026-08-03'])
  })

  it('넘길 미래 회차가 없으면 오버라이드 없이 스폰한다', async () => {
    useStore.setState({
      tasks: [
        task({
          id: 'r2',
          title: '독서',
          isRecurring: true,
          recurringPattern: 'daily',
          dueDate: '2026-08-10',
          scheduledStart: '2026-08-10T07:00:00',
          scheduledEnd: '2026-08-10T08:00:00',
          scheduledOverrides: { '2026-08-09': null }
        })
      ]
    })
    await useStore.getState().toggleTask('r2')
    const spawned = useStore.getState().tasks.find((t) => !t.completed)
    expect(spawned?.scheduledOverrides ?? null).toBeNull()
  })
})

describe('duplicateTask', () => {
  it('복제본은 원본 바로 아래에 온다', async () => {
    useStore.setState({
      tasks: [task({ id: 'a', sortOrder: 1 }), task({ id: 'b', sortOrder: 2 }), task({ id: 'c', sortOrder: 3 })]
    })
    await useStore.getState().duplicateTask('a')

    const ids = useStore.getState().tasks.map((t) => t.id)
    // 맨 끝에 붙으면 방금 무슨 일이 일어났는지 화면에서 보이지 않는다.
    expect(ids[0]).toBe('a')
    expect(ids[1]).not.toBe('b')
    expect(ids.slice(2)).toEqual(['b', 'c'])

    // 배열 위치는 set()이 무조건 정한다 — 재시작 후에도 자리를 지키는 것은
    // sortOrder뿐이므로, 그 값을 확인하지 않으면 이 테스트는 아무것도 막지 못한다.
    const copy = useStore.getState().tasks.find((t) => t.id !== 'a' && t.id !== 'b' && t.id !== 'c')
    expect(copy?.sortOrder).toBeGreaterThan(1)
    expect(copy?.sortOrder).toBeLessThan(2)
  })

  it('목록의 마지막을 복제하면 그 뒤 슬롯을 받는다', async () => {
    useStore.setState({
      tasks: [task({ id: 'a', sortOrder: 1 }), task({ id: 'other', listId: 'work', sortOrder: 9 })]
    })
    await useStore.getState().duplicateTask('a')

    // 다른 리스트의 sortOrder는 이 계산에 끼어들지 않는다.
    const copy = useStore.getState().tasks.find((t) => t.id !== 'a' && t.id !== 'other')
    expect(copy?.sortOrder).toBe(2)
  })

  it('내용은 그대로, 완료 상태는 물려받지 않는다', async () => {
    useStore.setState({
      tasks: [
        task({
          id: 'a',
          title: '보고서',
          description: '메모',
          priority: 'high',
          tags: ['업무'],
          dueDate: '2026-08-20',
          completed: true,
          completedAt: '2026-08-19T00:00:00.000Z'
        })
      ]
    })
    await useStore.getState().duplicateTask('a')

    const copy = useStore.getState().tasks.find((t) => t.id !== 'a')
    expect(copy).toMatchObject({
      title: '보고서',
      description: '메모',
      priority: 'high',
      tags: ['업무'],
      dueDate: '2026-08-20',
      completed: false,
      completedAt: null
    })
  })

  it('시간블록은 복제하지 않는다', async () => {
    useStore.setState({
      tasks: [
        task({
          id: 'a',
          scheduledStart: '2026-08-20T09:00:00',
          scheduledEnd: '2026-08-20T10:00:00',
          scheduledOverrides: { '2026-08-21': null }
        })
      ]
    })
    await useStore.getState().duplicateTask('a')

    // 한 시간대에 같은 일이 두 개 겹치는 것은 복제가 아니라 사고다.
    const copy = useStore.getState().tasks.find((t) => t.id !== 'a')
    expect(copy?.scheduledStart).toBeNull()
    expect(copy?.scheduledEnd).toBeNull()
    expect(copy?.scheduledOverrides ?? null).toBeNull()
  })

  it('고정은 물려받지 않는다', async () => {
    useStore.setState({ tasks: [task({ id: 'a', pinned: true })] })
    await useStore.getState().duplicateTask('a')

    expect(useStore.getState().tasks.find((t) => t.id !== 'a')?.pinned).toBe(false)
  })

  it('하위작업도 함께 복제되어 새 부모를 가리킨다', async () => {
    useStore.setState({
      tasks: [task({ id: 'a' }), task({ id: 's1', title: '1단계', parentId: 'a' }), task({ id: 's2', parentId: 'a' })]
    })
    await useStore.getState().duplicateTask('a')

    const tasks = useStore.getState().tasks
    const copy = tasks.find((t) => t.id !== 'a' && !t.parentId)
    const copiedSubs = tasks.filter((t) => t.parentId === copy?.id)
    expect(copiedSubs).toHaveLength(2)
    // 원본의 하위작업은 그대로 남는다
    expect(tasks.filter((t) => t.parentId === 'a')).toHaveLength(2)
    expect(copiedSubs.map((t) => t.id)).not.toContain('s1')
  })

  it('없는 id는 아무 일도 하지 않는다', async () => {
    useStore.setState({ tasks: [task({ id: 'a' })] })
    await useStore.getState().duplicateTask('nope')
    expect(useStore.getState().tasks).toHaveLength(1)
  })
})

describe('updateTask — 기간(startDate) 불변식', () => {
  it('시작일이 마감일보다 뒤면 저장하지 않는다', async () => {
    useStore.setState({ tasks: [task({ id: 'a', dueDate: '2026-08-20', startDate: '2026-08-18' })] })
    await useStore.getState().updateTask({ id: 'a', startDate: '2026-08-25' })

    // 거꾸로 된 기간은 화면에서 음수 길이의 막대가 된다.
    expect(useStore.getState().tasks[0].startDate).toBe('2026-08-18')
  })

  it('시작일과 마감일이 같은 하루짜리 기간은 허용한다', async () => {
    useStore.setState({ tasks: [task({ id: 'a', dueDate: '2026-08-20' })] })
    await useStore.getState().updateTask({ id: 'a', startDate: '2026-08-20' })
    expect(useStore.getState().tasks[0].startDate).toBe('2026-08-20')
  })

  it('마감일을 지우면 시작일도 함께 지운다', async () => {
    useStore.setState({ tasks: [task({ id: 'a', dueDate: '2026-08-20', startDate: '2026-08-18' })] })
    await useStore.getState().updateTask({ id: 'a', dueDate: null })

    // 끝이 없으면 기간이 아니다 — 시작일만 남으면 어디에도 그릴 수 없다.
    expect(useStore.getState().tasks[0].startDate).toBeNull()
  })

  it('마감일만 앞으로 당기면 기간이 통째로 따라온다', async () => {
    useStore.setState({ tasks: [task({ id: 'a', dueDate: '2026-08-20', startDate: '2026-08-18' })] })
    await useStore.getState().updateTask({ id: 'a', dueDate: '2026-08-15' })

    // 버리지 않는다 — 길이(2일)를 지킨 채 옮긴다.
    expect(useStore.getState().tasks[0].startDate).toBe('2026-08-13')
    expect(useStore.getState().tasks[0].dueDate).toBe('2026-08-15')
  })
})

describe('기간 불변식 — 생성 경로와 함께 실린 필드', () => {
  it('거꾸로 된 시작일은 그 필드만 무시하고 같이 온 수정은 살린다', async () => {
    useStore.setState({ tasks: [task({ id: 'a', dueDate: '2026-08-20', startDate: '2026-08-18' })] })
    await useStore.getState().updateTask({ id: 'a', startDate: '2026-08-25', dueTime: '09:30' })

    const t = useStore.getState().tasks[0]
    expect(t.startDate).toBe('2026-08-18')
    // 예전에는 패치 전체를 버려서, 같은 저장에 실린 무관한 수정까지 사라졌다.
    expect(t.dueTime).toBe('09:30')
  })

  it('추가할 때도 같은 규칙을 거친다 — 끝 없는 시작일은 만들지 않는다', async () => {
    useStore.setState({ tasks: [], selectedListId: 'inbox' })
    await useStore.getState().addTask('기간만 있는 할일', { startDate: '2026-08-18' })

    expect(useStore.getState().tasks[0].startDate).toBeNull()
  })

  it('추가할 때 거꾸로 된 기간도 만들지 않는다', async () => {
    useStore.setState({ tasks: [], selectedListId: 'inbox' })
    await useStore.getState().addTask('회고', { dueDate: '2026-08-18', startDate: '2026-08-25' })

    const t = useStore.getState().tasks[0]
    expect(t.startDate).toBeNull()
    expect(t.dueDate).toBe('2026-08-18')
  })
})

describe('기간 — 마감일만 옮기면 기간이 따라간다', () => {
  it('마감일을 당기면 시작일도 같은 길이만큼 따라온다', async () => {
    useStore.setState({ tasks: [task({ id: 'a', startDate: '2026-08-18', dueDate: '2026-08-20' })] })
    // 캘린더 드래그·단축키·AI 재예약은 dueDate만 보낸다. 예전에는 그때마다
    // 기간이 경고 없이 사라져, 사흘짜리 일이 하루짜리가 됐다.
    await useStore.getState().updateTask({ id: 'a', dueDate: '2026-08-15' })

    const t = useStore.getState().tasks[0]
    expect(t.dueDate).toBe('2026-08-15')
    expect(t.startDate).toBe('2026-08-13')
  })

  it('마감일을 미뤄도 길이는 그대로다', async () => {
    useStore.setState({ tasks: [task({ id: 'a', startDate: '2026-08-18', dueDate: '2026-08-20' })] })
    await useStore.getState().updateTask({ id: 'a', dueDate: '2026-09-01' })

    expect(useStore.getState().tasks[0].startDate).toBe('2026-08-30')
  })

  it('시작일을 함께 보내면 그쪽이 사용자의 의도다', async () => {
    useStore.setState({ tasks: [task({ id: 'a', startDate: '2026-08-18', dueDate: '2026-08-20' })] })
    await useStore.getState().updateTask({ id: 'a', dueDate: '2026-08-25', startDate: '2026-08-24' })

    expect(useStore.getState().tasks[0].startDate).toBe('2026-08-24')
  })

  it('마감일을 지우면 기간도 사라진다', async () => {
    useStore.setState({ tasks: [task({ id: 'a', startDate: '2026-08-18', dueDate: '2026-08-20' })] })
    await useStore.getState().updateTask({ id: 'a', dueDate: null })

    expect(useStore.getState().tasks[0].startDate).toBeNull()
  })
})

describe('duplicateTask — 중간값이 소진될 때', () => {
  it('간격이 남아 있지 않으면 맨 뒤로 보낸다 (같은 슬롯을 만들지 않는다)', async () => {
    // 같은 자리에 반복 복제하면 (a+b)/2가 53회쯤에서 a와 같아진다. 그대로 두면
    // 원본과 복제본이 같은 sortOrder를 가져 드래그로도 순서를 정할 수 없다.
    const tiny = 1 + Number.EPSILON // 1 바로 다음 표현 가능한 double — 사이에 자리가 없다
    useStore.setState({
      tasks: [task({ id: 'a', sortOrder: 1 }), task({ id: 'b', sortOrder: tiny })]
    })
    await useStore.getState().duplicateTask('a')

    const orders = useStore.getState().tasks.map((t) => t.sortOrder)
    expect(new Set(orders).size).toBe(orders.length)
  })
})

describe('duplicateTask — 반복은 물려받지 않는다', () => {
  it('복제본은 일회성이 된다', async () => {
    useStore.setState({
      tasks: [task({ id: 'a', title: '약 먹기', isRecurring: true, recurringPattern: 'daily', dueDate: '2026-08-19' })]
    })
    await useStore.getState().duplicateTask('a')

    // 시리즈 키는 (패턴, 제목, 마감일)이라 복제본이 원본과 같은 키를 갖는다.
    // 둘 다 완료하면 다음 회차는 하나만 생기고, 나머지 시리즈는 말없이 끝난다.
    const copy = useStore.getState().tasks.find((t) => t.id !== 'a')
    expect(copy?.isRecurring).toBe(false)
    expect(copy?.recurringPattern).toBeNull()
  })
})

describe('updateTask — 렌더러 배열에 없는 할일', () => {
  it('기한을 고쳐도 저장을 포기하지 않는다', async () => {
    const apiUpdate = vi.fn()
    ;(window as unknown as { api: Record<string, unknown> }).api = {
      ...(window as unknown as { api: Record<string, unknown> }).api,
      updateTask: apiUpdate
    }
    useStore.setState({ tasks: [] })
    await useStore.getState().updateTask({ id: 'missing', dueDate: '2026-08-20' })

    // main은 자기 저장소에서 그 행을 찾아 쓴다. 렌더러 배열에 잠깐 없다고
    // (휴지통·로딩 경합) 조용히 버리면 사용자의 수정이 사라진다.
    expect(apiUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: 'missing', dueDate: '2026-08-20' }))
  })
})

describe('duplicateTask — 하위작업이 섞인 리스트', () => {
  it('하위작업의 sortOrder가 복제본을 목록 밖으로 밀어내지 않는다', async () => {
    useStore.setState({
      tasks: [
        task({ id: 'a', sortOrder: 1 }),
        task({ id: 'b', sortOrder: 2 }),
        task({ id: 's', sortOrder: 40, parentId: 'a' })
      ]
    })
    await useStore.getState().duplicateTask('b')

    // 간격 탐색은 하위작업을 건너뛰는데 맨 뒤 계산은 세고 있었다 —
    // 재시작하면 복제본이 38칸 뒤에 나타났다.
    const copy = useStore.getState().tasks.find((t) => !t.parentId && !['a', 'b'].includes(t.id))
    expect(copy?.sortOrder).toBe(3)
  })
})
