import { dialog, Notification, globalShortcut, BrowserWindow, shell } from 'electron'
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
import { licensing, publicLicenseState } from './licensing/service'
import { handle, LICENSE_REQUIRED } from './ipc-gate'
import { asPurchaseSource, purchaseUrl, recoverUrl } from './licensing/endpoints'
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

/**
 * 자격증명이 따라가도 되는 범위 — 스킴·호스트·포트를 정규화한 오리진.
 *
 * 파싱되지 않거나 http(s)가 아니면 `null`이고, `null`은 **어떤 것과도 같지 않게**
 * 다룬다(`null !== null`이 아니므로 호출처가 따로 확인한다). 문자열 비교로는
 * `https://caldav.icloud.com`과 `https://CalDAV.iCloud.com:443/`이 달라 보이고,
 * `https://evil.example#caldav.icloud.com` 같은 것이 접두사 검사를 통과한다.
 */
function normalizedOrigin(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return parsed.origin
  } catch {
    return null
  }
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
  handle('app:capabilities', 'free', () => currentCapabilities())

  // License — 키와 토큰은 메인에만 있다. 렌더러는 "지금 유료 기능을 써도 되는가"와
  // 화면 문구에 필요한 것만 받는다 (licensing/service.ts의 PublicLicenseState).
  handle('license:state', 'free', () => publicLicenseState())
  handle('license:activate', 'free', async (_, key: unknown) => {
    const manager = licensing()
    // 초기화에 실패한 빌드다. 여기서 성공이라고 답하면 아무 일도 안 일어난 채
    // 사용자는 활성화됐다고 믿는다.
    if (!manager) return 'network'
    return manager.activate(typeof key === 'string' ? key : '')
  })
  handle('license:deactivate', 'free', async () => {
    const manager = licensing()
    if (!manager) return 'network'
    return manager.deactivate()
  })
  handle('license:purchase', 'free', (_, source: unknown) => safeOpenExternal(purchaseUrl(asPurchaseSource(source))))
  handle('license:recover', 'free', () => safeOpenExternal(recoverUrl()))

  // Folders
  handle('get-folders', 'free', () => db.getFolders())
  handle('create-folder', 'paid', (_, id, name) => db.createFolder(id, name))
  handle('update-folder', 'paid', (_, id, name, collapsed) => db.updateFolder(id, name, collapsed))
  handle('delete-folder', 'paid', (_, id) => db.deleteFolder(id))

  // Lists
  handle('get-lists', 'free', () => db.getLists())
  handle('create-list', 'paid', (_, id, name, color, icon, folderId) => db.createList(id, name, color, icon, folderId))
  handle('update-list', 'paid', (_, id, updates) => db.updateList(id, updates))
  handle('delete-list', 'paid', (_, id) => db.deleteList(id))

  // Tasks
  handle('get-tasks', 'free', () => db.getTasks())
  handle('get-trash-tasks', 'free', () => db.getTrashTasks())
  handle('create-task', 'paid', (_, task) => db.createTask(validateTaskInput(task)))
  handle('update-task', 'paid', (_, task) => db.updateTask(validateTaskUpdate(task)))
  handle('delete-task', 'paid', (_, id) => db.deleteTask(id))
  handle('restore-task', 'paid', (_, id) => db.restoreTask(id))
  handle('permanent-delete-task', 'paid', (_, id) => db.permanentDeleteTask(id))
  handle('empty-trash', 'paid', () => db.emptyTrash())
  handle('reorder-tasks', 'paid', (_, ids) => db.reorderTasks(ids))
  handle('batch-update-tasks', 'paid', (_, ids, updates) => db.batchUpdateTasks(ids, updates))

  // Habits
  handle('get-habits', 'free', () => db.getHabits())
  handle('create-habit', 'paid', (_, id, name, color, frequency, targetDays) =>
    db.createHabit(id, name, color, frequency, targetDays)
  )
  handle('delete-habit', 'paid', (_, id) => db.deleteHabit(id))
  handle('get-habit-logs', 'free', () => db.getHabitLogs())
  handle('toggle-habit-log', 'paid', (_, id, habitId, date) => db.toggleHabitLog(id, habitId, date))

  // Pomodoro
  handle('get-pomodoro-sessions', 'free', () => db.getPomodoroSessions())
  handle('save-pomodoro-session', 'paid', (_, session) => db.savePomodoroSession(session))

  // Score
  handle('get-score', 'free', () => db.getScore())
  handle('add-score-event', 'paid', (_, event) => db.addScoreEvent(event))
  handle('add-score-events', 'paid', (_, events) => db.addScoreEvents(events))

  // Attachments
  handle('pick-attachment', 'paid', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '모든 파일', extensions: ['*'] },
        { name: '이미지', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
        { name: '문서', extensions: ['pdf', 'doc', 'docx', 'txt', 'md'] }
      ]
    })
    if (result.canceled) return []
    // **다시 확인한다.** 게이트는 호출 시점에만 보는데, 이 다이얼로그는 사용자가
    // 열어 둔 채 몇 시간이 지날 수 있다(절전 포함). 그 사이 트라이얼이 끝났으면
    // 여기서 복사한 파일은 뒤이은 할일 저장이 거절되면서 아무도 참조하지 않는
    // 채로 첨부 폴더에 남는다.
    if (licensing()?.allowsPaidFeatures() === false) throw new Error(LICENSE_REQUIRED)
    const attachments: { name: string; path: string }[] = []
    for (const filePath of result.filePaths) {
      const name = `${uuid()}-${basename(filePath)}`
      const destPath = db.copyAttachment(filePath, name)
      attachments.push({ name: basename(filePath), path: destPath })
    }
    return attachments
  })
  // 첨부파일 열기: 시스템 기본 앱으로 파일 경로를 엶
  // **첨부 폴더 안만 연다.** `shell.openPath`는 Finder 더블클릭과 같아서 `.app`이나
  // `.command`를 가리키면 실행된다. 이 채널은 무료라 잠긴 앱에서도 열려 있고,
  // 게이트의 전제가 "DevTools와 `window.api.*`가 JS를 고치는 것보다 싸다"이므로
  // 임의 경로를 받으면 그 상태에서 OS 실행 원시연산을 그냥 내주는 셈이 된다.
  // 쓰기 쪽(`copyAttachment`)은 처음부터 같은 판정을 하고 있었다 — 비대칭이었다.
  handle('open-attachment', 'free', (_, filePath: string) => {
    const target = String(filePath)
    if (!db.isInsideAttachments(target)) throw new Error('Attachment path outside attachments directory')
    return shell.openPath(target)
  })

  // Export
  handle('export-data', 'free', async () => {
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
      // 새 열은 맨 뒤에 붙인다 — 가운데에 끼우면 기존 열 위치로 읽던 스프레드시트·
      // 스크립트가 오류 없이 엉뚱한 값을 읽는다.
      const header = 'Title,Description,Priority,DueDate,List,Completed,CreatedAt,StartDate,Pinned\n'
      const rows = tasks
        .map((t: Record<string, unknown>) =>
          [
            t.title,
            t.description,
            t.priority,
            t.due_date || '',
            t.list_id,
            t.completed ? 'Yes' : 'No',
            t.created_at,
            t.start_date || '',
            t.pinned ? 'Yes' : 'No'
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
  handle('app:notification-permission', 'free', () => (Notification.isSupported() ? 'supported' : 'unsupported'))

  // 권한 프롬프트를 사용자가 원하는 시점에 띄우기 위한 조용한 알림.
  handle('app:request-notification-permission', 'free', () => {
    if (!Notification.isSupported()) return false
    const strings = uiStrings()
    new Notification({ title: strings.permProbeTitle, body: strings.permProbeBody }).show()
    return true
  })

  // macOS 알림 설정 화면 열기 — 차단 상태를 사용자가 직접 풀 수 있는 유일한 경로다.
  handle('app:open-notification-settings', 'free', () =>
    shell.openExternal('x-apple.systempreferences:com.apple.Notifications-Settings.extension')
  )

  // 외부 링크 열기
  handle('open-external', 'free', (_, url: string) => {
    safeOpenExternal(url)
  })

  // AI
  handle('ai:check-connection', 'paid', () => ai.checkConnection())
  handle('ai:warmup', 'paid', () => ai.warmupModel())
  handle('ai:get-config', 'free', () => ai.getAiConfig())
  handle('ai:set-config', 'paid', (_, updates) => ai.setAiConfig(updates))
  handle('ai:create-task', 'paid', (_, input, tasks) => ai.createTaskFromNL(input, tasks))
  handle('ai:interpret-action', 'paid', (_, message, tasks) => ai.interpretTaskAction(message, tasks))
  handle('ai:stream-chat', 'paid', (event, message, tasks, history) => {
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
  handle('ai:get-history', 'free', () => db.getChatHistory())
  handle('ai:save-history', 'paid', (_, messages) => db.saveChatHistory(messages))
  handle('ai:pull-model', 'paid', (event, model) => {
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

  handle('calendar:get-config', 'free', () => toPublicConfig(loadCalendarConfig()))

  handle(
    'calendar:save-credentials',
    'paid',
    (_, input: { serverUrl?: string; username?: string; password?: string }) => {
      const config = loadCalendarConfig()
      const serverUrl = String(input?.serverUrl || config.serverUrl || DEFAULT_CONFIG.serverUrl)
      const username = String(input?.username ?? config.username)
      // 빈 문자열이 오면 "비밀번호는 건드리지 않는다"는 뜻이다 — UI가 값을 되채우지
      // 않기 때문에 사용자가 다른 항목만 고칠 때 비밀번호가 지워지면 안 된다.
      const supplied = input?.password ? String(input.password) : null

      // **자격증명은 저장될 때의 오리진·계정을 벗어나지 않는다** (M1의 IPC 절반).
      //
      // 이 핸들러가 하는 일이 정확히 `{...config, serverUrl: 새것}` 스프레드라, 예전에는
      // 이전 서버의 비밀번호가 그대로 딸려 갔다. 그 값은 다음 동기화에서 새 오리진으로
      // `Authorization: Basic`에 실린다 — 렌더러 한 줄로 iCloud 앱 암호를 임의 서버에
      // 보낼 수 있었다.
      //
      // 결속이 끊기면 **고른 캘린더와 동기화 상태도 함께 버린다.** 그것들은 이전 서버의
      // 리소스를 가리키는 값이라, 남겨 두면 `calendar:sync-now`가 새 자격증명을 들고
      // 예전 주소로 간다 — 아래 `calendar:select`의 오리진 검사를 순서만 바꿔 우회하는
      // 길이 된다.
      //
      // (wt-sync가 `calendar-config` 층에서 같은 불변식을 암호문 안쪽에 걸었다. 여기는
      //  그 값이 애초에 파일에 쓰이지 않게 하는 바깥쪽 겹이다 — 한쪽만으로도 막히지만,
      //  둘 중 하나를 지나치는 경로가 생기는 순간 조용히 뚫린다.)
      const rebound = normalizedOrigin(serverUrl) !== normalizedOrigin(config.serverUrl) || username !== config.username

      const next: CalendarConfig = {
        ...config,
        serverUrl,
        username,
        password: supplied ?? (rebound ? null : config.password),
        ...(rebound ? { calendarUrl: null, calendarName: null, enabled: false, syncState: {} } : {}),
        lastError: null
      }
      storeCalendarConfig(next)
      return toPublicConfig(next)
    }
  )

  handle('calendar:test-connection', 'paid', async () => {
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

  handle('calendar:select', 'paid', (_, url: string, name: string) => {
    const config = loadCalendarConfig()
    const target = String(url)
    // **고를 수 있는 캘린더는 설정된 서버 안에 있는 것뿐이다** (C1의 렌더러 절반).
    //
    // 예전에는 렌더러가 준 문자열을 스킴도 출처도 안 보고 그대로 저장했다. 그 값은
    // `calendar:sync-now`가 `Authorization: Basic`을 붙여 요청하는 주소가 되므로,
    // 렌더러 한 줄이면 iCloud 앱 암호가 임의 호스트로 나갔다.
    //
    // 정상 UI는 여기 걸릴 수 없다 — 목록은 설정된 서버에 대한 `discoverCalendars()`에서
    // 오고, wt-sync가 응답 안의 href를 그 오리진 안으로 강제했다. 여기 걸리는 호출은
    // UI를 거치지 않은 것뿐이라 조용히 무시하지 않고 던진다(`open-attachment`와 같다).
    if (normalizedOrigin(target) === null || normalizedOrigin(target) !== normalizedOrigin(config.serverUrl)) {
      throw new Error('Calendar URL outside the configured CalDAV server')
    }
    // 다른 캘린더로 옮기면 이전 캘린더의 동기화 상태는 의미가 없다. 남겨 두면 새
    // 캘린더에서 존재하지 않는 리소스를 갱신하려다 매번 실패한다.
    const changed = config.calendarUrl !== target
    const next: CalendarConfig = {
      ...config,
      calendarUrl: target,
      calendarName: String(name),
      enabled: true,
      syncState: changed ? {} : config.syncState
    }
    storeCalendarConfig(next)
    return toPublicConfig(next)
  })

  handle('calendar:sync-now', 'paid', async () => {
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

  // 연결 **해제**는 무료다. 잠겼다고 저장된 CalDAV 비밀번호를 못 지우게 하면,
  // 유료화가 사용자의 자격증명을 인질로 잡는 것이 된다 — 내보내기를 무료로 둔
  // 것과 같은 이유다. 연결(쓰기)은 그대로 유료다.
  handle('calendar:disconnect', 'free', () => {
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

  handle('google:get-config', 'free', () => ({
    ...toPublicGoogleConfig(loadGoogle()),
    clientIdConfigured: Boolean(resolveClientId())
  }))

  handle('google:connect', 'paid', async () => {
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

  handle('google:list-calendars', 'paid', async () => {
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

  handle('google:select', 'paid', (_, id: string, name: string) => {
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

  handle('google:sync-now', 'paid', async () => {
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

  // 위와 같다. 구글 리프레시 토큰을 지우고 revoke하는 길은 잠겨도 열려 있어야 한다.
  handle('google:disconnect', 'free', async () => {
    const config = loadGoogle()
    // 서버 쪽 권한까지 회수한다. 실패해도 로컬 토큰은 반드시 지운다.
    if (config.tokens?.refreshToken || config.tokens?.accessToken) {
      await revokeToken(config.tokens.refreshToken ?? config.tokens.accessToken, (u, i) => fetch(u, i))
    }
    storeGoogle({ ...DEFAULT_GOOGLE_CONFIG })
    return toPublicGoogleConfig(DEFAULT_GOOGLE_CONFIG)
  })

  // Quick add (global shortcut)
  handle('register-global-shortcut', 'free', () => {
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
