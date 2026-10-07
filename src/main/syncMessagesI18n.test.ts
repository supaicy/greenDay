/**
 * Regression: 영어 UI에서 캘린더·구글 연동 오류가 한국어로 떴다.
 *
 * `CalendarSyncSection`/`GoogleSyncSection`은 핸들러가 돌려준 `response.message`를
 * **그대로** 출력한다(`setMessage({ kind: 'error', text: response.message ?? '' })`).
 * 그런데 두 funnel(`describeError`·`describeGoogleError`)이 `error.message`를 그대로
 * 내보냈고, 그 문자열은 개발자용이라 한국어로 박혀 있는 데다 `일정 조회:` 같은
 * 컨텍스트까지 붙어 있었다 — 영어 사용자가 iCloud 앱 암호 안내를 한국어로 받았다.
 *
 * `syncNotConfigured`·`syncBlockedReadOnly`는 이미 `uiStrings()`를 지나고 있었고
 * (main-strings.ts가 이유까지 적어 뒀다) 나머지 경로만 빠져 있었다.
 *
 * 문구를 **값으로** 확인한다 — 한글만 없는지 보면 message를 빈 문자열로 만들어도
 * 통과한다(렌더러에는 빈 줄이 뜬다). 마지막 케이스는 한국어 UI에서 여전히
 * 한국어여야 함을 못박는다: 영어로 바꿔 박아서 통과시키는 "고침"을 막는다.
 */

import { describe, it, expect, vi, afterAll, beforeEach, afterEach } from 'vitest'
import { mainStrings } from '../shared/main-strings'
import { CalDavError } from './caldav/client'
import { GoogleApiError } from './google/calendar'
import { OAuthError } from './google/oauth'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

const EN = mainStrings('en')

let calConfig: Record<string, unknown> = {}
const runSync = vi.fn(async () => ({ state: {}, created: 0, updated: 0, deleted: 0, failures: [], skippedNoDate: 0 }))
const runGoogleSync = vi.fn(
  async (): Promise<Record<string, unknown>> => ({ state: {}, created: 0, updated: 0, deleted: 0, failures: [] })
)
const writeGoogleConfig = vi.fn((_path: string, _config: Record<string, unknown>) => {})
// 인자 타입을 적어 둔다 — `vi.fn(async () => …)`면 `mock.calls`가 빈 튜플이라
// 형식 이름을 꺼내 보는 아래 단언이 타입 단계에서 막힌다.
const showOpenDialog = vi.fn(
  async (_options: { filters: { name: string; extensions: string[] }[] }) => ({
    canceled: true,
    filePaths: [] as string[]
  })
)

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false }, electronApp: {}, optimizer: {} }))
vi.mock('electron-updater', () => ({ autoUpdater: { downloadUpdate: vi.fn(), quitAndInstall: vi.fn() } }))
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, listener: Handler) => handlers.set(channel, listener) },
  app: { getPath: () => '/tmp/greenday-i18n-test', getVersion: () => '0.0.0-test' },
  dialog: { showOpenDialog, showSaveDialog: vi.fn() },
  Notification: Object.assign(
    vi.fn(() => ({ show: vi.fn() })),
    { isSupported: () => false }
  ),
  globalShortcut: { register: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openPath: vi.fn(), openExternal: vi.fn() },
  Menu: { buildFromTemplate: (t: unknown) => t, setApplicationMenu: vi.fn() }
}))

vi.mock('./database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./database')>()
  return { ...actual, isDatabaseReadOnly: () => false, getTasks: () => [] }
})

// 동기화 함수를 직접 거절시켜 **오류 경로만** 본다 — 네트워크는 타지 않는다.
vi.mock('./calendar-sync', () => ({ runSync }))
vi.mock('./google-sync', () => ({ runGoogleSync }))

vi.mock('./calendar-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./calendar-config')>()
  return {
    ...actual,
    readConfigFile: () => ({ ...actual.DEFAULT_CONFIG, ...calConfig }),
    writeConfigFile: vi.fn()
  }
})

vi.mock('./google-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./google-config')>()
  return {
    ...actual,
    readGoogleConfig: () => ({
      ...actual.DEFAULT_GOOGLE_CONFIG,
      tokens: {
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        scope: 'https://www.googleapis.com/auth/calendar.app.created'
      },
      calendarId: 'cal-1',
      syncState: {}
    }),
    writeGoogleConfig
  }
})

