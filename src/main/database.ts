import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, writeFile, existsSync, mkdirSync, copyFileSync, realpathSync } from 'node:fs'
import path from 'node:path'

interface DbData {
  lists: Record<string, unknown>[]
  tasks: Record<string, unknown>[]
  habits: Record<string, unknown>[]
  habitLogs: Record<string, unknown>[]
  folders: Record<string, unknown>[]
  pomodoroSessions: Record<string, unknown>[]
  score: { total: number; events: Record<string, unknown>[] }
}

export function readHistoryFile(filePath: string): Record<string, unknown>[] {
  if (!existsSync(filePath)) return []
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'))
    return Array.isArray(raw?.messages) ? raw.messages : []
  } catch {
    return []
  }
}

export function writeHistoryFile(filePath: string, messages: Record<string, unknown>[]): void {
  writeFileSync(filePath, JSON.stringify({ version: 1, messages }, null, 2), 'utf-8')
}

export function getChatHistory(): Record<string, unknown>[] {
  if (!chatHistoryPath) return []
  return readHistoryFile(chatHistoryPath)
}

export function saveChatHistory(messages: Record<string, unknown>[]): void {
  if (!chatHistoryPath) return
  writeHistoryFile(chatHistoryPath, messages)
}

let data: DbData = {
  lists: [],
  tasks: [],
  habits: [],
  habitLogs: [],
  folders: [],
  pomodoroSessions: [],
  score: { total: 0, events: [] }
}
let dbPath: string
let attachmentsDir: string

/**
 * 데이터 파일을 못 읽었는가. **읽기 실패는 쓰기 금지로 이어져야 한다.**
 *
 * 예전에는 `load()`의 던짐이 그대로 부팅을 끊어서, 창도 IPC도 없었고 그래서
 * 파일이 덮어써질 수 없었다 — 우연한 보호였다. 그 던짐을 잡아 창을 띄우게
 * 바꾸면서 그 보호가 사라졌다: `dbPath`는 이미 사용자의 진짜 파일을 가리키고
 * `data`는 빈 기본값이라, 사용자가 뭐든 하나 건드리는 순간 `save()`가 그
 * 빈 값으로 원본을 덮어쓴다. 복구 가능한 고장이 영구 손실이 되는 것이다.
 */
let dbReadFailed = false

/** 데이터 파일을 못 읽어 쓰기가 막혀 있는가. 부팅이 사용자에게 알리는 데 쓴다. */
export function isDatabaseReadOnly(): boolean {
  return dbReadFailed
}

// 디바운스된 비동기 저장 (300ms 내 연속 변경은 한 번만 기록)
let saveTimer: ReturnType<typeof setTimeout> | null = null
let savePending = false

function save(): void {
  // 읽기에 실패한 세션에서는 절대 쓰지 않는다 — 위 `dbReadFailed` 주석 참고.
  //
  // **여기 한 곳이면 된다.** `flushSave()`는 `hadTimer || savePending`일 때만
  // 쓰는데 둘 다 이 함수만 세운다. 그쪽에도 같은 가드를 뒀다가 뺐다 —
  // 어느 한쪽만 지워도 다른 쪽이 덮어서 뮤테이션이 아무것도 못 잡았고,
  // 그건 시험할 수 없는 가드를 하나 늘린 것뿐이었다.
  if (dbReadFailed) return
  savePending = true
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    const json = JSON.stringify(data)
    writeFile(dbPath, json, 'utf-8', (err) => {
      if (err) console.error('DB 저장 실패:', err)
      else savePending = false
    })
  }, 300)
}

// 앱 종료 시 보류 중인 변경사항 동기 저장
function flushSave(): void {
  const hadTimer = saveTimer !== null
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (hadTimer || savePending) {
    savePending = false
    writeFileSync(dbPath, JSON.stringify(data), 'utf-8')
  }
}

