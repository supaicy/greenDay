import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import { clampDetailWidth } from './detailWidth'
import { isVirtualSmartList, tagFromListId } from '../utils/smartLists'
import { getFilteredTaskIds } from '../utils/filteredTaskIds'
import { todayString, tomorrowString } from '../utils/date'
import { pointsForTask, POINTS_PER_HABIT, POINTS_PER_POMODORO } from '../utils/score'
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
  AddTaskOptions,
  UndoAction,
  AiMessage,
  AiConfig
} from '../types'
import { isValidSchedulePair } from '../utils/scheduledTime'
import { nextRecurrenceSpawn, collectRecurrenceSpawns } from '../utils/recurrence'
import { trimHistory } from './trim'
import { normalizeChatHistory } from '../../../shared/ai-history'
import { buildAiTaskContext } from '../utils/aiContext'
import {
  type ActionOp,
  type TaskActionInterpretation,
  looksLikeTaskAction,
  resolveActionTarget
} from '../utils/aiActions'
import { isCapableModel } from '../utils/aiModels'
import i18n, { detectLanguage, persistLanguage, type Language } from '../i18n'

export type Theme = 'dark' | 'light'

// i18n/index.ts와 같은 가드. 스토어 생성 시점에 localStorage를 바로 읽으면 DOM 없는
// 환경(vitest node)에서 import만으로 죽어, 스토어 로직 전체가 테스트 불가가 된다.
const hasDom = typeof window !== 'undefined'
const readLocal = (key: string): string | null => (hasDom ? localStorage.getItem(key) : null)
const writeLocal = (key: string, value: string): void => {
  if (hasDom) localStorage.setItem(key, value)
}

interface Store {
  // 데이터
  tasks: Task[]
  trashTasks: Task[]
  lists: TaskList[]
  folders: Folder[]
  habits: Habit[]
  habitLogs: HabitLog[]
  pomodoroSessions: PomodoroSession[]
  score: { total: number; events: { type: string; points: number; date: string; taskId?: string }[] }

  // UI
  selectedListId: string | SmartList
  selectedTaskId: string | null
  viewType: ViewType
  searchQuery: string
  showAddTask: boolean
  editingListId: string | null
  theme: Theme
  language: Language
  detailPanelWidthPx: number | null
  showSettings: boolean
  sortBy: SortBy
  sortDir: SortDir
  batchSelectedIds: string[]
  batchMode: boolean
  undoStack: UndoAction[]
  showQuickAdd: boolean
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

  // 태스크
  addTask: (title: string, opts?: AddTaskOptions) => Promise<void>
  /** 여러 건을 한 번의 스토어 쓰기로 추가한다(일괄 완료의 반복 스폰 등). */
  addTasks: (drafts: Array<{ title: string; opts?: AddTaskOptions }>) => Promise<void>
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
  setLanguage: (lang: Language) => void
  setDetailPanelWidthPx: (px: number, windowWidth: number) => void
  toggleSettings: () => void
  setShowQuickAdd: (show: boolean) => void

  // 되돌리기
  pushUndo: (action: UndoAction) => void
  popUndo: () => Promise<void>

  // 습관
  addHabit: (name: string, color: string, frequency: 'daily' | 'weekly', targetDays: number[]) => Promise<void>
  removeHabit: (id: string) => Promise<void>
  toggleHabitLog: (habitId: string, date: string) => Promise<void>

  // 포모도로 타이머 상태는 store/usePomodoroStore.ts — 1초 틱이 메인 스토어를
  // 매초 갈아치우면 셀렉터 없이 구독하는 화면이 전부 리렌더된다.
  savePomodoroSession: (session: Omit<PomodoroSession, 'id'>) => Promise<void>

