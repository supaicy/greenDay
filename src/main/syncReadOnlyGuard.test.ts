/**
 * Regression: 진단 2.5 / 3장 #1·#12 — 읽기 전용 세션의 "지금 동기화"가
 * 사용자의 원격 캘린더를 통째로 비웠다.
 * Found by /qa on 2026-09-25
 * Report: docs/reports/2026-09-25-전체-진단.html
 *
 * 데이터 파일을 못 읽으면 세션이 읽기 전용으로 내려가고 `data`는 빈 기본값이 된다.
 * `getTasks()`에는 `assertWritable()`이 없어(읽기는 무료 채널이라 의도된 것)
 * 조용히 `[]`를 돌려주는데, 캘린더 설정은 **별도 파일**이라 멀쩡히 로드되므로
 * `syncState`에는 이전에 올린 항목이 전부 남아 있다. `planSync`의 마지막 루프가
 * "목록에 없는 것 = 지워진 것"으로 보아 전부 DELETE 한다.
 *
 * 로컬이 이미 안 읽히는 그 순간에 마지막 남은 사본이 날아간다. 서버 삭제는 앱에서
 * 되돌릴 수 없다. `databaseReadOnly.test.ts`가 export 경로에 대해 못박아 둔 것과
 * 같은 규칙을 동기화 채널 둘에도 적용한다.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mainStrings } from '../shared/main-strings'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

let readOnly = false
const runSync = vi.fn(async () => ({ state: {}, created: 0, updated: 0, deleted: 0, failures: [], skippedNoDate: 0 }))
const runGoogleSync = vi.fn(async () => ({ state: {}, created: 0, updated: 0, deleted: 0, failures: [] }))

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false }, electronApp: {}, optimizer: {} }))
vi.mock('electron-updater', () => ({ autoUpdater: { downloadUpdate: vi.fn(), quitAndInstall: vi.fn() } }))
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, listener: Handler) => handlers.set(channel, listener) },
  app: { getPath: () => '/tmp/greenday-sync-guard-test', getVersion: () => '0.0.0-test' },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
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
  return {
    ...actual,
    // 손상된 파일을 읽은 세션이 정확히 이 모양이다: 읽기 전용 + 빈 목록.
    isDatabaseReadOnly: () => readOnly,
    getTasks: () => []
  }
})

// 동기화가 **실제로 불렸는지**를 본다. 가드가 도는 것과 원격을 안 건드리는 것은 다르다.
vi.mock('./calendar-sync', () => ({ runSync }))
vi.mock('./google-sync', () => ({ runGoogleSync }))

// 자격증명·토큰은 갖춰져 있다고 본다 — 가드가 그보다 앞이라는 것이 요점이 아니라,
// 다 갖춰진 정상 연동에서도 읽기 전용이면 막힌다는 것이 요점이다.
vi.mock('./calendar-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./calendar-config')>()
  return {
    ...actual,
    readConfigFile: () => ({
      ...actual.DEFAULT_CONFIG,
      serverUrl: 'https://caldav.icloud.com',
      username: 'me@icloud.com',
      password: 'app-specific',
      calendarUrl: 'https://caldav.icloud.com/1/calendars/work/',
      enabled: true,
      syncState: { 'task-1': { href: 'h1', etag: 'e1', fingerprint: 'f1', sequence: 0 } }
    }),
    writeConfigFile: vi.fn()
  }
})

// Google은 `loadGoogle`이 ipc-handlers 안의 지역 헬퍼라, 진짜 이음매는
// `readGoogleConfig`다. 여기를 안 막으면 핸들러가 "구글 계정을 먼저 연결하세요"로
// 먼저 빠져나가서, 가드가 없어도 테스트가 통과해 버린다(실측).
vi.mock('./google-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./google-config')>()
  return {
    ...actual,
    readGoogleConfig: () => ({
      ...actual.DEFAULT_GOOGLE_CONFIG,
      tokens: {
        accessToken: 'a',
        refreshToken: 'r',
        // 갱신이 필요 없도록 넉넉히 — 네트워크로 새지 않게.
        expiry: new Date(Date.now() + 3_600_000).toISOString()
      },
      calendarId: 'cal-1',
      syncState: { 'task-1': { id: 'g1', fingerprint: 'f1' } }
    }),
    writeGoogleConfig: vi.fn()
  }
})

// 토큰 갱신·캘린더 확보가 네트워크를 타지 않게 한다. 그래야 "정상 세션이면
// runGoogleSync까지 간다"를 실제로 보일 수 있고, 가드가 그것을 막는다는 것이
// 비로소 의미를 갖는다.
vi.mock('./google/oauth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./google/oauth')>()
  return { ...actual, needsRefresh: () => false, refreshTokens: vi.fn(), revokeToken: vi.fn() }
})
vi.mock('./google/app-calendar', () => ({
  ensureAppCalendar: async (_client: unknown, config: unknown) => ({ config, created: false })
}))

const { setupIpcHandlers } = await import('./ipc-handlers')
setupIpcHandlers()

const APP_ORIGIN = 'http://localhost:5173'
process.env.ELECTRON_RENDERER_URL = APP_ORIGIN

function invoke(channel: string, ...args: unknown[]): unknown {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`등록되지 않은 채널: ${channel}`)
  return handler({ senderFrame: { url: `${APP_ORIGIN}/index.html` } }, ...args)
}

beforeEach(() => {
  readOnly = false
  runSync.mockClear()
  runGoogleSync.mockClear()
})

describe('읽기 전용 세션은 원격 캘린더를 건드리지 않는다', () => {
  it('CalDAV: 동기화가 거절되고 runSync가 아예 불리지 않는다', async () => {
    readOnly = true
    const result = (await invoke('calendar:sync-now')) as { ok: boolean; message: string | null }

    expect(result.ok).toBe(false)
    expect(result.message).toBe(mainStrings('ko').syncBlockedReadOnly)
    // 가드의 요점은 메시지가 아니라 **원격에 닿지 않는 것**이다.
    expect(runSync).not.toHaveBeenCalled()
  })

  it('Google: 동기화가 거절되고 runGoogleSync가 아예 불리지 않는다', async () => {
    readOnly = true
    const result = (await invoke('google:sync-now')) as { ok: boolean; message: string | null }

    expect(result.ok).toBe(false)
    // **읽기 전용 때문에** 막혔는지 확인한다. 그냥 ok:false만 보면 "토큰 없음" 같은
    // 다른 실패 경로가 가드 없이도 테스트를 통과시킨다(실제로 그랬다).
    expect(result.message).toBe(mainStrings('ko').syncBlockedReadOnly)
    expect(runGoogleSync).not.toHaveBeenCalled()
  })

  it('정상 세션에서는 그대로 동기화한다 — 가드가 기능을 막아서는 안 된다', async () => {
    readOnly = false
    await invoke('calendar:sync-now')
    await invoke('google:sync-now')

    // 이 둘이 불린다는 것이 위 두 테스트의 전제다 — 가드가 없으면 원격에 닿는다.
    expect(runSync).toHaveBeenCalledTimes(1)
    expect(runGoogleSync).toHaveBeenCalledTimes(1)
  })

  it('거절 문구가 한국어로 박혀 있지 않다 (렌더러가 그대로 출력한다)', async () => {
    readOnly = true
    const { setUiLanguage } = await import('./ui-language')
    setUiLanguage('en')
    const result = (await invoke('calendar:sync-now')) as { message: string }
    setUiLanguage('ko')

    expect(result.message).not.toMatch(/[가-힣]/)
  })
})