function load(): DbData {
  if (existsSync(dbPath)) {
    const raw = JSON.parse(readFileSync(dbPath, 'utf-8'))
    return {
      lists: raw.lists || [],
      tasks: raw.tasks || [],
      habits: raw.habits || [],
      habitLogs: raw.habitLogs || [],
      folders: raw.folders || [],
      pomodoroSessions: raw.pomodoroSessions || [],
      score: raw.score || { total: 0, events: [] }
    }
  }
  return {
    lists: [],
    tasks: [],
    habits: [],
    habitLogs: [],
    folders: [],
    pomodoroSessions: [],
    score: { total: 0, events: [] }
  }
}

/**
 * 구버전 픽커는 요일을 하나도 고르지 않은 채 '매주'를 적용할 수 있었고, 그 행은
 * recurring_pattern='weekly:'로 남았다. 예전 파서는 빈 문자열을 Number('')=0으로
 * 읽어 매주 일요일로 굴렸지만, 지금 파서는 빈 목록이라 다음 회차를 계산하지 못한다
 * — 그대로 두면 업그레이드한 사용자의 시리즈가 아무 신호 없이 끝난다.
 * 마감일이 있으면 그 요일로 복구하고, 없으면 반복을 꺼서 화면에 드러낸다.
 */
/**
 * 진짜 달력에 있는 날짜인가. validate.ts와 같은 판정을 로드 경로에도 둔다 —
 * IPC 검증이 생기기 전 빌드나 손으로 고친 JSON에 '2026-02-30' 같은 값이 남아
 * 있으면, 그 할일을 복제·수정하는 순간 검증이 거부하고 렌더러는 그 거부를
 * 아무도 받지 않아 사용자의 조작이 조용히 사라진다.
 */
function isRealIsoDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

function normalizeLegacyWeeklyPattern(t: Record<string, unknown>): void {
  if (t.recurring_pattern !== 'weekly:') return
  const due = typeof t.due_date === 'string' ? t.due_date : null
  if (due) {
    const [y, m, d] = due.split('-').map(Number)
    t.recurring_pattern = `weekly:${new Date(y, m - 1, d).getDay()}`
  } else {
    t.recurring_pattern = null
    t.is_recurring = 0
  }
}

