import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import { clampDetailWidth } from './detailWidth'
import { isVirtualSmartList, tagFromListId } from '../utils/smartLists'
import { getFilteredTaskIds } from '../utils/filteredTaskIds'
import { todayString, tomorrowString } from '../utils/date'
import type {
  Task,
  TaskList,
  Folder,
  Habit,
  HabitLog,
  PomodoroSession,
  SmartList,
  ViewType,
  Priority,
  SortBy,
  SortDir,
  UndoAction,
  AiMessage,
  AiConfig
} from '../types'
import { isValidSchedulePair } from '../utils/scheduledTime'
import { nextRecurringDate, shiftIsoByDays, daysBetween } from '../utils/recurrence'
import { trimHistory } from './trim'
import { normalizeChatHistory } from '../../../shared/ai-history'
import { buildAiTaskContext } from '../utils/aiContext'

export type Theme = 'dark' | 'light'

interface Store {
  // 데이터
  tasks: Task[]
  trashTasks: Task[]
  lists: TaskList[]
  folders: Folder[]
  habits: Habit[]
  habitLogs: HabitLog[]
  pomodoroSessions: PomodoroSession[]
  score: { total: number; events: { type: string; points: number; date: string }[] }

  // UI
  selectedListId: string | SmartList
  selectedTaskId: string | null
  viewType: ViewType
  searchQuery: string
  showAddTask: boolean
  editingListId: string | null
  theme: Theme
  detailPanelWidthPx: number | null
  showSettings: boolean
  sortBy: SortBy
  sortDir: SortDir
  batchSelectedIds: string[]
  batchMode: boolean
  undoStack: UndoAction[]
  showQuickAdd: boolean
  showExport: boolean
  dragTaskId: string | null
  updateAvailable: { version: string; downloadUrl: string } | null
  updateChecked: boolean
  updateDownloadProgress: number | null
  updateReady: boolean

  // 초기화
  loadData: () => Promise<void>

  // 폴더
  addFolder: (name: string) => Promise<void>
  updateFolder: (id: string, name: string, collapsed: boolean) => Promise<void>
  removeFolder: (id: string) => Promise<void>

  // 리스트
  setSelectedList: (id: string | SmartList) => void
  addList: (name: string, color: string, folderId?: string | null) => Promise<void>
  updateList: (id: string, updates: Partial<TaskList>) => Promise<void>
  removeList: (id: string) => Promise<void>
  setEditingList: (id: string | null) => void
  reorderLists: (ids: string[]) => Promise<void>

  // 태스크
  addTask: (
    title: string,
    opts?: {
      listId?: string
      dueDate?: string | null
      priority?: Priority
      parentId?: string | null
      dueTime?: string | null
      reminderAt?: string | null
      isRecurring?: boolean
      recurringPattern?: string | null
      tags?: string[]
    }
  ) => Promise<void>
  updateTask: (task: Partial<Task> & { id: string }) => Promise<void>
  toggleTask: (id: string) => Promise<void>
  removeTask: (id: string) => Promise<void>
  restoreTask: (id: string) => Promise<void>
  permanentDeleteTask: (id: string) => Promise<void>
  emptyTrash: () => Promise<void>
  selectTask: (id: string | null) => void
  setShowAddTask: (show: boolean) => void
  reorderTasks: (ids: string[]) => Promise<void>
  setDragTaskId: (id: string | null) => void

  // 일괄
  toggleBatchMode: () => void
  toggleBatchSelect: (id: string) => void
  selectAllBatch: () => void
  clearBatchSelection: () => void
  batchComplete: () => Promise<void>
  batchDelete: () => Promise<void>
  batchMove: (listId: string) => Promise<void>
  batchSetPriority: (priority: Priority) => Promise<void>

  // 정렬
  setSortBy: (sort: SortBy) => void
  setSortDir: (dir: SortDir) => void

  // 뷰
  setViewType: (type: ViewType) => void
  setSearchQuery: (query: string) => void
  setTheme: (theme: Theme) => void
  setDetailPanelWidthPx: (px: number, windowWidth: number) => void
  toggleSettings: () => void
  setShowQuickAdd: (show: boolean) => void
  setShowExport: (show: boolean) => void

  // 되돌리기
  pushUndo: (action: UndoAction) => void
  popUndo: () => Promise<void>
  clearUndo: () => void