// 토큰 갱신·캘린더 확보가 네트워크를 타지 않게 한다 — 우리가 보려는 것은 문구다.
vi.mock('./google/oauth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./google/oauth')>()
  return { ...actual, needsRefresh: () => false, refreshTokens: vi.fn(), revokeToken: vi.fn() }
})
vi.mock('./google/app-calendar', () => ({
  ensureAppCalendar: async (_client: unknown, config: unknown) => ({ config, created: false })
}))

const { setupIpcHandlers } = await import('./ipc-handlers')
const { setUiLanguage } = await import('./ui-language')
setupIpcHandlers()

const APP_ORIGIN = 'http://localhost:5173'
// 바꾼 환경변수는 되돌린다 — 저장하지 않으면 같은 워커의 다음 파일에 값이 샌다
// (calendarIpcBoundary.test.ts와 같은 방식).
const previousRendererUrl = process.env.ELECTRON_RENDERER_URL
const previousClientId = process.env.GOOGLE_OAUTH_CLIENT_ID
process.env.ELECTRON_RENDERER_URL = APP_ORIGIN
// 개발 머신에 값이 있으면 google:connect가 실제 인증 흐름으로 빠진다.
delete process.env.GOOGLE_OAUTH_CLIENT_ID
afterAll(() => {
  if (previousRendererUrl === undefined) delete process.env.ELECTRON_RENDERER_URL
  else process.env.ELECTRON_RENDERER_URL = previousRendererUrl
  if (previousClientId !== undefined) process.env.GOOGLE_OAUTH_CLIENT_ID = previousClientId
})

function invoke(channel: string, ...args: unknown[]): unknown {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`등록되지 않은 채널: ${channel}`)
  return handler({ senderFrame: { url: `${APP_ORIGIN}/index.html` } }, ...args)
}

const HANGUL = /[가-힣]/
const CONNECTED = {
  serverUrl: 'https://caldav.icloud.com',
  username: 'me@icloud.com',
  password: 'app-specific',
  calendarUrl: 'https://caldav.icloud.com/1/calendars/work/',
  enabled: true
}

beforeEach(() => {
  calConfig = {}
  runSync.mockReset()
  runGoogleSync.mockReset()
  writeGoogleConfig.mockClear()
  showOpenDialog.mockClear()
  setUiLanguage('en')
})

// 언어는 모듈 지역 상태다. 되돌려 두지 않으면 같은 프로세스의 다음 파일이 영어로 시작한다.
afterEach(() => {
  setUiLanguage('ko')
})

