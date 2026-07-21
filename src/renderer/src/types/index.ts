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

export type SmartList = 'inbox' | 'today' | 'next7days' | 'all' | 'completed' | 'trash'

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
