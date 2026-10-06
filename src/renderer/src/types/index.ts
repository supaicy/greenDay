export type Priority = 'none' | 'low' | 'medium' | 'high'

export interface Task {
  id: string
  title: string
  description: string
  completed: boolean
  priority: Priority
  dueDate: string | null
  dueTime: string | null
  /**
   * 기간의 시작일(YYYY-MM-DD). dueDate가 종료일 역할을 하므로 startDate만으로는
   * 기간이 성립하지 않는다 — 둘 다 있을 때만 "8/18 ~ 8/20"이 된다.
   */
  startDate: string | null
  reminderAt: string | null
  /** 목록 맨 위에 고정. 어떤 정렬 기준보다 앞선다(utils/taskOrder.ts). */
  pinned: boolean
  listId: string
  parentId: string | null
  tags: string[]
  createdAt: string
  completedAt: string | null
  deletedAt: string | null
  sortOrder: number
  isRecurring: boolean
  recurringPattern: string | null
  attachments: string[]
  scheduledStart: string | null
  scheduledEnd: string | null
  /**
   * 반복 할일의 회차별 시간블록 오버라이드. 키는 발생일(YYYY-MM-DD).
   * 값이 있으면 그날은 템플릿 대신 이 시각, null이면 그날 블록 없음(옮겨간 회차).
   */
  scheduledOverrides?: Record<string, { start: string; end: string } | null> | null
}

export interface TaskList {
  id: string
  name: string
  color: string
  icon: string
  folderId: string | null
  sortOrder: number
  createdAt: string
}

export interface Folder {
  id: string
  name: string
  collapsed: boolean
  sortOrder: number
  createdAt: string
}

export interface Habit {
  id: string
  name: string
  color: string
  frequency: 'daily' | 'weekly'
  targetDays: number[]
  createdAt: string
}

export interface HabitLog {
  id: string
  habitId: string
  date: string
  completed: boolean
}

export interface PomodoroSession {
  id: string
  taskId: string | null
  duration: number
  type: 'work' | 'break'
  startedAt: string
  completedAt: string | null
}

export type SmartList =
  | 'inbox'
  | 'today'
  | 'tomorrow'
  | 'next7days'
  | 'all'
  | 'summary'
  | 'completed'
  | 'trash'

export type ViewType =
  | 'tasks'
  | 'calendar'
  | 'calendarWeekly'
  | 'calendarDaily'
  | 'pomodoro'
  | 'habits'
  | 'kanban'
  | 'timeline'
  | 'eisenhower'
  | 'stats'

export type SortBy = 'default' | 'dueDate' | 'priority' | 'title' | 'createdAt'
export type SortDir = 'asc' | 'desc'

export interface UndoAction {
  // 실제 push/handle 되는 타입만 유지 ('completeTasks'/'moveTasks' 팬텀 타입 제거)
  type: 'deleteTask' | 'deleteTasks'
  description: string
  data: unknown
  timestamp: number
}

export interface ScoreEvent {
  type: 'taskComplete' | 'habitComplete' | 'pomodoroComplete'
  points: number
  date: string
}

// AI
export interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

// AiConfig — shared 모듈에서 재내보내기 (단일 정의 유지)
export type { AiConfig } from '../../../shared/ai-config'

/**
 * 부모와 한 번에 만들 하위작업(`AddTaskOptions.subtasks`). **이 API는** 직계 한 단계만
 * 받는다 — 앱 자체는 하위작업 아래에 또 하위작업을 둘 수 있다(상세 패널의 SubtaskList).
 */
export interface SubtaskDraft {
  title: string
  description?: string
  priority?: Priority
}

/**
 * `addTask(title, opts)`의 옵션. 스토어와 반복 스폰(RecurrenceSpawn)이 같은
 * 정의를 쓴다 — 각자 선언하던 시절엔 필드를 늘릴 때 한쪽만 늘어도 컴파일러가
 * 잡지 못해, 새 필드가 다음 회차에서 조용히 사라졌다.
 */
export interface AddTaskOptions {
  listId?: string
  /**
   * 본문(메모)과 첨부. `addTasks`가 `''`/`[]`로 못 박고 있던 시절, 반복 할일을
   * 완료하면 다음 회차가 빈 메모·첨부 없이 태어났다 — 내용은 완료본에만 남는데
   * 완료본은 '완료' 스마트 리스트 말고는 어디에도 안 보여서, 사용자 눈에는
   * 주간 장보기의 목록이 체크 한 번에 사라진 것이었다.
   */
  description?: string
  attachments?: string[]
  /**
   * 부모와 함께 만들 하위작업. 부모 id는 `addTasks`가 발급 직후 직접 채운다 —
   * 호출처가 따로 만들어 놓고 나중에 제목으로 부모를 되찾으면 같은 제목의 다른
   * 할일에 붙는다(`aiAddTaskFromText`가 그렇게 하고 있다).
   */
  subtasks?: SubtaskDraft[]
  dueDate?: string | null
  startDate?: string | null
  pinned?: boolean
  priority?: Priority
  parentId?: string | null
  dueTime?: string | null
  reminderAt?: string | null
  isRecurring?: boolean
  recurringPattern?: string | null
  tags?: string[]
  scheduledStart?: string | null
  scheduledEnd?: string | null
  scheduledOverrides?: Record<string, { start: string; end: string } | null> | null
}
