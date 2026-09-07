import { lazy, Suspense, useEffect } from 'react'
import { useStore } from './store/useStore'
import { Sidebar } from './components/sidebar/Sidebar'
import { Settings } from './components/sidebar/Settings'
import { TaskListView } from './components/tasks/TaskList'
import { CalendarView } from './components/calendar/CalendarView'
import { WeeklyCalendar } from './components/calendar/WeeklyCalendar'
import { DailyCalendar } from './components/calendar/DailyCalendar'
import { PomodoroTimer } from './components/pomodoro/PomodoroTimer'
import { HabitTracker } from './components/habits/HabitTracker'
import { KanbanView } from './components/kanban/KanbanView'
import { TimelineView } from './components/timeline/TimelineView'
import { EisenhowerMatrix } from './components/eisenhower/EisenhowerMatrix'
import { StatsView } from './components/stats/StatsView'
import { QuickAdd } from './components/common/QuickAdd'
import { UndoToast } from './components/common/UndoToast'
import { AiChatPanel } from './components/ai/AiChatPanel'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { usePomodoroTicker } from './hooks/usePomodoroTicker'
import { LicenseGate } from './licensing/LicenseGate'
import { BridgeNotice } from './components/migration/BridgeNotice'
import { MigrationBanner } from './components/migration/MigrationBanner'

// CodeMirror 6 라이브프리뷰 에디터(@atomic-editor/editor) 포함 무거운 컴포넌트 → 코드분할로 메인 청크 축소
const TaskDetail = lazy(() => import('./components/tasks/TaskDetail').then((m) => ({ default: m.TaskDetail })))

function MainContent() {
  const viewType = useStore((s) => s.viewType)
  switch (viewType) {
    case 'calendar':
      return <CalendarView />
    case 'calendarWeekly':
      return <WeeklyCalendar />
    case 'calendarDaily':
      return <DailyCalendar />
    case 'pomodoro':
      return <PomodoroTimer />
    case 'habits':
      return <HabitTracker />
    case 'kanban':
      return <KanbanView />
    case 'timeline':
      return <TimelineView />
    case 'eisenhower':
      return <EisenhowerMatrix />
    case 'stats':
      return <StatsView />
    default:
      return <TaskListView />
  }
}

export default function App() {
  const loadData = useStore((s) => s.loadData)
  const selectedTaskId = useStore((s) => s.selectedTaskId)
  const theme = useStore((s) => s.theme)
  const language = useStore((s) => s.language)

  useKeyboardShortcuts()
  usePomodoroTicker()

  useEffect(() => {
    loadData()
    void useStore.getState().aiLoadHistory()
    // AI 연결 상태를 시작 시 한 번 확인한다. 예전에는 설정이나 AI 패널을 열어야만
    // 확인돼서, 첫 실행에는 할일 추가 폼의 AI 버튼이 아예 보이지 않았다.
    void useStore.getState().aiCheckConnection()
    // 자동 업데이트 이벤트 수신 (electron-updater에서 push)
    const cleanupUpdate = window.api.onUpdateAvailable?.((info) => {
      useStore.setState({ updateAvailable: info, updateChecked: true })
    })
    const cleanupNotAvailable = window.api.onUpdateNotAvailable?.(() => {
      useStore.setState({ updateChecked: true })
    })
    const cleanupProgress = window.api.onUpdateProgress?.((percent) => {
      useStore.setState({ updateDownloadProgress: percent })
    })
    const cleanupDownloaded = window.api.onUpdateDownloaded?.(() => {
      useStore.setState({ updateReady: true, updateDownloadProgress: null })
    })
    // 글로벌 단축키 등록
    window.api.registerGlobalShortcut?.()
    // 글로벌 퀵 추가 이벤트 수신
    const cleanup = window.api.onGlobalQuickAdd?.(() => {
      useStore.getState().setShowQuickAdd(true)
    })
    return () => {
      cleanup?.()
      cleanupUpdate?.()
      cleanupNotAvailable?.()
      cleanupProgress?.()
      cleanupDownloaded?.()
    }
  }, [loadData])

  // 저장된 언어를 메인에 알린다(첫 실행 포함). 이후 변경은 setLanguage가 직접 보낸다.
  useEffect(() => {
    window.api.setLanguage?.(language)
  }, [language])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.body.style.backgroundColor = theme === 'dark' ? '#1C1C1E' : '#FFFFFF'
    document.body.style.color = theme === 'dark' ? '#E5E5EA' : '#1C1C1E'
  }, [theme])

  const isDark = theme === 'dark'

  return (
    <div
      className={`flex h-screen overflow-hidden ${isDark ? 'bg-[#1C1C1E] text-gray-100' : 'bg-white text-gray-800'}`}
    >
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <MainContent />
      </div>
      {selectedTaskId && (
        <Suspense fallback={null}>
          <TaskDetail />
        </Suspense>
      )}
      <AiChatPanel />
      <Settings />
      <QuickAdd />
      <UndoToast />
      {/* 유료 게이트는 앱 전체에서 한 곳이다. enforcement가 꺼져 있으면 아무것도 그리지 않는다. */}
      <LicenseGate />
      {/* 번들 ID 마이그레이션 — 브리지 빌드의 안내, 새 빌드의 첫 실행 상태. 해당 없으면 null. */}
      <BridgeNotice />
      <MigrationBanner />
    </div>
  )
}