export function initDatabase(): void {
  const userDataPath = app.getPath('userData')
  if (!existsSync(userDataPath)) mkdirSync(userDataPath, { recursive: true })
  dbPath = path.join(userDataPath, 'ticktick-data.json')
  aiConfigPath = path.join(userDataPath, 'ai-config.json')
  chatHistoryPath = path.join(userDataPath, 'ai-chat.json')
  calendarConfigPath = path.join(userDataPath, 'calendar-config.json')
  attachmentsDir = path.join(userDataPath, 'attachments')
  if (!existsSync(attachmentsDir)) mkdirSync(attachmentsDir, { recursive: true })
  try {
    data = load()
    dbReadFailed = false
  } catch (error) {
    // **원본을 먼저 옆으로 치운다.** 그래야 사용자에게 "덮어쓰지 않았다"고 말할 수
    // 있다 — 다이얼로그를 읽는 동안 백업하라고 부탁하는 것은 약속이 아니다.
    // 그 뒤 이 세션은 읽기 전용으로 간다(`save`/`flushSave`가 즉시 반환).
    dbReadFailed = true
    try {
      const aside = `${dbPath}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`
      copyFileSync(dbPath, aside)
      console.error(`[db] 읽기 실패 — 원본을 ${aside}로 복사했다`, error)
    } catch (copyError) {
      console.error('[db] 읽기 실패, 원본 복사도 실패', error, copyError)
    }
    throw error
  }

  // 기존 데이터 마이그레이션
  data.tasks.forEach((t) => {
    if (t.deleted_at === undefined) t.deleted_at = null
    if (t.due_time === undefined) t.due_time = null
    if (t.reminder_at === undefined) t.reminder_at = null
    if (t.attachments === undefined) t.attachments = '[]'
    if (t.scheduled_start === undefined) t.scheduled_start = null
    if (t.scheduled_end === undefined) t.scheduled_end = null
    if (t.scheduled_overrides === undefined) t.scheduled_overrides = null
    if (t.start_date === undefined) t.start_date = null
    if (t.pinned === undefined) t.pinned = 0
    for (const key of ['due_date', 'start_date']) {
      if (t[key] != null && !isRealIsoDate(t[key])) t[key] = null
    }
    // 기간의 불변식은 렌더러가 지키지만, 구버전으로 내려가 마감일을 지우면
    // 그 빌드의 updateTask는 start_date를 모르므로 끝 없는 시작일이 남는다.
    // 다시 올라와도 그 행을 건드리기 전에는 아무도 고치지 않으므로, 읽는 자리에서 정리한다.
    if (t.start_date && (typeof t.due_date !== 'string' || (t.start_date as string) > t.due_date)) {
      t.start_date = null
    }
    normalizeLegacyWeeklyPattern(t)
  })
  data.lists.forEach((l) => {
    if (l.folder_id === undefined) l.folder_id = null
  })

  // 기존 camelCase PomodoroSession 레코드를 snake_case로 일회 마이그레이션 (멱등)
  data.pomodoroSessions = data.pomodoroSessions.map((s) => {
    // task_id가 이미 있으면 이미 마이그레이션된 레코드
    if (s.task_id !== undefined) return s
    return {
      id: s.id,
      task_id: s.taskId ?? null,
      duration: s.duration,
      type: s.type,
      started_at: s.startedAt ?? null,
      completed_at: s.completedAt ?? null
    }
  })

  const inbox = data.lists.find((l) => l.id === 'inbox')
  if (!inbox) {
    data.lists.push({
      id: 'inbox',
      name: '기본함',
      color: '#4A90D9',
      icon: 'inbox',
      folder_id: null,
      sort_order: 0,
      created_at: new Date().toISOString()
    })
  } else if (inbox.name === '수신함') {
    // 시스템 리스트('inbox')는 UI에서 이름 편집이 불가하므로, 이전 기본 이름을
    // 새 이름으로 정규화한다 (사이드바 '기본함' 표기와 리스트 선택 드롭다운 일치).
    inbox.name = '기본함'
  }
  save()
}

// === Folders ===
export function getFolders(): unknown[] {
  return [...data.folders].sort((a, b) => ((a.sort_order as number) || 0) - ((b.sort_order as number) || 0))
}
export function createFolder(id: string, name: string): void {
  const max = data.folders.reduce((m, f) => Math.max(m, (f.sort_order as number) || 0), 0)
  data.folders.push({ id, name, collapsed: 0, sort_order: max + 1, created_at: new Date().toISOString() })
  save()
}
export function updateFolder(id: string, name: string, collapsed: boolean): void {
  const f = data.folders.find((f) => f.id === id)
  if (f) {
    f.name = name
    f.collapsed = collapsed ? 1 : 0
    save()
  }
}
export function deleteFolder(id: string): void {
  data.folders = data.folders.filter((f) => f.id !== id)
  data.lists.forEach((l) => {
    if (l.folder_id === id) l.folder_id = null
  })
  save()
}

