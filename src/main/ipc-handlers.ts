import { ipcMain, dialog, Notification, globalShortcut, BrowserWindow, shell } from 'electron'
import { writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { v4 as uuid } from 'uuid'
import * as db from './database'
import * as ai from './ai-service'
import { validateTaskInput, validateTaskUpdate } from './validate'
import { readConfigFile, writeConfigFile, toPublicConfig, DEFAULT_CONFIG, type CalendarConfig } from './calendar-config'
import { CalDavClient, CalDavError } from './caldav/client'
import { runSync } from './calendar-sync'
import type { TaskRow } from './caldav/sync'
import {
  readGoogleConfig,
  writeGoogleConfig,
  toPublicGoogleConfig,
  DEFAULT_GOOGLE_CONFIG,
  type GoogleConfig
} from './google-config'
import { GoogleCalendarClient, GoogleApiError } from './google/calendar'
import { needsRefresh, refreshTokens, revokeToken, OAuthError } from './google/oauth'
import { startGoogleAuth } from './google-auth-flow'
import { runGoogleSync } from './google-sync'
import { uiStrings } from './ui-language'
import { currentCapabilities } from './capabilities'
import { toLocalDateString } from '../shared/date'

// 빌드 때 주입되는 구글 OAuth 클라이언트 ID. 데스크톱 앱은 공개 클라이언트이므로
// 이 값은 비밀이 아니다 — 인가 코드 가로채기는 PKCE가 막는다.
declare const __GOOGLE_CLIENT_ID__: string
const BUILTIN_GOOGLE_CLIENT_ID = typeof __GOOGLE_CLIENT_ID__ === 'string' ? __GOOGLE_CLIENT_ID__ : ''

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
  // App meta — 이 빌드가 무엇을 할 수 있는지. 렌더러는 process.mas 같은 사실이 아니라
  // "자체 업데이트를 하는가" 같은 결론만 받는다 (shared/capabilities.ts).
  ipcMain.handle('app:capabilities', () => currentCapabilities())

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
  ipcMain.handle('add-score-events', (_, events) => db.addScoreEvents(events))

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
  // 첨부파일 열기: 시스템 기본 앱으로 파일 경로를 엶
  ipcMain.handle('open-attachment', (_, filePath: string) => shell.openPath(String(filePath)))

  // Export
  ipcMain.handle('export-data', async () => {
    // 파일명은 로컬 날짜 — UTC면 새벽에 하루 전 날짜가 박힌다.
    const today = toLocalDateString(new Date())
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
      // JSON 백업은 휴지통까지 전부 담지만(복원 목적), CSV는 스프레드시트로 바로 열어
      // 읽는 목록이다. 삭제 여부 열이 없는데 휴지통 항목을 섞으면 살아있는 할일과
      // 구분할 수 없어 잘못된 목록이 된다 — CSV에서는 제외한다.
      const tasks = ((parsed.tasks || []) as Record<string, unknown>[]).filter((t) => !t.deleted_at)
      const header = 'Title,Description,Priority,StartDate,DueDate,List,Completed,CreatedAt\n'
      const rows = tasks
        .map((t: Record<string, unknown>) =>
          [
            t.title,
            t.description,
            t.priority,
            t.start_date || '',
            t.due_date || '',
            t.list_id,
            t.completed ? 'Yes' : 'No',
            t.created_at
          ]
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

  // Notifications — 리마인더가 조용히 사라지지 않도록 렌더러가 권한 상태를 물어볼 수 있게 한다.
  // macOS는 앱이 처음 알림을 띄울 때 권한을 묻고, 그 첫 알림은 보통 사라진다(2026-08-05 검증).
  // 'unsupported'면 시스템이 알림 자체를 못 띄우는 상태다.
  ipcMain.handle('app:notification-permission', () => (Notification.isSupported() ? 'supported' : 'unsupported'))

  // 권한 프롬프트를 사용자가 원하는 시점에 띄우기 위한 조용한 알림.
  ipcMain.handle('app:request-notification-permission', () => {
    if (!Notification.isSupported()) return false
    const strings = uiStrings()
    new Notification({ title: strings.permProbeTitle, body: strings.permProbeBody }).show()
    return true
  })

  // macOS 알림 설정 화면 열기 — 차단 상태를 사용자가 직접 풀 수 있는 유일한 경로다.
  ipcMain.handle('app:open-notification-settings', () =>
    shell.openExternal('x-apple.systempreferences:com.apple.Notifications-Settings.extension')
  )

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
  const loadCalendarConfig = (): CalendarConfig => readConfigFile(db.getCalendarConfigPath(), db.realCrypto)
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

  // === 구글 캘린더 연동 ===
  const googleConfigPath = (): string =>
    db.getCalendarConfigPath().replace(/calendar-config\.json$/, 'google-config.json')
  const loadGoogle = (): GoogleConfig => readGoogleConfig(googleConfigPath(), db.realCrypto)
  const storeGoogle = (config: GoogleConfig): void => writeGoogleConfig(googleConfigPath(), config, db.realCrypto)

  const describeGoogleError = (error: unknown): string =>
    error instanceof GoogleApiError || error instanceof OAuthError ? error.message : '알 수 없는 오류가 발생했습니다.'

  const resolveClientId = (): string => BUILTIN_GOOGLE_CLIENT_ID || String(process.env.GOOGLE_OAUTH_CLIENT_ID ?? '')

  /**
   * 유효한 액세스 토큰을 확보한다. 만료가 가까우면 미리 갱신하고 갱신 결과를 저장한다.
   * 갱신에 실패하면 토큰을 버린다 — 죽은 토큰을 들고 계속 시도해 봐야 소용없고,
   * 사용자에게 재연결이 필요하다는 신호를 줘야 한다.
   */
  const ensureGoogleToken = async (config: GoogleConfig): Promise<GoogleConfig> => {
    if (!config.tokens) throw new OAuthError('not_connected', '구글 계정이 연결되어 있지 않습니다.')
    if (!needsRefresh(config.tokens, new Date().toISOString())) return config
    if (!config.tokens.refreshToken) {
      throw new OAuthError('no_refresh_token', '구글 연결이 만료되었습니다. 다시 연결해 주세요.')
    }
    try {
      const tokens = await refreshTokens(
        {
          clientId: resolveClientId(),
          refreshToken: config.tokens.refreshToken,
          now: new Date().toISOString()
        },
        (url, init) => fetch(url, init)
      )
      const next = { ...config, tokens }
      storeGoogle(next)
      return next
    } catch (error) {
      storeGoogle({ ...config, tokens: null, lastError: describeGoogleError(error) })
      throw error
    }
  }

  ipcMain.handle('google:get-config', () => ({
    ...toPublicGoogleConfig(loadGoogle()),
    clientIdConfigured: Boolean(resolveClientId())
  }))

  ipcMain.handle('google:connect', async () => {
    const clientId = resolveClientId()
    if (!clientId) {
      return {
        ok: false,
        message: '구글 OAuth 클라이언트 ID가 설정되지 않았습니다. 빌드 설정을 확인하세요.'
      }
    }
    const config = loadGoogle()
    try {
      const tokens = await startGoogleAuth(clientId)
      storeGoogle({ ...config, tokens, lastError: null })
      return { ok: true, message: null }
    } catch (error) {
      const message = describeGoogleError(error)
      storeGoogle({ ...config, lastError: message })
      return { ok: false, message }
    }
  })

  ipcMain.handle('google:list-calendars', async () => {
    try {
      const config = await ensureGoogleToken(loadGoogle())
      const client = new GoogleCalendarClient(config.tokens?.accessToken ?? '', (u, i) => fetch(u, i))
      const calendars = await client.listCalendars()
      // 읽기 전용 캘린더(공휴일 등)에는 일정을 만들 수 없다. 미리 걸러 낸다.
      return { ok: true, message: null, calendars: calendars.filter((c) => c.writable) }
    } catch (error) {
      return { ok: false, message: describeGoogleError(error), calendars: [] }
    }
  })

  ipcMain.handle('google:select', (_, id: string, name: string) => {
    const config = loadGoogle()
    // 캘린더를 바꾸면 이전 동기화 상태는 다른 캘린더의 것이라 쓸 수 없다.
    const changed = config.calendarId !== id
    const next: GoogleConfig = {
      ...config,
      calendarId: String(id),
      calendarName: String(name),
      enabled: true,
      syncState: changed ? {} : config.syncState
    }
    storeGoogle(next)
    return toPublicGoogleConfig(next)
  })

  ipcMain.handle('google:sync-now', async () => {
    const loaded = loadGoogle()
    if (!loaded.tokens || !loaded.calendarId) {
      return { ok: false, message: '구글 계정과 캘린더를 먼저 선택하세요.', result: null }
    }
    try {
      const config = await ensureGoogleToken(loaded)
      const result = await runGoogleSync({
        client: new GoogleCalendarClient(config.tokens?.accessToken ?? '', (u, i) => fetch(u, i)),
        calendarId: config.calendarId ?? '',
        tasks: db.getTasks() as unknown as TaskRow[],
        state: config.syncState
      })
      storeGoogle({
        ...config,
        syncState: result.state,
        lastSyncAt: new Date().toISOString(),
        lastError: null
      })
      const { state, ...summary } = result
      return { ok: true, message: null, result: summary }
    } catch (error) {
      const message = describeGoogleError(error)
      storeGoogle({ ...loadGoogle(), lastError: message })
      return { ok: false, message, result: null }
    }
  })

  ipcMain.handle('google:disconnect', async () => {
    const config = loadGoogle()
    // 서버 쪽 권한까지 회수한다. 실패해도 로컬 토큰은 반드시 지운다.
    if (config.tokens?.refreshToken || config.tokens?.accessToken) {
      await revokeToken(config.tokens.refreshToken ?? config.tokens.accessToken, (u, i) => fetch(u, i))
    }
    storeGoogle({ ...DEFAULT_GOOGLE_CONFIG })
    return toPublicGoogleConfig(DEFAULT_GOOGLE_CONFIG)
  })

  // Quick add (global shortcut)
  ipcMain.handle('register-global-shortcut', () => {
    // MAS 샌드박스에서는 시스템 전역 단축키를 등록할 수 없어 조용히 실패 → no-op
    if (!currentCapabilities().hasGlobalShortcuts) return false
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
