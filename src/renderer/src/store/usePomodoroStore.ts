import { create } from 'zustand'
import { useStore } from './useStore'

export type PomodoroMode = 'work' | 'shortBreak' | 'longBreak'

/** 모드별 길이(초). 화면과 스토어가 같은 값을 봐야 남은 시간이 어긋나지 않는다. */
export const POMODORO_DURATIONS: Record<PomodoroMode, number> = {
  work: 25 * 60,
  shortBreak: 5 * 60,
  longBreak: 15 * 60
}

/** 긴 휴식이 오기까지의 집중 세션 수. 세션 점(dot) 개수도 이 값에서 파생된다. */
export const POMODORO_LONG_BREAK_EVERY = 4

/**
 * 이 시간(초)보다 짧은 세션은 기록하지 않는다.
 * 재생 직후 건너뛰기를 반복하면 정격 25분 세션과 점수가 무한히 쌓였다 —
 * duration을 정격값으로 적고 있어서 통계의 '총 집중 시간'도 같이 부풀었다.
 *
 * 이 하한이 실제로 물려면 재는 값이 '돌린 시간'이어야 한다. 벽시계로 재던 동안은
 * 일시정지 1분이 그냥 넘겨 줘서 아무것도 막지 못했다(skip 참고).
 */
export const POMODORO_MIN_RECORDED_SECONDS = 60

interface PomodoroState {
  mode: PomodoroMode
  /** 남은 시간(초). 일시정지 중에는 이 값이 기준, 진행 중에는 deadline에서 파생된다. */
  timeLeft: number
  /**
   * 진행 중일 때 끝나는 시각(epoch ms). 멈춰 있으면 null.
   *
   * 틱마다 1씩 빼면 안 된다 — Chromium은 창이 가려지면 타이머를 초당이 아니라
   * 분당 수준으로 스로틀하므로, 감산 방식은 백그라운드에서 타이머가 한없이 길어진다.
   * 티커가 앱 루트로 옮겨오면서 이 경로가 상시 노출됐다.
   */
  deadline: number | null
  running: boolean
  /** 완료한 집중 세션 수. */
  sessions: number
  /** 현재 세션을 시작한 시각(ISO). 아직 시작 전이면 null. */
  startedAt: string | null

  switchMode: (mode: PomodoroMode) => void
  toggleRun: () => void
  reset: () => void
  tick: () => void
  skip: () => Promise<void>
}

/** 모드를 새로 잡을 때의 상태. 세 군데서 같은 객체를 손으로 조립하던 걸 한곳으로 모은다. */
function fresh(mode: PomodoroMode, sessions: number) {
  return { mode, timeLeft: POMODORO_DURATIONS[mode], deadline: null, running: false, sessions, startedAt: null }
}

/** 벽시계 기준 남은 초. 스로틀로 틱을 몇 번 건너뛰어도 값이 정확하다. */
function remainingSeconds(deadline: number): number {
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
}

/**
 * 포모도로만 담는 별도 스토어.
 *
 * 메인 스토어에 두면 1초마다의 틱이 루트 상태를 새로 만들고, 셀렉터 없이
 * `useStore()`로 구독하는 컴포넌트가 전부 매초 리렌더된다 — 사용자가 다른 뷰에 있어도
 * 사이드바·캘린더·AI 패널까지 통째로 재조정된다. 스토어를 분리하면 틱은 타이머 화면만 건드린다.
 */
export const usePomodoroStore = create<PomodoroState>((set, get) => ({
  ...fresh('work', 0),

  switchMode: (mode) => set((s) => fresh(mode, s.sessions)),
  reset: () => set((s) => fresh(s.mode, s.sessions)),
  toggleRun: () =>
    set((s) => {
      if (s.running) {
        // 멈출 때 남은 시간을 확정해 둔다.
        return { running: false, timeLeft: s.deadline ? remainingSeconds(s.deadline) : s.timeLeft, deadline: null }
      }
      return {
        running: true,
        deadline: Date.now() + s.timeLeft * 1000,
        // 시작 시각은 첫 재생에서만 찍는다 — 일시정지 후 재개해도 세션은 이어진다.
        startedAt: s.startedAt ?? new Date().toISOString()
      }
    }),
  tick: () => set((s) => (s.deadline ? { timeLeft: remainingSeconds(s.deadline) } : {})),

  skip: async () => {
    const { mode, startedAt, sessions, timeLeft, running, deadline } = get()
    // 실제로 흐른 시간만 기록한다. 정격 길이를 적으면 건너뛰기만으로 통계와 점수가 부푼다.
    //
    // 벽시계(`Date.now() - startedAt`)로 재면 안 된다 — startedAt은 첫 재생에만 찍고
    // 일시정지에도 그대로 두므로(위 toggleRun), 멈춰 있던 시간이 통째로 섞인다.
    // 2분 집중 → 일시정지 → 25분 자리 비움 → 건너뛰기면 정격 25분 세션이 기록되고
    // POINTS_PER_POMODORO까지 나갔다. 정확히 그 부풀림을 막으려던 아래 60초 하한도
    // 멈춰 있던 시간이 대신 넘겨 줘서 무력했다(10초 집중 + 5분 정지 = 310초 세션).
    // timeLeft는 진행 중에만 줄어드니 '정격 - 남은 시간'이 곧 실제로 돌린 시간이고,
    // 멈춘 시간은 거기에 절대 섞이지 않는다. 진행 중이면 직전 틱 값 대신 deadline으로
    // 다시 잰다 — 창이 가려지면 틱이 분 단위로 스로틀돼 timeLeft가 최대 1분 낡아 있다.
    const left = running && deadline ? remainingSeconds(deadline) : timeLeft
    const focused = Math.max(0, POMODORO_DURATIONS[mode] - left)
    if (startedAt && focused >= POMODORO_MIN_RECORDED_SECONDS) {
      await useStore.getState().savePomodoroSession({
        taskId: null,
        duration: focused,
        type: mode === 'work' ? 'work' : 'break',
        startedAt,
        completedAt: new Date().toISOString()
      })
    }
    const nextSessions = mode === 'work' ? sessions + 1 : sessions
    const nextMode: PomodoroMode =
      mode === 'work' ? (nextSessions % POMODORO_LONG_BREAK_EVERY === 0 ? 'longBreak' : 'shortBreak') : 'work'
    set(fresh(nextMode, nextSessions))
  }
}))