  // 습관
  addHabit: (name: string, color: string, frequency: 'daily' | 'weekly', targetDays: number[]) => Promise<void>
  removeHabit: (id: string) => Promise<void>
  toggleHabitLog: (habitId: string, date: string) => Promise<void>

  // 포모도로
  savePomodoroSession: (session: Omit<PomodoroSession, 'id'>) => Promise<void>

  // 점수
  addScore: (type: string, points: number) => Promise<void>

  // 첨부파일
  pickAttachment: () => Promise<{ name: string; path: string }[]>

  // 내보내기
  exportData: () => Promise<boolean>

  // AI
  aiMessages: AiMessage[]
  aiLoading: boolean
  aiConnected: boolean | null
  aiModels: string[]
  aiConfig: AiConfig | null
  showAiChat: boolean
  _aiStreamCleanup: (() => void) | null
  setShowAiChat: (show: boolean) => void
  aiCheckConnection: () => Promise<void>
  aiWarmup: () => Promise<void>
  aiLoadConfig: () => Promise<void>
  aiLoadHistory: () => Promise<void>
  aiSaveConfig: (updates: Partial<AiConfig>) => Promise<void>
  aiSendMessage: (message: string) => Promise<void>
  aiClearMessages: () => void
  aiCreateTaskFromNL: (input: string) => Promise<{
    title: string
    dueDate: string | null
    dueTime: string | null
    priority: Priority
    tags: string[]
    subtasks: { title: string; dueDate: string | null }[]
  } | null>
  // 채팅 메시지를 할일로 변환해 생성. 생성된 제목 반환(실패 시 null).
  aiAddTaskFromText: (text: string) => Promise<string | null>
}

function mapTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string) || '',
    completed: Boolean(row.completed),
    priority: (row.priority as Priority) || 'none',
    dueDate: (row.due_date as string) || null,
    dueTime: (row.due_time as string) || null,
    reminderAt: (row.reminder_at as string) || null,
    listId: (row.list_id as string) || 'inbox',
    parentId: (row.parent_id as string) || null,
    tags: safeParseArray<string>(row.tags as string),
    attachments: safeParseArray<string>(row.attachments as string),
    createdAt: row.created_at as string,
    completedAt: (row.completed_at as string) || null,
    deletedAt: (row.deleted_at as string) || null,
    sortOrder: (row.sort_order as number) || 0,
    isRecurring: Boolean(row.is_recurring),
    recurringPattern: (row.recurring_pattern as string) || null,
    scheduledStart: (row.scheduled_start as string) || null,
    scheduledEnd: (row.scheduled_end as string) || null
  }
}
function mapList(row: Record<string, unknown>): TaskList {
  return {
    id: row.id as string,
    name: row.name as string,
    color: row.color as string,
    icon: row.icon as string,
    folderId: (row.folder_id as string) || null,
    sortOrder: (row.sort_order as number) || 0,
    createdAt: row.created_at as string
  }
}
function mapFolder(row: Record<string, unknown>): Folder {
  return {
    id: row.id as string,
    name: row.name as string,
    collapsed: Boolean(row.collapsed),
    sortOrder: (row.sort_order as number) || 0,
    createdAt: row.created_at as string
  }
}
function mapHabit(row: Record<string, unknown>): Habit {
  return {
    id: row.id as string,
    name: row.name as string,
    color: row.color as string,
    frequency: row.frequency as 'daily' | 'weekly',
    targetDays: safeParseArray<number>(row.target_days as string),
    createdAt: row.created_at as string
  }
}
function mapHabitLog(row: Record<string, unknown>): HabitLog {
  return {
    id: row.id as string,
    habitId: row.habit_id as string,
    date: row.date as string,
    completed: Boolean(row.completed)
  }
}
function mapPomodoroSession(row: Record<string, unknown>): PomodoroSession {
  return {
    id: row.id as string,
    // snake_case 우선, 구 camelCase 폴백 (마이그레이션 과도기 대응)
    taskId: ((row.task_id ?? row.taskId) as string) || null,
    duration: row.duration as number,
    type: row.type as 'work' | 'break',
    startedAt: (row.started_at ?? row.startedAt) as string,
    completedAt: ((row.completed_at ?? row.completedAt) as string) || null
  }
}
function safeParseArray<T = unknown>(s: string | undefined | null): T[] {
  try {
    return JSON.parse(s || '[]') as T[]
  } catch {
    return []
  }
}