// === Lists ===
export function getLists(): unknown[] {
  return [...data.lists].sort((a, b) => ((a.sort_order as number) || 0) - ((b.sort_order as number) || 0))
}
export function createList(id: string, name: string, color: string, icon: string, folderId: string | null): void {
  const max = data.lists.reduce((m, l) => Math.max(m, (l.sort_order as number) || 0), 0)
  data.lists.push({
    id,
    name,
    color,
    icon,
    folder_id: folderId,
    sort_order: max + 1,
    created_at: new Date().toISOString()
  })
  save()
}
export function updateList(id: string, updates: Record<string, unknown>): void {
  const list = data.lists.find((l) => l.id === id)
  if (!list) return
  const allowed = ['name', 'color', 'icon', 'folder_id', 'sort_order']
  for (const key of allowed) {
    if (Object.hasOwn(updates, key)) (list as Record<string, unknown>)[key] = updates[key]
  }
  save()
}
export function deleteList(id: string): void {
  if (id === 'inbox') return
  data.lists = data.lists.filter((l) => l.id !== id)
  data.tasks.forEach((t) => {
    if (t.list_id === id) t.list_id = 'inbox'
  })
  save()
}

// === Tasks ===
export function getTasks(): unknown[] {
  return [...data.tasks]
    .filter((t) => !t.deleted_at)
    .sort((a, b) => ((a.sort_order as number) || 0) - ((b.sort_order as number) || 0))
}
export function getTrashTasks(): unknown[] {
  return data.tasks.filter((t) => t.deleted_at)
}
export function createTask(task: Record<string, unknown>): void {
  // 렌더러가 자리를 정했으면 그 자리를 쓴다. 여기서 maxOrder+1로 다시 매기면
  // '복제본은 원본 바로 아래'처럼 렌더러가 계산한 중간값이 버려져, 화면에서는
  // 제자리에 있던 항목이 재시작 후 목록 맨 끝으로 튄다.
  const maxOrder = data.tasks
    .filter((t) => t.list_id === task.listId && !t.deleted_at)
    .reduce((m, t) => Math.max(m, (t.sort_order as number) || 0), 0)
  // Number.isFinite: NaN/Infinity가 sort_order에 앉으면 정렬이 조용히 무너진다.
  const sortOrder = Number.isFinite(task.sortOrder) ? (task.sortOrder as number) : maxOrder + 1
  data.tasks.push({
    id: task.id,
    title: task.title,
    description: task.description || '',
    completed: 0,
    priority: task.priority || 'none',
    due_date: task.dueDate || null,
    due_time: task.dueTime || null,
    start_date: task.startDate || null,
    reminder_at: task.reminderAt || null,
    pinned: task.pinned ? 1 : 0,
    list_id: task.listId || 'inbox',
    parent_id: task.parentId || null,
    tags: JSON.stringify(task.tags || []),
    attachments: JSON.stringify(task.attachments || []),
    created_at: new Date().toISOString(),
    completed_at: null,
    deleted_at: null,
    sort_order: sortOrder,
    is_recurring: task.isRecurring ? 1 : 0,
    recurring_pattern: task.recurringPattern || null,
    scheduled_start: task.scheduledStart || null,
    scheduled_end: task.scheduledEnd || null,
    scheduled_overrides: task.scheduledOverrides ? JSON.stringify(task.scheduledOverrides) : null
  })
  save()
}
/** JSON 저장소는 0/1로 적는다 — 불리언으로 새면 옛 레코드와 모양이 갈린다. */
const BOOLEAN_FIELDS = new Set(['isRecurring', 'pinned'])

