// @vitest-environment jsdom

/**
 * Regression: 통계의 '습관 완료율'이 구조적으로 언제나 100%였다.
 *
 * 분모가 `habitLogs.length`였는데, 체크를 풀면 로그의 completed가 false가 되는
 * 게 아니라 행이 지워진다(`store/useStore.ts`의 filter · `main/database.ts`의
 * splice — 둘 다 toggleHabitLog다). 남아 있는 로그는 전부 completed=true라,
 * "있는 것 중 완료된 것"은 늘 전부였다 — 나흘을 걸러도 화면은 100%라고 말했다.
 *
 * 그래서 여기서 못박는 것은 **숫자가 움직인다**는 것이다. 값 하나를 맞히는 게
 * 아니라, 거른 날이 늘면 내려가야 한다.
 *
 * 두 시간대에서 돈다(vitest.config.ts의 TZ_SENSITIVE). habit.createdAt은
 * UTC ISO인데 창은 로컬 날짜로 세므로, Asia/Seoul 한쪽만 보면 부호가 가려진다.
 */

import '@testing-library/jest-dom/vitest'
import { act, render, screen, cleanup } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { useStore } from '../../store/useStore'
import { StatsView } from './StatsView'

// 2026-09-25T12:00Z 고정 — Asia/Seoul(21시)에서도 America/New_York(08시)에서도
// 로컬 날짜가 같은 2026-09-25다. 한쪽 시간대에서만 맞는 창을 세지 않는다.
// 최근 14일 창은 09-12 ~ 09-25.
const NOW = new Date('2026-09-25T12:00:00.000Z')

const HABIT = {
  id: 'h1',
  name: '물 마시기',
  color: '#4A90D9',
  frequency: 'daily' as const,
  targetDays: [0, 1, 2, 3, 4, 5, 6],
  createdAt: '2026-09-01T00:00:00.000Z'
}
const THREE_DAYS = [
  { id: 'l1', habitId: 'h1', date: '2026-09-23', completed: true },
  { id: 'l2', habitId: 'h1', date: '2026-09-24', completed: true },
  { id: 'l3', habitId: 'h1', date: '2026-09-25', completed: true }
]

beforeAll(async () => {
  // jsdom의 navigator.language는 en-US라 초기 언어가 흔들린다 — 한국어로 고정.
  await i18n.changeLanguage('ko')
})

// 스토어는 모듈 싱글턴이라, 심은 값을 되돌리지 않으면 뒤 테스트로 샌다.
let snapshot: Record<string, unknown>

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  const s = useStore.getState() as unknown as Record<string, unknown>
  snapshot = { habits: s.habits, habitLogs: s.habitLogs, tasks: s.tasks, pomodoroSessions: s.pomodoroSessions }
  useStore.setState({ tasks: [], pomodoroSessions: [], habits: [HABIT], habitLogs: THREE_DAYS } as never)
})

afterEach(async () => {
  cleanup()
  vi.useRealTimers()
  useStore.setState(snapshot as never)
  // 언어도 모듈 싱글턴이다 — 영어로 바꿔 본 테스트가 그대로 끝나면 뒤 테스트가
  // 한국어 라벨을 못 찾아 엉뚱한 곳에서 터진다.
  await i18n.changeLanguage('ko')
})

function shownRate(): string {
  return (screen.getByText('습관 완료율').nextElementSibling as HTMLElement).textContent ?? ''
}
// 라벨은 언어를 따라 바뀐다 — 값 칸은 그 라벨의 다음 형제다.
function shownDay(): string {
  const label = screen.getByText(/^(최고 생산 요일|Most productive day)$/)
  return (label.nextElementSibling as HTMLElement).textContent ?? ''
}

describe('통계 · 습관 완료율', () => {
  it('열나흘 중 사흘만 체크했으면 100%가 아니다', () => {
    render(<StatsView />)
    expect(shownRate()).toBe('21%') // 3 / 14
  })

  it('체크를 하나 풀면 숫자가 내려간다', () => {
    render(<StatsView />)
    expect(shownRate()).toBe('21%')
    act(() => {
      // 체크 해제는 completed를 false로 바꾸지 않고 행을 지운다 — 버그의 뿌리.
      useStore.setState({ habitLogs: THREE_DAYS.slice(0, 2) } as never)
    })
    expect(shownRate()).toBe('14%') // 2 / 14
  })

  it('오늘 만든 습관은 만들기 전 날들을 거른 것으로 세지 않는다', () => {
    act(() => {
      useStore.setState({
        habits: [{ ...HABIT, createdAt: '2026-09-25T12:00:00.000Z' }],
        habitLogs: [{ id: 'l1', habitId: 'h1', date: '2026-09-25', completed: true }]
      } as never)
    })
    render(<StatsView />)
    expect(shownRate()).toBe('100%') // 1 / 1 — 첫날부터 7%로 시작하지 않는다
  })
})

/**
 * Regression: 완료가 하나도 없을 때 '최고 생산 요일'이 없는 요일을 지어냈다.
 *
 * 빈 상태를 '-'라는 자리표시 문자열로 만들어 date.dayLabel에 그대로 꽂았다.
 * 한국어 틀은 '{{day}}요일'이라 '-요일'이라는 없는 요일이 나왔고, 영어 틀은
 * 맨 '{{day}}'라 '-' 하나로 끝나 덜 티났을 뿐 똑같이 말이 안 됐다.
 * 영어만 보면 그냥 넘어가기 쉬워서 **두 언어를 다 못박는다** — 틀이 다르면
 * 같은 자리표시 문자열도 다른 모양으로 새는 걸 ko 하나로는 못 잡는다.
 */
describe('통계 · 최고 생산 요일', () => {
  it('완료한 할일이 없으면 없는 요일을 지어내지 않는다', () => {
    render(<StatsView />)
    expect(shownDay()).toBe('없음')
  })

  it('영어에서도 빈 상태는 말이 되는 낱말이다', async () => {
    await i18n.changeLanguage('en')
    render(<StatsView />)
    expect(shownDay()).toBe('None')
  })

  it('완료가 있으면 요일 이름은 그대로 붙는다', () => {
    // 과하게 고쳐 요일 표기 자체를 죽이지 않았는지 보는 반대쪽 가드.
    // 09-24T12:00Z는 Seoul(21시)에서도 New_York(08시)에서도 같은 목요일이다 —
    // 이 파일은 TZ_SENSITIVE라 양쪽에서 돈다.
    act(() => {
      useStore.setState({
        tasks: [
          {
            id: 't1',
            title: '목요일에 끝낸 일',
            completed: true,
            completedAt: '2026-09-24T12:00:00.000Z',
            createdAt: '2026-09-24T00:00:00.000Z'
          }
        ]
      } as never)
    })
    render(<StatsView />)
    expect(shownDay()).toBe('목요일')
  })
})
