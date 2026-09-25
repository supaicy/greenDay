// @vitest-environment jsdom

/**
 * 사이드바 뱃지 == 그 리스트를 실제로 열었을 때 서는 행의 수.
 *
 * Regression: 하위작업 3개 달린 할일 하나가 기본함 뱃지에 '4'로 떴다. 목록은
 * TaskList가 결과를 isTopLevel로 한 번 더 걸러 1줄만 보여 주는데, 뱃지는 tasks를
 * 그대로 셌기 때문이다. 날짜 스마트 리스트(오늘/내일/다음 7일/요약)만 판별식
 * (SMART_LIST_PREDICATES → isActiveTopLevel)을 뷰와 공유했고, 전체·기본함·완료됨·
 * 사용자 리스트는 각자 셌다 — 사용자는 나머지가 숨은 건지 사라진 건지 알 수 없다.
 *
 * 그래서 이 테스트는 뱃지를 고정된 숫자와 비교하지 않는다. 같은 스토어 상태로 실제
 * TaskListView를 그려서 서는 행을 세고 그 값과 맞춘다 — 한쪽 판별식만 바뀌어도
 * 어긋나게. 숫자만 비교하면 "어디가 몇인지"가 실패 메시지에서 사라지므로 라벨을 붙인다.
 */

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { useStore } from '../../store/useStore'
import type { Task, TaskList } from '../../types'
import { TaskListView } from '../tasks/TaskList'
import { Sidebar } from './Sidebar'

beforeAll(async () => {
  // jsdom의 navigator.language는 en-US라 초기 언어가 흔들린다 — 한국어로 고정.
  await i18n.changeLanguage('ko')
  // Radix(리스트 행의 ⋯ 메뉴, 정렬 메뉴)가 쓰는 API 중 jsdom에 없는 것들.
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView = () => {}
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
})

function task(id: string, title: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title,
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
    attachments: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    completedAt: null,
    deletedAt: null,
    sortOrder: 1,
    isRecurring: false,
    recurringPattern: null,
    scheduledStart: null,
    scheduledEnd: null,
    scheduledOverrides: null,
    ...over
  }
}

// 기본함: 부모 1 + 하위 3 / 업무: 부모 1 + 하위 2 / 완료: 부모 1 + 하위 2.
// 하위작업도 listId를 들고 다닌다(SubtaskList → addTask가 선택된 리스트를 상속) —
// 그래서 뱃지가 안 걸러 내면 바로 이 버킷들에 얹힌다.
const SEED: Task[] = [
  task('p1', '부모-기본함'),
  task('s1', '하위1', { parentId: 'p1' }),
  task('s2', '하위2', { parentId: 'p1' }),
  task('s3', '하위3', { parentId: 'p1' }),
  task('p2', '부모-업무', { listId: 'work' }),
  task('s4', '하위4', { parentId: 'p2', listId: 'work' }),
  task('s5', '하위5', { parentId: 'p2', listId: 'work' }),
  task('c1', '완료-부모', { completed: true, completedAt: '2026-09-02T00:00:00.000Z' }),
  task('c2', '완료-하위1', { completed: true, parentId: 'c1' }),
  task('c3', '완료-하위2', { completed: true, parentId: 'c1' })
]

const LISTS: TaskList[] = [
  { id: 'work', name: '업무', color: '#4A90D9', icon: 'inbox', folderId: null, sortOrder: 1, createdAt: '2026-09-01T00:00:00.000Z' }
]

// 스토어는 모듈 싱글턴이다 — 심은 값을 되돌리지 않으면 뒤 테스트로 샌다.
const STORE_KEYS = ['tasks', 'lists', 'selectedListId'] as const
let snapshot: Record<string, unknown>

beforeEach(() => {
  // window.api가 없으면 스토어 쓰기가 unhandled rejection으로 죽어, 판별식이
  // 회귀했을 때 깔끔한 실패 대신 에러로 터진다.
  ;(window as unknown as Record<string, unknown>).api = {
    updateTask: vi.fn().mockResolvedValue(undefined),
    createTask: vi.fn().mockResolvedValue(undefined),
    deleteTask: vi.fn().mockResolvedValue(undefined),
    batchUpdateTasks: vi.fn().mockResolvedValue(undefined),
    addScoreEvent: vi.fn().mockResolvedValue(undefined),
    addScoreEvents: vi.fn().mockResolvedValue(undefined),
    reorderTasks: vi.fn().mockResolvedValue(undefined)
  }
  const s = useStore.getState() as unknown as Record<string, unknown>
  snapshot = Object.fromEntries(STORE_KEYS.map((k) => [k, s[k]]))
  useStore.setState({ tasks: SEED, lists: LISTS })
})

afterEach(() => {
  cleanup()
  useStore.setState(snapshot as never)
})

/**
 * 사이드바 행의 맨 끝 span이 뱃지다. 스마트 리스트 행은 <button>, 사용자 리스트 행은
 * 중첩 button(⋯ 트리거) 때문에 <div role="button">이라 둘 다 찾는다.
 */
function badgeOf(label: string): string {
  const labelSpan = screen.getByText(label, { selector: 'span' })
  const row = labelSpan.closest('button') ?? labelSpan.closest('[role="button"]')
  const spans = row?.querySelectorAll('span')
  return spans?.[spans.length - 1]?.textContent?.trim() ?? ''
}

/** 그 리스트를 실제로 열었을 때 화면에 서는 행들. */
function rowsIn(listId: string): Task[] {
  useStore.setState({ selectedListId: listId })
  const { unmount } = render(<TaskListView />)
  const rows = SEED.filter((t) => screen.queryAllByText(t.title).length > 0)
  unmount()
  return rows
}

describe('사이드바 뱃지', () => {
  // 뱃지는 '남은 일'이다 → 열었을 때 서는 행 중 미완료 행의 수와 같아야 한다.
  it.each([
    ['기본함', 'inbox'],
    ['전체', 'all'],
    ['업무', 'work']
  ])('%s: 뱃지 == 열었을 때 서는 미완료 행의 수', (label, listId) => {
    // 행을 먼저 센다 — 사이드바가 붙은 뒤 selectedListId를 바꾸면 act 밖 갱신이 된다.
    const rows = rowsIn(listId).filter((t) => !t.completed)
    render(<Sidebar />)
    expect(`${label}=${badgeOf(label)}`).toBe(`${label}=${rows.length}`)
  })

  it('완료됨: 뱃지 == 열었을 때 서는 행의 수', () => {
    const rows = rowsIn('completed')
    render(<Sidebar />)
    expect(`완료됨=${badgeOf('완료됨')}`).toBe(`완료됨=${rows.length}`)
  })
})
