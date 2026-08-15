export type Priority = 'none' | 'low' | 'medium' | 'high'

export interface Task {
  id: string
  title: string
  description: string
  completed: boolean
  priority: Priority
  dueDate: string | null
  dueTime: string | null
  reminderAt: string | null
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