export function updateTask(task: Record<string, unknown>): void {
  const existing = data.tasks.find((t) => t.id === task.id)
  if (!existing) return
  const fields: Record<string, string> = {
    title: 'title',
    description: 'description',
    priority: 'priority',
    dueDate: 'due_date',
    dueTime: 'due_time',
    startDate: 'start_date',
    reminderAt: 'reminder_at',
    pinned: 'pinned',
    listId: 'list_id',
    parentId: 'parent_id',
    isRecurring: 'is_recurring',
    recurringPattern: 'recurring_pattern',
    scheduledStart: 'scheduled_start',
    scheduledEnd: 'scheduled_end'
  }
  // 직렬화를 먼저 끝낸 뒤에 레코드를 건드린다. 순환 참조 등으로 JSON.stringify가
  // 중간에 던지면, 앞쪽 스칼라 필드만 바뀐 절반짜리 레코드가 메모리에 남고
  // 나중의 무관한 save()가 그 상태를 그대로 디스크에 적는다.
  const serialized: Record<string, string | null> = {}
  if (task.tags !== undefined) serialized.tags = JSON.stringify(task.tags)
  if (task.attachments !== undefined) serialized.attachments = JSON.stringify(task.attachments)
  if (task.scheduledOverrides !== undefined) {
    serialized.scheduled_overrides = task.scheduledOverrides === null ? null : JSON.stringify(task.scheduledOverrides)
  }

  for (const [key, col] of Object.entries(fields)) {
    if (task[key] !== undefined) {
      existing[col] = BOOLEAN_FIELDS.has(key) ? (task[key] ? 1 : 0) : task[key]
    }
  }
  for (const [col, value] of Object.entries(serialized)) existing[col] = value
  if (task.completed !== undefined) {
    existing.completed = task.completed ? 1 : 0
    existing.completed_at = task.completed ? new Date().toISOString() : null
  }
  if (task.sortOrder !== undefined) existing.sort_order = task.sortOrder
  save()
}
export function deleteTask(id: string): void {
  const now = new Date().toISOString()
  data.tasks.forEach((t) => {
    if (t.id === id || t.parent_id === id) t.deleted_at = now
  })
  save()
}
export function restoreTask(id: string): void {
  const task = data.tasks.find((t) => t.id === id)
  if (task) {
    task.deleted_at = null
    save()
  }
}
export function permanentDeleteTask(id: string): void {
  data.tasks = data.tasks.filter((t) => t.id !== id && t.parent_id !== id)
  save()
}
export function emptyTrash(): void {
  data.tasks = data.tasks.filter((t) => !t.deleted_at)
  save()
}
export function reorderTasks(orderedIds: string[]): void {
  // 렌더러의 applyReorder와 같은 규칙: 0..n-1로 새로 매기지 않고, 재배치 대상이
  // 이미 쥐고 있던 sort_order 슬롯만 새 순서대로 다시 나눠 준다. sort_order는
  // 리스트별 카운터라서 전역 재번호는 다른 리스트의 순서를 덮어쓴다.
  const moving = orderedIds.map((id) => data.tasks.find((t) => t.id === id)).filter((t) => t !== undefined)
  const slots = moving.map((t) => (t.sort_order as number) || 0).sort((a, b) => a - b)
  moving.forEach((t, i) => {
    t.sort_order = slots[i]
  })
  save()
}
export function batchUpdateTasks(ids: string[], updates: Record<string, unknown>): void {
  for (const id of ids) {
    const task = data.tasks.find((t) => t.id === id)
    if (!task) continue
    if (updates.completed !== undefined) {
      task.completed = updates.completed ? 1 : 0
      task.completed_at = updates.completed ? new Date().toISOString() : null
    }
    if (updates.listId !== undefined) task.list_id = updates.listId
    if (updates.priority !== undefined) task.priority = updates.priority
    if (updates.dueDate !== undefined) task.due_date = updates.dueDate
    if (updates.deleted !== undefined) task.deleted_at = updates.deleted ? new Date().toISOString() : null
  }
  save()
}

// === Habits ===
export function getHabits(): unknown[] {
  return [...data.habits].sort(
    (a, b) => new Date(a.created_at as string).getTime() - new Date(b.created_at as string).getTime()
  )
}
export function createHabit(id: string, name: string, color: string, frequency: string, targetDays: number[]): void {
  data.habits.push({
    id,
    name,
    color,
    frequency,
    target_days: JSON.stringify(targetDays),
    created_at: new Date().toISOString()
  })
  save()
}
export function deleteHabit(id: string): void {
  data.habits = data.habits.filter((h) => h.id !== id)
  data.habitLogs = data.habitLogs.filter((l) => l.habit_id !== id)
  save()
}
export function getHabitLogs(): unknown[] {
  return data.habitLogs
}
export function toggleHabitLog(id: string, habitId: string, date: string): void {
  const idx = data.habitLogs.findIndex((l) => l.habit_id === habitId && l.date === date)
  if (idx >= 0) data.habitLogs.splice(idx, 1)
  else data.habitLogs.push({ id, habit_id: habitId, date, completed: 1 })
  save()
}

