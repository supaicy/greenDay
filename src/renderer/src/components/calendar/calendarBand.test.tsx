// @vitest-environment jsdom

/**
 * 캘린더의 '시간 밴드'가 하루 전체를 덮는지 못 박는다.
 *
 * 주간은 8~22시, 일간은 6~23시 행만 그리면서 dueTime이 있는 할일은 무조건
 * timed 버킷으로 보냈다 — 종일 행에서는 빠지는데 그 시각의 행이 없어서
 * 07:00·23:00(주간) / 03:00·00:30(일간) 할일이 격자 어디에도 안 떴다.
 * 시간블록도 같은 구멍이었다: 블록 레이어가 -시작시각만큼 올라가 있어 밴드
 * 밖 블록은 top이 음수가 되고, 스크롤로도 닿지 못했다.
 *
 * 버킷 판정(dueTime이 있나)과 렌더 판정(그 시각 행이 있나)은 같은 말을 해야 한다.
 * Found by /qa on 2026-09-25 (진단 #41)
 */

import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { useStore } from '../../store/useStore'
import { todayString } from '../../utils/date'
import type { Task } from '../../types'
import { WeeklyCalendar } from './WeeklyCalendar'
import { DailyCalendar } from './DailyCalendar'

beforeAll(async () => {
  // jsdom의 navigator.language는 en-US라 초기 언어가 흔들린다 — 한국어로 고정.
  await i18n.changeLanguage('ko')
  // TimeBlock의 컨텍스트 메뉴(Radix)가 쓰는 브라우저 API 중 jsdom에 없는 것들.
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

// 실제 스토어에 연결된 컴포넌트를 그린다. window.api가 없으면 스토어 쓰기가
// unhandled rejection으로 죽고, setState로 심은 값은 모듈 싱글턴에 남아 뒤
// 테스트로 샌다 — 스냅샷으로 되돌린다.
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

// '배정 안 됨' 레일(aside)은 scheduledStart 없는 할일을 전부 싣는다 —
// 격자에서 사라진 것도 거기엔 보이므로, 격자 안쪽만 센다.
function inGrid(title: string): HTMLElement[] {
  return screen.queryAllByText(title).filter((el) => el.closest('aside') === null)
}

// 블록은 절대배치라 DOM에 있어도 보이지 않을 수 있다. 자기 top과 조상 레이어의
// 오프셋을 합쳐 실제 y를 구한다 — 음수면 격자 위로 잘려 스크롤로도 닿지 못한다.
function effectiveTop(el: HTMLElement): number {
  let sum = 0
  let node: HTMLElement | null = el
  while (node && node.tagName !== 'SECTION') {
    if (node.style.top) sum += Number.parseFloat(node.style.top)
    node = node.parentElement
  }
  return sum
}

describe('WeeklyCalendar — 시간대 밖 dueTime', () => {
  it.each([
    ['09:00', '아홉시회의'],
    ['07:00', '새벽스탠드업'],
    ['23:00', '자정전정리'],
    ['00:30', '자정삼십분']
  ])('%s 할일이 주간 격자에 뜬다', (time, title) => {
    useStore.setState({ tasks: [task({ id: `w-${time}`, title, dueTime: time })] } as never)
    render(<WeeklyCalendar />)
    expect(inGrid(title)).toHaveLength(1)
  })

  it('07:00 시간블록이 격자 안(음수 아님)에 놓인다', () => {
    useStore.setState({
      tasks: [
        task({
          id: 'wb',
          title: '새벽블록',
          // dueDate를 비워 둔다 — 남기면 같은 제목이 종일 행에도 떠서
          // 아래 위치 검사가 블록이 아니라 종일 카드를 보게 된다.
          dueDate: null,
          scheduledStart: `${TODAY}T07:00:00`,
          scheduledEnd: `${TODAY}T08:00:00`
        })
      ]
    } as never)
    render(<WeeklyCalendar />)
    const label = inGrid('새벽블록')[0]
    expect(label).toBeTruthy()
    expect(effectiveTop(label)).toBeGreaterThanOrEqual(0)
  })
})

describe('DailyCalendar — 시간대 밖 dueTime', () => {
  it.each([
    ['09:00', '아홉시회의'],
    ['03:00', '새벽세시'],
    ['00:30', '자정삼십분']
  ])('%s 할일이 일간 격자에 뜬다', (time, title) => {
    useStore.setState({ tasks: [task({ id: `d-${time}`, title, dueTime: time })] } as never)
    render(<DailyCalendar />)
    expect(inGrid(title)).toHaveLength(1)
  })

  it('03:00 시간블록이 격자 안(음수 아님)에 놓인다', () => {
    useStore.setState({
      tasks: [
        task({
          id: 'db',
          title: '새벽블록',
          dueDate: null,
          scheduledStart: `${TODAY}T03:00:00`,
          scheduledEnd: `${TODAY}T04:00:00`
        })
      ]
    } as never)
    render(<DailyCalendar />)
    const label = inGrid('새벽블록')[0]
    expect(label).toBeTruthy()
    expect(effectiveTop(label)).toBeGreaterThanOrEqual(0)
  })
})
