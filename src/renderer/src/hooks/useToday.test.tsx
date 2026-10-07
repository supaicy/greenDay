// @vitest-environment jsdom

/**
 * 훅의 요점은 '자정에 다시 무장한다'는 것이다. 순수 헬퍼
 * (msUntilNextLocalMidnight)만 테스트하면, 재무장 호출이 사라져도 초록이다.
 */
import { render, screen, cleanup, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useToday } from './useToday'

function Today(): React.JSX.Element {
  return <span data-testid="today">{useToday()}</span>
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useToday', () => {
  it('로컬 자정을 넘기면 갱신되고, 다음 자정에도 다시 갱신된다', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 15, 23, 59, 50))
    render(<Today />)
    expect(screen.getByTestId('today').textContent).toBe('2026-08-15')

    act(() => {
      vi.advanceTimersByTime(11_000)
    })
    expect(screen.getByTestId('today').textContent).toBe('2026-08-16')

    // 한 번 발화하고 끝나면 여기서 멈춘다 — 재무장을 지키는 단언.
    act(() => {
      vi.advanceTimersByTime(86_400_000)
    })
    expect(screen.getByTestId('today').textContent).toBe('2026-08-17')
  })

  it('언마운트하면 타이머를 정리한다', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0))
    const { unmount } = render(<Today />)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