export const useStore = create<Store>((set, get) => ({
  tasks: [],
  trashTasks: [],
  lists: [],
  folders: [],
  habits: [],
  habitLogs: [],
  pomodoroSessions: [],
  score: { total: 0, events: [] },
  selectedListId: 'today',
  selectedTaskId: null,
  viewType: 'tasks',
  searchQuery: '',
  showAddTask: false,
  editingListId: null,
  theme: (localStorage.getItem('ticktick-theme') as Theme) || 'dark',
  detailPanelWidthPx: ((): number | null => {
    const n = Number(localStorage.getItem('ticktick-detail-width'))
    return Number.isFinite(n) && n > 0 ? n : null
  })(),
  showSettings: false,
  sortBy: 'default',
  sortDir: 'asc',
  batchSelectedIds: [],
  batchMode: false,
  undoStack: [],
  showQuickAdd: false,
  showExport: false,
  dragTaskId: null,
  updateAvailable: null as { version: string; downloadUrl: string } | null,
  updateChecked: false,
  updateDownloadProgress: null as number | null,
  updateReady: false,

  loadData: async () => {
    const [rawLists, rawTasks, rawTrash, rawHabits, rawHabitLogs, rawFolders, rawSessions, rawScore] =
      await Promise.all([
        window.api.getLists(),
        window.api.getTasks(),
        window.api.getTrashTasks(),
        window.api.getHabits(),
        window.api.getHabitLogs(),
        window.api.getFolders(),
        window.api.getPomodoroSessions(),
        window.api.getScore()
      ])
    set({
      lists: (rawLists as Record<string, unknown>[]).map(mapList),
      tasks: (rawTasks as Record<string, unknown>[]).map(mapTask),
      trashTasks: (rawTrash as Record<string, unknown>[]).map(mapTask),
      habits: (rawHabits as Record<string, unknown>[]).map(mapHabit),
      habitLogs: (rawHabitLogs as Record<string, unknown>[]).map(mapHabitLog),
      folders: (rawFolders as Record<string, unknown>[]).map(mapFolder),
      pomodoroSessions: (rawSessions as Record<string, unknown>[]).map(mapPomodoroSession),
      score: rawScore as { total: number; events: { type: string; points: number; date: string }[] }
    })
  },

  // === 폴더 ===
  addFolder: async (name) => {
    const id = uuid()
    const now = new Date().toISOString()
    const maxOrder = get().folders.reduce((m, f) => Math.max(m, f.sortOrder || 0), 0)
    const newFolder: Folder = { id, name, collapsed: false, sortOrder: maxOrder + 1, createdAt: now }
    set((s) => ({ folders: [...s.folders, newFolder] }))
    window.api.createFolder(id, name)
  },
  updateFolder: async (id, name, collapsed) => {
    set((s) => ({
      folders: s.folders.map((f) => (f.id === id ? { ...f, name, collapsed } : f))
    }))
    window.api.updateFolder(id, name, collapsed)
  },
  removeFolder: async (id) => {
    set((s) => ({
      folders: s.folders.filter((f) => f.id !== id),
      lists: s.lists.map((l) => (l.folderId === id ? { ...l, folderId: null } : l))
    }))
    window.api.deleteFolder(id)
  },

  // === 리스트 ===
  setSelectedList: (id) =>
    set({ selectedListId: id, selectedTaskId: null, viewType: 'tasks', batchMode: false, batchSelectedIds: [] }),
  addList: async (name, color, folderId) => {
    const id = uuid()
    const now = new Date().toISOString()
    const maxOrder = get().lists.reduce((m, l) => Math.max(m, l.sortOrder || 0), 0)
    const newList: TaskList = {
      id,
      name,
      color,
      icon: 'list',
      folderId: folderId || null,
      sortOrder: maxOrder + 1,
      createdAt: now
    }
    set((s) => ({ lists: [...s.lists, newList] }))
    window.api.createList(id, name, color, 'list', folderId || null)
  },
  updateList: async (id, updates) => {
    set((s) => ({
      lists: s.lists.map((l) => (l.id === id ? { ...l, ...updates } : l))
    }))
    const mapped: Record<string, unknown> = {}
    if (updates.name !== undefined) mapped.name = updates.name
    if (updates.color !== undefined) mapped.color = updates.color
    if (updates.folderId !== undefined) mapped.folder_id = updates.folderId
    if (updates.sortOrder !== undefined) mapped.sort_order = updates.sortOrder
    window.api.updateList(id, mapped)
  },
  removeList: async (id) => {
    set((s) => ({
      lists: s.lists.filter((l) => l.id !== id),
      tasks: s.tasks.map((t) => (t.listId === id ? { ...t, listId: 'inbox' } : t)),
      selectedListId: s.selectedListId === id ? 'inbox' : s.selectedListId
    }))
    window.api.deleteList(id)
  },
  setEditingList: (id) => set({ editingListId: id }),
  reorderLists: async (ids) => {
    set((s) => ({
      lists: s.lists
        .map((l) => {
          const idx = ids.indexOf(l.id)
          return idx >= 0 ? { ...l, sortOrder: idx } : l
        })
        .sort((a, b) => a.sortOrder - b.sortOrder)
    }))
    window.api.reorderLists(ids)
  },

  // === 태스크 ===
  addTask: async (title, opts = {}) => {
    const currentList = get().selectedListId
    const targetList =
      opts.listId ||
      (typeof currentList === 'string' && !isVirtualSmartList(currentList) ? currentList : 'inbox')
    // 오늘/내일 뷰에서 날짜 없이 추가하면, 방금 추가한 그 리스트에 보이도록 마감일을 채운다.
    let finalDueDate = opts.dueDate || null
    if (!finalDueDate && currentList === 'today') finalDueDate = todayString()
    else if (!finalDueDate && currentList === 'tomorrow') finalDueDate = tomorrowString()

    // 태그 뷰에서 (최상위 태스크를) 추가하면 그 태그가 자동으로 붙어 방금 추가한 뷰에 보인다.
    // 하위작업(parentId)은 뷰의 태그를 상속하지 않는다.
    const currentTag = typeof currentList === 'string' ? tagFromListId(currentList) : null
    const finalTags = opts.tags ?? (currentTag && !opts.parentId ? [currentTag] : [])

    const id = uuid()
    const now = new Date().toISOString()
    const maxOrder = get()
      .tasks.filter((t) => t.listId === targetList)
      .reduce((m, t) => Math.max(m, t.sortOrder || 0), 0)

    const newTask: Task = {
      id,
      title,
      description: '',
      completed: false,
      priority: opts.priority || 'none',
      dueDate: finalDueDate,
      dueTime: opts.dueTime || null,
      reminderAt: opts.reminderAt || null,
      listId: targetList,
      parentId: opts.parentId || null,
      tags: finalTags,
      attachments: [],
      createdAt: now,
      completedAt: null,
      deletedAt: null,
      sortOrder: maxOrder + 1,
      isRecurring: opts.isRecurring || false,
      recurringPattern: opts.recurringPattern || null,
      scheduledStart: null,
      scheduledEnd: null
    }
    set((s) => ({ tasks: [...s.tasks, newTask] }))

    window.api.createTask({
      id,
      title,
      description: '',
      priority: opts.priority || 'none',
      dueDate: finalDueDate,
      dueTime: opts.dueTime || null,
      reminderAt: opts.reminderAt || null,
      listId: targetList,
      parentId: opts.parentId || null,
      tags: finalTags,
      attachments: [],
      isRecurring: opts.isRecurring || false,
      recurringPattern: opts.recurringPattern || null
    })
  },
  updateTask: async (task) => {
    // Invariant guard: if the caller is changing scheduledStart/End, ensure the pair is valid
    if ('scheduledStart' in task || 'scheduledEnd' in task) {
      const current = get().tasks.find((t) => t.id === task.id)
      if (!current) return
      const nextStart = 'scheduledStart' in task ? (task.scheduledStart ?? null) : current.scheduledStart
      const nextEnd = 'scheduledEnd' in task ? (task.scheduledEnd ?? null) : current.scheduledEnd
      if (!isValidSchedulePair(nextStart, nextEnd)) {
        console.warn('[updateTask] rejected invalid schedule pair', { nextStart, nextEnd })
        return
      }
    }
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === task.id ? { ...t, ...task } : t))
    }))
    window.api.updateTask(task)
  },
  toggleTask: async (id) => {
    const task = get().tasks.find((t) => t.id === id)
    if (!task) return
    const newCompleted = !task.completed
    const completedAt = newCompleted ? new Date().toISOString() : null

    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, completed: newCompleted, completedAt } : t))
    }))
    window.api.updateTask({ id, completed: newCompleted })

    if (newCompleted) {
      const points = task.priority === 'high' ? 3 : task.priority === 'medium' ? 2 : 1
      get().addScore('taskComplete', points)

      // 반복 task: 완료 시 다음 인스턴스 생성
      if (task.isRecurring && task.recurringPattern) {
        const base = task.dueDate ?? new Date().toISOString().split('T')[0]
        const next = nextRecurringDate(task.recurringPattern, base)
        if (next) {
          // 중복 인스턴스 방지: 같은 패턴·제목·기한의 미완료 task가 이미 있으면 생성 건너뜀
          const exists = get().tasks.some(
            (t) =>
              !t.completed &&
              t.isRecurring &&
              t.recurringPattern === task.recurringPattern &&
              t.title === task.title &&
              t.dueDate === next
          )
          if (!exists) {
            // 알림 오프셋 계산
            let nextReminderAt: string | null = null
            if (task.reminderAt && task.dueDate && next) {
              const delta = daysBetween(task.dueDate, next)
              nextReminderAt = shiftIsoByDays(task.reminderAt, delta)
            }
            get().addTask(task.title, {
              listId: task.listId,
              dueDate: next,
              dueTime: task.dueTime ?? undefined,
              priority: task.priority,
              isRecurring: true,
              recurringPattern: task.recurringPattern,
              tags: task.tags,
              reminderAt: nextReminderAt,
            })
          }
        }
      }
    }
  },
  removeTask: async (id) => {
    const task = get().tasks.find((t) => t.id === id)
    if (task) {
      get().pushUndo({ type: 'deleteTask', description: `"${task.title}" 삭제됨`, data: task, timestamp: Date.now() })
    }
    const now = new Date().toISOString()
    set((s) => {
      const subtasks = s.tasks.filter((t) => t.parentId === id)
      const deletedItems = [
        ...(task ? [{ ...task, deletedAt: now }] : []),
        ...subtasks.map((t) => ({ ...t, deletedAt: now }))
      ]
      return {
        tasks: s.tasks.filter((t) => t.id !== id && t.parentId !== id),
        trashTasks: [...s.trashTasks, ...deletedItems],
        selectedTaskId: s.selectedTaskId === id ? null : s.selectedTaskId
      }
    })
    window.api.deleteTask(id)
  },
  restoreTask: async (id) => {
    const task = get().trashTasks.find((t) => t.id === id)
    if (task) {
      const restored = { ...task, deletedAt: null }
      set((s) => ({
        trashTasks: s.trashTasks.filter((t) => t.id !== id),
        tasks: [...s.tasks, restored]
      }))
    }
    window.api.restoreTask(id)
  },
  permanentDeleteTask: async (id) => {
    set((s) => ({
      trashTasks: s.trashTasks.filter((t) => t.id !== id),
      tasks: s.tasks.filter((t) => t.id !== id && t.parentId !== id)
    }))
    window.api.permanentDeleteTask(id)
  },
  emptyTrash: async () => {
    set({ trashTasks: [] })
    window.api.emptyTrash()
  },
  // 같은 태스크를 다시 클릭하면 상세를 닫는다(토글). 다른 id면 전환, null이면 닫기.
  selectTask: (id) => set((s) => ({ selectedTaskId: s.selectedTaskId === id ? null : id })),
  setShowAddTask: (show) => set({ showAddTask: show }),
  reorderTasks: async (ids) => {
    set((s) => ({
      tasks: s.tasks.map((t) => {
        const idx = ids.indexOf(t.id)
        return idx >= 0 ? { ...t, sortOrder: idx } : t
      })
    }))
    window.api.reorderTasks(ids)
  },
  setDragTaskId: (id) => set({ dragTaskId: id }),

  // === 일괄 ===
  toggleBatchMode: () => set((s) => ({ batchMode: !s.batchMode, batchSelectedIds: [] })),
  toggleBatchSelect: (id) =>
    set((s) => ({
      batchSelectedIds: s.batchSelectedIds.includes(id)
        ? s.batchSelectedIds.filter((i) => i !== id)
        : [...s.batchSelectedIds, id]
    })),
  selectAllBatch: () => {
    const { tasks, selectedListId } = get()
    const filtered = getFilteredTaskIds(tasks, selectedListId)
    set({ batchSelectedIds: filtered })
  },
  clearBatchSelection: () => set({ batchSelectedIds: [] }),
  batchComplete: async () => {
    const ids = get().batchSelectedIds
    const now = new Date().toISOString()
    set((s) => ({
      tasks: s.tasks.map((t) => (ids.includes(t.id) ? { ...t, completed: true, completedAt: now } : t)),
      batchSelectedIds: [],
      batchMode: false
    }))
    window.api.batchUpdateTasks(ids, { completed: true })
  },
  batchDelete: async () => {
    const ids = get().batchSelectedIds
    const now = new Date().toISOString()
    const allTasks = get().tasks
    const subtaskIds = allTasks.filter((t) => t.parentId && ids.includes(t.parentId)).map((t) => t.id)
    const allDeletedIds = [...new Set([...ids, ...subtaskIds])]
    const deletedTasks = allTasks.filter((t) => allDeletedIds.includes(t.id))
    // 삭제 전 undo 스택에 ID 목록 저장 (popUndo deleteTasks 핸들러가 trashTasks에서 ID로 복원)
    get().pushUndo({
      type: 'deleteTasks',
      description: `${allDeletedIds.length}개 삭제됨`,
      data: allDeletedIds,
      timestamp: Date.now()
    })
    set((s) => ({
      tasks: s.tasks.filter((t) => !allDeletedIds.includes(t.id)),
      trashTasks: [...s.trashTasks, ...deletedTasks.map((t) => ({ ...t, deletedAt: now }))],
      batchSelectedIds: [],
      batchMode: false
    }))
    window.api.batchUpdateTasks(allDeletedIds, { deleted: true })
  },
  batchMove: async (listId) => {
    const ids = get().batchSelectedIds
    set((s) => ({
      tasks: s.tasks.map((t) => (ids.includes(t.id) ? { ...t, listId } : t)),
      batchSelectedIds: [],
      batchMode: false
    }))
    window.api.batchUpdateTasks(ids, { listId })
  },
  batchSetPriority: async (priority) => {
    const ids = get().batchSelectedIds
    set((s) => ({
      tasks: s.tasks.map((t) => (ids.includes(t.id) ? { ...t, priority } : t)),
      batchSelectedIds: []
    }))
    window.api.batchUpdateTasks(ids, { priority })
  },

  // === 정렬 ===
  setSortBy: (sort) => set({ sortBy: sort }),
  setSortDir: (dir) => set({ sortDir: dir }),

  // === 뷰 ===
  setViewType: (type) => set({ viewType: type, selectedTaskId: null }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setTheme: (theme) => {
    localStorage.setItem('ticktick-theme', theme)
    set({ theme })
  },
  setDetailPanelWidthPx: (px, windowWidth) => {
    const clamped = clampDetailWidth(px, windowWidth, get().showAiChat)
    localStorage.setItem('ticktick-detail-width', String(clamped))
    set({ detailPanelWidthPx: clamped })
  },
  toggleSettings: () => set((s) => ({ showSettings: !s.showSettings })),
  setShowQuickAdd: (show) => set({ showQuickAdd: show }),
  setShowExport: (show) => set({ showExport: show }),

  // === 되돌리기 ===
  pushUndo: (action) => set((s) => ({ undoStack: [...s.undoStack.slice(-19), action] })),
  popUndo: async () => {
    const stack = get().undoStack
    if (stack.length === 0) return
    const action = stack[stack.length - 1]
    set({ undoStack: stack.slice(0, -1) })
    if (action.type === 'deleteTask') {
      const task = action.data as Task
      set((s) => ({
        trashTasks: s.trashTasks.filter((t) => t.id !== task.id),
        tasks: [...s.tasks, { ...task, deletedAt: null }]
      }))
      window.api.restoreTask(task.id)
    } else if (action.type === 'deleteTasks') {
      const ids = action.data as string[]
      set((s) => {
        const restored = s.trashTasks.filter((t) => ids.includes(t.id))
        return {
          trashTasks: s.trashTasks.filter((t) => !ids.includes(t.id)),
          tasks: [...s.tasks, ...restored.map((t) => ({ ...t, deletedAt: null }))]
        }
      })
      for (const id of ids) window.api.restoreTask(id)
    }
  },
  clearUndo: () => set({ undoStack: [] }),

  // === 습관 ===
  addHabit: async (name, color, frequency, targetDays) => {
    const id = uuid()
    const now = new Date().toISOString()
    const newHabit: Habit = { id, name, color, frequency, targetDays, createdAt: now }
    set((s) => ({ habits: [...s.habits, newHabit] }))
    window.api.createHabit(id, name, color, frequency, targetDays)
  },
  removeHabit: async (id) => {
    set((s) => ({
      habits: s.habits.filter((h) => h.id !== id),
      habitLogs: s.habitLogs.filter((l) => l.habitId !== id)
    }))
    window.api.deleteHabit(id)
  },
  toggleHabitLog: async (habitId, date) => {
    const existing = get().habitLogs.find((l) => l.habitId === habitId && l.date === date)
    const id = uuid()
    if (existing) {
      set((s) => ({ habitLogs: s.habitLogs.filter((l) => !(l.habitId === habitId && l.date === date)) }))
    } else {
      const newLog: HabitLog = { id, habitId, date, completed: true }
      set((s) => ({ habitLogs: [...s.habitLogs, newLog] }))
      get().addScore('habitComplete', 1)
    }
    window.api.toggleHabitLog(id, habitId, date)
  },

  // === 포모도로 ===
  savePomodoroSession: async (session) => {
    const id = uuid()
    const fullSession: PomodoroSession = { ...session, id }
    set((s) => ({ pomodoroSessions: [...s.pomodoroSessions, fullSession] }))
    window.api.savePomodoroSession({ ...session, id })

    if (session.type === 'work' && session.completedAt) {
      get().addScore('pomodoroComplete', 2)
    }
  },

  // === 점수 ===
  addScore: async (type, points) => {
    const date = new Date().toISOString().split('T')[0]
    set((s) => ({
      score: {
        total: s.score.total + points,
        // 인메모리 이벤트 배열 최대 200개로 제한 (total은 계속 누적)
        events: [...s.score.events, { type, points, date }].slice(-200)
      }
    }))
    window.api.addScoreEvent({ type, points, date })
  },

  // === 첨부파일 ===
  pickAttachment: async () => {
    return (await window.api.pickAttachment()) as { name: string; path: string }[]
  },

  // === 내보내기 ===
  exportData: async () => {
    return (await window.api.exportData()) as boolean
  },

  // === AI ===
  aiMessages: [],
  aiLoading: false,
  aiConnected: null,
  aiModels: [],
  aiConfig: null,
  showAiChat: false,
  _aiStreamCleanup: null as (() => void) | null,
  setShowAiChat: (show) => {
    if (!show) {
      // 패널 닫을 때 진행 중인 스트리밍 정리
      const cleanup = get()._aiStreamCleanup
      if (cleanup) cleanup()
      set({ aiLoading: false })
    }
    set({ showAiChat: show })
  },
  aiCheckConnection: async () => {
    try {
      const result = (await window.api.aiCheckConnection()) as { connected: boolean; models?: string[] }
      set({ aiConnected: result.connected, aiModels: result.models ?? [] })
    } catch {
      set({ aiConnected: false, aiModels: [] })
    }
  },
  aiWarmup: async () => {
    // 로컬 모델을 미리 로드해 첫 응답의 콜드 지연 제거 (Ollama가 아니면 main에서 no-op)
    try {
      await window.api.aiWarmup?.()
    } catch {
      /* 웜업 실패는 무시 */
    }
  },
  aiLoadConfig: async () => {
    try {
      const config = (await window.api.aiGetConfig()) as AiConfig
      set({ aiConfig: config })
    } catch {
      /* ignore */
    }
  },
  aiLoadHistory: async () => {
    const messages = (await window.api.aiGetHistory()) as AiMessage[]
    set({ aiMessages: messages })
  },
  aiSaveConfig: async (updates) => {
    try {
      await window.api.aiSetConfig(updates)
    } catch {
      // main이 거부하면(예: 로컬 전용 잠금 위반) 저장 안 됨 → 실제 저장 상태로 폼 복원
    }
    const config = (await window.api.aiGetConfig()) as AiConfig
    set({ aiConfig: config })
  },
  aiSendMessage: async (message) => {
    // 이전 스트리밍 리스너 정리 (리스너 누적 방지)
    const prevCleanup = get()._aiStreamCleanup
    if (prevCleanup) prevCleanup()

    // 현재 메시지 추가 전의 대화를 컨텍스트로 캡처 (멀티턴). 최근 N개만.
    const history = normalizeChatHistory(get().aiMessages)

    const userMsg: AiMessage = {
      id: uuid(),
      role: 'user',
      content: message,
      timestamp: new Date().toISOString()
    }
    const assistantMsg: AiMessage = {
      id: uuid(),
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString()
    }
    set((s) => ({
      aiMessages: [...s.aiMessages, userMsg, assistantMsg],
      aiLoading: true
    }))

    const tasks = buildAiTaskContext(get().tasks)

    // 리스너를 스트림 호출 전에 등록 (레이스 컨디션 방지)
    const cleanup = () => {
      cleanupToken?.()
      cleanupDone?.()
      cleanupError?.()
      set({ _aiStreamCleanup: null })
    }

    const cleanupToken = window.api.onAiStreamToken?.((token: string) => {
      set((s) => ({
        aiMessages: s.aiMessages.map((m) => (m.id === assistantMsg.id ? { ...m, content: m.content + token } : m))
      }))
    })
    const cleanupDone = window.api.onAiStreamDone?.(() => {
      const { aiMessages, aiConfig } = get()
      const cap = aiConfig?.maxHistoryMessages ?? 200
      const trimmed = trimHistory(aiMessages, cap)
      set({ aiLoading: false, aiMessages: trimmed })
      void window.api.aiSaveHistory(trimmed)
      cleanup()
    })
    const cleanupError = window.api.onAiStreamError?.((error: string) => {
      const withError = get().aiMessages.map((m) =>
        m.id === assistantMsg.id ? { ...m, content: `오류: ${error}` } : m
      )
      const cap = get().aiConfig?.maxHistoryMessages ?? 200
      const trimmed = trimHistory(withError, cap)
      set({ aiLoading: false, aiMessages: trimmed })
      void window.api.aiSaveHistory(trimmed)
      cleanup()
    })

    set({ _aiStreamCleanup: cleanup })

    try {
      await window.api.aiStreamChat(message, tasks, history)
    } catch {
      set((s) => ({
        aiLoading: false,
        aiMessages: s.aiMessages.map((m) =>
          m.id === assistantMsg.id ? { ...m, content: 'AI 서비스에 연결할 수 없습니다.' } : m
        )
      }))
      cleanup()
    }
  },
  aiClearMessages: () => {
    set({ aiMessages: [] })
    void window.api.aiSaveHistory([])
  },
  aiCreateTaskFromNL: async (input) => {
    const tasks = buildAiTaskContext(get().tasks)
    try {
      const result = (await window.api.aiCreateTask(input, tasks)) as {
        action: string
        task: {
          title: string
          dueDate: string | null
          dueTime: string | null
          priority: Priority
          tags: string[]
          subtasks: { title: string; dueDate: string | null }[]
        }
      }
      return result.task
    } catch {
      return null
    }
  },
  aiAddTaskFromText: async (text) => {
    const parsed = await get().aiCreateTaskFromNL(text)
    if (!parsed) return null
    await get().addTask(parsed.title, {
      dueDate: parsed.dueDate,
      dueTime: parsed.dueTime,
      priority: parsed.priority,
      tags: parsed.tags
    })
    // 하위작업 생성. addTask는 배열 끝에 추가하므로, 같은 제목이 이미 있어도
    // 방금 만든(가장 최근) 최상위 태스크에 붙도록 뒤에서부터 찾는다.
    if (parsed.subtasks.length > 0) {
      const parent = [...get().tasks].reverse().find((t) => t.title === parsed.title && !t.parentId)
      if (parent) {
        for (const sub of parsed.subtasks) {
          await get().addTask(sub.title, { parentId: parent.id, dueDate: sub.dueDate })
        }
      }
    }
    return parsed.title
  }
}))
