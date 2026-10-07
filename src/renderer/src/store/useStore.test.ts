import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { useStore } from './useStore'
import type { Task, AiMessage } from '../types'
import { getScheduledForOccurrence } from '../utils/scheduledTime'

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
      deleteTask: vi.fn(),
      restoreTask: vi.fn(),
      permanentDeleteTask: vi.fn(),
      // AI 액션 경로가 대화를 디스크에 적는지 보는 테스트가 쓴다.
      aiSaveHistory: vi.fn(),
      aiInterpretAction: vi.fn()
    }
  })
  useStore.setState({ tasks: [], score: { total: 10, events: [], taskNet: {} }, batchSelectedIds: [], batchMode: false })
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
      score: { total: 1, events: [], taskNet: {} }
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

  // sortOrder는 **리스트별** 카운터라 리스트마다 1부터 센다. '전체'·'오늘'·'다음 7일'·
  // 태그처럼 리스트를 가로지르는 뷰에는 같은 값을 쥔 행이 여럿 보이는데, 동점 슬롯을
  // 그대로 되돌려 주면 마지막 안정 정렬이 이전 배열 순서를 지켜 드롭이 통째로 버려졌다 —
  // 끌어다 놓은 항목이 제자리로 튕기고, 다시 끌어도 결과가 한 글자도 안 바뀌었다.
  it('honours the drop across lists whose per-list counters tie', async () => {
    useStore.setState({
      tasks: [
        task({ id: 'a1', listId: 'A', sortOrder: 1 }),
        task({ id: 'a2', listId: 'A', sortOrder: 2 }),
        task({ id: 'b1', listId: 'B', sortOrder: 1 }),
        task({ id: 'b2', listId: 'B', sortOrder: 2 })
      ]
    })
    await useStore.getState().reorderTasks(['b1', 'a1', 'a2', 'b2'])
    expect(useStore.getState().tasks.map((t) => t.id)).toEqual(['b1', 'a1', 'a2', 'b2'])
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

// 캘린더에서 2026-09-27 회차만 14시로 끌어다 놓고 일괄 완료하면, 넘긴 키가
// 완료본에도 남아 그날 같은 블록이 둘 겹쳤다(완료본 + 새 인스턴스). 캘린더는
// deletedAt만 거르고 completed는 거르지 않으므로 둘 다 그려진다. 하나씩 완료하는
// 경로는 원래 이 정리를 하고 있었다 — 두 경로가 같은 결과를 내는지를 못 박는다.
describe('일괄 완료 — 넘긴 미래 회차는 완료본에서 빠진다', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 8, 25, 12, 0, 0))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const moved = (): Task =>
    task({
      id: 'r',
      title: '운동',
      isRecurring: true,
      recurringPattern: 'daily',
      dueDate: '2026-09-25',
      scheduledStart: '2026-09-25T09:00:00',
      scheduledEnd: '2026-09-25T10:00:00',
      // 2026-09-27 회차만 14시로 옮겨둔 상태
      scheduledOverrides: { '2026-09-27': { start: '2026-09-27T14:00:00', end: '2026-09-27T15:00:00' } }
    })

  /** 그날 그 제목으로 캘린더에 그려질 블록 수 — WeeklyCalendar와 같은 규칙(deletedAt만 거른다). */
  const blocksOn = (title: string, date: string): number =>
    useStore.getState().tasks.filter((t) => !t.deletedAt && t.title === title && getScheduledForOccurrence(t, date))
      .length

  it('하나씩 완료한 것과 일괄 완료가 같은 수의 블록을 남긴다', async () => {
    useStore.setState({ tasks: [moved()] })
    await useStore.getState().toggleTask('r')
    const one = blocksOn('운동', '2026-09-27')

    useStore.setState({ tasks: [moved()], batchSelectedIds: ['r'], batchMode: true })
    await useStore.getState().batchComplete()
    expect(blocksOn('운동', '2026-09-27')).toBe(one)
    expect(blocksOn('운동', '2026-09-27')).toBe(1)
  })

  it('완료본에는 넘긴 키가 남지 않는다', async () => {
    useStore.setState({ tasks: [moved()], batchSelectedIds: ['r'], batchMode: true })
    await useStore.getState().batchComplete()
    const done = useStore.getState().tasks.find((t) => t.completed)
    expect(done?.scheduledOverrides ?? null).toBeNull()
  })

  // 짝짓기가 어긋나면 A의 오버라이드를 B에서 빼게 된다. 스폰이 안 생기는 항목이
  // 섞여 있어도 인덱스가 밀리지 않는지 함께 본다.
  it('비반복이 섞인 일괄 완료에서도 시리즈마다 자기 것만 빠진다', async () => {
    useStore.setState({
      tasks: [
        task({
          id: 'plain',
          title: '장보기',
          scheduledStart: '2026-09-27T11:00:00',
          scheduledEnd: '2026-09-27T11:30:00'
        }),
        moved(),
        task({
          id: 'b',
          title: '독서',
          isRecurring: true,
          recurringPattern: 'daily',
          dueDate: '2026-09-25',
          scheduledStart: '2026-09-25T20:00:00',
          scheduledEnd: '2026-09-25T21:00:00',
          scheduledOverrides: { '2026-09-28': { start: '2026-09-28T07:00:00', end: '2026-09-28T08:00:00' } }
        })
      ],
      batchSelectedIds: ['plain', 'r', 'b'],
      batchMode: true
    })
    await useStore.getState().batchComplete()

    expect(blocksOn('운동', '2026-09-27')).toBe(1)
    expect(blocksOn('독서', '2026-09-28')).toBe(1)
    expect(blocksOn('장보기', '2026-09-27')).toBe(1)
    expect(useStore.getState().tasks.find((t) => t.id === 'r')?.scheduledOverrides ?? null).toBeNull()
    expect(useStore.getState().tasks.find((t) => t.id === 'b')?.scheduledOverrides ?? null).toBeNull()
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

/**
 * 진짜 main(`src/main/database.ts`)에 `window.api`를 잇는다.
 *
 * 복원 집합은 main이 정하고 화면은 그 답을 옮기기만 한다. 그 약속이 지켜지는지는
 * main을 흉내 낸 목으로는 못 본다 — 목이 틀린 답을 주면 테스트도 같이 틀린다. 그래서
 * 실제 main 모듈을 임시 폴더에 띄우고 IPC를 함수 호출로 바꿔 끼운다(호출 순서와
 * 비동기 반환은 `ipcRenderer.invoke`와 같다).
 *
 * 경로를 변수로 둔다 — 리터럴로 import하면 `tsc --build`가 main 파일을 렌더러
 * 프로젝트(tsconfig.web.json)로 끌어들여 TS6307로 실패한다. 그래서 타입도 필요한
 * 만큼만 여기 적는다.
 */
interface MainDb {
  initDatabase(): void
  closeDatabase(): boolean
  createTask(task: Record<string, unknown>): void
  updateTask(task: Record<string, unknown>): void
  deleteTask(id: string): void
  restoreTask(id: string): unknown
  permanentDeleteTask(id: string): void
  emptyTrash(): void
  batchUpdateTasks(ids: string[], updates: Record<string, unknown>): void
  getLists(): unknown[]
  getTasks(): unknown[]
  getTrashTasks(): unknown[]
  getHabits(): unknown[]
  getHabitLogs(): unknown[]
  getFolders(): unknown[]
  getPomodoroSessions(): unknown[]
  getScore(): unknown
}
const MAIN_DATABASE = '../../../main/database'

function useRealMain(): { db: () => MainDb } {
  let db: MainDb | null = null
  let dir = ''
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'greenday-store-main-'))
    const at = dir
    vi.resetModules()
    vi.doMock('electron', () => ({
      app: { getPath: () => at, getVersion: () => '0.0.0-test' },
      safeStorage: { isEncryptionAvailable: () => false }
    }))
    const main = (await import(/* @vite-ignore */ MAIN_DATABASE)) as MainDb
    main.initDatabase()
    db = main
    const ipc =
      <A extends unknown[]>(fn: (...args: A) => unknown) =>
      (...args: A): Promise<unknown> =>
        new Promise((resolve) => resolve(fn(...args)))
    vi.stubGlobal('window', {
      api: {
        ...window.api,
        getLists: vi.fn(ipc(main.getLists)),
        getTasks: vi.fn(ipc(main.getTasks)),
        getTrashTasks: vi.fn(ipc(main.getTrashTasks)),
        getHabits: vi.fn(ipc(main.getHabits)),
        getHabitLogs: vi.fn(ipc(main.getHabitLogs)),
        getFolders: vi.fn(ipc(main.getFolders)),
        getPomodoroSessions: vi.fn(ipc(main.getPomodoroSessions)),
        getScore: vi.fn(ipc(main.getScore)),
        createTask: vi.fn(ipc(main.createTask)),
        deleteTask: vi.fn(ipc(main.deleteTask)),
        restoreTask: vi.fn(ipc(main.restoreTask)),
        permanentDeleteTask: vi.fn(ipc(main.permanentDeleteTask)),
        emptyTrash: vi.fn(ipc(main.emptyTrash)),
        batchUpdateTasks: vi.fn(ipc(main.batchUpdateTasks))
      }
    })
  })
  afterEach(() => {
    db?.closeDatabase()
    db = null
    vi.doUnmock('electron')
    rmSync(dir, { recursive: true, force: true })
  })
  return {
    db: () => {
      if (!db) throw new Error('main이 아직 뜨지 않았다')
      return db
    }
  }
}

