// @vitest-environment jsdom

/**
 * 칸반 드롭은 분류기(columnTasks)와 한 쌍이다. 분류기가 '진행 중'으로 보는
 * 조건이 늘었는데 드롭 핸들러가 그대로면, 패치가 그 술어를 거짓으로 만들지
 * 못해 updateTask가 `{ id }` 하나만 받고 아무 일도 일어나지 않는다 — 카드는
 * 되튀고 에러도 토스트도 없다. 실제로 82b533b에서 startDate 가지가 분류기에만
 * 생겨, 기간을 쓰는 할일의 드롭이 통째로 죽어 있었다. 이 파일이 그 짝을 못 박는다.
 */

import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { useStore } from '../../store/useStore'
import { todayString } from '../../utils/date'
import { shiftIsoByDays } from '../../utils/recurrence'
import type { Task } from '../../types'
import { KanbanView } from './KanbanView'

function makeTask(over: Partial<Task>): Task {
  return {
    id: 'k1',
    title: '분기 회고',
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
    createdAt: '2026-09-01T00:00:00.000Z',
    completedAt: null,
    deletedAt: null,
    sortOrder: 0,
    isRecurring: false,
    recurringPattern: null,
    attachments: [],
    scheduledStart: null,
    scheduledEnd: null,
    ...over
  }
}

let snap: Record<string, unknown>

beforeAll(async () => {
  // jsdom의 navigator.language는 en-US라 초기 언어가 흔들린다 — 한국어로 고정.
  await i18n.changeLanguage('ko')
})

beforeEach(() => {
  // 실제 스토어에 연결해 그린다. window.api가 없으면 persist가 unhandled
  // rejection으로 죽어, 회귀했을 때 깔끔한 실패 대신 에러로 터진다.
  ;(window as unknown as Record<string, unknown>).api = {
    updateTask: vi.fn(),
    createTask: vi.fn(),
    deleteTask: vi.fn(),
    batchUpdateTasks: vi.fn(),
    addScoreEvent: vi.fn(),
    addScoreEvents: vi.fn(),
    reorderTasks: vi.fn()
  }
  const s = useStore.getState() as unknown as Record<string, unknown>
  snap = { tasks: s.tasks, theme: s.theme, selectedTaskId: s.selectedTaskId }
})

afterEach(() => {
  cleanup()
  // 모듈 싱글턴이라 심은 값이 뒤 테스트로 샌다.
  useStore.setState(snap as never)
})

function dropOnTodo(taskId: string): void {
  fireEvent.drop(screen.getByRole('region', { name: '할 일' }), {
    dataTransfer: { getData: () => taskId, dropEffect: 'move' }
  })
}

it('기간이 시작된 할일을 진행 중 → 할 일로 드롭하면 할 일 열에 남는다', async () => {
  const today = todayString()
  useStore.setState({
    tasks: [makeTask({ startDate: today, dueDate: shiftIsoByDays(today, 5) })]
  } as never)

  render(<KanbanView />)
  // 출발점: 기간이 이미 시작됐으므로 '진행 중'이다(분류기).
  expect(within(screen.getByRole('region', { name: '진행 중' })).getByText('분기 회고')).toBeInTheDocument()

  dropOnTodo('k1')

  await waitFor(() => {
    expect(within(screen.getByRole('region', { name: '할 일' })).getByText('분기 회고')).toBeInTheDocument()
  })
  expect(within(screen.getByRole('region', { name: '진행 중' })).queryByText('분기 회고')).toBeNull()
  // 마감일은 아직 남았으므로 건드리지 않는다 — 시작일만 떨어져 나간다.
  expect(useStore.getState().tasks[0].startDate).toBeNull()
  expect(useStore.getState().tasks[0].dueDate).toBe(shiftIsoByDays(today, 5))
})

it('마감일 없이 시작일만 오늘인 할일도 할 일로 옮겨진다', async () => {
  const today = todayString()
  useStore.setState({ tasks: [makeTask({ id: 'k2', title: '이사 준비', startDate: today })] } as never)

  render(<KanbanView />)
  expect(within(screen.getByRole('region', { name: '진행 중' })).getByText('이사 준비')).toBeInTheDocument()

  dropOnTodo('k2')

  await waitFor(() => {
    expect(within(screen.getByRole('region', { name: '할 일' })).getByText('이사 준비')).toBeInTheDocument()
  })
})

it('회귀 방지: 마감일만 오늘인 할일은 예전처럼 그대로 옮겨진다', async () => {
  const today = todayString()
  useStore.setState({ tasks: [makeTask({ id: 'k3', title: '전구 갈기', dueDate: today })] } as never)

  render(<KanbanView />)
  dropOnTodo('k3')

  await waitFor(() => {
    expect(within(screen.getByRole('region', { name: '할 일' })).getByText('전구 갈기')).toBeInTheDocument()
  })
})

it('미래 시작일은 드롭이 지우지 않는다 — 이미 할 일 열이고, 지우면 기간이 사라진다', async () => {
  const today = todayString()
  const start = shiftIsoByDays(today, 3)
  useStore.setState({
    tasks: [makeTask({ id: 'k4', title: '워크숍', startDate: start, dueDate: shiftIsoByDays(today, 6) })]
  } as never)

  render(<KanbanView />)
  dropOnTodo('k4')

  await waitFor(() => {
    expect(within(screen.getByRole('region', { name: '할 일' })).getByText('워크숍')).toBeInTheDocument()
  })
  expect(useStore.getState().tasks[0].startDate).toBe(start)
})