  // 점수
  addScore: (type: string, points: number, taskId?: string) => Promise<void>
  /** 여러 건을 스토어 쓰기 1회 + IPC 1회로 반영한다(일괄 완료용). */
  addScores: (entries: { type: string; points: number; taskId?: string }[]) => Promise<void>
  /** 해당 태스크에 지급된 점수의 순합. 회수 금액 계산용(내부). */
  _netScoreFor: (taskId: string) => number

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
  // 원클릭 모델 설치(pull) 진행 상태. null이면 진행 중 아님.
  aiPull: { model: string; status: string; percent: number | null; error: string | null; active: boolean } | null
  // 실행 대기 중인 '기존 할일' 액션. 사용자가 확인 카드에서 승인해야 실행된다.
  aiPendingAction: { op: ActionOp; taskId: string; taskTitle: string; dueDate: string | null } | null
  _aiStreamCleanup: (() => void) | null
  setShowAiChat: (show: boolean) => void
  aiCheckConnection: () => Promise<void>
  aiPullModel: (model: string) => void
  // 채팅 전송 진입점 — 신뢰 가능한 모델 + 액션 의도면 액션 해석으로, 아니면 일반 채팅으로 라우팅.
  aiSubmit: (message: string) => void
  aiRequestTaskAction: (message: string) => Promise<void>
  aiConfirmAction: () => Promise<void>
  aiCancelAction: () => void
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
    tags: safeParseJson<string[]>(row.tags as string, []),
    attachments: safeParseJson<string[]>(row.attachments as string, []),
    createdAt: row.created_at as string,
    completedAt: (row.completed_at as string) || null,
    deletedAt: (row.deleted_at as string) || null,
    sortOrder: (row.sort_order as number) || 0,
    isRecurring: Boolean(row.is_recurring),
    recurringPattern: (row.recurring_pattern as string) || null,
    scheduledStart: (row.scheduled_start as string) || null,
    scheduledEnd: (row.scheduled_end as string) || null,
    scheduledOverrides: safeParseJson<Task['scheduledOverrides']>(row.scheduled_overrides as string, null)
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
    targetDays: safeParseJson<number[]>(row.target_days as string, []),
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
/**
 * 드래그로 바뀐 순서를 적용한다.
 *
 * 0..n-1로 새로 번호를 매기면 안 된다 — sortOrder는 리스트별 카운터인데(createTask가
 * 같은 listId 안에서 maxOrder+1을 준다) '오늘'·태그·'전체' 뷰는 여러 리스트에 걸쳐 있어,
 * 그 화면에서 두 개를 바꾸는 것만으로 다른 리스트의 자리까지 0,1로 덮어쓰게 된다.
 * 대신 재배치 대상이 이미 쥐고 있던 슬롯을 모아 새 순서대로 다시 나눠 준다.
 */
export function applyReorder(tasks: Task[], ids: string[]): Task[] {
  const moving = ids.map((id) => tasks.find((t) => t.id === id)).filter((t): t is Task => Boolean(t))
  if (moving.length === 0) return tasks
  const slots = moving.map((t) => t.sortOrder).sort((a, b) => a - b)
  const nextOrder = new Map(moving.map((t, i) => [t.id, slots[i]]))
  return tasks
    .map((t) => (nextOrder.has(t.id) ? { ...t, sortOrder: nextOrder.get(t.id) as number } : t))
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

/** JSON 문자열을 파싱하되 깨진 값이면 fallback. DB 행 디코딩 경로의 유일한 가드. */
function safeParseJson<T>(s: string | undefined | null, fallback: T): T {
  if (!s) return fallback
  try {
    return (JSON.parse(s) as T) ?? fallback
  } catch {
    return fallback
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
  theme: (readLocal('ticktick-theme') as Theme) || 'dark',
  language: detectLanguage(),
  detailPanelWidthPx: ((): number | null => {
    const n = Number(readLocal('ticktick-detail-width'))
    return Number.isFinite(n) && n > 0 ? n : null
  })(),
  showSettings: false,
  sortBy: 'default',
  sortDir: 'asc',
  batchSelectedIds: [],
  batchMode: false,
  undoStack: [],
  showQuickAdd: false,
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

  // === 태스크 ===
  addTask: async (title, opts = {}) => get().addTasks([{ title, opts }]),
  addTasks: async (drafts) => {
    if (drafts.length === 0) return
    const currentList = get().selectedListId
    const currentTag = typeof currentList === 'string' ? tagFromListId(currentList) : null
    const now = new Date().toISOString()

    // 리스트별 최대 sortOrder를 한 번만 훑고, 같은 리스트에 여러 건이 들어오면
    // 그 안에서 이어 붙인다. 건당 다시 스캔하면 같은 값이 중복 발급된다.
    const maxOrderByList = new Map<string, number>()
    for (const t of get().tasks) {
      maxOrderByList.set(t.listId, Math.max(maxOrderByList.get(t.listId) ?? 0, t.sortOrder || 0))
    }

    const newTasks: Task[] = drafts.map(({ title, opts = {} }) => {
      const targetList =
        opts.listId || (typeof currentList === 'string' && !isVirtualSmartList(currentList) ? currentList : 'inbox')
      // 오늘/내일 뷰에서 날짜 없이 추가하면, 방금 추가한 그 리스트에 보이도록 마감일을 채운다.
      let finalDueDate = opts.dueDate || null
      if (!finalDueDate && currentList === 'today') finalDueDate = todayString()
      else if (!finalDueDate && currentList === 'tomorrow') finalDueDate = tomorrowString()

      // 태그 뷰에서 (최상위 태스크를) 추가하면 그 태그가 자동으로 붙어 방금 추가한 뷰에 보인다.
      // 하위작업(parentId)은 뷰의 태그를 상속하지 않는다.
      const finalTags = opts.tags ?? (currentTag && !opts.parentId ? [currentTag] : [])

      const sortOrder = (maxOrderByList.get(targetList) ?? 0) + 1
      maxOrderByList.set(targetList, sortOrder)

      return {
        id: uuid(),
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
        sortOrder,
        isRecurring: opts.isRecurring || false,
        recurringPattern: opts.recurringPattern || null,
        scheduledStart: opts.scheduledStart || null,
        scheduledEnd: opts.scheduledEnd || null
      }
    })

    // 스토어 쓰기는 한 번. 건당 set()은 선택 수만큼 전체 재렌더를 만든다.
    set((s) => ({ tasks: [...s.tasks, ...newTasks] }))

    // 방금 만든 Task를 그대로 넘긴다. 필드를 손으로 다시 나열하면 IPC 경계가
    // Record<string, unknown>이라 타입이 안 잡히고, Task에 필드가 늘 때 조용히
    // 빠진다. main의 createTask는 이름으로 읽고 나머지는 무시한다.
    for (const t of newTasks) window.api.createTask(t)
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
    // 회차 오버라이드도 같은 불변식을 지킨다(null 항목은 '그날 블록 없음'이라 허용).
    if (task.scheduledOverrides) {
      for (const pair of Object.values(task.scheduledOverrides)) {
        if (pair && !isValidSchedulePair(pair.start, pair.end)) {
          console.warn('[updateTask] rejected invalid override pair', pair)
          return
        }
      }
    }

    // scheduledOverrides는 반복 시리즈에 딸린 회차 예외다. 시리즈의 시간블록이
    // 사라지거나 반복 자체가 끝나거나 패턴이 바뀌면 과거 발생일 기준의 예외는
    // 의미가 없다 — 남기면 유령 블록이 된다. 규칙을 여기서 한 번에 지킨다:
    // 예전에는 호출처마다 손으로 지웠고, 레일 드롭 한 곳이 빠져 있었다.
    const patch = { ...task }
    if (patch.scheduledOverrides === undefined) {
      const current = get().tasks.find((t) => t.id === task.id)
      const unscheduled = 'scheduledStart' in patch && patch.scheduledStart === null
      const recurrenceOff = patch.isRecurring === false
      const patternChanged =
        patch.recurringPattern !== undefined && current != null && patch.recurringPattern !== current.recurringPattern
      if (unscheduled || recurrenceOff || patternChanged) patch.scheduledOverrides = null
    }

    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === patch.id ? { ...t, ...patch } : t))
    }))
    window.api.updateTask(patch)
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

    // 완료를 취소하면 줬던 점수를 되돌린다. 예전에는 지급만 해서 같은 할일을
    // 완료/취소 반복하는 것만으로 점수를 무한히 올릴 수 있었다(2026-08-05 검증).
    // 회수는 현재 우선순위가 아니라 이 태스크에 실제로 지급된 순합으로 한다 —
    // 완료 뒤 우선순위를 바꾸면 지급액과 회수액이 어긋나 총점이 계속 흘렀다.
    if (newCompleted) {
      get().addScore('taskComplete', pointsForTask(task.priority), id)
    } else {
      const owed = get()._netScoreFor(id)
      if (owed > 0) get().addScore('taskComplete', -owed, id)
    }

    if (newCompleted) {
      // 반복 task: 완료 시 다음 인스턴스 생성 (중복 방지·알림 오프셋은 헬퍼가 처리)
      const spawn = nextRecurrenceSpawn(task, get().tasks, todayString())
      if (spawn) get().addTask(spawn.title, spawn)
    }
  },
  removeTask: async (id) => {
    const task = get().tasks.find((t) => t.id === id)
    if (task) {
      get().pushUndo({
        type: 'deleteTask',
        description: i18n.t('undo.taskDeleted', { title: task.title }),
        data: task,
        timestamp: Date.now()
      })
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
    // sortOrder 값만 갱신하면 화면은 그대로였다 — 'default' 정렬은 배열 순서를
    // 그대로 쓰기 때문이다(2026-08-05 검증: 재시작해야 반영됨). 값과 함께 배열도 정렬한다.
    set((s) => ({ tasks: applyReorder(s.tasks, ids) }))
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
    const { tasks, selectedListId, searchQuery } = get()
    const filtered = getFilteredTaskIds(tasks, selectedListId, searchQuery)
    set({ batchSelectedIds: filtered })
  },
  clearBatchSelection: () => set({ batchSelectedIds: [] }),
  batchComplete: async () => {
    const ids = get().batchSelectedIds
    const idSet = new Set(ids)
    const now = new Date().toISOString()
    // 미완료였던 것만 점수를 준다. 일괄 완료가 점수를 건너뛰면, 나중에 하나씩
    // 완료 취소할 때 준 적 없는 점수가 회수돼 총점이 음수로 흘렀다.
    // 합계를 한 번에 반영한다 — 건당 addScore는 선택 수만큼 스토어 쓰기와 IPC를 만든다.
    const newlyCompleted = get().tasks.filter((t) => idSet.has(t.id) && !t.completed)
    const newlyCompletedIds = newlyCompleted.map((t) => t.id)
    // 반복 task의 다음 인스턴스 — 완료 반영 전 스냅샷으로 계산해야 하나씩 완료한
    // 것과 같은 결과가 된다(안 그러면 일괄 완료가 반복 시리즈를 조용히 끝냈다).
    const spawns = collectRecurrenceSpawns(newlyCompleted, get().tasks, todayString())
    set((s) => ({
      // 이미 완료였던 항목의 completedAt은 건드리지 않는다 — 덮어쓰면 완료 이력이
      // 오늘로 밀려 통계의 '오늘 완료'와 14일 추이가 조용히 바뀐다.
      tasks: s.tasks.map((t) => (idSet.has(t.id) && !t.completed ? { ...t, completed: true, completedAt: now } : t)),
      batchSelectedIds: [],
      batchMode: false
    }))
    window.api.batchUpdateTasks(newlyCompletedIds, { completed: true })
    await get().addTasks(spawns.map((spawn) => ({ title: spawn.title, opts: spawn })))
    await get().addScores(
      newlyCompleted.map((t) => ({ type: 'taskComplete', points: pointsForTask(t.priority), taskId: t.id }))
    )
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
      description: i18n.t('undo.tasksDeleted', { count: allDeletedIds.length }),
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
    writeLocal('ticktick-theme', theme)
    set({ theme })
  },
  setLanguage: (lang) => {
    persistLanguage(lang)
    // 메인 프로세스로의 통지는 App의 language 이펙트가 담당한다(첫 실행도 같은 경로).
    set({ language: lang })
  },
  setDetailPanelWidthPx: (px, windowWidth) => {
    const clamped = clampDetailWidth(px, windowWidth, get().showAiChat)
    writeLocal('ticktick-detail-width', String(clamped))
    set({ detailPanelWidthPx: clamped })
  },
  toggleSettings: () => set((s) => ({ showSettings: !s.showSettings })),
  setShowQuickAdd: (show) => set({ showQuickAdd: show }),

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
      // 체크 해제도 점수를 되돌린다 — 할일 완료 취소와 같은 규칙.
      get().addScore('habitComplete', -POINTS_PER_HABIT)
    } else {
      const newLog: HabitLog = { id, habitId, date, completed: true }
      set((s) => ({ habitLogs: [...s.habitLogs, newLog] }))
      get().addScore('habitComplete', POINTS_PER_HABIT)
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
      get().addScore('pomodoroComplete', POINTS_PER_POMODORO)
    }
  },

  // === 점수 ===
  addScore: async (type, points, taskId) => {
    // 통계가 로컬 날짜로 집계하므로 이벤트 날짜도 로컬이어야 한다.
    const date = todayString()
    // main의 addScoreEvent와 같은 0 하한을 쓴다. 다르면 낙관적 표시와 저장값이 갈린다.
    // 하한에 걸려 잘린 만큼은 이벤트에도 그대로 적어야 total과 이벤트 합계가 갈리지 않는다.
    const applied = Math.max(points, -get().score.total)
    set((s) => ({
      score: {
        total: s.score.total + applied,
        // 인메모리 이벤트 배열 최대 200개로 제한 (total은 계속 누적)
        events: [...s.score.events, { type, points: applied, date, taskId }].slice(-200)
      }
    }))
    window.api.addScoreEvent({ type, points: applied, date, taskId })
  },

  addScores: async (entries) => {
    if (entries.length === 0) return
    const date = todayString()
    // 하한을 누적으로 적용해, 각 이벤트에 실제 반영된 값만 남긴다.
    let total = get().score.total
    const applied = entries.map((e) => {
      const p = Math.max(e.points, -total)
      total += p
      return { type: e.type, points: p, date, taskId: e.taskId }
    })
    set((s) => ({ score: { total, events: [...s.score.events, ...applied].slice(-200) } }))
    window.api.addScoreEvents(applied)
  },

  // 이 태스크에 지금까지 순수하게 지급된 점수. 완료를 취소할 때 '현재 우선순위'로
  // 다시 계산하면, 완료 후 우선순위를 바꾼 경우 준 것보다 적게/많이 회수돼 총점이 흘렀다.
  _netScoreFor: (taskId) => get().score.events.reduce((sum, e) => (e.taskId === taskId ? sum + e.points : sum), 0),

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
  aiPull: null,
  aiPendingAction: null,
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
  aiPullModel: (model) => {
    // 이미 설치 중이면 중복 실행 방지
    if (get().aiPull?.active) return
    set({ aiPull: { model, status: i18n.t('ai.pullPreparing'), percent: null, error: null, active: true } })

    // 리스너 정리는 done/error 어느 쪽이든 한 번만. (aiSendMessage와 동일 패턴)
    const cleanup = (): void => {
      offProgress?.()
      offDone?.()
      offError?.()
    }
    const offProgress = window.api.onAiPullProgress?.((p) => {
      set({
        aiPull: {
          model,
          status: p.status || i18n.t('ai.pullDownloading'),
          percent: p.percent,
          error: null,
          active: true
        }
      })
    })
    const offDone = window.api.onAiPullDone?.(() => {
      set({ aiPull: { model, status: i18n.t('ai.pullDone'), percent: 100, error: null, active: false } })
      cleanup()
      // 새 모델을 목록에 반영하고 방금 설치한 모델을 활성 모델로 지정.
      // 'exaone3.5'로 pull하면 Ollama는 'exaone3.5:latest'로 저장하므로, 새로고침된
      // 목록에서 실제 태그를 찾아 저장한다(드롭다운에서 '(미설치)'로 보이지 않게).
      void get()
        .aiCheckConnection()
        .then(() => {
          const installed = get().aiModels.find((m) => m === model || m.startsWith(`${model}:`)) ?? model
          return get().aiSaveConfig({ model: installed })
        })
    })
    const offError = window.api.onAiPullError?.((error) => {
      set({ aiPull: { model, status: i18n.t('ai.pullFailed'), percent: null, error, active: false } })
      cleanup()
    })
    void window.api.aiPullModel?.(model)
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
        m.id === assistantMsg.id ? { ...m, content: i18n.t('ai.error', { message: error }) } : m
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
          m.id === assistantMsg.id ? { ...m, content: i18n.t('ai.serviceUnavailable') } : m
        )
      }))
      cleanup()
    }
  },
  aiClearMessages: () => {
    set({ aiMessages: [], aiPendingAction: null })
    void window.api.aiSaveHistory([])
  },
  aiSubmit: (message) => {
    // 신뢰 가능한 모델 + 액션 의도(명령형 휴리스틱)면 '기존 할일' 액션 해석으로 라우팅(확인 카드).
    // 그 외에는 일반 채팅 스트리밍. (소형 모델은 오탐이 잦아 자동 감지에서 제외)
    const cfg = get().aiConfig
    if (cfg && isCapableModel(cfg.model) && looksLikeTaskAction(message)) {
      void get().aiRequestTaskAction(message)
    } else {
      // 사용자가 확인 카드를 무시하고 다른 메시지를 보내면, 맥락을 벗어난 파괴적
      // 액션 카드가 남아 나중에 잘못 확인되지 않게 조용히 닫는다.
      if (get().aiPendingAction) set({ aiPendingAction: null })
      void get().aiSendMessage(message)
    }
  },
  aiRequestTaskAction: async (message) => {
    const pushAssistant = (content: string): void =>
      set((s) => ({
        aiMessages: [...s.aiMessages, { id: uuid(), role: 'assistant', content, timestamp: new Date().toISOString() }]
      }))
    const userMsg: AiMessage = { id: uuid(), role: 'user', content: message, timestamp: new Date().toISOString() }
    set((s) => ({ aiMessages: [...s.aiMessages, userMsg], aiLoading: true, aiPendingAction: null }))
    try {
      const tasks = buildAiTaskContext(get().tasks)
      const res = (await window.api.aiInterpretAction(message, tasks)) as TaskActionInterpretation
      if (res.op === 'none') {
        set({ aiLoading: false })
        pushAssistant(i18n.t('ai.actionUnclear'))
        return
      }
      if (res.op === 'reschedule' && !res.dueDate) {
        set({ aiLoading: false })
        pushAssistant(i18n.t('ai.actionNeedDate'))
        return
      }
      const target = resolveActionTarget(res.taskTitle, get().tasks)
      if (!target) {
        set({ aiLoading: false })
        pushAssistant(i18n.t('ai.actionNoMatch', { title: res.taskTitle }))
        return
      }
      set({
        aiLoading: false,
        aiPendingAction: { op: res.op, taskId: target.id, taskTitle: target.title, dueDate: res.dueDate }
      })
    } catch {
      // 연결 실패뿐 아니라 모델이 예상과 다른 형식을 반환한 경우(sanitize throw)도 여기로
      // 온다 — 특정해 "연결 불가"라 단정하지 않고 일반 메시지로 안내한다.
      set({ aiLoading: false })
      pushAssistant(i18n.t('ai.actionFailed'))
    }
  },
  aiConfirmAction: async () => {
    const pending = get().aiPendingAction
    if (!pending) return
    set({ aiPendingAction: null })
    const pushAssistant = (content: string): void =>
      set((s) => ({
        aiMessages: [...s.aiMessages, { id: uuid(), role: 'assistant', content, timestamp: new Date().toISOString() }]
      }))
    // TOCTOU 방지: 확인 카드가 떠 있는 동안 사용자가 손으로 그 태스크를 완료/삭제/변경했을
    // 수 있다. 실행 직전 현재 상태를 다시 확인해, 없거나 이미 처리된 경우 blind 실행 대신
    // 정직하게 알린다(예전 코드는 toggleTask가 이미 완료된 태스크를 도로 미완료로 되돌렸음).
    const task = get().tasks.find((t) => t.id === pending.taskId && !t.deletedAt)
    if (!task) {
      pushAssistant(i18n.t('ai.actionGone', { title: pending.taskTitle }))
      return
    }
    let done = ''
    if (pending.op === 'complete') {
      if (task.completed) {
        pushAssistant(i18n.t('ai.actionAlreadyDone', { title: pending.taskTitle }))
        return
      }
      await get().toggleTask(pending.taskId) // 미완료 확인 후이므로 완료로 전환됨
      done = i18n.t('ai.actionCompleted', { title: pending.taskTitle })
    } else if (pending.op === 'delete') {
      await get().removeTask(pending.taskId)
      done = i18n.t('ai.actionDeleted', { title: pending.taskTitle })
    } else if (pending.op === 'reschedule') {
      await get().updateTask({ id: pending.taskId, dueDate: pending.dueDate })
      done = i18n.t('ai.actionRescheduled', { title: pending.taskTitle, date: pending.dueDate })
    }
    pushAssistant(done)
  },
  aiCancelAction: () => {
    if (!get().aiPendingAction) return
    set((s) => ({
      aiPendingAction: null,
      aiMessages: [
        ...s.aiMessages,
        { id: uuid(), role: 'assistant', content: i18n.t('ai.actionCancelled'), timestamp: new Date().toISOString() }
      ]
    }))
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