/** main에 행을 만들고 화면을 main에서 다시 읽는다(앱 시작과 같은 경로). 부모가 먼저 와야 한다. */
async function seed(db: MainDb, rows: Task[]): Promise<void> {
  for (const t of rows) db.createTask({ ...t })
  useStore.setState({ undoStack: [] })
  await useStore.getState().loadData()
}

const sortedIds = (list: { id: string }[]): string[] => list.map((t) => t.id).sort()

/** 화면의 살아 있는 목록·휴지통이 디스크와 정확히 같은 집합인지. */
function expectInSync(db: MainDb): void {
  const s = useStore.getState()
  expect(sortedIds(s.tasks), '살아 있는 목록이 화면과 디스크에서 다르다').toEqual(
    sortedIds(db.getTasks() as { id: string }[])
  )
  expect(sortedIds(s.trashTasks), '휴지통이 화면과 디스크에서 다르다').toEqual(
    sortedIds(db.getTrashTasks() as { id: string }[])
  )
}

/**
 * H5 — 하위작업이 있는 할일을 지우고 되돌리면 하위작업이 휴지통에 남았다.
 *
 * 삭제는 하위작업까지 함께 내리는데(아래 첫 테스트) 되돌리기는 부모 하나만
 * 올렸다. 화면에서는 하위작업이 통째로 사라진 것으로 보인다. 지금은 main의
 * `restoreTask`가 되살린 id를 돌려주고 화면은 그것을 그대로 옮긴다
 * (`databaseRestoreTask.test.ts`가 main 쪽 규칙을 못 박는다).
 */
describe('삭제 되돌리기와 하위작업', () => {
  const main = useRealMain()
  const family = (): Task[] => [
    task({ id: 'p', title: '부모' }),
    task({ id: 'c1', title: '하위1', parentId: 'p' }),
    task({ id: 'c2', title: '하위2', parentId: 'p' })
  ]
  const ids = sortedIds

  it('삭제는 하위작업까지 휴지통으로 내린다', async () => {
    await seed(main.db(), family())
    await useStore.getState().removeTask('p')

    expect(useStore.getState().tasks).toEqual([])
    expect(ids(useStore.getState().trashTasks)).toEqual(['c1', 'c2', 'p'])
    expectInSync(main.db())
  })

  it('되돌리기가 하위작업도 같이 올린다', async () => {
    await seed(main.db(), family())
    await useStore.getState().removeTask('p')
    await useStore.getState().popUndo()

    expect(ids(useStore.getState().tasks), '하위작업이 휴지통에 남았다').toEqual(['c1', 'c2', 'p'])
    expect(useStore.getState().trashTasks).toEqual([])
    expect(useStore.getState().tasks.every((t) => t.deletedAt === null)).toBe(true)
    // IPC는 부모 id 하나다 — 무엇이 올라왔는지는 main이 답한다.
    expect(window.api.restoreTask).toHaveBeenCalledWith('p')
    expectInSync(main.db())
  })

  it('휴지통 화면의 개별 복원도 하위작업을 데려온다', async () => {
    await seed(main.db(), family())
    await useStore.getState().removeTask('p')
    await useStore.getState().restoreTask('p')

    expect(ids(useStore.getState().tasks)).toEqual(['c1', 'c2', 'p'])
    expect(useStore.getState().trashTasks).toEqual([])
    expectInSync(main.db())
  })

  // main은 "같은 조작으로 함께 내려간" 하위작업만 되살린다(`deleted_with` 표시).
  // 화면은 그 답을 받으므로 두 삭제가 같은 밀리초에 떨어져도(테스트에서는 매번
  // 그렇다) 갈리지 않는다 — 예전의 "삭제 시각이 같은가" 근사는 바로 거기서 틀렸다.
  it('따로 지웠던 하위작업은 휴지통에 그대로 둔다', async () => {
    await seed(main.db(), family())
    await useStore.getState().removeTask('c1')
    await useStore.getState().removeTask('p')
    await useStore.getState().restoreTask('p')

    expect(ids(useStore.getState().tasks)).toEqual(['c2', 'p'])
    expect(ids(useStore.getState().trashTasks)).toEqual(['c1'])
    expectInSync(main.db())
  })

  // 이 버전으로 올라오기 전에 쌓인 undo가 스택에 남아 있을 수 있다.
  it('옛 모양의 undo 페이로드도 읽는다', async () => {
    await seed(main.db(), [task({ id: 'p', title: '부모' })])
    main.db().deleteTask('p')
    await useStore.getState().loadData()
    const parent = useStore.getState().trashTasks[0]
    useStore.setState({ undoStack: [{ type: 'deleteTask', description: '', data: parent, timestamp: 1 }] })
    await useStore.getState().popUndo()
    expect(ids(useStore.getState().tasks)).toEqual(['p'])
    expectInSync(main.db())
  })

  // 부모를 휴지통에 둔 채 자식만 올리면 뷰는 isTopLevel로 거르고 하위작업은 살아 있는
  // 부모의 상세 안에서만 그려져서, 되살린 할일이 어느 화면에도 나타나지 않는다.
  // main이 조상을 함께 올리고 그것도 답에 넣는다.
  it('하위작업만 복원하면 부모도 함께 올라온다', async () => {
    await seed(main.db(), family())
    await useStore.getState().removeTask('p')
    expect(ids(useStore.getState().trashTasks)).toEqual(['c1', 'c2', 'p'])

    await useStore.getState().restoreTask('c1')

    const live = useStore.getState().tasks
    const trashed = new Set(useStore.getState().trashTasks.map((t) => t.id))
    const invisible = live.filter(
      (t) => t.parentId !== null && (trashed.has(t.parentId) || !live.some((p) => p.id === t.parentId))
    )
    expect(ids(invisible), '살아났는데 부모가 휴지통이라 어느 화면에도 없다').toEqual([])
    expect(ids(live)).toContain('c1')
    expectInSync(main.db())
  })
})

