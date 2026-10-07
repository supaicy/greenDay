import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import { clampDetailWidth } from './detailWidth'
import { isVirtualSmartList, tagFromListId } from '../utils/smartLists'
import { getFilteredTaskIds } from '../utils/filteredTaskIds'
// 뷰(TaskList)·'전체 선택'과 같은 검색 판별식. setSearchQuery가 일괄 선택을 줄일 때도
// 같은 식을 써야 BatchBar의 개수와 화면에 보이는 줄 수가 어긋나지 않는다.
import { matchesSearch } from '../utils/search'
import { todayString, tomorrowString } from '../utils/date'
import { pointsForTask, POINTS_PER_HABIT, POINTS_PER_POMODORO } from '../utils/score'
import { refreshLicense } from '../licensing/useLicense'
import { LICENSE_REQUIRED } from '../../../shared/license'
// 메인이 읽기 전용 세션에서 던지는 이유. 문구의 단일 출처는 shared다 —
// 여기 다시 적으면 메인에서 이름을 바꿨을 때 이 분기만 조용히 죽는다.
import { DB_READ_ONLY } from '../../../shared/db-errors'
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
import {
  nextRecurrenceSpawn,
  collectRecurrenceSpawns,
  overridesAfterHandover,
  shiftIsoByDays,
  daysBetween
} from '../utils/recurrence'
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

/** 회차 오버라이드 보존 기간(일). 이보다 오래된 키는 쓸 때 턴다. */
const OVERRIDE_RETENTION_DAYS = 90

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
  score: ScoreSlice
  /**
   * 이 세션의 데이터 파일이 읽기 전용인가 (메인이 데이터 파일을 못 읽었다).
   *
   * 켜지면 **아무 편집도 저장되지 않는다.** 화면이 그 사실을 말해야 한다 —
   * 아니면 사용자는 한 세션치를 편집하고 재시작 때 전부 잃는다.
   * (배너를 그리는 것은 아직 없다. `Settings`/`App` 소유 워크트리의 일이다.)
   */
  dbReadOnly: boolean

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
  /**
   * 확인을 **못 했다**. `updateChecked`만으로는 이 상태를 표현할 수 없다 —
   * `updateChecked && !updateAvailable`은 "최신 버전입니다"로 읽히기 때문이다.
   */
  updateFailed: boolean
  updateDownloadProgress: number | null
  /** 받다가 실패했다. 확인 실패(`updateFailed`)와 따로 둔다 — 새 버전은 있고 다시 받으면 된다. */
  updateDownloadFailed: boolean
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
  /** 할일을 복제해 원본 바로 아래에 놓는다(하위작업 포함). */
  duplicateTask: (id: string) => Promise<void>
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
  /** 지금 화면의 대화를 잘라서 디스크에 적는다. 대화를 늘린 쪽이 누구든 이걸 부른다. */
  _aiPersistHistory: () => void
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
    startDate: (row.start_date as string) || null,
    reminderAt: (row.reminder_at as string) || null,
    pinned: Boolean(row.pinned),
    listId: (row.list_id as string) || 'inbox',
    parentId: (row.parent_id as string) || null,
    tags: parseStringArray(row.tags as string),
    attachments: parseStringArray(row.attachments as string),
    createdAt: row.created_at as string,
    completedAt: (row.completed_at as string) || null,
    deletedAt: (row.deleted_at as string) || null,
    sortOrder: (row.sort_order as number) || 0,
    isRecurring: Boolean(row.is_recurring),
    recurringPattern: (row.recurring_pattern as string) || null,
    scheduledStart: (row.scheduled_start as string) || null,
    scheduledEnd: (row.scheduled_end as string) || null,
    scheduledOverrides: parsePlainObject<NonNullable<Task['scheduledOverrides']>>(row.scheduled_overrides as string)
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
    targetDays: parseNumberArray(row.target_days as string),
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
  // 슬롯은 **엄격히 증가**해야 한다. sortOrder는 위 주석대로 리스트별 카운터라
  // 리스트마다 1부터 세고, '전체'·'오늘'·'다음 7일'·태그처럼 리스트를 가로지르는
  // 뷰는 같은 값을 쥔 행을 한 묶음으로 넘긴다. 동점을 그대로 나눠 주면 아래
  // 안정 정렬이 동점끼리는 이전 배열 순서를 지켜 드롭이 통째로 버려진다 —
  // 항목이 제자리로 튕겨 나오고, 몇 번을 다시 끌어도 결과가 한 글자도 안 바뀌던
  // 그 버그다. 올려 주는 것은 이미 동점이거나 뒤집힌 값뿐이고, 한 번 끌고 나면
  // 그 묶음은 엄격히 증가하므로 다음 드래그는 아무것도 밀지 않는다.
  for (let i = 1; i < slots.length; i++) {
    if (slots[i] <= slots[i - 1]) slots[i] = slots[i - 1] + 1
  }
  const nextOrder = new Map(moving.map((t, i) => [t.id, slots[i]]))
  return tasks
    .map((t) => (nextOrder.has(t.id) ? { ...t, sortOrder: nextOrder.get(t.id) as number } : t))
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

/**
 * 기간(startDate~dueDate)의 불변식을 한 자리에서 지킨다. dueDate가 종료일이라
 * 둘은 한 쌍이다 — 생성이든 수정이든 같은 규칙을 거쳐야, 한쪽 경로만 열려
 * 거꾸로 된 기간이나 끝 없는 시작일이 디스크에 남는 일이 없다.
 *
 * `next`는 이 변경이 적용된 뒤의 값(수정 경로는 저장값과 합친 것). 규칙에
 * 어긋나면 startDate만 떨어뜨린다 — 같이 실려 온 다른 필드는 사용자의 의도다.
 */
export function normalizeDateRange(
  patch: { startDate?: string | null },
  next: { startDate: string | null; dueDate: string | null }
): void {
  // 끝이 없으면 기간이 아니다. 거꾸로면 그릴 수 없다.
  if (!next.startDate) return
  if (next.dueDate && next.startDate <= next.dueDate) return

  if (patch.startDate) {
    // 사용자가 방금 지정한 시작일이 틀렸다 — 그 필드만 무시하고 저장값을 지킨다.
    delete patch.startDate
  } else {
    // 마감일이 옮겨지거나 지워지면서 남아 있던 시작일이 의미를 잃었다.
    patch.startDate = null
  }
}

/**
 * IPC 영속화 호출을 감싼다. main의 검증이 거부하면 ipcMain.handle이 reject하는데,
 * 아무도 await하지 않아 unhandled rejection으로 사라졌다 — 화면에는 반영된 변경이
 * 디스크에는 없고, 재시작해야 그 사실이 드러난다. 최소한 진단은 남긴다.
 * (사용자에게 보이는 실패 표면은 TODOS의 '조용한 실패' 항목.)
 */