// === Pomodoro Sessions ===
export function getPomodoroSessions(): unknown[] {
  return data.pomodoroSessions
}
export function savePomodoroSession(session: Record<string, unknown>): void {
  // 다른 엔티티와 동일하게 snake_case로 저장
  data.pomodoroSessions.push({
    id: session.id,
    task_id: session.taskId ?? null,
    duration: session.duration,
    type: session.type,
    started_at: session.startedAt ?? null,
    completed_at: session.completedAt ?? null
  })
  save()
}

// === Score ===

// 순수 헬퍼: events 배열을 최근 max개로 제한 (오래된 항목 제거, total은 별도 누적)
export function capEvents<T>(events: T[], max = 200): T[] {
  return events.length > max ? events.slice(events.length - max) : events
}

export function getScore(): unknown {
  return data.score
}
export function addScoreEvents(events: Record<string, unknown>[]): void {
  for (const event of events) {
    data.score.events.push(event)
    data.score.total = Math.max(0, data.score.total + (Number(event.points) || 0))
  }
  data.score.events = capEvents(data.score.events)
  save()
}
export function addScoreEvent(event: Record<string, unknown>): void {
  data.score.events.push(event)
  // 회수(음수) 이벤트가 들어올 수 있다. 총점은 0 아래로 내려가지 않게 막는다 —
  // 이 기능이 생기기 전 일괄 완료는 점수를 주지 않았으므로, 그때 완료한 항목을
  // 지금 취소하면 준 적 없는 점수를 회수해 음수로 흐를 수 있다.
  data.score.total = Math.max(0, data.score.total + (Number(event.points) || 0))
  // 상한 초과 시 가장 오래된 이벤트 제거 (write amplification 방지)
  data.score.events = capEvents(data.score.events)
  save()
}

// === Attachments ===
/**
 * 이 경로가 우리 첨부 폴더 **안**인가.
 *
 * `copyAttachment`가 쓰기 쪽에서 이미 같은 판정을 하고 있었는데, 읽기(여는) 쪽에는
 * 없었다. 그 비대칭이 문제다 — `shell.openPath`는 Finder에서 더블클릭하는 것과
 * 같아서 `.app`·`.command`·`.scpt`를 가리키면 **실행된다.**
 */
export function isInsideAttachments(candidate: string): boolean {
  // **심볼릭 링크까지 푼다.** `path.resolve`는 문자열 연산이라 첨부 폴더 안에
  // 놓인 심링크는 그대로 통과하고, `shell.openPath`가 그 링크가 가리키는 것을
  // 연다 — 이 검사가 막으려던 바로 그 실행 원시연산이 되돌아온다. 오늘 앱이
  // 심링크를 만들지는 않지만, 백업 복원이나 나중에 붙을 동기화가 만들 수 있다.
  //
  // realpath는 없는 경로에서 던진다. 그때는 어차피 열 것도 없으므로 닫는 쪽으로
  // 떨어진다(문자열 검사로 폴백하지 않는다 — 그러면 구멍이 그대로 남는다).
  try {
    const real = realpathSync(path.resolve(candidate))
    const root = realpathSync(attachmentsDir)
    return real.startsWith(root + path.sep)
  } catch {
    return false
  }
}