/**
 * 삭제는 **자손 전부**에 캐스케이드한다 — main의 `deleteTask`/`batchUpdateTasks`와 같은 규칙.
 *
 * 상세 패널은 하위작업에도 SubtaskList를 그리므로 A→B→C 3단 트리가 생긴다. 예전에는
 * 직계 하위작업만 내려 손자가 살아 남았고, 화면에서는 살아 있는 부모가 없어 보이지
 * 않는 행이 됐다(main은 그 상태를 다음 부팅에서 정리한다 — databaseCascade.test.ts).
 */
describe('삭제 캐스케이드 — 손자까지', () => {
  const tree = (): Task[] => [
    task({ id: 'a', title: 'A' }),
    task({ id: 'b', title: 'B', parentId: 'a' }),
    task({ id: 'c', title: 'C', parentId: 'b' }),
    task({ id: 'z', title: '무관' })
  ]
  const ids = sortedIds

  describe('main과 함께', () => {
    const main = useRealMain()

    it('removeTask가 손자까지 휴지통으로 내리고, 되돌리기가 모두 올린다', async () => {
      await seed(main.db(), tree())
      await useStore.getState().removeTask('a')
      expect(ids(useStore.getState().tasks), '손자가 살아 남았다').toEqual(['z'])
      expect(ids(useStore.getState().trashTasks)).toEqual(['a', 'b', 'c'])
      expectInSync(main.db())

      await useStore.getState().popUndo()
      expect(ids(useStore.getState().tasks)).toEqual(['a', 'b', 'c', 'z'])
      expect(useStore.getState().trashTasks).toEqual([])
      expectInSync(main.db())
    })

    it('휴지통의 뿌리 복원이 손자까지 데려온다', async () => {
      await seed(main.db(), tree())
      await useStore.getState().removeTask('a')
      await useStore.getState().restoreTask('a')
      expect(ids(useStore.getState().tasks)).toEqual(['a', 'b', 'c', 'z'])
      expect(useStore.getState().trashTasks).toEqual([])
      expectInSync(main.db())
    })

    it('batchDelete가 손자까지 내리고 main에도 그 id를 모두 보낸다', async () => {
      await seed(main.db(), tree())
      useStore.setState({ batchMode: true, batchSelectedIds: ['a'] })
      await useStore.getState().batchDelete()
      expect(ids(useStore.getState().tasks)).toEqual(['z'])
      expect(ids(useStore.getState().trashTasks)).toEqual(['a', 'b', 'c'])
      const sent = vi.mocked(window.api.batchUpdateTasks).mock.calls.at(-1)?.[0] as string[]
      expect([...sent].sort()).toEqual(['a', 'b', 'c'])

      await useStore.getState().popUndo()
      expect(ids(useStore.getState().tasks)).toEqual(['a', 'b', 'c', 'z'])
      expectInSync(main.db())
    })

    it('영구 삭제가 휴지통의 손자까지 지운다', async () => {
      await seed(main.db(), tree())
      await useStore.getState().removeTask('a')
      await useStore.getState().permanentDeleteTask('a')
      expect(useStore.getState().trashTasks, '휴지통에 자손이 고아로 남았다').toEqual([])
      expect(ids(useStore.getState().tasks)).toEqual(['z'])
      expectInSync(main.db())
    })
  })

  it('손상된 순환 parentId에서 멈춘다', async () => {
    useStore.setState({
      tasks: [task({ id: 'p', parentId: 'q' }), task({ id: 'q', parentId: 'p' })],
      trashTasks: [],
      undoStack: []
    })
    await useStore.getState().removeTask('p')
    expect(ids(useStore.getState().trashTasks)).toEqual(['p', 'q'])
  })
})

/**
 * **복원은 main의 답을 그대로 옮긴다.**
 *
 * 렌더러가 "같은 `deletedAt`의 자손"으로 집합을 짐작하던 시절, main과 갈리는 경우가
 * 있었다. 갈린 채로 '휴지통 비우기'를 누르면 화면에는 살아 있는 행이 디스크에서
 * 영구 삭제되고, 반대로 디스크에는 살아 있는 행이 화면에서는 휴지통에 남았다.
 * 아래는 그 경우들을 실제 main과 함께 돌려 화면과 디스크가 같은 집합인지 본다.
 */