function persist(what: string, run: () => unknown): void {
  try {
    const r = run()
    if (r instanceof Promise) r.catch((e) => report(what, e))
  } catch (e) {
    report(what, e)
  }
}

/**
 * 저장 실패를 어떻게 다룰지.
 *
 * **잠김은 다르게 다룬다.** 메인의 게이트가 유료 채널을 거절하면(`ipc-gate.ts`)
 * 화면은 이미 낙관적으로 바뀐 뒤라, 그냥 로그만 남기면 사용자에게는 편집이
 * 된 것처럼 보이고 재시작하면 사라진다. 게이트가 던지는 이유로 적어 둔 것이
 * 바로 그 "유령 편집"인데, 정작 렌더러가 그 거절을 아무도 받지 않고 있었다.
 *
 * 문자열로 비교하는 이유: Electron이 거절을 감싸서
 * `Error invoking remote method 'update-task': Error: license_required`로 만든다.
 * 그래서 `===`가 아니라 포함 검사다. 문구 자체는 `shared/license.ts`에서 가져온다 —
 * 여기 다시 적어 두면 메인에서 이름을 바꿨을 때 아무것도 안 깨진 채 이 경로만
 * 조용히 죽는다.
 *
 * 여기서 하는 일은 **상태를 다시 받아오는 것**뿐이다. 그러면 잠금 화면이 즉시
 * 뜨고 사용자가 왜 안 먹히는지 알게 된다. 낙관적 변경을 되돌리는 것은 연산마다
 * 역연산이 필요해 따로 할 일이다(TODOS 참고).
 *
 * **읽기 전용 거절은 지금 되돌린다.** 그쪽은 역연산이 필요 없다: 데이터 파일을
 * 못 읽은 세션에서는 이번 것만이 아니라 **아무것도** 쓸 수 없으므로, 메인에서
 * 통째로 다시 읽어오는 것이 정확한 롤백이다. 메인의 `data`는 이 세션 내내
 * 변하지 않으므로 그 재동기화가 화면을 정확히 디스크 상태로 되돌린다.
 * 이걸 안 하면 메인만 고쳐 놓고(H8) 사용자가 보는 유령 편집은 그대로 남는다 —
 * 검증이 `createFolder`로 실측했다: db_read_only로 거절됐는데 폴더가 화면에 남았다.
 */
function report(what: string, error: unknown): void {
  console.error(`[persist] ${what} 실패`, error)
  const message = String((error as { message?: unknown })?.message ?? error)
  if (message.includes(LICENSE_REQUIRED)) {
    void refreshLicense()
    return
  }
  if (message.includes(DB_READ_ONLY)) {
    useStore.setState({ dbReadOnly: true })
    void resyncFromMain()
  }
}

/**
 * 메인에서 다시 읽어와 낙관적 변경을 버린다. **한 번에 하나만 돈다.**
 *
 * 거절은 무더기로 온다 — 일괄 완료 하나가 IPC를 여럿 쏘고 그 전부가 거절된다.
 * 매번 전체 재적재를 걸면 같은 일을 수십 번 한다.
 */
let resyncing = false
async function resyncFromMain(): Promise<void> {
  if (resyncing) return
  resyncing = true
  try {
    await useStore.getState().loadData()
  } catch (error) {
    console.error('[persist] 재동기화 실패', error)
  } finally {
    resyncing = false
  }
}

/**
 * 휴지통 복원을 main에 맡기고, **main이 되살렸다고 답한 id만** 화면에서 옮긴다.
 *
 * 무엇이 함께 올라오는지(같은 삭제로 내려간 자손, 매달린 조상, 되돌리기의 남은 자손)는
 * main의 `restoreTask`만 안다 — 판정 재료인 `deleted_with`가 렌더러의 `Task`에는 없다.
 * 화면이 "같은 `deletedAt`의 자손"으로 따로 짐작하던 시절에는 중간 행 복원·낡은
 * 연결·휴지통 복원 뒤의 되돌리기에서 둘이 갈렸고, 그 상태로 '휴지통 비우기'를 누르면
 * 화면에 살아 있는 행이 디스크에서 영구 삭제됐다. 그래서 낙관적으로 먼저 옮기지 않는다:
 * 로컬 IPC 한 번이라 기다려도 눈에 띄지 않고, 거절되면 화면은 처음부터 그대로다.
 */
async function restoreOnMain(id: string): Promise<void> {
  let answer: unknown
  try {
    answer = await window.api.restoreTask(id)
  } catch (error) {
    report('restoreTask', error)
    return
  }
  applyRestored(answer)
}

/**
 * main의 답을 화면에 옮긴다. 휴지통에서 꺼내 `deletedAt`을 지우는 것뿐이다.
 *
 * 답이 배열이 아니거나(모양을 모르는 main), 답의 id가 화면 어디에도 없으면(답이 오기
 * 전에 '휴지통 비우기'가 화면의 휴지통을 비웠다 — main은 복원을 먼저 처리했으니 그
 * 행은 디스크에 살아 있다) 짐작하지 않고 main에서 다시 읽는다.
 */
function applyRestored(answer: unknown): void {
  if (!Array.isArray(answer)) {
    console.error('[restoreTask] main의 답이 id 목록이 아니다', answer)
    void resyncFromMain()
    return
  }
  const ids = new Set(answer.filter((x): x is string => typeof x === 'string'))
  if (ids.size === 0) return
  let unseen = false
  useStore.setState((s) => {
    const live = new Set(s.tasks.map((t) => t.id))
    const back = s.trashTasks.filter((t) => ids.has(t.id) && !live.has(t.id))
    const placed = new Set([...live, ...back.map((t) => t.id)])
    unseen = [...ids].some((x) => !placed.has(x))
    if (back.length === 0) return {}
    return {
      trashTasks: s.trashTasks.filter((t) => !ids.has(t.id)),
      tasks: [...s.tasks, ...back.map((t) => ({ ...t, deletedAt: null }))]
    }
  })
  if (unseen) void resyncFromMain()
}

/**
 * `parentId`로 이어진 자손 전부의 id(자기 자신 제외). **한 단계가 아니다** — main의
 * `descendantsOf`와 같은 규칙이어야 화면과 디스크가 재시작 전후로 갈리지 않는다.
 * 상세 패널은 하위작업에도 SubtaskList를 그려 A→B→C가 생기는데, 직계만 내리면
 * 손자가 살아 남아 살아 있는 부모가 없는, 어느 화면에도 없는 행이 됐다.
 * 순환 parentId에 멈추도록 본 id를 센다. (복원 집합은 여기서 고르지 않는다 — `restoreOnMain`.)
 */
