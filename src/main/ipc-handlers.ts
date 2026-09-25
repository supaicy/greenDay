import { dialog, Notification, globalShortcut, shell } from 'electron'
import { writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { v4 as uuid } from 'uuid'
import * as db from './database'
import * as ai from './ai-service'
import { validateTaskInput, validateTaskUpdate, validateBatchUpdate } from './validate'
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
import { ensureAppCalendar } from './google/app-calendar'
import { uiStrings } from './ui-language'
import { currentCapabilities } from './capabilities'
import { licensing, publicLicenseState } from './licensing/service'
import { handle, LICENSE_REQUIRED } from './ipc-gate'
import { asPurchaseSource, purchaseUrl, recoverUrl } from './licensing/endpoints'
import { toLocalDateString } from '../shared/date'
import { flushPendingQuickAdd, requestQuickAdd } from './main-window'

// 빌드 때 주입되는 구글 OAuth 클라이언트 ID. 데스크톱 앱은 공개 클라이언트이므로
// 이 값은 비밀이 아니다 — 인가 코드 가로채기는 PKCE가 막는다.
declare const __GOOGLE_CLIENT_ID__: string
const BUILTIN_GOOGLE_CLIENT_ID = typeof __GOOGLE_CLIENT_ID__ === 'string' ? __GOOGLE_CLIENT_ID__ : ''

/**
 * UTF-8 BOM. **CSV에만** 붙인다 — 왜 붙이고 왜 JSON에는 안 붙이는지는 쓰는 자리의 주석에.
 * 리터럴 문자로 적지 않는다: 눈에 보이지 않아서 편집·붙여넣기·포매터에 조용히 사라진다.
 */
const UTF8_BOM = '\uFEFF'

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
  handle('batch-update-tasks', 'paid', (_, ids, updates) => db.batchUpdateTasks(ids, validateBatchUpdate(updates)))

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
      // 형식 이름은 macOS가 그대로 띄운다 — 영어 UI에 한국어가 섞이지 않게 표를 거친다.
      filters: [
        { name: uiStrings().filterAllFiles, extensions: ['*'] },
        { name: uiStrings().filterImages, extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
        { name: uiStrings().filterDocuments, extensions: ['pdf', 'doc', 'docx', 'txt', 'md'] }
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
      // **BOM을 앞에 붙인다.** `.csv`에는 인코딩을 선언할 자리가 없어서 스프레드시트는
      // 앞 바이트만 보고 짐작한다 — BOM이 없으면 엑셀은 시스템 코드페이지(한국어
      // 윈도우는 CP949)로 읽고 한글 제목·설명·목록 이름이 통째로 깨져 나온다.
      // 헤더가 전부 ASCII라 앞부분만 보고 판단하는 쪽에는 단서조차 없다 — 첫
      // 비ASCII 바이트는 첫 데이터 행 한참 안쪽이다.
      // 내보내기는 잠긴 화면에서도 열어 두는 유일한 길인데(데이터를 인질로 잡지
      // 않는다), 돌려준 파일을 사용자가 못 읽으면 그 약속이 말뿐이 된다.
      // **JSON 쪽에는 붙이지 말 것** — `JSON.parse`는 앞선 U+FEFF에서 그대로 터지고
      // 복원 경로(`database.ts`의 load/restore)가 바로 그 파서다. 두 방향을
      // `exportEncoding.test.ts`가 각각 못 박는다.
      writeFileSync(result.filePath, `${UTF8_BOM}${header}${rows}`, 'utf-8')
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
  // **스트림 이벤트에 요청 id를 달아 보낸다.** 창에 채널은 하나뿐인데 스트림은 여럿
  // 살아 있을 수 있다 — 렌더러가 리스너를 떼도 여기 `streamChat`은 끝까지 돈다(취소
  // 경로가 없다). id가 없으면 렌더러는 어느 스트림의 토큰인지 구분할 방법이 없어,
  // 버려진 답변이 다음 답변 말머리에 붙고 그 done이 새 스트림을 끊어 버렸다.
  handle('ai:stream-chat', 'paid', (event, message, tasks, history, requestId) => {
    const sender = event.sender
    // `pullModel`과 같은 방식으로 한 번 정규화한다. 보낸 sender에게만 되돌아가므로 값
    // 자체가 위험하진 않지만, 타입이 흔들리면 렌더러의 일치 검사가 조용히 어긋난다.
    const id = String(requestId ?? '')
    ai.streamChat(
      message,
      tasks,
      history ?? [],
      (token) => {
        if (!sender.isDestroyed()) sender.send('ai:stream-token', token, id)
      },
      () => {
        if (!sender.isDestroyed()) sender.send('ai:stream-done', id)
      },
      (error) => {
        if (!sender.isDestroyed()) sender.send('ai:stream-error', error, id)
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
  const storeCalendarConfig = (config: CalendarConfig, options: { clearSecret?: boolean } = {}): void =>
    writeConfigFile(db.getCalendarConfigPath(), config, db.realCrypto, options)

  /**
   * CalDAV 오류를 렌더러가 띄울 문장으로 바꾼다. **`code`만 본다.**
   *
   * `error.message`를 그대로 내보내던 자리다. 그 문자열은 개발자용이라 한국어로
   * 박혀 있고 `일정 조회:` 같은 컨텍스트까지 붙는데, `CalendarSyncSection`이
   * `response.message`를 그대로 출력하므로 **영어 UI에 한국어가 그대로 떴다.**
   * 밖으로 나가는 문장은 `uiStrings()`에서만 나온다.
   *
   * 원문에서 남기는 것은 상태 코드 하나다 — 언어가 없고, 문의가 들어왔을 때
   * 유일하게 쓸모 있는 값이다. 우리 오류 타입이 아닌 예외는 내부 정보가 새지
   * 않도록 일반 문구로 접는다.
   */
  const describeError = (error: unknown): string => {
    const strings = uiStrings()
    if (!(error instanceof CalDavError)) return strings.syncErrorUnknown
    const text = strings.caldavErrors[error.code]
    return error.status === null ? text : `${text} (${error.status})`
  }

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
      return { ok: false, message: uiStrings().calendarCredentialsMissing, calendars: [] }
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
      return { ok: false, message: uiStrings().syncNotConfigured, result: null }
    }
    /**
     * **읽기 전용 세션에서는 원격을 건드리지 않는다.**
     *
     * 데이터 파일을 못 읽으면 세션이 읽기 전용으로 내려가고 `data`는 빈 기본값이
     * 된다. 그런데 `getTasks()`에는 `assertWritable()`이 없어서(읽기는 무료 채널이라
     * 의도된 것) 조용히 `[]`를 돌려준다. 캘린더 설정은 **별도 파일**이라 멀쩡히
     * 로드되므로 `syncState`에는 이전에 올린 항목이 전부 남아 있고,
     * `planSync`의 마지막 루프가 "목록에 없는 것 = 지워진 것"으로 보아
     * **사용자의 캘린더에서 Greenday 일정을 전부 삭제**한다.
     *
     * 로컬이 이미 안 읽히는 그 순간에 마지막 남은 사본이 날아간다. 서버 삭제는
     * 앱에서 되돌릴 수 없고, 비워진 state가 저장되면서 무엇을 지웠는지 기록도
     * 사라진다.
     *
     * 이 저장소는 같은 위험을 이미 알고 있었다 — `databaseReadOnly.test.ts`가
     * "빈 백업으로 진짜 백업을 덮지 않는다"며 `exportData()`가 읽기 전용에서
     * 던지도록 못박아 두었다. 동기화 채널 둘만 같은 가드를 못 받았고,
     * `isDatabaseReadOnly()`는 export돼 있으면서 자기 테스트 말고는 호출처가 없었다.
     */
    if (db.isDatabaseReadOnly()) {
      return { ok: false, message: uiStrings().syncBlockedReadOnly, result: null }
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
    // 사용자가 지우겠다고 한 저장이다 — 보호 모드(secrets-gate)도 여기서는 물러난다.
    storeCalendarConfig({ ...DEFAULT_CONFIG }, { clearSecret: true })
    return toPublicConfig(DEFAULT_CONFIG)
  })

  // === 구글 캘린더 연동 ===
  const googleConfigPath = (): string =>
    db.getCalendarConfigPath().replace(/calendar-config\.json$/, 'google-config.json')
  const loadGoogle = (): GoogleConfig => readGoogleConfig(googleConfigPath(), db.realCrypto)
  const storeGoogle = (config: GoogleConfig, options: { clearSecret?: boolean } = {}): void =>
    writeGoogleConfig(googleConfigPath(), config, db.realCrypto, options)

  /**
   * 구글 쪽도 같다 — 문장은 `code`로만 고른다(위 `describeError` 참고).
   *
   * 다만 인덱싱이 느슨하다: `GoogleApiError['code']`는 닫힌 유니온이지만
   * `OAuthError.code`는 그냥 `string`이라(google/oauth.ts) 타입이 전부를 못 잡는다.
   * 그래서 **모르는 code는 반드시 접는다** — 접지 않으면 `undefined`가 그대로
   * 렌더러로 가서 오류 칸이 빈 줄로 뜬다.
   */
  const describeGoogleError = (error: unknown): string => {
    const strings = uiStrings()
    if (!(error instanceof GoogleApiError) && !(error instanceof OAuthError)) return strings.syncErrorUnknown
    const text = (strings.googleErrors as Record<string, string | undefined>)[error.code] ?? strings.syncErrorUnknown
    // network 오류의 status는 0이다 — 붙여 봐야 아무 뜻이 없다.
    return error instanceof GoogleApiError && error.status > 0 ? `${text} (${error.status})` : text
  }

  const resolveClientId = (): string => BUILTIN_GOOGLE_CLIENT_ID || String(process.env.GOOGLE_OAUTH_CLIENT_ID ?? '')

  /**
   * 구글이 그랜트를 **거절했다고 단정할 수 있는** code. 저장된 토큰을 버리는 것은
   * 이때뿐이다. 나머지는 전부 "닿지 못했다"이거나 "모르겠다"다 — `network`(fetch가
   * 던짐: 오프라인·DNS·TLS·30초 상한), `bad_response`(JSON이 아님: 캡티브 포털의
   * HTML), `token_failed`(`invalid_grant`가 아닌 모든 비정상 응답 — 구글의 5xx도
   * 여기로 온다), `no_token`. 이것들로 자격증명을 지우면 다음 시도에 멀쩡히 될
   * 연결을 우리 손으로 끊는다. 라이선스 클라이언트의 `KNOWN_REFUSALS`와 같은 규칙이다.
   */
  const GOOGLE_REFUSAL_CODES = new Set(['invalid_grant'])

  /**
   * 유효한 액세스 토큰을 확보한다. 만료가 가까우면 미리 갱신하고 갱신 결과를 저장한다.
   * 구글이 그랜트를 거절하면(`invalid_grant`) 토큰을 버린다 — 죽은 토큰을 들고 계속
   * 시도해 봐야 소용없고, 사용자에게 재연결이 필요하다는 신호를 줘야 한다.
   * 서버에 **닿지 못한** 실패는 거절이 아니므로 토큰을 남긴다.
   */
  const ensureGoogleToken = async (config: GoogleConfig): Promise<GoogleConfig> => {
    // 아래 두 message는 **로그·cause 추적용이다.** 화면에 나가는 문장은
    // `describeGoogleError`가 code(`not_connected`·`no_refresh_token`)로 고른다.
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
      // **거부와 불통을 뭉치지 않는다.** 구글이 실제로 그랜트를 거절했을 때만 토큰을
      // 버린다. 오프라인·DNS·TLS 순간 실패는 `OAuthError('network')`로 오는데, 갱신
      // 실패를 전부 "그랜트가 죽었다"로 읽으면 비행기에서 "지금 동기화" 한 번이
      // 리프레시 토큰을 디스크에서 지운다(`tokens: null` → `tokens_enc: null`,
      // 보호 모드가 아니면 `preserveCiphertext`가 되살릴 것도 없다). 그러면 브라우저
      // OAuth 동의를 처음부터 다시 받아야 하고, 이 경로는 `revokeToken`도 안 부르니
      // 구글 계정에는 죽은 승인이 남는다.
      const refused = error instanceof OAuthError && GOOGLE_REFUSAL_CODES.has(error.code)
      storeGoogle({ ...config, tokens: refused ? null : config.tokens, lastError: describeGoogleError(error) })
      throw error
    }
  }

  const googleClient = (config: GoogleConfig): GoogleCalendarClient =>
    new GoogleCalendarClient(config.tokens?.accessToken ?? '', (u, i) => fetch(u, i))

  /**
   * 쓸 캘린더를 확보한다 — 앱이 만든 `Greenday` 캘린더. `calendar.app.created` 범위는
   * 그 하나에만 닿으므로 사용자가 고를 것이 없다. 저장된 id가 죽었으면(지웠거나 다른
   * 계정) 새로 만들고 동기화 상태를 비운다. 연결 직후와 매 동기화 앞에서 부른다.
   */
  const ensureGoogleCalendar = async (config: GoogleConfig): Promise<GoogleConfig> => {
    const { config: next } = await ensureAppCalendar(googleClient(config), config)
    storeGoogle(next)
    return next
  }

  handle('google:get-config', 'free', () => ({
    ...toPublicGoogleConfig(loadGoogle()),
    clientIdConfigured: Boolean(resolveClientId())
  }))

  handle('google:connect', 'paid', async () => {
    const clientId = resolveClientId()
    if (!clientId) {
      return { ok: false, message: uiStrings().googleClientIdMissing }
    }
    const config = loadGoogle()
    let connected: GoogleConfig
    try {
      const tokens = await startGoogleAuth(clientId)
      connected = { ...config, tokens, lastError: null }
      storeGoogle(connected)
    } catch (error) {
      const message = describeGoogleError(error)
      storeGoogle({ ...config, lastError: message })
      return { ok: false, message }
    }
    // 로그인 직후 캘린더까지 확보한다 — 사용자가 고를 단계가 없으므로 여기서 끝나야
    // "연결됨"이다. 실패해도 토큰은 남긴다: 다음 동기화가 같은 확보를 다시 시도한다.
    try {
      await ensureGoogleCalendar(connected)
      return { ok: true, message: null }
    } catch (error) {
      const message = describeGoogleError(error)
      storeGoogle({ ...loadGoogle(), lastError: message })
      return { ok: false, message }
    }
  })

  handle('google:sync-now', 'paid', async () => {
    const loaded = loadGoogle()
    if (!loaded.tokens) {
      return { ok: false, message: uiStrings().syncGoogleNotConnected, result: null }
    }
    /**
     * **읽기 전용 세션에서는 원격을 건드리지 않는다.**
     *
     * 데이터 파일을 못 읽으면 세션이 읽기 전용으로 내려가고 `data`는 빈 기본값이
     * 된다. 그런데 `getTasks()`에는 `assertWritable()`이 없어서(읽기는 무료 채널이라
     * 의도된 것) 조용히 `[]`를 돌려준다. 캘린더 설정은 **별도 파일**이라 멀쩡히
     * 로드되므로 `syncState`에는 이전에 올린 항목이 전부 남아 있고,
     * `planSync`의 마지막 루프가 "목록에 없는 것 = 지워진 것"으로 보아
     * **사용자의 캘린더에서 Greenday 일정을 전부 삭제**한다.
     *
     * 로컬이 이미 안 읽히는 그 순간에 마지막 남은 사본이 날아간다. 서버 삭제는
     * 앱에서 되돌릴 수 없고, 비워진 state가 저장되면서 무엇을 지웠는지 기록도
     * 사라진다.
     *
     * 이 저장소는 같은 위험을 이미 알고 있었다 — `databaseReadOnly.test.ts`가
     * "빈 백업으로 진짜 백업을 덮지 않는다"며 `exportData()`가 읽기 전용에서
     * 던지도록 못박아 두었다. 동기화 채널 둘만 같은 가드를 못 받았고,
     * `isDatabaseReadOnly()`는 export돼 있으면서 자기 테스트 말고는 호출처가 없었다.
     */
    if (db.isDatabaseReadOnly()) {
      return { ok: false, message: uiStrings().syncBlockedReadOnly, result: null }
    }
    try {
      const config = await ensureGoogleCalendar(await ensureGoogleToken(loaded))
      const result = await runGoogleSync({
        client: googleClient(config),
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
    // 토큰만 버린다. 캘린더 id·이름·동기화 상태는 남긴다 — 비밀이 아니고, 같은 계정으로
    // 다시 연결하면 같은 `Greenday` 캘린더를 이어 쓰기 위해서다. 목록 API가 이 범위에
    // 없어 id를 잃으면 같은 이름의 캘린더가 하나 더 생긴다. 다른 계정이면
    // `calendars.get`이 실패해 새로 만들고 상태도 그때 비운다(google/app-calendar.ts).
    const kept: GoogleConfig = {
      ...DEFAULT_GOOGLE_CONFIG,
      calendarId: config.calendarId,
      calendarName: config.calendarName,
      syncState: config.syncState
    }
    storeGoogle(kept, { clearSecret: true })
    return toPublicGoogleConfig(kept)
  })

  // Quick add (global shortcut)
  handle('register-global-shortcut', 'free', (event) => {
    // MAS 샌드박스에서는 시스템 전역 단축키를 등록할 수 없어 조용히 실패 → no-op
    if (!currentCapabilities().hasGlobalShortcuts) return false
    // **이 호출은 "렌더러가 이제 받을 수 있다"는 신호이기도 하다.** App.tsx가 이
    // invoke 바로 다음 줄에서 `onGlobalQuickAdd` 리스너를 걸고, invoke는 비동기라
    // 이 핸들러는 그 줄보다 뒤에 돈다. 창이 없던 동안 눌린 핫키를 여기서 흘려보낸다 —
    // 창 생성 이벤트(`did-finish-load`)에 걸면 리스너보다 먼저 도착해 그대로
    // 사라진다(main-window.ts의 `quickAddPending` 주석 참고).
    flushPendingQuickAdd(event.sender)
    // 창이 하나도 없을 때 무엇을 하는지는 `requestQuickAdd`가 안다. 여기서
    // `getAllWindows()`를 직접 보던 동안, macOS에서 창을 닫으면(= 전역 단축키가
    // 존재하는 이유인 바로 그 상태) 핫키가 무반응이면서 다른 앱의 Cmd+Shift+A는
    // 계속 가로챘다 — 없는 것보다 나쁜 상태였다.
    try {
      globalShortcut.register('CommandOrControl+Shift+A', requestQuickAdd)
      return true
    } catch {
      return false
    }
  })
}