describe('복원은 main의 답을 그대로 — 화면과 디스크가 같은 집합', () => {
  const main = useRealMain()
  const abc = (): Task[] => [
    task({ id: 'A', title: 'A' }),
    task({ id: 'B', title: 'B', parentId: 'A' }),
    task({ id: 'C', title: 'C', parentId: 'B' }),
    task({ id: 'Z', title: '무관' })
  ]

  it('중간 행 B를 복원한 뒤 휴지통을 비워도 화면의 C가 디스크에서 사라지지 않는다', async () => {
    await seed(main.db(), abc())
    await useStore.getState().removeTask('A')
    await useStore.getState().restoreTask('B')
    expectInSync(main.db())
    expect(sortedIds(useStore.getState().tasks)).toEqual(['A', 'B', 'C', 'Z'])

    await useStore.getState().emptyTrash()
    expectInSync(main.db())
    expect(sortedIds(main.db().getTasks() as { id: string }[]), '화면에 보이던 C가 영구 삭제됐다').toContain('C')
  })

  it('낡은 연결: 다시 지운 뿌리를 복원해도 따로 남아 있던 D는 휴지통에 남는다 — 화면도', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      await seed(main.db(), [
        task({ id: 'A', title: 'A' }),
        task({ id: 'B', title: 'B', parentId: 'A' }),
        task({ id: 'D', title: 'D', parentId: 'A' })
      ])
      vi.setSystemTime(new Date('2026-10-01T00:00:00.000Z'))
      await useStore.getState().removeTask('A')
      await useStore.getState().restoreTask('B')
      vi.setSystemTime(new Date('2026-10-01T00:00:05.000Z'))
      await useStore.getState().removeTask('A')
      await useStore.getState().restoreTask('A')

      expect(sortedIds(useStore.getState().trashTasks)).toEqual(['D'])
      expectInSync(main.db())
      await useStore.getState().emptyTrash()
      expectInSync(main.db())
    } finally {
      vi.useRealTimers()
    }
  })

  it('A 삭제 → 휴지통에서 C 복원 → 되돌리기: D가 디스크와 화면에서 함께 올라온다', async () => {
    await seed(main.db(), [...abc(), task({ id: 'D', title: 'D', parentId: 'A' })])
    await useStore.getState().removeTask('A')
    await useStore.getState().restoreTask('C')
    expect(sortedIds(useStore.getState().trashTasks)).toEqual(['D'])
    expectInSync(main.db())

    await useStore.getState().popUndo()
    expect(sortedIds(useStore.getState().tasks)).toEqual(['A', 'B', 'C', 'D', 'Z'])
    expect(useStore.getState().trashTasks).toEqual([])
    expectInSync(main.db())
  })

  it('자식을 먼저 고른 일괄 삭제도 뿌리 복원 하나로 전부 올라온다', async () => {
    await seed(main.db(), abc())
    useStore.setState({ batchMode: true, batchSelectedIds: ['C', 'A'] })
    await useStore.getState().batchDelete()
    expect(sortedIds(useStore.getState().trashTasks)).toEqual(['A', 'B', 'C'])
    await useStore.getState().restoreTask('A')
    expect(sortedIds(useStore.getState().tasks)).toEqual(['A', 'B', 'C', 'Z'])
    expectInSync(main.db())
  })

  it('순환 parentId가 실린 일괄 삭제도 둘 다 내려가고 복원된다', async () => {
    main.db().createTask({ ...task({ id: 'a', title: 'a' }) })
    main.db().createTask({ ...task({ id: 'b', title: 'b', parentId: 'a' }) })
    main.db().updateTask({ id: 'a', parentId: 'b' })
    await seed(main.db(), [])
    useStore.setState({ batchMode: true, batchSelectedIds: ['a', 'b'] })
    await useStore.getState().batchDelete()
    expect(sortedIds(main.db().getTrashTasks() as { id: string }[])).toEqual(['a', 'b'])
    expectInSync(main.db())
    await useStore.getState().restoreTask('a')
    expect(sortedIds(useStore.getState().tasks)).toEqual(['a', 'b'])
    expectInSync(main.db())
  })
})