function descendantIds(rows: Task[], id: string): string[] {
  const children = new Map<string, Task[]>()
  for (const t of rows) {
    if (!t.parentId) continue
    const list = children.get(t.parentId)
    if (list) list.push(t)
    else children.set(t.parentId, [t])
  }
  const out: string[] = []
  const seen = new Set<string>([id])
  const queue = [id]
  while (queue.length) {
    for (const child of children.get(queue.shift() as string) ?? []) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      out.push(child.id)
      queue.push(child.id)
    }
  }
  return out
}

/**
 * 단건 삭제의 undo 페이로드.
 *
 * `UndoAction.data`가 `unknown`이라 모양을 여기서 정한다 — 넣는 곳과 꺼내는 곳이
 * 둘 다 이 파일이므로 공유 타입을 넓힐 이유가 없다.
 */
interface DeletedTaskUndo {
  task: Task
  /**
   * 부모와 **같은 조작으로** 함께 내려간 자손(하위작업만이 아니라 깊이와 상관없이)의 id.
   * 되돌릴 때 무엇을 올릴지는 이 목록이 아니라 main의 `restoreTask` 답이 정한다 — 그
   * 사이 휴지통에서 일부를 복원했을 수 있다. 지금은 기록용이고 읽는 곳이 없다(undo 스택은
   * 메모리에만 있어 맞출 옛 페이로드도 없다 — 정리는 TODOS).
   */
  subtaskIds: string[]
}

/**
 * 옛 모양(`data`가 Task 하나)도 읽는다. 이 버전으로 올라오기 전에 쌓인 undo가
 * 스택에 남아 있을 수 있고, 그때 `data.task`가 undefined면 되돌리기가 던진다.
 */
function readDeletedTaskUndo(raw: unknown): DeletedTaskUndo {
  const o = raw as Partial<DeletedTaskUndo> & Partial<Task>
  if (o && typeof o === 'object' && 'task' in o && o.task) {
    return { task: o.task as Task, subtaskIds: Array.isArray(o.subtaskIds) ? o.subtaskIds : [] }
  }
  return { task: raw as Task, subtaskIds: [] }
}

/**
 * main이 보낸 score를 온전한 슬라이스로. **`taskNet`이 없으면 지어내지 않는다** —
 * 빈 원장으로 시작하면 옛 완료의 회수액이 0이 되지만(과소 회수), 이벤트에서
 * 되짚어 만들면 잘려 나간 이력 때문에 **과대 회수**가 되어 총점이 실제보다
 * 낮아진다. 두 방향 중 사용자에게서 뺏지 않는 쪽을 고른다.
 * (main의 `normalizeScore`가 마이그레이션을 이미 했으므로 여기 오는 값에는 보통 들어 있다.)
 */
function normalizeScoreSlice(raw: unknown): ScoreSlice {
  const empty: ScoreSlice = { total: 0, events: [], taskNet: {} }
  if (typeof raw !== 'object' || raw === null) return empty
  const o = raw as Record<string, unknown>
  const taskNet: Record<string, number> = {}
  if (typeof o.taskNet === 'object' && o.taskNet !== null && !Array.isArray(o.taskNet)) {
    for (const [id, value] of Object.entries(o.taskNet as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value) && value !== 0) taskNet[id] = value
    }
  }
  return {
    total: typeof o.total === 'number' && Number.isFinite(o.total) ? o.total : 0,
    events: Array.isArray(o.events) ? (o.events as ScoreSlice['events']) : [],
    taskNet
  }
}

/**
 * JSON 문자열 → 배열. **모양까지 확인한다.** DB 행 디코딩 경로의 유일한 가드다.
 *
 * 전에 있던 `safeParseJson`은 파싱만 하고 `as T`로 캐스팅할 뿐이라, 파싱 결과가 배열이
 * 아니어도 그대로 `Task.tags`에 앉았다. 그러면 화면이 `task.tags.map(...)`에서
 * 던지고, ErrorBoundary가 없던 동안에는 앱 전체가 백지가 됐다 — 게다가 그 값은
 * 디스크에 있으므로 **재시작해도 같은 자리에서 다시 죽었다.**
 *
 * 2026-09-25 진단 실측: `tags`가 `"\"[]\""`(이중 인코딩)인 행 하나로
 * `a.tags.map is not a function`이 나면서 창이 완전히 비었다.
 *
 * 파싱은 실패할 수 있는 입력이다 — 마이그레이션으로 넘어온 옛 스키마, 손으로
 * 고친 JSON, 형태가 다른 미래 버전의 파일. 여기서 한 번 거르면 그 전부가
 * "태그 없음"으로 안전하게 내려앉는다.
 */
function parseArrayOf<T>(s: string | undefined | null, isItem: (v: unknown) => v is T): T[] {
  if (!s) return []
  try {
    const parsed: unknown = JSON.parse(s)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isItem)
  } catch {
    return []
  }
}

const parseStringArray = (s: string | undefined | null): string[] =>
  parseArrayOf(s, (v): v is string => typeof v === 'string')

const parseNumberArray = (s: string | undefined | null): number[] =>
  parseArrayOf(s, (v): v is number => typeof v === 'number' && Number.isFinite(v))

/** JSON 문자열 → 평범한 객체. 배열·문자열·숫자가 오면 없는 것으로 친다. */
function parsePlainObject<T>(s: string | undefined | null): T | null {
  if (!s) return null
  try {
    const parsed: unknown = JSON.parse(s)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as T
  } catch {
    return null
  }
}

/**
 * 점수 상태. `events`는 표시용이라 200개로 잘리고, `taskNet`은 잘리지 않는다.
 *
 * 완료 취소가 회수할 금액은 "이 할일에 실제로 지급된 합"인데 그것을 잘리는
 * 배열에서 구하면, 완료 이벤트가 창 밖으로 밀린 뒤에는 회수액이 0이 된다 —
 * 지급은 됐는데 회수는 안 되는 순증이고 같은 할일로 반복 가능하다.
 * main의 `ScoreState`와 같은 모양이다(database.ts).
 */
export interface ScoreSlice {
  total: number
  events: { type: string; points: number; date: string; taskId?: string }[]
  taskNet: Record<string, number>
}

/** 원장에 delta를 반영한다. 0이 되면 지운다 — 원장이 무한히 자라지 않게. */
export function applyToLedger(
  ledger: Record<string, number>,
  taskId: string | undefined,
  delta: number
): Record<string, number> {
  if (!taskId || delta === 0) return ledger
  const next = { ...ledger }
  const value = (next[taskId] ?? 0) + delta
  if (value === 0) delete next[taskId]
  else next[taskId] = value
  return next
}

