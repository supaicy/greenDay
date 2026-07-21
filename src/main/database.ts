import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, writeFile, existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs'
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

// 디바운스된 비동기 저장 (300ms 내 연속 변경은 한 번만 기록)
let saveTimer: ReturnType<typeof setTimeout> | null = null
let savePending = false

function save(): void {
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

export function initDatabase(): void {
  const userDataPath = app.getPath('userData')
  if (!existsSync(userDataPath)) mkdirSync(userDataPath, { recursive: true })
  dbPath = path.join(userDataPath, 'ticktick-data.json')
  aiConfigPath = path.join(userDataPath, 'ai-config.json')
  chatHistoryPath = path.join(userDataPath, 'ai-chat.json')
  attachmentsDir = path.join(userDataPath, 'attachments')
  if (!existsSync(attachmentsDir)) mkdirSync(attachmentsDir, { recursive: true })
  data = load()

  // 기존 데이터 마이그레이션
  data.tasks.forEach((t) => {
    if (t.deleted_at === undefined) t.deleted_at = null
    if (t.due_time === undefined) t.due_time = null
    if (t.reminder_at === undefined) t.reminder_at = null
    if (t.attachments === undefined) t.attachments = '[]'
    if (t.scheduled_start === undefined) t.scheduled_start = null
    if (t.scheduled_end === undefined) t.scheduled_end = null
  })
  data.lists.forEach((l) => {
    if (l.folder_id === undefined) l.folder_id = null
  })

  if (!data.lists.find((l) => l.id === 'inbox')) {
    data.lists.push({
      id: 'inbox',
      name: '수신함',
      color: '#4A90D9',
      icon: 'inbox',
      folder_id: null,
      sort_order: 0,
      created_at: new Date().toISOString()
    })
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
export function reorderLists(orderedIds: string[]): void {
  orderedIds.forEach((id, i) => {
    const l = data.lists.find((l) => l.id === id)
    if (l) l.sort_order = i
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
  const maxOrder = data.tasks
    .filter((t) => t.list_id === task.listId && !t.deleted_at)
    .reduce((m, t) => Math.max(m, (t.sort_order as number) || 0), 0)
  data.tasks.push({
    id: task.id,
    title: task.title,
    description: task.description || '',
    completed: 0,
    priority: task.priority || 'none',
    due_date: task.dueDate || null,
    due_time: task.dueTime || null,
    reminder_at: task.reminderAt || null,
    list_id: task.listId || 'inbox',
    parent_id: task.parentId || null,
    tags: JSON.stringify(task.tags || []),
    attachments: JSON.stringify(task.attachments || []),
    created_at: new Date().toISOString(),
    completed_at: null,
    deleted_at: null,
    sort_order: maxOrder + 1,
    is_recurring: task.isRecurring ? 1 : 0,
    recurring_pattern: task.recurringPattern || null,
    scheduled_start: task.scheduledStart || null,
    scheduled_end: task.scheduledEnd || null
  })
  save()
}
export function updateTask(task: Record<string, unknown>): void {
  const existing = data.tasks.find((t) => t.id === task.id)
  if (!existing) return
  const fields: Record<string, string> = {
    title: 'title',
    description: 'description',
    priority: 'priority',
    dueDate: 'due_date',
    dueTime: 'due_time',
    reminderAt: 'reminder_at',
    listId: 'list_id',
    parentId: 'parent_id',
    isRecurring: 'is_recurring',
    recurringPattern: 'recurring_pattern',
    scheduledStart: 'scheduled_start',
    scheduledEnd: 'scheduled_end'
  }
  for (const [key, col] of Object.entries(fields)) {
    if (task[key] !== undefined) {
      existing[col] = key === 'isRecurring' ? (task[key] ? 1 : 0) : task[key]
    }
  }
  if (task.tags !== undefined) existing.tags = JSON.stringify(task.tags)
  if (task.attachments !== undefined) existing.attachments = JSON.stringify(task.attachments)
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
  orderedIds.forEach((id, i) => {
    const t = data.tasks.find((t) => t.id === id)
    if (t) t.sort_order = i
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
  data.pomodoroSessions.push(session)
  save()
}

// === Score ===
export function getScore(): unknown {
  return data.score
}
export function addScoreEvent(event: Record<string, unknown>): void {
  data.score.events.push(event)
  data.score.total += (event.points as number) || 0
  save()
}

// === Attachments ===
export function getAttachmentsDir(): string {
  return attachmentsDir
}
export function copyAttachment(sourcePath: string, destName: string): string {
  const safeName = path.basename(destName)
  const destPath = path.resolve(attachmentsDir, safeName)
  if (!destPath.startsWith(attachmentsDir + path.sep) && destPath !== attachmentsDir) {
    throw new Error('Path traversal blocked in copyAttachment')
  }
  copyFileSync(sourcePath, destPath)
  return destPath
}
export function listAttachmentFiles(): string[] {
  return existsSync(attachmentsDir) ? readdirSync(attachmentsDir) : []
}

// === AI Config ===
let aiConfigPath: string
let chatHistoryPath: string

export interface KeyCrypto {
  available(): boolean
  encrypt(s: string): string
  decrypt(b64: string): string
}

const realCrypto: KeyCrypto = {
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
    out.apiKey_enc = crypto.encrypt(out.apiKey)
    out.apiKey = null
  }
  return out
}

export function decodeApiKey(raw: Record<string, unknown>, crypto: KeyCrypto): Record<string, unknown> {
  const out = { ...raw }
  if (typeof out.apiKey_enc === 'string' && out.apiKey_enc && crypto.available()) {
    try {
      out.apiKey = crypto.decrypt(out.apiKey_enc)
    } catch {
      out.apiKey = null
    }
  }
  delete out.apiKey_enc
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
  writeFileSync(aiConfigPath, JSON.stringify(encodeApiKey(config, realCrypto), null, 2), 'utf-8')
}

// === Export ===
export function exportData(): string {
  return JSON.stringify(data, null, 2)
}

export function closeDatabase(): void {
  flushSave()
}