describe('복원은 main의 답을 그대로 — 목으로 본 적용 규칙', () => {
  const at = '2026-08-28T00:00:00.000Z'

  it('돌려받은 id만 옮긴다 — 같은 시각의 자손이라고 짐작해 더 올리지 않는다', async () => {
    vi.mocked(window.api.restoreTask).mockResolvedValue(['x', 'q'])
    useStore.setState({
      tasks: [],
      trashTasks: [
        task({ id: 'p', deletedAt: at }),
        task({ id: 'x', parentId: 'p', deletedAt: at }),
        task({ id: 'y', parentId: 'x', deletedAt: at }),
        task({ id: 'q', deletedAt: '2026-01-01T00:00:00.000Z' })
      ]
    })
    await useStore.getState().restoreTask('x')
    expect(sortedIds(useStore.getState().tasks)).toEqual(['q', 'x'])
    expect(sortedIds(useStore.getState().trashTasks)).toEqual(['p', 'y'])
    expect(useStore.getState().tasks.every((t) => t.deletedAt === null)).toBe(true)
  })

  it('main이 거절하면 화면은 그대로다', async () => {
    vi.mocked(window.api.restoreTask).mockRejectedValue(new Error('boom'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    useStore.setState({ tasks: [], trashTasks: [task({ id: 'p', deletedAt: at })] })
    await useStore.getState().restoreTask('p')
    expect(sortedIds(useStore.getState().trashTasks)).toEqual(['p'])
    expect(useStore.getState().tasks).toEqual([])
    error.mockRestore()
  })

  // 답의 모양을 모르면 짐작하지 않고 main에서 통째로 다시 읽는다.
  const reloadFrom = (live: Record<string, unknown>[], trash: Record<string, unknown>[]): void => {
    Object.assign(window.api, {
      getLists: vi.fn(async () => []),
      getTasks: vi.fn(async () => live),
      getTrashTasks: vi.fn(async () => trash),
      getHabits: vi.fn(async () => []),
      getHabitLogs: vi.fn(async () => []),
      getFolders: vi.fn(async () => []),
      getPomodoroSessions: vi.fn(async () => []),
      getScore: vi.fn(async () => ({ total: 0, events: [], taskNet: {} }))
    })
  }

  it('배열이 아닌 답이면 main에서 다시 읽는다', async () => {
    vi.mocked(window.api.restoreTask).mockResolvedValue(undefined)
    reloadFrom([{ id: 'p', title: 'p', list_id: 'inbox' }], [{ id: 'c', title: 'c', list_id: 'inbox', deleted_at: at }])
    useStore.setState({ tasks: [], trashTasks: [task({ id: 'p', deletedAt: at }), task({ id: 'c', deletedAt: at })] })
    await useStore.getState().restoreTask('p')
    await vi.waitFor(() => expect(sortedIds(useStore.getState().tasks)).toEqual(['p']))
    expect(sortedIds(useStore.getState().trashTasks)).toEqual(['c'])
  })

  // 답이 오기 전에 '휴지통 비우기'가 화면의 휴지통을 비웠다 — 옮길 행이 화면에 없다.
  // main은 복원을 먼저 처리했으니(IPC는 순서대로 간다) 그 행은 디스크에 살아 있다.
  it('돌려받은 id가 화면 어디에도 없으면 main에서 다시 읽는다', async () => {
    let answer: (ids: string[]) => void = () => {}
    vi.mocked(window.api.restoreTask).mockReturnValue(new Promise((r) => (answer = r)))
    Object.assign(window.api, { emptyTrash: vi.fn() })
    reloadFrom([{ id: 'p', title: 'p', list_id: 'inbox' }], [])
    useStore.setState({ tasks: [], trashTasks: [task({ id: 'p', deletedAt: at })] })
    const restoring = useStore.getState().restoreTask('p')
    await useStore.getState().emptyTrash()
    answer(['p'])
    await restoring
    await vi.waitFor(() => expect(sortedIds(useStore.getState().tasks)).toEqual(['p']))
  })
})

/**
 * M8 — 완료 이벤트가 200개 창 밖으로 밀리면 완료 취소가 회수하지 못했다.
 * 회수액의 출처를 잘리는 `events`에서 잘리지 않는 `taskNet` 원장으로 옮겼다.
 */
describe('점수 원장', () => {
  it('완료가 원장에 남고 취소가 그만큼 회수한다', async () => {
    useStore.setState({ tasks: [task({ id: 'a', priority: 'high' })], score: { total: 10, events: [], taskNet: {} } })
    await useStore.getState().toggleTask('a')
    expect(useStore.getState().score.taskNet).toEqual({ a: 3 })

    await useStore.getState().toggleTask('a')
    expect(useStore.getState().score.taskNet).toEqual({})
    expect(useStore.getState().score.total).toBe(10)
  })

  it('이벤트가 200개 창 밖으로 밀려도 회수한다', async () => {
    useStore.setState({ tasks: [task({ id: 'a', priority: 'high' })], score: { total: 10, events: [], taskNet: {} } })
    await useStore.getState().toggleTask('a')

    // 표시용 배열에서 'a'의 완료 이벤트를 밀어낸다.
    await useStore.getState().addScores(
      Array.from({ length: 250 }, (_, i) => ({ type: 'habitComplete' as const, points: 1, taskId: `f${i}` }))
    )
    expect(useStore.getState().score.events).toHaveLength(200)
    expect(
      useStore.getState().score.events.some((e) => e.taskId === 'a'),
      '전제: 옛 이벤트가 창 밖으로 밀렸다'
    ).toBe(false)

    const before = useStore.getState().score.total
    await useStore.getState().toggleTask('a')
    expect(useStore.getState().score.total, '회수되지 않아 점수가 순증했다').toBe(before - 3)
  })

  it('일괄 완료도 원장에 남긴다', async () => {
    useStore.setState({
      tasks: [task({ id: 'a', priority: 'high' }), task({ id: 'b', priority: 'medium' })],
      score: { total: 0, events: [], taskNet: {} },
      batchSelectedIds: ['a', 'b'],
      batchMode: true
    })
    await useStore.getState().batchComplete()
    expect(useStore.getState().score.taskNet).toEqual({ a: 3, b: 2 })
  })
})

/**
 * H8의 나머지 절반 — **최종 사용자에게 보이는 유령 편집.**
 *
 * 메인을 fail-closed로 만든 것만으로는 부족하다. 렌더러는 낙관적으로 먼저 바꾸고
 * IPC 거절을 `persist()`에서 로그로 삼켰으므로, 화면에는 편집이 남고 재시작하면
 * 사라진다. 검증이 `createFolder`로 실측했다: db_read_only로 거절됐는데 폴더가
 * 화면에 남아 있었다.
 *
 * 메인 쪽 테스트는 메인 함수를 직접 부르므로 이 경로를 구조적으로 못 잡는다 —
 * 여기가 그 자리다.
 *
 * 되돌리는 방법이 재적재인 이유: 읽기 전용 세션에서는 **아무것도** 쓸 수 없으므로
 * 메인의 상태가 곧 디스크의 진실이고 이 세션 내내 변하지 않는다. 연산마다 역연산을
 * 쓰지 않고도 정확한 롤백이 된다.
 */
describe('읽기 전용 세션의 유령 편집', () => {
  const rejectWith = (message: string) => vi.fn().mockRejectedValue(new Error(message))

  /** 메인이 들고 있는(=디스크의) 진실. 재적재는 여기서 온다. */
  const mainState = {
    getLists: vi.fn().mockResolvedValue([{ id: 'inbox', name: '기본함', color: '#fff', icon: 'inbox' }]),
    getTasks: vi.fn().mockResolvedValue([]),
    getTrashTasks: vi.fn().mockResolvedValue([]),
    getHabits: vi.fn().mockResolvedValue([]),
    getHabitLogs: vi.fn().mockResolvedValue([]),
    getFolders: vi.fn().mockResolvedValue([]),
    getPomodoroSessions: vi.fn().mockResolvedValue([]),
    getScore: vi.fn().mockResolvedValue({ total: 0, events: [], taskNet: {} })
  }

  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

  beforeEach(() => {
    vi.stubGlobal('window', {
      api: {
        ...mainState,
        createFolder: rejectWith('Error invoking remote method: Error: db_read_only'),
        createTask: rejectWith('Error invoking remote method: Error: db_read_only'),
        updateTask: rejectWith('Error invoking remote method: Error: db_read_only'),
        addScoreEvent: vi.fn(),
        addScoreEvents: vi.fn()
      }
    })
    useStore.setState({ folders: [], tasks: [], lists: [], dbReadOnly: false })
  })

  it('거절된 폴더 생성이 화면에 남지 않는다', async () => {
    // await하지 않고 낙관적 상태를 먼저 본다 — await하면 거절 처리가 그 사이에
    // 끼어들어 "먼저 보였다"를 관찰할 수 없다.
    const pending = useStore.getState().addFolder('유령 폴더')
    expect(useStore.getState().folders, '전제: 낙관적으로 먼저 보인다').toHaveLength(1)

    await pending
    await flush()
    await flush()

    expect(useStore.getState().folders, '거절됐는데 폴더가 화면에 남았다').toEqual([])
  })

  it('거절된 할일 생성이 화면에 남지 않는다', async () => {
    const pending = useStore.getState().addTask('유령 할일')
    expect(useStore.getState().tasks, '전제: 낙관적으로 먼저 보인다').toHaveLength(1)

    await pending
    await flush()
    await flush()

    expect(useStore.getState().tasks).toEqual([])
  })

  it('읽기 전용이라는 사실을 상태에 세워 화면이 말할 수 있게 한다', async () => {
    await useStore.getState().addFolder('유령 폴더')
    await flush()
    await flush()
    expect(useStore.getState().dbReadOnly).toBe(true)
  })

  it('메인에서 다시 읽어온 것으로 대체한다', async () => {
    await useStore.getState().addFolder('유령 폴더')
    await flush()
    await flush()
    expect(useStore.getState().lists.map((l) => l.id)).toEqual(['inbox'])
    expect(mainState.getTasks).toHaveBeenCalled()
  })

  // 거절은 무더기로 온다 — 일괄 조작 하나가 IPC를 여럿 쏘고 그 전부가 거절된다.
  it('거절이 쏟아져도 재적재는 한 번만 돈다', async () => {
    mainState.getTasks.mockClear()
    await Promise.all([
      useStore.getState().addFolder('a'),
      useStore.getState().addFolder('b'),
      useStore.getState().addFolder('c')
    ])
    await flush()
    await flush()
    expect(mainState.getTasks.mock.calls.length).toBe(1)
  })

  // 라이선스 거절은 다른 경로다 — 그쪽은 게이트를 띄우지 재적재하지 않는다.
  it('라이선스 거절을 읽기 전용으로 오해하지 않는다', async () => {
    vi.stubGlobal('window', {
      api: { ...mainState, createFolder: rejectWith('Error: license_required') }
    })
    mainState.getTasks.mockClear()
    await useStore.getState().addFolder('유료 폴더')
    await flush()
    await flush()
    expect(useStore.getState().dbReadOnly).toBe(false)
    expect(mainState.getTasks).not.toHaveBeenCalled()
  })
})

/**
 * Regression: 진단 2.3 — 모양이 어긋난 행 하나가 앱 전체를 백지로 만들었다.
 * Found by /qa on 2026-09-25
 * Report: docs/reports/2026-09-25-전체-진단.html
 *
 * `mapTask`가 `JSON.parse` 결과를 `as string[]`로 캐스팅만 했다. 파싱 결과가
 * 배열이 아니면 그대로 `Task.tags`에 앉고, 화면이 `tags.map(...)`에서 던졌다.
 * 값이 디스크에 있으므로 재시작해도 같은 자리에서 다시 죽었다.
 *
 * 마이그레이션으로 넘어온 옛 스키마, 손으로 고친 JSON, 다른 버전이 쓴 파일 —
 * 어느 쪽이든 이 경계에서 "태그 없음"으로 내려앉아야 한다.
 */
describe('loadData — 어긋난 행이 화면을 무너뜨리지 않는다', () => {
  const row = (over: Record<string, unknown>): Record<string, unknown> => ({
    id: 'r1',
    title: '행',
    tags: '[]',
    attachments: '[]',
    created_at: '2026-09-25T00:00:00.000Z',
    ...over
  })

  const loadWith = async (rows: Record<string, unknown>[]): Promise<void> => {
    vi.stubGlobal('window', {
      api: {
        getLists: async () => [],
        getTasks: async () => rows,
        getTrashTasks: async () => [],
        getHabits: async () => [],
        getHabitLogs: async () => [],
        getFolders: async () => [],
        getPomodoroSessions: async () => [],
        getScore: async () => ({ total: 0, events: [], taskNet: {} })
      }
    })
    await useStore.getState().loadData()
  }

  it('이중 인코딩된 tags가 배열로 내려앉는다', async () => {
    // 실측된 그 값: JSON.parse('"[]"') === '[]' (문자열) → .map이 없다.
    await loadWith([row({ tags: '"[]"' })])
    const [task] = useStore.getState().tasks
    expect(Array.isArray(task.tags)).toBe(true)
    expect(task.tags).toEqual([])
    expect(() => task.tags.map((x) => x)).not.toThrow()
  })

  it('객체·숫자·문자열 어떤 것이 와도 배열이다', async () => {
    for (const bad of ['{"a":1}', '42', '"업무"', 'true', 'null', '깨진 JSON']) {
      await loadWith([row({ tags: bad, attachments: bad })])
      const [task] = useStore.getState().tasks
      expect(Array.isArray(task.tags), `tags for ${bad}`).toBe(true)
      expect(Array.isArray(task.attachments), `attachments for ${bad}`).toBe(true)
    }
  })

  it('배열 안의 비문자열 원소는 걸러낸다', async () => {
    await loadWith([row({ tags: '["업무", 7, null, "긴급"]' })])
    expect(useStore.getState().tasks[0].tags).toEqual(['업무', '긴급'])
  })

  it('정상 tags는 그대로 통과한다', async () => {
    await loadWith([row({ tags: '["업무","긴급"]' })])
    expect(useStore.getState().tasks[0].tags).toEqual(['업무', '긴급'])
  })

  it('scheduledOverrides가 배열이면 없는 것으로 친다', async () => {
    await loadWith([row({ scheduled_overrides: '["나쁜 값"]' })])
    expect(useStore.getState().tasks[0].scheduledOverrides).toBeNull()
  })
})

/**
 * **검색이 화면을 좁혀도 일괄 선택은 그대로 남아 있었다.**
 *
 * 검색창은 일괄 모드에서도 계속 떠 있고(BatchBar는 따로 뜨는 바다), `setSearchQuery`는
 * `batchSelectedIds`를 건드리지 않았다. 그래서 '전체 선택' 뒤에 검색어를 치면 화면에는
 * 두어 줄만 남는데 BatchBar는 여전히 스물몇 개를 들고 있었고, 그 상태의 삭제가 화면에
 * 없는 할일까지 통째로 휴지통에 넣었다 — 무엇이 사라졌는지 화면에 아무 단서도 없이.
 * 완료는 가려진 것의 점수까지 지급했고, 이동은 가려진 것을 다른 리스트로 옮겼다.
 *
 * getFilteredTaskIds에 검색 필터를 넣은 건 '검색 → 전체 선택' 순서만 고쳤다.
 * 반대 순서('전체 선택 → 검색')는 여기서 막는다.
 */
describe('일괄 선택과 검색 좁히기', () => {
  const rows = () => [
    task({ id: 'a', title: '빨래' }),
    task({ id: 'b', title: '설거지' }),
    task({ id: 'c', title: '보고서' })
  ]

  it('검색으로 가려진 할일은 선택에서 빠진다 — 일괄 삭제가 화면 밖의 것을 버리지 않는다', async () => {
    useStore.setState({ tasks: rows(), trashTasks: [], selectedListId: 'inbox', searchQuery: '', batchMode: true })
    useStore.getState().selectAllBatch()
    useStore.getState().setSearchQuery('보고서')
    expect(useStore.getState().batchSelectedIds, 'BatchBar의 개수는 화면에 보이는 수와 같아야 한다').toEqual(['c'])

    await useStore.getState().batchDelete()
    expect(useStore.getState().trashTasks.map((t) => t.id)).toEqual(['c'])
    expect(useStore.getState().tasks.map((t) => t.id), '가려진 빨래·설거지가 함께 버려졌다').toEqual(['a', 'b'])
  })

  it('일괄 완료도 가려진 할일의 점수를 지급하지 않는다', async () => {
    useStore.setState({
      tasks: rows().map((t) => ({ ...t, priority: 'high' as const })),
      score: { total: 0, events: [], taskNet: {} },
      selectedListId: 'inbox',
      searchQuery: '',
      batchMode: true
    })
    useStore.getState().selectAllBatch()
    useStore.getState().setSearchQuery('보고서')
    await useStore.getState().batchComplete()
    expect(
      useStore
        .getState()
        .tasks.filter((t) => t.completed)
        .map((t) => t.id)
    ).toEqual(['c'])
    expect(useStore.getState().score.taskNet).toEqual({ c: 3 })
  })

  // 검색을 지운다고 선택이 되살아나면 안 된다 — 사라진 선택은 화면에서도 사라져 있었다.
  it('검색어를 지워도 걸러진 선택은 돌아오지 않는다', () => {
    useStore.setState({ tasks: rows(), selectedListId: 'inbox', searchQuery: '', batchMode: true })
    useStore.getState().selectAllBatch()
    useStore.getState().setSearchQuery('보고서')
    useStore.getState().setSearchQuery('')
    expect(useStore.getState().batchSelectedIds).toEqual(['c'])
  })

  // 일괄 모드가 아닐 때는 아무것도 걸러내지 않는다(불변식: 선택이 비어 있다).
  it('일반 모드의 검색은 선택을 건드리지 않는다', () => {
    useStore.setState({ tasks: rows(), selectedListId: 'inbox', searchQuery: '', batchMode: false })
    useStore.getState().setSearchQuery('보고서')
    expect(useStore.getState().batchSelectedIds).toEqual([])
    expect(useStore.getState().searchQuery).toBe('보고서')
  })

  // 거르는 잣대가 '전체 선택' 대상(getFilteredTaskIds)이면 안 되는 이유.
  // 뷰는 완료한 할일도 '완료 N' 묶음으로 계속 그리고 거기서도 체크가 되는데,
  // getFilteredTaskIds는 미완료만 돌려준다. 그걸로 거르면 검색어에 멀쩡히 걸려
  // 화면에 그대로 보이는 완료 항목의 체크가 타이핑 한 번에 조용히 풀렸다.
  it('검색어에 걸리면 완료된 할일의 선택도 유지된다 — 아직 화면에 보인다', () => {
    useStore.setState({
      tasks: [...rows(), task({ id: 'd', title: '보고서 초안', completed: true })],
      selectedListId: 'inbox',
      searchQuery: '',
      batchMode: true
    })
    useStore.getState().toggleBatchSelect('c')
    useStore.getState().toggleBatchSelect('d')
    useStore.getState().setSearchQuery('보고서')
    expect(useStore.getState().batchSelectedIds).toEqual(['c', 'd'])
  })
})

/**
 * 반복 할일은 완료할 때마다 다음 회차를 새로 만든다. 그 스폰이 제목·마감일만
 * 들고 가던 시절, 메모·첨부·체크리스트는 완료본에만 남았다 — 완료본은 '완료'
 * 스마트 리스트 말고는 어느 화면에도 안 보이므로, 사용자 쪽에서는 주간 장보기에
 * 적어 둔 품목 목록이 체크 한 번에 사라진 것과 구별되지 않았다.
 */
describe('반복 스폰 — 내용이 다음 회차로 넘어간다', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0))
    // 스토어 기본값이 'today'라 앞 테스트가 무엇을 남겼든 여기서 못 박는다 —
    // 뷰가 '오늘'이면 날짜 자동 채움이 끼어들어 마지막 케이스와 구분이 흐려진다.
    useStore.setState({ selectedListId: 'inbox' })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const weekly = (): Task =>
    task({
      id: 'shop',
      title: '장보기',
      description: '우유, 계란, 빵',
      attachments: ['목록.png|/data/attachments/uuid-목록.png'],
      isRecurring: true,
      recurringPattern: 'daily',
      dueDate: '2026-08-15'
    })

  /** 스폰된 다음 회차(= 미완료 최상위 하나). */
  const spawned = (): Task | undefined => useStore.getState().tasks.find((t) => !t.completed && !t.parentId)
  /** 그 회차에 달린 체크리스트. */
  const kids = (): Task[] => useStore.getState().tasks.filter((t) => t.parentId === spawned()?.id)

  it('toggleTask 스폰이 메모와 첨부를 들고 간다', async () => {
    useStore.setState({ tasks: [weekly()] })
    await useStore.getState().toggleTask('shop')
    expect(spawned()?.dueDate).toBe('2026-08-16')
    expect(spawned()?.description).toBe('우유, 계란, 빵')
    expect(spawned()?.attachments).toEqual(['목록.png|/data/attachments/uuid-목록.png'])
  })

  // 체크리스트는 시리즈의 것이다. 지난 회차에서 체크한 표시는 따라오지 않는다.
  it('toggleTask 스폰이 하위작업을 전부 미완료로 다시 세운다', async () => {
    useStore.setState({
      tasks: [
        weekly(),
        task({ id: 's1', title: '우유', parentId: 'shop', description: '저지방' }),
        task({ id: 's2', title: '계란', parentId: 'shop', completed: true, priority: 'high' })
      ]
    })
    await useStore.getState().toggleTask('shop')
    expect(kids().map((k) => k.title)).toEqual(['우유', '계란'])
    expect(kids().map((k) => k.completed)).toEqual([false, false])
    expect(kids().map((k) => k.description)).toEqual(['저지방', ''])
    expect(kids().map((k) => k.priority)).toEqual(['none', 'high'])
    // 원본의 하위작업은 그대로 원본에 남는다 — 옮기는 것이 아니라 복제다.
    expect(useStore.getState().tasks.filter((t) => t.parentId === 'shop')).toHaveLength(2)
  })

  // 일괄 완료는 스폰을 collectRecurrenceSpawns로 따로 계산한다 — 한 건씩 완료한
  // 것과 결과가 같아야 한다. 여기서 갈리면 같은 할일이 어떻게 완료했느냐에 따라
  // 다음 주에 내용이 있기도 없기도 한다.
  it('batchComplete 스폰도 같은 것을 들고 간다', async () => {
    useStore.setState({
      tasks: [weekly(), task({ id: 's1', title: '우유', parentId: 'shop' })],
      batchSelectedIds: ['shop']
    })
    await useStore.getState().batchComplete()
    expect(spawned()?.description).toBe('우유, 계란, 빵')
    expect(spawned()?.attachments).toEqual(['목록.png|/data/attachments/uuid-목록.png'])
    expect(kids().map((k) => k.title)).toEqual(['우유'])
  })

  // '오늘' 뷰의 날짜 자동 채움은 최상위 할일만의 규칙이다(태그 상속과 같은 기준).
  // 하위작업까지 채우면 다음 주 체크리스트에 오늘 날짜가 찍혀 부모와 어긋난다.
  it('스폰된 하위작업은 오늘 뷰의 마감일을 물려받지 않는다', async () => {
    useStore.setState({
      tasks: [weekly(), task({ id: 's1', title: '우유', parentId: 'shop' })],
      selectedListId: 'today'
    })
    await useStore.getState().toggleTask('shop')
    expect(spawned()?.dueDate).toBe('2026-08-16')
    expect(kids().map((k) => k.dueDate)).toEqual([null])
  })
})