/**
 * 첨부를 폴더 안으로 복사한다.
 *
 * 판정이 `isInsideAttachments`와 **같지 않다.** 그쪽은 "이미 있는 것을 열어도
 * 되는가"라 존재하지 않으면 닫는 쪽으로 떨어지고, 이쪽은 "여기에 새로 써도
 * 되는가"라 존재하지 않는 것이 정상이다. 그래서 검사를 둘로 나눈다:
 *   - 이름은 `basename`으로 잘라 상위 이동을 없앤다(문자열 검사면 충분하다).
 *   - **이미 뭔가 있으면** realpath로 확인한다 — 그 자리에 바깥을 가리키는
 *     심링크가 놓여 있으면 `copyFileSync`가 그걸 따라가 폴더 밖에 쓴다.
 *     읽기 쪽에 심링크 방어를 넣으면서 이쪽을 "같은 판정"이라고 적어 뒀는데,
 *     같지 않았다.
 */
export function copyAttachment(sourcePath: string, destName: string): string {
  const safeName = path.basename(destName)
  const destPath = path.resolve(attachmentsDir, safeName)
  if (!destPath.startsWith(attachmentsDir + path.sep) && destPath !== attachmentsDir) {
    throw new Error('Path traversal blocked in copyAttachment')
  }
  if (existsSync(destPath) && !isInsideAttachments(destPath)) {
    throw new Error('Attachment destination escapes the attachments directory')
  }
  copyFileSync(sourcePath, destPath)
  return destPath
}

// === AI Config ===
let aiConfigPath: string
let chatHistoryPath: string
let calendarConfigPath: string

/** 캘린더 설정 파일 경로. initDatabase 전에는 빈 문자열. */
export function getCalendarConfigPath(): string {
  return calendarConfigPath ?? ''
}

export interface KeyCrypto {
  available(): boolean
  encrypt(s: string): string
  decrypt(b64: string): string
}

export const realCrypto: KeyCrypto = {
  available: () => {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  },
  encrypt: (s) => safeStorage.encryptString(s).toString('base64'),
  decrypt: (b64) => safeStorage.decryptString(Buffer.from(b64, 'base64'))
}

export function encodeApiKey(config: Record<string, unknown>, crypto: KeyCrypto): Record<string, unknown> {
  const out = { ...config }
  if (typeof out.apiKey === 'string' && out.apiKey && crypto.available()) {
    try {
      out.apiKey_enc = crypto.encrypt(out.apiKey)
      out.apiKey = null
    } catch {
      // 암호화 실패: 평문 키를 절대 저장하지 않는다. 기존 apiKey_enc가 있으면 그대로 보존됨.
      out.apiKey = null
    }
  }
  return out
}

export function decodeApiKey(raw: Record<string, unknown>, crypto: KeyCrypto): Record<string, unknown> {
  const out = { ...raw }
  if (typeof out.apiKey_enc === 'string' && out.apiKey_enc) {
    if (crypto.available()) {
      try {
        out.apiKey = crypto.decrypt(out.apiKey_enc)
      } catch {
        out.apiKey = null
      }
      // 복호화(또는 손상 확인)를 마친 경우에만 암호문 제거
      delete out.apiKey_enc
    }
    // crypto 불가 시: apiKey_enc 보존 → 이후 정상 세션에서 키 복구 가능
  }
  return out
}

export function getAiConfig(): Record<string, unknown> | null {
  if (!aiConfigPath) return null
  if (!existsSync(aiConfigPath)) return null
  try {
    return decodeApiKey(JSON.parse(readFileSync(aiConfigPath, 'utf-8')), realCrypto)
  } catch {
    return null
  }
}

export function saveAiConfig(config: Record<string, unknown>): void {
  if (!aiConfigPath) return
  try {
    writeFileSync(aiConfigPath, JSON.stringify(encodeApiKey(config, realCrypto), null, 2), 'utf-8')
  } catch (err) {
    console.error('AI config 저장 실패:', err)
  }
}

// === Export ===
export function exportData(): string {
  return JSON.stringify(data, null, 2)
}

export function closeDatabase(): void {
  flushSave()
}
