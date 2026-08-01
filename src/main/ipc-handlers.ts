import { ipcMain, dialog, Notification, globalShortcut, BrowserWindow, shell } from 'electron'
import { writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { v4 as uuid } from 'uuid'
import * as db from './database'
import * as ai from './ai-service'
import { validateTaskInput, validateTaskUpdate } from './validate'
import {
  readConfigFile,
  writeConfigFile,
  toPublicConfig,
  DEFAULT_CONFIG,
  type CalendarConfig
} from './calendar-config'
import { CalDavClient, CalDavError } from './caldav/client'
import { runSync } from './calendar-sync'
import type { TaskRow } from './caldav/sync'

function csvCell(value: unknown): string {
  const s = String(value ?? '')
  const escaped = s.replace(/"/g, '""')
  const safe = /^[=+\-@\t\r\n]/.test(escaped) ? `'${escaped}` : escaped
  return `"${safe}"`
}

async function safeOpenExternal(url: string): Promise<void> {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return
    await shell.openExternal(parsed.href)
  } catch {
    // 잘못된 URL 무시
  }
}

export function setupIpcHandlers(): void {
  // App meta — 렌더러가 Mac App Store(샌드박스) 빌드 여부를 알아 업데이트 UI 등을 분기.
  ipcMain.handle('app:is-mas', () => Boolean(process.mas))

  // Folders
  ipcMain.handle('get-folders', () => db.getFolders())
  ipcMain.handle('create-folder', (_, id, name) => db.createFolder(id, name))
  ipcMain.handle('update-folder', (_, id, name, collapsed) => db.updateFolder(id, name, collapsed))
  ipcMain.handle('delete-folder', (_, id) => db.deleteFolder(id))

  // Lists
  ipcMain.handle('get-lists', () => db.getLists())
  ipcMain.handle('create-list', (_, id, name, color, icon, folderId) => db.createList(id, name, color, icon, folderId))
  ipcMain.handle('update-list', (_, id, updates) => db.updateList(id, updates))
  ipcMain.handle('delete-list', (_, id) => db.deleteList(id))
  ipcMain.handle('reorder-lists', (_, ids) => db.reorderLists(ids))

  // Tasks
  ipcMain.handle('get-tasks', () => db.getTasks())
  ipcMain.handle('get-trash-tasks', () => db.getTrashTasks())
  ipcMain.handle('create-task', (_, task) => db.createTask(validateTaskInput(task)))
  ipcMain.handle('update-task', (_, task) => db.updateTask(validateTaskUpdate(task)))
  ipcMain.handle('delete-task', (_, id) => db.deleteTask(id))
  ipcMain.handle('restore-task', (_, id) => db.restoreTask(id))
  ipcMain.handle('permanent-delete-task', (_, id) => db.permanentDeleteTask(id))
  ipcMain.handle('empty-trash', () => db.emptyTrash())
  ipcMain.handle('reorder-tasks', (_, ids) => db.reorderTasks(ids))
  ipcMain.handle('batch-update-tasks', (_, ids, updates) => db.batchUpdateTasks(ids, updates))

  // Habits
  ipcMain.handle('get-habits', () => db.getHabits())
  ipcMain.handle('create-habit', (_, id, name, color, frequency, targetDays) =>
    db.createHabit(id, name, color, frequency, targetDays)
  )
  ipcMain.handle('delete-habit', (_, id) => db.deleteHabit(id))
  ipcMain.handle('get-habit-logs', () => db.getHabitLogs())
  ipcMain.handle('toggle-habit-log', (_, id, habitId, date) => db.toggleHabitLog(id, habitId, date))

  // Pomodoro
  ipcMain.handle('get-pomodoro-sessions', () => db.getPomodoroSessions())
  ipcMain.handle('save-pomodoro-session', (_, session) => db.savePomodoroSession(session))

  // Score
  ipcMain.handle('get-score', () => db.getScore())
  ipcMain.handle('add-score-event', (_, event) => db.addScoreEvent(event))

  // Attachments
  ipcMain.handle('pick-attachment', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '모든 파일', extensions: ['*'] },
        { name: '이미지', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
        { name: '문서', extensions: ['pdf', 'doc', 'docx', 'txt', 'md'] }
      ]
    })
    if (result.canceled) return []
    const attachments: { name: string; path: string }[] = []
    for (const filePath of result.filePaths) {
      const name = `${uuid()}-${basename(filePath)}`
      const destPath = db.copyAttachment(filePath, name)
      attachments.push({ name: basename(filePath), path: destPath })
    }
    return attachments
  })
  ipcMain.handle('get-attachments-dir', () => db.getAttachmentsDir())
  // 첨부파일 열기: 시스템 기본 앱으로 파일 경로를 엶
  ipcMain.handle('open-attachment', (_, filePath: string) => shell.openPath(String(filePath)))

  // Export
  ipcMain.handle('export-data', async () => {
    // Local date (not toISOString/UTC) so the filename matches the user's day —
    // toISOString lags a day for positive-UTC users in early-morning hours.
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const result = await dialog.showSaveDialog({
      defaultPath: `ticktick-backup-${today}.json`,
      filters: [
        { name: 'JSON', extensions: ['json'] },
        { name: 'CSV', extensions: ['csv'] }
      ]
    })
    if (result.canceled || !result.filePath) return false
    const ext = result.filePath.endsWith('.csv') ? 'csv' : 'json'
    const exportedData = db.exportData()
    if (ext === 'csv') {
      const parsed = JSON.parse(exportedData)
      const tasks = parsed.tasks || []
      const header = 'Title,Description,Priority,DueDate,List,Completed,CreatedAt\n'
      const rows = tasks
        .map((t: Record<string, unknown>) =>
          [t.title, t.description, t.priority, t.due_date || '', t.list_id, t.completed ? 'Yes' : 'No', t.created_at]
            .map(csvCell)
            .join(',')
        )
        .join('\n')
      writeFileSync(result.filePath, header + rows, 'utf-8')
    } else {
      writeFileSync(result.filePath, exportedData, 'utf-8')
    }
    return true
  })

  // Notifications
  ipcMain.handle('show-notification', (_, title, body) => {
    new Notification({ title, body }).show()
  })

  // 외부 링크 열기
  ipcMain.handle('open-external', (_, url: string) => {
    safeOpenExternal(url)
  })

  // AI
  ipcMain.handle('ai:check-connection', () => ai.checkConnection())
  ipcMain.handle('ai:warmup', () => ai.warmupModel())
  ipcMain.handle('ai:get-config', () => ai.getAiConfig())
  ipcMain.handle('ai:set-config', (_, updates) => ai.setAiConfig(updates))
  ipcMain.handle('ai:create-task', (_, input, tasks) => ai.createTaskFromNL(input, tasks))
  ipcMain.handle('ai:interpret-action', (_, message, tasks) => ai.interpretTaskAction(message, tasks))
  ipcMain.handle('ai:chat', (_, message, tasks) => ai.chat(message, tasks))
  ipcMain.handle('ai:stream-chat', (event, message, tasks, history) => {
    const sender = event.sender
    ai.streamChat(
      message,
      tasks,
      history ?? [],
      (token) => {
        if (!sender.isDestroyed()) sender.send('ai:stream-token', token)
      },
      () => {
        if (!sender.isDestroyed()) sender.send('ai:stream-done')
      },
      (error) => {
        if (!sender.isDestroyed()) sender.send('ai:stream-error', error)
      }
    )
  })
  ipcMain.handle('ai:get-history', () => db.getChatHistory())
  ipcMain.handle('ai:save-history', (_, messages) => db.saveChatHistory(messages))
  ipcMain.handle('ai:pull-model', (event, model) => {
    const sender = event.sender
    ai.pullModel(
      String(model ?? ''),
      (progress) => {
        if (!sender.isDestroyed()) sender.send('ai:pull-progress', progress)
      },
      () => {
        if (!sender.isDestroyed()) sender.send('ai:pull-done')
      },
      (error) => {
        if (!sender.isDestroyed()) sender.send('ai:pull-error', error)
      }
    )
  })

  // === 캘린더 연동 (CalDAV) ===
  // 설정은 파일에 두고, 비밀번호만 safeStorage로 암호화한다. 렌더러에는 절대 넘기지 않는다.
  const loadCalendarConfig = (): CalendarConfig =>
    readConfigFile(db.getCalendarConfigPath(), db.realCrypto)
  const storeCalendarConfig = (config: CalendarConfig): void =>
    writeConfigFile(db.getCalendarConfigPath(), config, db.realCrypto)

  // CalDAV 오류는 사용자에게 그대로 보여줄 수 있게 다듬어져 있다. 그 외 예외는
  // 내부 정보가 새지 않도록 일반 문구로 바꾼다.
  const describeError = (error: unknown): string =>
    error instanceof CalDavError ? error.message : '알 수 없는 오류가 발생했습니다.'

  ipcMain.handle('calendar:get-config', () => toPublicConfig(loadCalendarConfig()))

  ipcMain.handle(
    'calendar:save-credentials',
    (_, input: { serverUrl?: string; username?: string; password?: string }) => {
      const config = loadCalendarConfig()
      const next: CalendarConfig = {
        ...config,
        serverUrl: String(input?.serverUrl || config.serverUrl || DEFAULT_CONFIG.serverUrl),
        username: String(input?.username ?? config.username),
        // 빈 문자열이 오면 기존 비밀번호를 유지한다 — UI가 값을 되채우지 않기 때문에
        // 사용자가 다른 항목만 고칠 때 비밀번호가 지워지면 안 된다.
        password: input?.password ? String(input.password) : config.password,
        lastError: null
      }
      storeCalendarConfig(next)
      return toPublicConfig(next)
    }
  )

  ipcMain.handle('calendar:test-connection', async () => {
    const config = loadCalendarConfig()
    if (!config.username || !config.password) {
      return { ok: false, message: '계정과 앱 암호를 먼저 입력하세요.', calendars: [] }
    }
    try {
      const client = new CalDavClient({
        serverUrl: config.serverUrl,
        username: config.username,
        password: config.password
      })
      const calendars = await client.discoverCalendars()
      storeCalendarConfig({ ...config, lastError: null })
      // 일정을 담을 수 없는 컬렉션(미리알림 등)은 고를 수 없게 미리 걸러 보낸다.
      return { ok: true, message: null, calendars: calendars.filter((c) => c.supportsEvents) }
    } catch (error) {
      const message = describeError(error)
      storeCalendarConfig({ ...config, lastError: message })
      return { ok: false, message, calendars: [] }
    }
  })

  ipcMain.handle('calendar:select', (_, url: string, name: string) => {
    const config = loadCalendarConfig()
    // 다른 캘린더로 옮기면 이전 캘린더의 동기화 상태는 의미가 없다. 남겨 두면 새
    // 캘린더에서 존재하지 않는 리소스를 갱신하려다 매번 실패한다.
    const changed = config.calendarUrl !== url
    const next: CalendarConfig = {
      ...config,
      calendarUrl: String(url),
      calendarName: String(name),
      enabled: true,
      syncState: changed ? {} : config.syncState
    }
    storeCalendarConfig(next)
    return toPublicConfig(next)
  })

  ipcMain.handle('calendar:set-enabled', (_, enabled: boolean) => {
    const next = { ...loadCalendarConfig(), enabled: Boolean(enabled) }
    storeCalendarConfig(next)
    return toPublicConfig(next)
  })

  ipcMain.handle('calendar:sync-now', async () => {
    const config = loadCalendarConfig()
    if (!config.username || !config.password || !config.calendarUrl) {
      return { ok: false, message: '연동 설정을 먼저 마치세요.', result: null }
    }
    try {
      const result = await runSync({
        credentials: {
          serverUrl: config.serverUrl,
          username: config.username,
          password: config.password
        },
        calendarUrl: config.calendarUrl,
        tasks: db.getTasks() as unknown as TaskRow[],
        state: config.syncState,
        now: new Date().toISOString()
      })
      storeCalendarConfig({
        ...config,
        syncState: result.state,
        lastSyncAt: new Date().toISOString(),
        lastError: null
      })
      const { state, ...summary } = result
      return { ok: true, message: null, result: summary }
    } catch (error) {
      const message = describeError(error)
      storeCalendarConfig({ ...config, lastError: message })
      return { ok: false, message, result: null }
    }
  })

  ipcMain.handle('calendar:disconnect', () => {
    // 자격증명과 동기화 상태를 모두 버린다. 서버의 일정은 건드리지 않는다 —
    // 연동 해제가 사용자의 캘린더를 비우는 동작이면 되돌릴 방법이 없다.
    storeCalendarConfig({ ...DEFAULT_CONFIG })
    return toPublicConfig(DEFAULT_CONFIG)
  })

  // Quick add (global shortcut)
  ipcMain.handle('register-global-shortcut', () => {
    // MAS 샌드박스에서는 시스템 전역 단축키를 등록할 수 없어 조용히 실패 → no-op
    if (process.mas) return false
    try {
      globalShortcut.register('CommandOrControl+Shift+A', () => {
        const wins = BrowserWindow.getAllWindows()
        if (wins.length > 0) {
          const win = wins[0]
          if (win.isMinimized()) win.restore()
          win.focus()
          win.webContents.send('global-quick-add')
        }
      })
      return true
    } catch {
      return false
    }
  })
}