describe('영어 UI에서 연동 오류가 한국어로 새지 않는다', () => {
  it('CalDAV 자격증명 미입력 — calendar:test-connection', async () => {
    const r = (await invoke('calendar:test-connection')) as { ok: boolean; message: string }
    expect(r.ok).toBe(false)
    expect(r.message).not.toMatch(HANGUL)
    expect(r.message).toBe(EN.calendarCredentialsMissing)
  })

  it('CalDAV 서버 오류 pass-through — calendar:sync-now (401)', async () => {
    calConfig = CONNECTED
    // 실제로 나오던 문자열 그대로다. `일정 조회:` 컨텍스트까지 따라 나갔다.
    runSync.mockRejectedValueOnce(
      new CalDavError('unauthorized', '일정 조회: 인증 실패 (401). iCloud는 계정 암호가 아니라 앱 암호가 필요합니다.', 401)
    )
    const r = (await invoke('calendar:sync-now')) as { ok: boolean; message: string }
    expect(r.ok).toBe(false)
    expect(r.message).not.toMatch(HANGUL)
    // 언어 없는 상태 코드만 남긴다 — 문의가 들어왔을 때 유일하게 쓸모 있는 값이다.
    expect(r.message).toBe(`${EN.caldavErrors.unauthorized} (401)`)
  })

  it('CalDAV 알 수 없는 오류 fallback — calendar:sync-now', async () => {
    calConfig = CONNECTED
    runSync.mockRejectedValueOnce(new Error('boom'))
    const r = (await invoke('calendar:sync-now')) as { message: string }
    expect(r.message).not.toMatch(HANGUL)
    // 우리 오류가 아니면 내부 정보를 흘리지 않는다 — 'boom'이 그대로 나가면 안 된다.
    expect(r.message).toBe(EN.syncErrorUnknown)
  })

  it('구글 API 오류 — google:sync-now (403)', async () => {
    runGoogleSync.mockRejectedValueOnce(new GoogleApiError(403, '이 캘린더에 접근할 권한이 없습니다.', 'forbidden'))
    const r = (await invoke('google:sync-now')) as { ok: boolean; message: string }
    expect(r.ok).toBe(false)
    expect(r.message).not.toMatch(HANGUL)
    expect(r.message).toBe(`${EN.googleErrors.forbidden} (403)`)
  })

  it('표에 없는 OAuth code는 빈 줄이 아니라 일반 문구로 접힌다', async () => {
    // `OAuthError.code`는 `string`이라 타입이 표와의 일치를 보장하지 못한다.
    // 접지 않으면 `undefined`가 그대로 렌더러로 가서 오류 칸이 비어 보인다.
    runGoogleSync.mockRejectedValueOnce(new OAuthError('some_future_code', '나중에 생길 오류'))
    const r = (await invoke('google:sync-now')) as { message: string }
    expect(r.message).toBe(EN.syncErrorUnknown)
  })

  it('CalDAV 서버 주소가 http면 https가 필요하다고 말한다 — calendar:test-connection', async () => {
    // 예전에는 `protocol`로 접혀 "응답을 이해할 수 없습니다"가 떴다. 서버에 닿기도 전에
    // 우리가 거절한 것인데 서버 탓으로 들렸다.
    calConfig = { ...CONNECTED, serverUrl: 'http://caldav.example.com' }
    const r = (await invoke('calendar:test-connection')) as { ok: boolean; message: string }
    expect(r.ok).toBe(false)
    expect(r.message).toBe(EN.caldavErrors.insecure_url)
    expect(r.message).not.toBe(EN.caldavErrors.protocol)

    setUiLanguage('ko')
    const ko = (await invoke('calendar:test-connection')) as { message: string }
    expect(ko.message).toBe(mainStrings('ko').caldavErrors.insecure_url)
    expect(ko.message).toMatch(/https/)
  })

  it('구글 할당량에 걸려 멈춘 동기화 — 실패로 알리되 올린 만큼의 상태는 저장한다', async () => {
    // runGoogleSync가 던지지 않고 멈춘 결과를 돌려준다(google-sync.ts의 stoppedBy).
    runGoogleSync.mockResolvedValueOnce({
      state: { 'task-1': { href: 'cal-1', etag: null, fingerprint: 'f1', sequence: 0 } },
      created: 1,
      updated: 0,
      deleted: 0,
      skippedNoDate: 0,
      failures: [{ taskId: 'task-2', message: '요청이 너무 잦습니다.' }],
      stoppedBy: new GoogleApiError(429, '요청이 너무 잦습니다. 잠시 후 다시 시도하세요.', 'rate_limit')
    })
    const r = (await invoke('google:sync-now')) as {
      ok: boolean
      message: string
      result: Record<string, unknown> | null
    }
    expect(r.ok).toBe(false)
    expect(r.message).toBe(`${EN.googleErrors.rate_limit} (429)`)
    // 요약은 그대로 보여 준다 — 몇 개가 올라갔고 몇 개가 남았는지. 오류 객체는 넘기지 않는다.
    expect(r.result).toMatchObject({ created: 1, failures: [{ taskId: 'task-2' }] })
    expect(r.result).not.toHaveProperty('stoppedBy')
    expect(r.result).not.toHaveProperty('state')
    const saved = writeGoogleConfig.mock.lastCall?.[1]
    expect(saved?.syncState).toEqual({ 'task-1': { href: 'cal-1', etag: null, fingerprint: 'f1', sequence: 0 } })
    // 끝난 동기화가 아니므로 마지막 동기화 시각은 찍지 않는다.
    expect(saved?.lastSyncAt ?? null).toBeNull()
  })

  it('구글 클라이언트 ID 미설정 — google:connect', async () => {
    const r = (await invoke('google:connect')) as { ok: boolean; message: string }
    expect(r.ok).toBe(false)
    expect(r.message).not.toMatch(HANGUL)
    expect(r.message).toBe(EN.googleClientIdMissing)
  })

  it('첨부 고르기 다이얼로그의 형식 이름 — macOS가 그대로 띄운다', async () => {
    await invoke('pick-attachment')
    const options = showOpenDialog.mock.lastCall?.[0]
    expect(options?.filters.map((f) => f.name)).toEqual([EN.filterAllFiles, EN.filterImages, EN.filterDocuments])
  })

  it('한국어 UI에서는 그대로 한국어다 — 문장을 지워서 통과시키지 않는다', async () => {
    setUiLanguage('ko')
    const r = (await invoke('calendar:test-connection')) as { message: string }
    expect(r.message).toMatch(HANGUL)
    expect(r.message).toBe(mainStrings('ko').calendarCredentialsMissing)
  })
})
