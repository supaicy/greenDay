import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useStore } from './useStore'
import { usePomodoroStore, POMODORO_DURATIONS } from './usePomodoroStore'

/**
 * 건너뛰기가 적는 집중 시간이 '실제로 돌린 시간'인지 고정한다.
 *
 * 예전에는 `Date.now() - startedAt`(벽시계)으로 쟀다. startedAt은 첫 재생에만
 * 찍고 일시정지해도 남겨 두므로(세션을 이어 가려고 일부러 그렇게 뒀다), 자리를
 * 비운 시간이 통째로 집중 시간이 됐다 — 2분 집중 → 일시정지 → 25분 뒤 건너뛰기면
 * 정격 25분 세션이 기록되고 POINTS_PER_POMODORO까지 나갔다. 정확히 그 부풀림을
 * 막으려고 둔 60초 하한도 멈춰 있던 시간이 넘겨 버려 무력했다.
 */

// 인자를 타입에 적어 둬야 `mock.calls[0][0]`이 빈 튜플로 추론되지 않는다.
const saveSession = vi.fn(async (_session: Record<string, unknown>) => {})

/** 매 테스트 같은 자리에서 시작한다. switchMode는 sessions를 이어받으므로 직접 넣는다. */
function resetTimer(): void {
  usePomodoroStore.setState({
    mode: 'work',
    timeLeft: POMODORO_DURATIONS.work,
    deadline: null,
    running: false,
    sessions: 0,
    startedAt: null
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-25T09:00:00.000Z'))
  saveSession.mockClear()
  // 기록 경로만 가로챈다. 점수·영속화는 useStore 쪽 테스트가 따로 본다.
  useStore.setState({ savePomodoroSession: saveSession })
  resetTimer()
})

afterEach(() => {
  vi.useRealTimers()
})

/** 초 단위로 벽시계를 민다. 일시정지 중에는 타이머가 줄지 않아야 한다. */
function advance(seconds: number): void {
  vi.setSystemTime(Date.now() + seconds * 1000)
}

describe('pomodoro skip', () => {
  it('일시정지 동안 흐른 시간은 집중 시간으로 세지 않는다', async () => {
    const timer = usePomodoroStore.getState()
    timer.toggleRun() // 재생
    advance(120) // 실제 집중 2분
    timer.tick()
    timer.toggleRun() // 일시정지
    expect(usePomodoroStore.getState().timeLeft).toBe(POMODORO_DURATIONS.work - 120)

    advance(25 * 60) // 자리를 25분 비운다
    await usePomodoroStore.getState().skip()

    expect(saveSession).toHaveBeenCalledTimes(1)
    expect(saveSession.mock.calls[0][0]).toMatchObject({ duration: 120, type: 'work' })
  })

  it('멈춰 있던 시간으로는 60초 하한을 넘지 못한다', async () => {
    const timer = usePomodoroStore.getState()
    timer.toggleRun()
    advance(10) // 실제 집중 10초
    timer.tick()
    timer.toggleRun() // 일시정지
    advance(5 * 60)
    await usePomodoroStore.getState().skip()

    expect(saveSession).not.toHaveBeenCalled()
  })

  it('멈춤 없이 채운 세션은 정격 길이 그대로 기록된다', async () => {
    const timer = usePomodoroStore.getState()
    timer.toggleRun()
    advance(POMODORO_DURATIONS.work)
    timer.tick() // 티커가 skip 직전에 하는 일
    await usePomodoroStore.getState().skip()

    expect(saveSession.mock.calls[0][0]).toMatchObject({ duration: POMODORO_DURATIONS.work })
  })

  it('창이 가려져 틱이 밀렸어도 진행 중 건너뛰기는 deadline으로 다시 잰다', async () => {
    const timer = usePomodoroStore.getState()
    timer.toggleRun()
    advance(180) // 3분 흘렀지만 스로틀돼 tick()이 한 번도 안 왔다
    await usePomodoroStore.getState().skip()

    expect(saveSession.mock.calls[0][0]).toMatchObject({ duration: 180 })
  })
})
