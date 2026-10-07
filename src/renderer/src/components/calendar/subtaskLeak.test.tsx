// @vitest-environment jsdom

/**
 * 하위작업은 캘린더에서도 부모 밖으로 새지 않는다.
 *
 * smartLists.ts의 isTopLevel이 "하위작업을 독립 항목으로 세지 않는다"를 한 곳에서
 * 정의하는데, 캘린더 3종(일간·주간·월간)만 그 판별식을 빼먹고 deletedAt/dueDate만
 * 봤다(2026-09-25 검증). 하위작업에 마감일이 붙는 건 예외가 아니라 기본 경로다 —
 * ai-service.ts의 스키마가 subtasks[].dueDate를 직접 받아 AddTask/useStore가
 * 그대로 addTask({ parentId, dueDate })로 넘긴다.
 *
 * 새면 같은 일이 부모 카드와 하위 카드로 두 번 세어지고, 하위 카드를 누르면
 * TaskList(항상 최상위만 그린다)에서는 찾을 수 없는 할일이 상세 패널에 열린다.
 * 월간 셀은 앞의 3개만 그려서 진짜 할일이 '+n개'로 밀려나기까지 한다. 같은
 * 일간/주간 화면의 왼쪽 '배정 안 됨' 레일은 이미 isActiveTopLevel을 쓰므로,
 * 가드가 없으면 한 화면 안에서 레일과 격자가 서로 다른 개수를 말한다.
 *
 * 순수 로직이 아니라 "실제로 그렸을 때 뭐가 서 있는가"라서 컴포넌트 테스트로 둔다.
 */

import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { useStore } from '../../store/useStore'
import type { Task } from '../../types'
import { todayString } from '../../utils/date'
import { CalendarView } from './CalendarView'
import { DailyCalendar } from './DailyCalendar'
import { WeeklyCalendar } from './WeeklyCalendar'

beforeAll(async () => {
  // jsdom의 navigator.language는 en-US라 초기 언어가 흔들린다 — 한국어로 고정.
  await i18n.changeLanguage('ko')
  // TimeBlock이 쓰는 Radix 컨텍스트 메뉴가 jsdom에 없는 브라우저 API를 건드린다.
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

const TODAY = todayString()

function task(over: Partial<Task>): Task {
  return {
    id: 'x',
    title: 'x',
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

// 종일 칸과 시간 칸 둘 다 본다 — 일간 뷰는 dueTime 유무로 두 갈래로 나눠 그린다.
const FIXTURE: Task[] = [
  task({ id: 'p', title: '보고서 쓰기', dueDate: TODAY }),
  task({ id: 's', title: '자료 모으기', parentId: 'p', dueDate: TODAY }),
  task({ id: 'p2', title: '시간지정 부모', dueDate: TODAY, dueTime: '10:00' }),
  task({ id: 's2', title: '시간지정 하위', parentId: 'p2', dueDate: TODAY, dueTime: '10:30' })
]

// '배정 안 됨' 레일(aside)에도 부모가 실린다 — 격자가 그렸는지를 보려면 레일 밖만 센다.
// (레일은 이미 isActiveTopLevel을 쓰므로 하위작업은 애초에 거기 없다.)
function inGrid(title: string): HTMLElement[] {
  return screen.queryAllByText(title).filter((el) => el.closest('aside') === null)
}

// 스토어는 모듈 싱글턴이라 심은 tasks가 뒤 테스트로 샌다 — 스냅샷으로 되돌린다.
// window.api가 없으면 스토어 쓰기가 unhandled rejection으로 죽어, 가드가 회귀했을 때
// 깔끔한 실패 대신 에러로 터진다.
let snapshot: Task[]
beforeEach(() => {
  ;(window as unknown as Record<string, unknown>).api = { updateTask: vi.fn() }
  snapshot = useStore.getState().tasks
  useStore.setState({ tasks: FIXTURE })
})
afterEach(() => {
  cleanup()
  useStore.setState({ tasks: snapshot })
})

describe('캘린더 3종은 하위작업을 독립 카드로 세우지 않는다', () => {
  it('일간 — 종일 칸에도 시간 칸에도 하위작업이 없다', () => {
    render(<DailyCalendar />)
    expect(inGrid('보고서 쓰기')).toHaveLength(1)
    expect(inGrid('시간지정 부모')).toHaveLength(1)
    // 레일 포함 화면 어디에도 없어야 한다.
    expect(screen.queryAllByText('자료 모으기')).toHaveLength(0)
    expect(screen.queryAllByText('시간지정 하위')).toHaveLength(0)
  })

  it('주간', () => {
    render(<WeeklyCalendar />)
    expect(inGrid('보고서 쓰기')).toHaveLength(1)
    expect(screen.queryAllByText('자료 모으기')).toHaveLength(0)
    expect(screen.queryAllByText('시간지정 하위')).toHaveLength(0)
  })

  it('월간 — 하위작업이 셀의 3칸을 먹어 진짜 할일을 밀어내지 않는다', () => {
    render(<CalendarView />)
    expect(inGrid('보고서 쓰기')).toHaveLength(1)
    expect(inGrid('시간지정 부모')).toHaveLength(1)
    expect(screen.queryAllByText('자료 모으기')).toHaveLength(0)
    expect(screen.queryAllByText('시간지정 하위')).toHaveLength(0)
  })
})
