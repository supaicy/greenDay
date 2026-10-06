// @vitest-environment jsdom

/**
 * 캘린더를 열 때 종일 할일이 스크롤에 밀려 안 보이던 문제를 못 박는다.
 *
 * 101b7ee가 밴드를 24시간으로 열면서 마운트 때 격자 컨테이너를 업무시간
 * (일간 06:00, 주간 08:00)으로 스크롤하게 했다. 그런데 종일 블록이 같은 스크롤
 * 컨테이너의 첫 자식이고 sticky가 아니라서, 뷰를 여는 순간 종일 할일이 위로
 * 밀려 사라졌다. 목표 스크롤 값도 그 블록 높이를 무시해서 격자가 초점 시각보다
 * 그만큼 아래에 멈췄다.
 *
 * 종일 블록(주간은 요일 헤더 + 종일 행)을 스크롤 컨테이너 맨 위에 sticky로 고정하면
 * 둘 다 풀린다 — 고정된 블록이 흐름 안에서 격자 바로 위에 있으므로,
 * scrollTop = 초점시각 × 60 × PX_PER_MIN이 그 시각을 고정 블록 바로 아래에 놓는다.
 * jsdom엔 레이아웃이 없어서 그 구조적 계약(sticky 래퍼가 종일 할일을 품고, 격자
 * 바로 앞 형제다)과 마운트 스크롤 값을 검사한다.
 */

import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n, { tList } from '../../i18n'
import { useStore } from '../../store/useStore'
import { todayString } from '../../utils/date'
import type { Task } from '../../types'
import { WeeklyCalendar } from './WeeklyCalendar'
import { DailyCalendar } from './DailyCalendar'

beforeAll(async () => {
  await i18n.changeLanguage('ko')
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

let snapshot: Record<string, unknown>
beforeEach(() => {
  ;(window as unknown as Record<string, unknown>).api = {
    updateTask: vi.fn(),
    createTask: vi.fn(),
    deleteTask: vi.fn()
  }
  const s = useStore.getState() as unknown as Record<string, unknown>
  snapshot = { tasks: s.tasks }
})
afterEach(() => {
  cleanup()
  useStore.setState(snapshot as never)
})

const TODAY = todayString()

function task(partial: Partial<Task>): Task {
  return {
    id: 'x',
    title: 'x',
    description: '',
    completed: false,
    priority: 'none',
    dueDate: TODAY,
    dueTime: null,
    startDate: null,
    reminderAt: null,
    pinned: false,
    listId: 'inbox',
    parentId: null,
    tags: [],
    createdAt: '2026-09-01T00:00:00',
    completedAt: null,
    deletedAt: null,
    sortOrder: 0,
    isRecurring: false,
    recurringPattern: null,
    attachments: [],
    scheduledStart: null,
    scheduledEnd: null,
    ...partial
  }
}

const ALL_DAY_TITLE = '종일할일'

// '배정 안 됨' 레일(aside)에도 같은 제목이 뜬다 — 격자 쪽만 본다.
function allDayInGrid(): HTMLElement {
  const hits = screen.queryAllByText(ALL_DAY_TITLE).filter((el) => el.closest('aside') === null)
  expect(hits).toHaveLength(1)
  return hits[0]
}

function seedAllDay(): void {
  useStore.setState({ tasks: [task({ id: 'allday', title: ALL_DAY_TITLE })] } as never)
}

describe('DailyCalendar — 열 때 종일 할일이 밀려나지 않는다', () => {
  it('종일 블록이 스크롤 컨테이너 맨 위에 sticky로 고정되고, 격자 바로 앞에 있다', () => {
    seedAllDay()
    const { container } = render(<DailyCalendar />)
    const grid = container.querySelector('section') as HTMLElement
    expect(grid).toBeTruthy()

    const pinned = grid.previousElementSibling as HTMLElement | null
    expect(pinned).toBeTruthy()
    expect(pinned).toHaveClass('sticky', 'top-0')
    // 오버레이(110/111)와 토스트(90)보다 아래여야 한다.
    expect(pinned).toHaveClass('z-10')
    expect(pinned).toContainElement(allDayInGrid())
    // 고정 블록이 스크롤 컨테이너의 첫 자식 — 그 위에 밀려 올라갈 것이 없다.
    expect(pinned?.parentElement?.firstElementChild).toBe(pinned)
  })

  it('마운트 때 격자를 06:00(DAY_FOCUS_HOUR)으로 스크롤한다', () => {
    seedAllDay()
    const { container } = render(<DailyCalendar />)
    const scroller = (container.querySelector('section') as HTMLElement).parentElement as HTMLElement
    expect(scroller.scrollTop).toBe(6 * 60 * (40 / 30))
  })
})

describe('WeeklyCalendar — 열 때 종일 할일이 밀려나지 않는다', () => {
  it('요일 헤더와 종일 행이 한 sticky 래퍼 안에 있고, 그 래퍼가 격자 바로 앞에 있다', () => {
    seedAllDay()
    const { container } = render(<WeeklyCalendar />)
    const grid = (container.querySelector('section') as HTMLElement).parentElement as HTMLElement
    const pinned = grid.previousElementSibling as HTMLElement | null
    expect(pinned).toBeTruthy()
    expect(pinned).toHaveClass('sticky', 'top-0', 'z-10')
    expect(pinned).toContainElement(allDayInGrid())
    // 요일 헤더도 같은 래퍼 안이다 — 따로 sticky면 종일 행만 밀려 올라간다.
    const monday = tList('date.weekdaysShort')[1]
    expect(pinned).toContainElement(screen.getByText(monday))
    // 안쪽에 또 sticky가 있으면 두 고정 층이 서로 겹친다.
    expect(pinned?.querySelector('.sticky')).toBeNull()
    expect(pinned?.parentElement?.firstElementChild).toBe(pinned)
  })

  it('마운트 때 격자를 08:00(WEEK_FOCUS_HOUR)으로 스크롤한다', () => {
    seedAllDay()
    const { container } = render(<WeeklyCalendar />)
    // section(요일 칼럼) → 격자 flex → min-w 래퍼 → 스크롤 컨테이너
    const scroller = (container.querySelector('section') as HTMLElement).parentElement?.parentElement
      ?.parentElement as HTMLElement
    expect(scroller).toHaveClass('overflow-auto')
    expect(scroller.scrollTop).toBe(8 * 60 * (48 / 60))
  })
})