export const useStore = create<Store>((set, get) => ({
  tasks: [],
  trashTasks: [],
  lists: [],
  folders: [],
  habits: [],
  habitLogs: [],
  pomodoroSessions: [],
  score: { total: 0, events: [], taskNet: {} },
  dbReadOnly: false,
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
  updateFailed: false,
  updateDownloadProgress: null as number | null,
  updateDownloadFailed: false,
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
      // main이 `taskNet`을 안 실어 보내는 일은 없지만(normalizeScore가 항상 채운다),
      // IPC 너머에서 온 값이라 모양을 믿지 않는다 — 없으면 빈 원장으로 시작한다.
      score: normalizeScoreSlice(rawScore)
    })
  },

  // === 폴더 ===
  addFolder: async (name) => {
    const id = uuid()
    const now = new Date().toISOString()
    const maxOrder = get().folders.reduce((m, f) => Math.max(m, f.sortOrder || 0), 0)
    const newFolder: Folder = { id, name, collapsed: false, sortOrder: maxOrder + 1, createdAt: now }
    set((s) => ({ folders: [...s.folders, newFolder] }))
    persist('createFolder', () => window.api.createFolder(id, name))
  },
  updateFolder: async (id, name, collapsed) => {
    set((s) => ({
      folders: s.folders.map((f) => (f.id === id ? { ...f, name, collapsed } : f))
    }))
    persist('updateFolder', () => window.api.updateFolder(id, name, collapsed))
  },
  removeFolder: async (id) => {
    set((s) => ({
      folders: s.folders.filter((f) => f.id !== id),
      lists: s.lists.map((l) => (l.folderId === id ? { ...l, folderId: null } : l))
    }))
    persist('deleteFolder', () => window.api.deleteFolder(id))
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
    persist('createList', () => window.api.createList(id, name, color, 'list', folderId || null))
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
    persist('updateList', () => window.api.updateList(id, mapped))
  },
  removeList: async (id) => {
    set((s) => ({
      lists: s.lists.filter((l) => l.id !== id),
      tasks: s.tasks.map((t) => (t.listId === id ? { ...t, listId: 'inbox' } : t)),
      selectedListId: s.selectedListId === id ? 'inbox' : s.selectedListId
    }))
    persist('deleteList', () => window.api.deleteList(id))
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

    // 한 건을 Task로 굽는다. 하위작업도 같은 절차를 거쳐야 해서 밖으로 뺐다 —
    // 두 벌로 적어 두면 Task에 필드가 늘 때 한쪽만 늘고, 그 필드는 하위작업에서만
    // 조용히 빈다(바로 이 함수의 `description: ''`이 그렇게 굳은 자리다).
    const build = (title: string, opts: AddTaskOptions): Task => {
      const targetList =
        opts.listId || (typeof currentList === 'string' && !isVirtualSmartList(currentList) ? currentList : 'inbox')
      // 오늘/내일 뷰에서 날짜 없이 추가하면, 방금 추가한 그 리스트에 보이도록 마감일을 채운다.
      // 하위작업(parentId)은 제외한다 — 목록에 홀로 서지 않으니(smartLists.isTopLevel)
      // 뷰의 날짜를 물려받을 이유가 없고, 반복 스폰이 만든 다음 주 체크리스트에
      // '오늘'이 찍히면 부모와 날짜가 어긋난다. 아래 태그 규칙과 같은 기준이다.
      let finalDueDate = opts.dueDate || null
      if (!finalDueDate && !opts.parentId && currentList === 'today') finalDueDate = todayString()
      else if (!finalDueDate && !opts.parentId && currentList === 'tomorrow') finalDueDate = tomorrowString()

      // 태그 뷰에서 (최상위 태스크를) 추가하면 그 태그가 자동으로 붙어 방금 추가한 뷰에 보인다.
      // 하위작업(parentId)은 뷰의 태그를 상속하지 않는다.
      const finalTags = opts.tags ?? (currentTag && !opts.parentId ? [currentTag] : [])

      const sortOrder = (maxOrderByList.get(targetList) ?? 0) + 1
      maxOrderByList.set(targetList, sortOrder)

      const range = { startDate: opts.startDate ?? null, dueDate: finalDueDate }
      normalizeDateRange(range, range)

      return {
        id: uuid(),
        title,
        description: opts.description ?? '',
        completed: false,
        priority: opts.priority || 'none',
        dueDate: finalDueDate,
        dueTime: opts.dueTime || null,
        startDate: range.startDate ?? null,
        reminderAt: opts.reminderAt || null,
        pinned: opts.pinned || false,
        listId: targetList,
        parentId: opts.parentId || null,
        tags: finalTags,
        attachments: opts.attachments ?? [],
        createdAt: now,
        completedAt: null,
        deletedAt: null,
        sortOrder,
        isRecurring: opts.isRecurring || false,
        recurringPattern: opts.recurringPattern || null,
        scheduledStart: opts.scheduledStart || null,
        scheduledEnd: opts.scheduledEnd || null,
        scheduledOverrides: opts.scheduledOverrides || null
      }
    }

    const newTasks: Task[] = []
    for (const { title, opts = {} } of drafts) {
      const parent = build(title, opts)
      newTasks.push(parent)
      // 하위작업은 부모 id가 나온 뒤에야 만들 수 있다. 같은 set/persist 묶음에
      // 태워 보내면 부모만 저장되고 체크리스트가 없는 중간 상태가 생기지 않는다.
      for (const sub of opts.subtasks ?? []) {
        newTasks.push(
          build(sub.title, {
            parentId: parent.id,
            listId: parent.listId,
            description: sub.description,
            priority: sub.priority
          })
        )
      }
    }

    // 스토어 쓰기는 한 번. 건당 set()은 선택 수만큼 전체 재렌더를 만든다.
    set((s) => ({ tasks: [...s.tasks, ...newTasks] }))

    // 방금 만든 Task를 그대로 넘긴다. 필드를 손으로 다시 나열하면 IPC 경계가
    // Record<string, unknown>이라 타입이 안 잡히고, Task에 필드가 늘 때 조용히
    // 빠진다. main의 createTask는 이름으로 읽고 나머지는 무시한다.
    for (const t of newTasks) persist('createTask', () => window.api.createTask(t))
  },
  updateTask: async (task) => {
    // 같은 태스크를 네 번 찾고 있었다 — 한 번 찾아 모든 가드가 나눠 쓴다.
    const current = get().tasks.find((t) => t.id === task.id)

    // Invariant guard: if the caller is changing scheduledStart/End, ensure the pair is valid
    if ('scheduledStart' in task || 'scheduledEnd' in task) {
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

    const patch = { ...task }
    // 기간은 생성 경로와 같은 규칙을 쓴다(normalizeDateRange). 잘못된 값이면
    // startDate만 떨어져 나가고, 같이 실려 온 dueTime 같은 필드는 살아남는다 —
    // 예전에는 patch 전체를 버려서 무관한 수정까지 조용히 사라졌다.
    // current가 없어도(휴지통·로딩 경합) 쓰기는 통과시킨다 — main은 자기
    // 저장소에서 그 행을 찾는다. 비교할 저장값이 없으니 보정만 건너뛴다.
    if (current && ('startDate' in patch || 'dueDate' in patch)) {
      // 마감일만 옮기는 조작(캘린더 드래그·'오늘로' 단축키·AI 재예약)은 기간을
      // 통째로 옮기려는 뜻이다. 길이를 지킨 채 따라가지 않으면, 사흘짜리 일이
      // 드래그 한 번에 경고도 없이 하루짜리가 된다.
      if (!('startDate' in patch) && patch.dueDate && current.startDate && current.dueDate) {
        patch.startDate = shiftIsoByDays(patch.dueDate, -daysBetween(current.startDate, current.dueDate))
      }
      normalizeDateRange(patch, {
        startDate: 'startDate' in patch ? (patch.startDate ?? null) : current.startDate,
        dueDate: 'dueDate' in patch ? (patch.dueDate ?? null) : current.dueDate
      })
    }

    // scheduledOverrides는 반복 시리즈에 딸린 회차 예외다. 시리즈의 시간블록이
    // 사라지거나 반복 자체가 끝나거나 패턴이 바뀌면 과거 발생일 기준의 예외는
    // 의미가 없다 — 남기면 유령 블록이 된다. 규칙을 여기서 한 번에 지킨다:
    // 예전에는 호출처마다 손으로 지웠고, 레일 드롭 한 곳이 빠져 있었다.
    if (patch.scheduledOverrides === undefined) {
      const unscheduled = 'scheduledStart' in patch && patch.scheduledStart === null
      const recurrenceOff = patch.isRecurring === false
      const patternChanged =
        patch.recurringPattern !== undefined && current != null && patch.recurringPattern !== current.recurringPattern
      // 마감일도 무효화 사유다 — occursOn이 dueDate를 기준점으로 쓰므로, 날짜가
      // 바뀌면 발생일 집합이 통째로 다시 매핑된다. 옛 키를 남기면 값이 있는 키는
      // 유령 블록이 되고, null 키는 이제 진짜 발생일인 날을 영영 가린다.
      const dueDateChanged = patch.dueDate !== undefined && current != null && patch.dueDate !== current.dueDate
      if (unscheduled || recurrenceOff || patternChanged || dueDateChanged) patch.scheduledOverrides = null
    }

    // 오버라이드 맵은 키를 쌓기만 한다(드롭·리사이즈가 추가만 하고 지우지 않는다).
    // 완료하지 않은 매일 반복을 계속 옮기면 상호작용마다 키가 하나씩 늘고,
    // IPC 경계의 상한(1000키)에 닿으면 저장이 조용히 거부된다. 다만 지난 키를
    // 즉시 버리면 "지난주 운동은 8시였다"는 기록까지 사라지므로, 보존 기간을 둔다.
    if (patch.scheduledOverrides) {
      const cutoff = shiftIsoByDays(todayString(), -OVERRIDE_RETENTION_DAYS)
      const stored = current?.scheduledOverrides ?? {}
      const kept = Object.entries(patch.scheduledOverrides).filter(([date, pair]) => {
        if (date >= cutoff) return true
        // 오래됐어도 이번에 새로 쓰거나 바꾼 키는 남긴다 — 캘린더를 되짚어가
        // 옛 회차를 옮기면 저장이 조용히 무효가 됐다. 손대지 않고 그대로
        // 실려 온 옛 키만 정리 대상이다.
        return JSON.stringify(pair) !== JSON.stringify(stored[date] ?? null) || !(date in stored)
      })
      patch.scheduledOverrides = kept.length > 0 ? Object.fromEntries(kept) : null
    }

    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === patch.id ? { ...t, ...patch } : t))
    }))
    persist('updateTask', () => window.api.updateTask(patch))
  },
  toggleTask: async (id) => {
    const task = get().tasks.find((t) => t.id === id)
    if (!task) return
    const newCompleted = !task.completed
    const completedAt = newCompleted ? new Date().toISOString() : null

    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, completed: newCompleted, completedAt } : t))
    }))
    persist('updateTask', () => window.api.updateTask({ id, completed: newCompleted }))

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
      const spawn = nextRecurrenceSpawn(
        task,
        get().tasks,
        todayString(),
        get().tasks.filter((t) => t.parentId === id)
      )
      if (spawn) {
        // 넘긴 미래 회차는 완료본에서 뺀다 — 양쪽에 남으면 같은 날짜를 두 인스턴스가
        // 주장한다(완료본은 오버라이드가 있는 날을 자기 회차로 인정하므로 실제로 겹친다).
        // 규칙은 recurrence.ts의 overridesAfterHandover 한 곳에 있다 — 일괄 완료도
        // 같은 것을 부른다. 예전에는 이 세 줄이 여기에만 있어서 일괄 완료가 같은
        // 날짜의 블록을 하나씩 복제했다.
        const left = overridesAfterHandover(task, spawn)
        if (left !== undefined) get().updateTask({ id, scheduledOverrides: left })
        get().addTask(spawn.title, spawn)
      }
    }
  },
  removeTask: async (id) => {
    const task = get().tasks.find((t) => t.id === id)
    // 살아 있는 자손 전부 — main의 `deleteTask`도 같은 집합을 내린다.
    const subtaskIds = descendantIds(get().tasks, id)
    if (task) {
      get().pushUndo({
        type: 'deleteTask',
        // 되돌리기는 부모 id 하나로 main의 `restoreTask`에 묻고, main이 실제로 되살린
        // id만 화면에 옮긴다(`restoreOnMain`). 자손 목록은 기록으로만 싣는다.
        data: { task, subtaskIds } satisfies DeletedTaskUndo,
        description: i18n.t('undo.taskDeleted', { title: task.title }),
        timestamp: Date.now()
      })
    }
    const now = new Date().toISOString()
    const gone = new Set([id, ...subtaskIds])
    set((s) => ({
      tasks: s.tasks.filter((t) => !gone.has(t.id)),
      trashTasks: [...s.trashTasks, ...s.tasks.filter((t) => gone.has(t.id)).map((t) => ({ ...t, deletedAt: now }))],
      selectedTaskId: s.selectedTaskId && gone.has(s.selectedTaskId) ? null : s.selectedTaskId
    }))
    persist('deleteTask', () => window.api.deleteTask(id))
  },
  duplicateTask: async (id) => {
    const all = get().tasks
    const src = all.find((t) => t.id === id)
    if (!src) return
    const now = new Date().toISOString()

    // 원본과 다음 항목 사이의 값을 준다 — 다른 행의 sortOrder를 건드리지 않고도
    // 원본 바로 아래에 놓인다. (reorderTasks는 기존 슬롯을 맞바꿀 뿐 정수로 다시
    //  번호를 매기지 않는다. 간격은 스스로 회복되지 않으므로 아래에서 직접 막는다.)
    let after = Number.POSITIVE_INFINITY
    for (const t of all) {
      if (t.listId === src.listId && !t.parentId && t.sortOrder > src.sortOrder) after = Math.min(after, t.sortOrder)
    }
    // 같은 자리에 계속 복제하면 간격이 반씩 줄어 결국 중간값이 원본과 같아진다.
    // 그때는 같은 슬롯을 만드는 대신 맨 뒤로 보낸다 — 자리는 아쉬워도 순서는 정해진다.
    const mid = (src.sortOrder + after) / 2
    // 간격 탐색과 같은 기준이어야 한다 — 하위작업을 세면 복제본이 목록 밖으로 밀려난다.
    const maxOrder = all.reduce((m, t) => (t.listId === src.listId && !t.parentId ? Math.max(m, t.sortOrder) : m), 0)
    const sortOrder = Number.isFinite(after) && mid > src.sortOrder && mid < after ? mid : maxOrder + 1

    // 복제되지 않는 것들: 완료 이력은 이 할일의 것이 아니고, 시간블록은 한 자리에
    // 둘이 겹치게 만들며, 고정은 "이것 하나를 위에 둔다"는 뜻이라 복제가 무의미하다.
    // 반복도 뗀다 — 시리즈 키가 (패턴·제목·마감일)이라 복제본이 원본과 같은 키를
    // 갖고, 둘 다 완료하면 다음 회차가 하나만 생겨 나머지 시리즈가 말없이 끝난다.
    const fresh = (t: Task, over: Partial<Task>): Task => ({
      ...t,
      id: uuid(),
      completed: false,
      completedAt: null,
      deletedAt: null,
      pinned: false,
      isRecurring: false,
      recurringPattern: null,
      scheduledStart: null,
      scheduledEnd: null,
      scheduledOverrides: null,
      createdAt: now,
      ...over
    })

    const copy = fresh(src, { sortOrder })
    const subtasks = all.filter((t) => t.parentId === id).map((t) => fresh(t, { parentId: copy.id }))

    set((s) => {
      const at = s.tasks.findIndex((t) => t.id === id)
      return { tasks: [...s.tasks.slice(0, at + 1), copy, ...s.tasks.slice(at + 1), ...subtasks] }
    })
    for (const t of [copy, ...subtasks]) persist('createTask', () => window.api.createTask(t))
  },
  restoreTask: async (id) => {
    // 무엇이 함께 올라오는지는 main이 답한다(`restoreOnMain`). 화면은 그 목록을 옮길 뿐이다.
    await restoreOnMain(id)
  },
  permanentDeleteTask: async (id) => {
    // main의 `permanentDeleteTask`처럼 자손 전부를 걷는다 — 휴지통에 손자가 남으면
    // 다음 로드까지 부모 없는 행이 보이다가 사라진다.
    set((s) => {
      const gone = new Set([id, ...descendantIds([...s.trashTasks, ...s.tasks], id)])
      return {
        trashTasks: s.trashTasks.filter((t) => !gone.has(t.id)),
        tasks: s.tasks.filter((t) => !gone.has(t.id))
      }
    })
    persist('permanentDeleteTask', () => window.api.permanentDeleteTask(id))
  },
  emptyTrash: async () => {
    set({ trashTasks: [] })
    persist('emptyTrash', () => window.api.emptyTrash())
  },
  // 같은 태스크를 다시 클릭하면 상세를 닫는다(토글). 다른 id면 전환, null이면 닫기.
  selectTask: (id) => set((s) => ({ selectedTaskId: s.selectedTaskId === id ? null : id })),
  setShowAddTask: (show) => set({ showAddTask: show }),
  reorderTasks: async (ids) => {
    // sortOrder 값만 갱신하면 화면은 그대로였다 — 'default' 정렬은 배열 순서를
    // 그대로 쓰기 때문이다(2026-08-05 검증: 재시작해야 반영됨). 값과 함께 배열도 정렬한다.
    set((s) => ({ tasks: applyReorder(s.tasks, ids) }))
    persist('reorderTasks', () => window.api.reorderTasks(ids))
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
    const plans = collectRecurrenceSpawns(newlyCompleted, get().tasks, todayString())
    set((s) => ({
      // 이미 완료였던 항목의 completedAt은 건드리지 않는다 — 덮어쓰면 완료 이력이
      // 오늘로 밀려 통계의 '오늘 완료'와 14일 추이가 조용히 바뀐다.
      tasks: s.tasks.map((t) => (idSet.has(t.id) && !t.completed ? { ...t, completed: true, completedAt: now } : t)),
      batchSelectedIds: [],
      batchMode: false
    }))
    persist('batchUpdateTasks', () => window.api.batchUpdateTasks(newlyCompletedIds, { completed: true }))
    // 스폰에 넘긴 미래 회차를 완료본에서 뺀다. 단건 완료가 하던 정리인데 여기만
    // 빠져 있어서, 옮겨둔 회차가 있는 시리즈를 일괄 완료하면 그 날짜에 같은 블록이
    // 둘 겹쳤다(완료본 하나 + 새 인스턴스 하나). 일괄 완료를 되풀이할수록 늘어났다.
    // 넘긴 키가 없으면 overridesAfterHandover가 undefined를 주고 쓰기도 건너뛴다 —
    // 평범한 일괄 완료의 스토어 쓰기 횟수는 그대로다.
    for (const { source, spawn } of plans) {
      const left = overridesAfterHandover(source, spawn)
      if (left !== undefined) get().updateTask({ id: source.id, scheduledOverrides: left })
    }
    await get().addTasks(plans.map(({ spawn }) => ({ title: spawn.title, opts: spawn })))
    await get().addScores(
      newlyCompleted.map((t) => ({ type: 'taskComplete', points: pointsForTask(t.priority), taskId: t.id }))
    )
  },
  batchDelete: async () => {
    const ids = get().batchSelectedIds
    const now = new Date().toISOString()
    const allTasks = get().tasks
    // 자손 전부 — 직계만 실으면 손자가 살아 남는다(main의 `batchUpdateTasks`도 같은 집합을 내린다).
    const subtaskIds = ids.flatMap((id) => descendantIds(allTasks, id))
    const allDeletedIds = [...new Set([...ids, ...subtaskIds])]
    const deletedTasks = allTasks.filter((t) => allDeletedIds.includes(t.id))
    // 삭제 전 undo 스택에 ID 목록 저장 — 되돌릴 때 id마다 main에 묻고, main이 되살렸다고
    // 답한 것만 휴지통에서 옮긴다.
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
    persist('batchUpdateTasks', () => window.api.batchUpdateTasks(allDeletedIds, { deleted: true }))
  },
  batchMove: async (listId) => {
    const ids = get().batchSelectedIds
    set((s) => ({
      tasks: s.tasks.map((t) => (ids.includes(t.id) ? { ...t, listId } : t)),
      batchSelectedIds: [],
      batchMode: false
    }))
    persist('batchUpdateTasks', () => window.api.batchUpdateTasks(ids, { listId }))
  },
  batchSetPriority: async (priority) => {
    const ids = get().batchSelectedIds
    set((s) => ({
      tasks: s.tasks.map((t) => (ids.includes(t.id) ? { ...t, priority } : t)),
      batchSelectedIds: []
    }))
    persist('batchUpdateTasks', () => window.api.batchUpdateTasks(ids, { priority }))
  },

  // === 정렬 ===
  setSortBy: (sort) => set({ sortBy: sort }),
  setSortDir: (dir) => set({ sortDir: dir }),

  // === 뷰 ===
  setViewType: (type) => set({ viewType: type, selectedTaskId: null }),
  // 검색은 화면을 좁히는데 일괄 선택은 그대로 남아 있었다. '전체 선택' 뒤에 검색어를
  // 치면 BatchBar는 가려진 것까지 그대로 들고 있어서, 그 상태의 일괄 삭제/완료/이동이
  // 화면에 없는 할일을 통째로 처리했다(보이는 건 한 줄인데 스물한 개가 휴지통으로 갔다).
  // 좁힐 때마다 선택도 같이 줄여, BatchBar의 개수가 언제나 화면에 보이는 것과 같게 만든다.
  // 리스트를 바꿀 때 setSelectedList가 일괄 상태를 통째로 비우는 것과 같은 이유다.
  // getFilteredTaskIds의 검색 필터는 '검색 → 전체 선택' 한쪽 순서만 막는다 — 반대 순서는
  // 여기서만 막을 수 있다.
  // 거르는 잣대는 getFilteredTaskIds가 아니라 matchesSearch다. 전자는 '전체 선택' 대상
  // (= 미완료)만 돌려주는데 뷰는 완료한 것도 '완료 N' 묶음으로 계속 그리고 거기서도
  // 체크가 된다 — 그걸로 거르면 검색어와 무관하게, 화면에 멀쩡히 보이는 완료 항목의
  // 체크가 타이핑 한 번에 조용히 풀린다. 여기서 바뀌는 건 검색어뿐이니 검색어로만 판단한다.
  // 일괄 모드가 아닐 때는 걸러내지 않는다 — 선택이 비어 있는 게 불변식이고, 타이핑마다
  // 전체 태스크를 훑을 이유도 없다.
  setSearchQuery: (query) =>
    set((s) => {
      if (!s.batchMode || s.batchSelectedIds.length === 0) return { searchQuery: query }
      const visible = new Set(s.tasks.filter((t) => matchesSearch(t, query)).map((t) => t.id))
      return { searchQuery: query, batchSelectedIds: s.batchSelectedIds.filter((id) => visible.has(id)) }
    }),
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
      const { task } = readDeletedTaskUndo(action.data)
      // IPC는 부모 id 하나이고, 무엇이 올라왔는지는 main의 답을 그대로 옮긴다.
      // 페이로드의 자손 목록으로 옮기면 안 된다: 그 사이 휴지통에서 자손 하나를 복원해
      // 부모가 이미 살아 있으면, 남은 자손을 main이 올리는지는 main만 안다.
      await restoreOnMain(task.id)
    } else if (action.type === 'deleteTasks') {
      const ids = action.data as string[]
      // 하나씩 main에 묻는다. 뿌리가 먼저 올라오면 그 아래 행의 답은 빈 목록이고,
      // 자식이 먼저 실려 조상을 끌어올렸으면 뿌리의 답이 남은 자손이다 — 합이 전부다.
      await Promise.all(ids.map((id) => restoreOnMain(id)))
    }
  },

  // === 습관 ===
  addHabit: async (name, color, frequency, targetDays) => {
    const id = uuid()
    const now = new Date().toISOString()
    const newHabit: Habit = { id, name, color, frequency, targetDays, createdAt: now }
    set((s) => ({ habits: [...s.habits, newHabit] }))
    persist('createHabit', () => window.api.createHabit(id, name, color, frequency, targetDays))
  },
  removeHabit: async (id) => {
    set((s) => ({
      habits: s.habits.filter((h) => h.id !== id),
      habitLogs: s.habitLogs.filter((l) => l.habitId !== id)
    }))
    persist('deleteHabit', () => window.api.deleteHabit(id))
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
    persist('toggleHabitLog', () => window.api.toggleHabitLog(id, habitId, date))
  },

  // === 포모도로 ===
  savePomodoroSession: async (session) => {
    const id = uuid()
    const fullSession: PomodoroSession = { ...session, id }
    set((s) => ({ pomodoroSessions: [...s.pomodoroSessions, fullSession] }))
    persist('savePomodoroSession', () => window.api.savePomodoroSession({ ...session, id }))

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
        events: [...s.score.events, { type, points: applied, date, taskId }].slice(-200),
        // 원장은 자르지 않는다 — 회수액의 단일 출처다.
        taskNet: applyToLedger(s.score.taskNet, taskId, applied)
      }
    }))
    persist('addScoreEvent', () => window.api.addScoreEvent({ type, points: applied, date, taskId }))
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
    set((s) => ({
      score: {
        total,
        events: [...s.score.events, ...applied].slice(-200),
        taskNet: applied.reduce((ledger, e) => applyToLedger(ledger, e.taskId, e.points), s.score.taskNet)
      }
    }))
    persist('addScoreEvents', () => window.api.addScoreEvents(applied))
  },

  // 이 태스크에 지금까지 순수하게 지급된 점수. 완료를 취소할 때 '현재 우선순위'로
  // 다시 계산하면, 완료 후 우선순위를 바꾼 경우 준 것보다 적게/많이 회수돼 총점이 흘렀다.
  //
  // **원장에서 읽는다.** 예전에는 `score.events`를 훑었는데 그 배열이 200개로
  // 잘리므로, 완료 뒤 다른 점수 이벤트가 200건 쌓이면 회수액이 0이 됐다 —
  // 지급만 되고 회수는 안 되는 순증이 같은 할일로 무한히 반복 가능했다.
  _netScoreFor: (taskId) => get().score.taskNet[taskId] ?? 0,

  // === 첨부파일 ===
  pickAttachment: async () => {
    return (await window.api.pickAttachment()) as { name: string; path: string }[]
  },

  // === 내보내기 ===
  exportData: async () => {
    // **거절을 여기서 잡는다.** 읽기 실패 세션에서 main이 이제 거절하고
    // (`database.ts`의 `DB_READ_ONLY` — 빈 백업으로 사용자의 진짜 백업을 덮지
    // 않기 위해서다), 저장 경로가 읽기 전용이면 `writeFileSync`도 던진다.
    // 세 호출처가 전부 반환값을 버리므로, 잡지 않으면 처리되지 않은 거절이 된다.
    //
    // 사용자에게 보이는 실패 문구는 아직 없다(M9). 여기서는 `false`를 정직하게
    // 돌려주는 것까지 한다 — 호출처가 그것을 그릴 준비가 되면 바로 쓰인다.
    try {
      return (await window.api.exportData()) as boolean
    } catch (error) {
      report('exportData', error)
      return false
    }
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
    persist('aiPullModel', () => window.api.aiPullModel?.(model))
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

  // **대화가 디스크로 가는 단 하나의 경로.** 예전에는 이 잘라-저장하기가
  // `aiSendMessage`의 done/error 핸들러 안에만 복사돼 있어서, 액션 카드로만 오간
  // 대화(요청·확인·취소·"못 찾았다")는 통째로 저장되지 않았다. 앱을 끄면
  // `aiLoadHistory()`가 그 이전 대화를 되살려, 사용자에게는 완료·삭제된 할일만
  // 남고 시켰다는 기록은 사라진 화면이 남는다 — 할일 변경은 `toggleTask`/`removeTask`가
  // 따로 저장하므로, 왜 그렇게 됐는지 되짚을 근거만 없어진다.
  //
  // 자르기(cap)도 여기 한 곳에만 둔다. 저장본과 화면의 길이가 갈리면 재시작할 때
  // 화면이 소리 없이 짧아진다. `trimHistory`는 cap 이하면 같은 배열을 돌려주므로,
  // 참조가 그대로면 set을 건너뛴다(구독자 헛재렌더 방지).
  _aiPersistHistory: () => {
    const { aiMessages, aiConfig } = get()
    const trimmed = trimHistory(aiMessages, aiConfig?.maxHistoryMessages ?? 200)
    if (trimmed !== aiMessages) set({ aiMessages: trimmed })
    persist('aiSaveHistory', () => window.api.aiSaveHistory(trimmed))
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

    // **이 요청의 id — '버려진 스트림 섞임'을 막는 가드다.**
    // 리스너를 떼는 것만으로는 스트림이 멈추지 않는다. main의 `streamChat`은 끝까지
    // 돌고, `ai:stream-*`는 창에 채널이 하나뿐인 브로드캐스트다. 그리고 그 겹침을
    // 여는 문은 정확히 하나다 — `setShowAiChat(false)`가 답변 도중 리스너를 걷으면서
    // `aiLoading:false`로 되돌려 입력칸을 다시 열어 준다(패널이 열려 있는 동안에는
    // AiChatPanel이 `aiLoading`으로 전송을 막는다). 그래서 답변 중에 패널을 닫았다
    // 열고 다시 물으면, 버려진 스트림 A와 새 스트림 B가 같은 채널에 함께 쏟아졌다:
    // A의 잔여 토큰이 B의 답변 말머리에 붙고, A의 done이 B의 리스너를 통째로 걷어
    // 가 B의 진짜 답변이 문장 중간에서 끊긴 채 히스토리에 저장됐다.
    // id가 다르면 남의 스트림이니 무시한다. 모르는 id도 '내 것이 아님'이 맞는
    // 판정이다 — main·preload는 같은 빌드로 나가므로 id 없는 이벤트는 없다.
    const requestId = uuid()

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

    const cleanupToken = window.api.onAiStreamToken?.((token: string, id: string) => {
      if (id !== requestId) return
      set((s) => ({
        aiMessages: s.aiMessages.map((m) => (m.id === assistantMsg.id ? { ...m, content: m.content + token } : m))
      }))
    })
    const cleanupDone = window.api.onAiStreamDone?.((id: string) => {
      if (id !== requestId) return
      set({ aiLoading: false })
      get()._aiPersistHistory()
      cleanup()
    })
    const cleanupError = window.api.onAiStreamError?.((error: string, id: string) => {
      if (id !== requestId) return
      const withError = get().aiMessages.map((m) =>
        m.id === assistantMsg.id ? { ...m, content: i18n.t('ai.error', { message: error }) } : m
      )
      set({ aiLoading: false, aiMessages: withError })
      get()._aiPersistHistory()
      cleanup()
    })

    set({ _aiStreamCleanup: cleanup })

    try {
      await window.api.aiStreamChat(message, tasks, history, requestId)
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
    persist('aiSaveHistory', () => window.api.aiSaveHistory([]))
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
    const pushAssistant = (content: string): void => {
      set((s) => ({
        aiMessages: [...s.aiMessages, { id: uuid(), role: 'assistant', content, timestamp: new Date().toISOString() }]
      }))
      get()._aiPersistHistory()
    }
    const userMsg: AiMessage = { id: uuid(), role: 'user', content: message, timestamp: new Date().toISOString() }
    set((s) => ({ aiMessages: [...s.aiMessages, userMsg], aiLoading: true, aiPendingAction: null }))
    // 해석이 성공하면 답이 아니라 확인 카드가 뜬다 — assistant 메시지가 없으므로
    // 카드를 띄운 채 앱을 끄면 이 발화만 사라진다. 여기서 한 번 적어 둔다.
    get()._aiPersistHistory()
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
    const pushAssistant = (content: string): void => {
      set((s) => ({
        aiMessages: [...s.aiMessages, { id: uuid(), role: 'assistant', content, timestamp: new Date().toISOString() }]
      }))
      get()._aiPersistHistory()
    }
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
    get()._aiPersistHistory()
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