/**
 * 버려진 AI 스트림이 다음 답변을 오염시키고 끊었다 (2026-09-25 진단 #18).
 *
 * `ai:stream-*`는 창에 채널이 하나뿐인 브로드캐스트고, 렌더러가 리스너를 떼도
 * main의 `streamChat`은 끝까지 돈다(취소 경로가 없다). 두 스트림이 겹치는 문은
 * 정확히 하나다 — `setShowAiChat(false)`가 답변 도중 리스너를 걷으면서
 * `aiLoading:false`로 되돌려, AiChatPanel이 막고 있던 전송을 다시 열어 준다.
 * 이벤트에 요청 id가 없던 시절 그 결과는 둘이었다: 버려진 스트림의 잔여 토큰이
 * 새 답변 말머리에 붙었고, 그 done이 새 스트림의 리스너를 통째로 걷어 가
 * 진짜 답변이 문장 중간에서 끊긴 채 히스토리에 저장됐다.
 */
describe('AI 스트림 요청 격리', () => {
  type TokenCb = (token: string, requestId: string) => void
  type DoneCb = (requestId: string) => void

  // main을 흉내 내는 단일 브로드캐스트 버스. 실제 배관과 같은 모양이다 —
  // 채널은 창당 하나고, 스트림이 몇 개 살아 있든 같은 채널로 쏟아진다.
  function makeBus() {
    const tokenCbs: TokenCb[] = []
    const doneCbs: DoneCb[] = []
    const requestIds: string[] = []
    const api = {
      // 실제 핸들러도 streamChat을 await 하지 않고 즉시 반환한다.
      aiStreamChat: vi.fn(async (_m: string, _t: unknown, _h: unknown, requestId: string) => {
        requestIds.push(requestId)
      }),
      aiSaveHistory: vi.fn(),
      onAiStreamToken: (cb: TokenCb) => {
        tokenCbs.push(cb)
        return () => {
          const i = tokenCbs.indexOf(cb)
          if (i >= 0) tokenCbs.splice(i, 1)
        }
      },
      onAiStreamDone: (cb: DoneCb) => {
        doneCbs.push(cb)
        return () => {
          const i = doneCbs.indexOf(cb)
          if (i >= 0) doneCbs.splice(i, 1)
        }
      },
      onAiStreamError: () => () => {}
    }
    return {
      api,
      // stream 0 = 첫 질문의 스트림(A), 1 = 둘째 질문의 스트림(B)
      emitToken: (stream: number, token: string) => {
        for (const cb of [...tokenCbs]) cb(token, requestIds[stream])
      },
      emitDone: (stream: number) => {
        for (const cb of [...doneCbs]) cb(requestIds[stream])
      }
    }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('패널을 닫아 버려진 스트림은 다음 답변에 끼어들지 못한다', async () => {
    const bus = makeBus()
    vi.stubGlobal('window', { api: bus.api })
    useStore.setState({
      aiMessages: [],
      aiLoading: false,
      aiConfig: null,
      showAiChat: true,
      _aiStreamCleanup: null
    })

    // 1) 첫 질문 — 스트림 A 시작
    await useStore.getState().aiSendMessage('첫 질문')
    bus.emitToken(0, '첫답변')

    // 2) 답변 도중 패널을 닫았다 연다. 렌더러 리스너만 떨어지고 main의 A는 계속 돈다.
    useStore.getState().setShowAiChat(false)
    useStore.getState().setShowAiChat(true)

    // 3) 둘째 질문 — 스트림 B 시작. 이제 A와 B가 같은 채널을 공유한다.
    await useStore.getState().aiSendMessage('둘째 질문')

    // 4) 버려진 A가 남은 토큰을 뱉는다  5) B의 진짜 첫 토큰
    bus.emitToken(0, '[A의 잔여 토큰]')
    bus.emitToken(1, '둘째답변')
    // 6) A가 끝난다 — 예전에는 여기서 B의 리스너가 통째로 걷혔다
    bus.emitDone(0)
    // 7) B는 아직 답하는 중
    bus.emitToken(1, ' 이어짐')

    const second = useStore.getState().aiMessages[3]?.content
    expect(second, 'A의 잔여 토큰이 B의 답변에 섞이면 안 된다').toBe('둘째답변 이어짐')
    expect(useStore.getState().aiLoading, 'A의 done이 B의 스피너를 꺼서는 안 된다').toBe(true)

    // B가 제대로 끝나면 그때 스피너가 꺼지고 히스토리가 저장된다.
    bus.emitDone(1)
    expect(useStore.getState().aiLoading).toBe(false)
    expect(bus.api.aiSaveHistory).toHaveBeenCalled()
  })
})

/**
 * 액션 카드로만 오간 대화가 디스크에 남는가.
 *
 * 2026-09-25 검증에서 실측: `aiRequestTaskAction`/`aiConfirmAction`/`aiCancelAction`은
 * 대화에 메시지를 밀어 넣고도 `aiSaveHistory`를 한 번도 부르지 않았다. 저장은
 * `aiSendMessage`의 done/error 핸들러 안에만 있었다. 그래서 액션만 쓰고 앱을 끄면
 * `aiLoadHistory()`가 마지막으로 저장된 = 이전 대화를 되살린다: 할일은 완료·삭제됐는데
 * 시켰다는 기록은 사라지고, 화면은 옛 대화로 되돌아간다.
 */
describe('AI 액션 경로의 대화 저장', () => {
  const interpret = (): ReturnType<typeof vi.fn> => window.api.aiInterpretAction as ReturnType<typeof vi.fn>
  const saved = (): AiMessage[] =>
    ((window.api.aiSaveHistory as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] ?? []) as AiMessage[]

  beforeEach(() => {
    useStore.setState({ aiMessages: [], aiPendingAction: null, aiConfig: null, aiLoading: false })
  })

  it('확인한 액션의 요청과 결과를 남긴다', async () => {
    useStore.setState({ tasks: [task({ id: 'a', title: '장보기' })] })
    interpret().mockResolvedValue({ op: 'complete', taskTitle: '장보기', dueDate: null })

    await useStore.getState().aiRequestTaskAction('장보기 완료해줘')
    await useStore.getState().aiConfirmAction()

    expect(window.api.aiSaveHistory).toHaveBeenCalled()
    expect(saved().map((m) => m.role)).toEqual(['user', 'assistant'])
    // 저장본과 화면이 같아야 한다 — 다르면 재시작할 때 대화가 소리 없이 달라진다.
    expect(saved()).toEqual(useStore.getState().aiMessages)
  })

  // 취소도 기록이다. 무엇을 안 하기로 했는지가 남아야 다음에 또 시킬지 판단할 수 있다.
  it('취소한 액션도 남긴다', async () => {
    useStore.setState({ tasks: [task({ id: 'a', title: '장보기' })] })
    interpret().mockResolvedValue({ op: 'delete', taskTitle: '장보기', dueDate: null })

    await useStore.getState().aiRequestTaskAction('장보기 삭제해줘')
    useStore.getState().aiCancelAction()

    expect(saved()).toEqual(useStore.getState().aiMessages)
    expect(saved()).toHaveLength(2)
  })

  // 실패 응답("그런 할일 못 찾았다")도 대화다. 이것만 사라지면 사용자는 자기가
  // 물어본 적 없다고 기억하게 된다.
  it('할일을 못 찾았다는 답도 남긴다', async () => {
    useStore.setState({ tasks: [] })
    interpret().mockResolvedValue({ op: 'complete', taskTitle: '없는할일', dueDate: null })

    await useStore.getState().aiRequestTaskAction('없는할일 완료해줘')

    expect(saved()).toEqual(useStore.getState().aiMessages)
    expect(saved()).toHaveLength(2)
  })
})
