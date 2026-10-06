// @vitest-environment jsdom

/**
 * App.tsx가 메인의 업데이트 이벤트를 스토어 상태로 옮기는 자리.
 *
 * Regression: 다운로드 실패가 진행 막대를 그 자리에 얼려 두었다. 메인이 다운로드
 * 실패를 'update-error'(확인 실패)로 보냈고, App은 `updateFailed`만 세운 채
 * `updateDownloadProgress`를 그대로 두었다 — 설정의 카드는 `progress != null`이면
 * 버튼 대신 막대를 그리므로 다시 받을 길이 없었다. 이제 다운로드 실패는 제 채널
 * ('update-download-error')로 오고, 여기서 막대를 내리고 실패를 기록한다.
 *
 * 화면 전체를 그릴 이유가 없어 자식 컴포넌트는 전부 비운다. 보는 것은 구독 배선뿐이다.
 */

import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from './store/useStore'

vi.mock('./components/sidebar/Sidebar', () => ({ Sidebar: () => null }))
vi.mock('./components/sidebar/Settings', () => ({ Settings: () => null }))
vi.mock('./components/tasks/TaskList', () => ({ TaskListView: () => null }))
vi.mock('./components/calendar/CalendarView', () => ({ CalendarView: () => null }))
vi.mock('./components/calendar/WeeklyCalendar', () => ({ WeeklyCalendar: () => null }))
vi.mock('./components/calendar/DailyCalendar', () => ({ DailyCalendar: () => null }))
vi.mock('./components/pomodoro/PomodoroTimer', () => ({ PomodoroTimer: () => null }))
vi.mock('./components/habits/HabitTracker', () => ({ HabitTracker: () => null }))
vi.mock('./components/kanban/KanbanView', () => ({ KanbanView: () => null }))
vi.mock('./components/timeline/TimelineView', () => ({ TimelineView: () => null }))
vi.mock('./components/eisenhower/EisenhowerMatrix', () => ({ EisenhowerMatrix: () => null }))
vi.mock('./components/stats/StatsView', () => ({ StatsView: () => null }))
vi.mock('./components/common/QuickAdd', () => ({ QuickAdd: () => null }))
vi.mock('./components/common/UndoToast', () => ({ UndoToast: () => null }))
vi.mock('./components/ai/AiChatPanel', () => ({ AiChatPanel: () => null }))
vi.mock('./components/tasks/TaskDetail', () => ({ TaskDetail: () => null }))
vi.mock('./licensing/LicenseGate', () => ({ LicenseGate: () => null }))
vi.mock('./components/migration/BridgeNotice', () => ({ BridgeNotice: () => null }))
vi.mock('./components/migration/MigrationBanner', () => ({ MigrationBanner: () => null }))
vi.mock('./hooks/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: () => {} }))
vi.mock('./hooks/usePomodoroTicker', () => ({ usePomodoroTicker: () => {} }))

import App from './App'

/** preload가 건네는 `on*` 구독의 콜백을 이름별로 잡아 둔다 — 메인 대신 우리가 쏜다. */
const subscribed = new Map<string, (...args: unknown[]) => void>()

beforeEach(() => {
  subscribed.clear()
  ;(window as unknown as Record<string, unknown>).api = new Proxy(
    {},
    {
      get: (_target, key: string) => {
        if (key.startsWith('on')) {
          return (cb: (...args: unknown[]) => void) => {
            subscribed.set(key, cb)
            return () => subscribed.delete(key)
          }
        }
        return vi.fn(async () => null)
      }
    }
  )
  useStore.setState({
    loadData: vi.fn(async () => {}),
    aiLoadHistory: vi.fn(async () => {}),
    aiCheckConnection: vi.fn(async () => {}),
    updateAvailable: { version: '9.9.9', downloadUrl: 'https://example.com/r' },
    updateChecked: true,
    updateFailed: false,
    updateDownloadProgress: null,
    updateDownloadFailed: false,
    updateReady: false
  } as never)
})
afterEach(() => cleanup())

function fire(name: string, ...args: unknown[]): void {
  const cb = subscribed.get(name)
  expect(cb, `App이 ${name}을 구독하지 않았다`).toBeDefined()
  cb?.(...args)
}

describe('업데이트 다운로드 실패 이벤트', () => {
  it('진행 막대를 내리고 다운로드 실패를 기록한다 — 확인 실패로 세지 않는다', () => {
    render(<App />)
    fire('onUpdateProgress', 42)
    expect(useStore.getState().updateDownloadProgress).toBe(42)

    fire('onUpdateDownloadError')
    const s = useStore.getState() as unknown as Record<string, unknown>
    expect(s.updateDownloadProgress).toBeNull()
    expect(s.updateDownloadFailed).toBe(true)
    expect(s.updateFailed).toBe(false)
    // 새 버전이 있다는 사실은 그대로다 — 카드와 다시 받기 버튼이 남아야 한다.
    expect(s.updateAvailable).toEqual({ version: '9.9.9', downloadUrl: 'https://example.com/r' })
  })

  it('다시 받기가 진행되기 시작하면 실패 표시를 내린다', () => {
    render(<App />)
    fire('onUpdateDownloadError')
    fire('onUpdateProgress', 5)
    expect((useStore.getState() as unknown as Record<string, unknown>).updateDownloadFailed).toBe(false)
  })
})
