/**
 * Regression: 오프라인에서 "지금 동기화"를 한 번 누르면 저장된 구글 리프레시 토큰이
 * 지워졌다.
 *
 * `ensureGoogleToken`의 catch가 갱신 실패를 전부 "그랜트가 죽었다"로 읽어
 * `tokens: null`을 저장했다. 그런데 `postToken`은 fetch가 던진 것도
 * `OAuthError('network')`로 올려 보낸다 — 비행기·캡티브 포털·순간 DNS 실패·30초
 * 상한 초과가 거절과 **똑같은 모양**으로 도착한다. 그 한 번이
 * `google-config.json`의 `tokens_enc`를 null로 덮고(`encodeGoogleConfig`),
 * 보호 모드가 아니면 `preserveCiphertext`도 되살리지 않는다. 사용자는 브라우저
 * OAuth 동의를 처음부터 다시 받아야 하고, 이 경로는 `revokeToken`을 부르지 않으니
 * 구글 계정에는 죽은 승인이 남는다. 액세스 토큰은 한 시간짜리라 수동 동기화를
 * 누를 때마다 갱신 경로를 타므로, 나쁜 네트워크 한 순간이면 충분했다.
 *
 * CLAUDE.md가 라이선스 클라이언트에 못박아 둔 규칙과 같다 — "거부와 불통을 뭉치지
 * 말 것". 여기서 거부는 `invalid_grant` 하나뿐이다.
 */

import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest'
import { OAuthError } from './google/oauth'
import { mainStrings } from '../shared/main-strings'
import type { GoogleConfig } from './google-config'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

// 디스크 대신 쓰는 저장소. `writeGoogleConfig`가 여기에 쓴 것이 곧 파일 내용이다 —
// `tokens: null`이 오면 `encodeGoogleConfig`가 `tokens_enc: null`을 쓴다.
let stored: GoogleConfig
const { refreshTokens } = vi.hoisted(() => ({ refreshTokens: vi.fn() }))

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false }, electronApp: {}, optimizer: {} }))
vi.mock('electron-updater', () => ({ autoUpdater: { downloadUpdate: vi.fn(), quitAndInstall: vi.fn() } }))
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, listener: Handler) => handlers.set(channel, listener) },
  app: { getPath: () => '/tmp/greenday-google-refusal-test', getVersion: () => '0.0.0-test' },
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
    // 읽기 전용 가드가 먼저 막으면 갱신 경로에 닿지도 못한다 — 정상 세션으로 둔다.
    isDatabaseReadOnly: () => false,
    getTasks: () => [],
    getCalendarConfigPath: () => '/tmp/greenday-google-refusal-test/calendar-config.json'
  }
})

// `loadGoogle`·`storeGoogle`은 ipc-handlers 안의 지역 헬퍼라, 진짜 이음매는 이 모듈이다.
vi.mock('./google-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./google-config')>()
  return {
    ...actual,
    readGoogleConfig: () => ({ ...stored }),
    writeGoogleConfig: (_path: string, config: GoogleConfig) => {
      stored = { ...config }
    }
  }
})

// 갱신만 갈아끼운다. `needsRefresh`는 진짜를 쓴다 — 만료된 액세스 토큰이면 참이어야
// 한다는 것 자체가 이 회귀의 전제다(수동 동기화의 일상).
vi.mock('./google/oauth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./google/oauth')>()
  return { ...actual, refreshTokens, revokeToken: vi.fn() }
})
vi.mock('./google/app-calendar', () => ({
  ensureAppCalendar: async (_client: unknown, config: unknown) => ({ config, created: false })
}))
vi.mock('./google-sync', () => ({
  runGoogleSync: vi.fn(async () => ({ state: {}, created: 0, updated: 0, deleted: 0, failures: [] }))
}))

const { setupIpcHandlers } = await import('./ipc-handlers')
const { runGoogleSync } = await import('./google-sync')
setupIpcHandlers()

const APP_ORIGIN = 'http://localhost:5173'
// 되돌리지 않으면 같은 워커의 다음 파일에 값이 샌다(calendarIpcBoundary.test.ts와 같은 방식).
const previousRendererUrl = process.env.ELECTRON_RENDERER_URL
process.env.ELECTRON_RENDERER_URL = APP_ORIGIN
afterAll(() => {
  if (previousRendererUrl === undefined) delete process.env.ELECTRON_RENDERER_URL
  else process.env.ELECTRON_RENDERER_URL = previousRendererUrl
})

function invoke(channel: string, ...args: unknown[]): unknown {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`등록되지 않은 채널: ${channel}`)
  return handler({ senderFrame: { url: `${APP_ORIGIN}/index.html` } }, ...args)
}

beforeEach(() => {
  refreshTokens.mockReset()
  stored = {
    // 액세스 토큰은 이미 만료 — 수동 동기화를 누르는 순간의 평범한 상태다.
    tokens: {
      accessToken: 'stale',
      refreshToken: 'REFRESH-KEEP-ME',
      expiresAt: '2020-01-01T00:00:00.000Z',
      scope: 'https://www.googleapis.com/auth/calendar.app.created'
    },
    calendarId: 'cal-1',
    calendarName: 'Greenday',
    account: 'me@gmail.com',
    enabled: true,
    lastSyncAt: null,
    lastError: null,
    syncState: {}
  }
})

describe('구글 토큰 갱신 실패: 거부와 불통을 가른다', () => {
  it('오프라인(network)은 실패를 보고하되 리프레시 토큰을 남긴다', async () => {
    // `postToken`의 fetch catch가 내는 바로 그 오류.
    refreshTokens.mockRejectedValue(new OAuthError('network', '구글 서버에 연결하지 못했습니다.'))

    const result = (await invoke('google:sync-now')) as { ok: boolean; message: string | null }

    expect(result.ok).toBe(false)
    // 요점은 메시지가 아니라 **자격증명이 살아남는 것**이다.
    expect(stored.tokens).not.toBeNull()
    expect(stored.tokens?.refreshToken).toBe('REFRESH-KEEP-ME')
  })

  it('응답이 JSON이 아닐 때(bad_response)도 토큰을 남긴다 — 캡티브 포털의 HTML', async () => {
    refreshTokens.mockRejectedValue(new OAuthError('bad_response', '구글 응답을 이해할 수 없습니다.'))

    await invoke('google:sync-now')

    expect(stored.tokens?.refreshToken).toBe('REFRESH-KEEP-ME')
  })

  it('구글의 일시 장애(token_failed)도 거절이 아니다 — 5xx가 여기로 온다', async () => {
    refreshTokens.mockRejectedValue(new OAuthError('token_failed', '토큰 발급에 실패했습니다 (503).'))

    await invoke('google:sync-now')

    expect(stored.tokens?.refreshToken).toBe('REFRESH-KEEP-ME')
  })

  it('구글이 실제로 거절하면(invalid_grant) 토큰을 버린다 — 재연결을 안내해야 한다', async () => {
    refreshTokens.mockRejectedValue(
      new OAuthError('invalid_grant', '구글 연결이 만료되었습니다. 다시 연결해 주세요.')
    )

    const result = (await invoke('google:sync-now')) as { ok: boolean }

    expect(result.ok).toBe(false)
    // 가드가 "아무것도 안 지운다"로 넘어가면 죽은 연결이 영원히 남는다.
    expect(stored.tokens).toBeNull()
  })
})

/**
 * `invalid_grant`만 거절이 아니다. 릴리스 사이에 빌드의 클라이언트 ID가 바뀌었거나
 * OAuth 클라이언트가 지워지면 구글은 `invalid_client`·`unauthorized_client`로 답한다.
 * 예전에는 그것이 `token_failed`로 접혀 죽은 그랜트를 영원히 들고 "연결됨"이라고 했다.
 */
describe('클라이언트 쪽 영구 거절도 토큰을 버리고 재연결을 안내한다', () => {
  it.each(['invalid_client', 'unauthorized_client'])('%s', async (code) => {
    refreshTokens.mockRejectedValue(new OAuthError(code, '구글이 이 앱의 연결을 거절했습니다.'))

    const result = (await invoke('google:sync-now')) as { ok: boolean; message: string }

    expect(result.ok).toBe(false)
    expect(stored.tokens).toBeNull()
    // 일반 문구("알 수 없는 오류")로 접히면 사용자는 무엇을 해야 하는지 모른다.
    const sentence = (mainStrings('ko').googleErrors as Record<string, string | undefined>)[code]
    expect(sentence).toBeTruthy()
    expect(result.message).toBe(sentence)
    expect(stored.lastError).toBe(sentence)
  })
})

/**
 * 갱신은 최대 30초 걸린다. 그 사이 사용자가 "연결 해제"를 누르면 디스크의 토큰은 이미
 * 지워졌는데, catch가 sync-now를 시작할 때 읽어 둔 사본으로 `tokens: config.tokens`를
 * 다시 써서 **지운 리프레시 토큰이 되살아났다.** 저장은 언제나 지금 디스크에 있는 값
 * 위에 한다.
 */
describe('갱신 도중 바뀐 연결을 옛 사본으로 덮지 않는다', () => {
  it('갱신 중 연결 해제 + 불통(network) — 지운 토큰을 되살리지 않는다', async () => {
    refreshTokens.mockImplementation(async () => {
      await invoke('google:disconnect')
      throw new OAuthError('network', '구글 서버에 연결하지 못했습니다.')
    })

    await invoke('google:sync-now')

    expect(stored.tokens).toBeNull()
  })

  it('갱신 중 연결 해제 + 갱신 성공 — 새 토큰도 저장하지 않는다', async () => {
    refreshTokens.mockImplementation(async () => {
      await invoke('google:disconnect')
      return {
        accessToken: 'fresh',
        refreshToken: 'REFRESH-KEEP-ME',
        expiresAt: '2099-01-01T00:00:00.000Z',
        scope: 'https://www.googleapis.com/auth/calendar.app.created'
      }
    })

    const result = (await invoke('google:sync-now')) as { ok: boolean }

    expect(result.ok).toBe(false)
    expect(stored.tokens).toBeNull()
  })

  // 갱신이 끝난 뒤 동기화 본문(최대 수십 건의 요청)이 도는 동안에도 같다. 끝에서 저장하는
  // 사본은 시작할 때의 것이라, 그 사이 끊은 연결의 토큰을 되살렸다.
  it('동기화 본문 도중 연결 해제 — 끝난 뒤 저장이 토큰을 되살리지 않는다', async () => {
    refreshTokens.mockResolvedValue({
      accessToken: 'fresh',
      refreshToken: 'REFRESH-KEEP-ME',
      expiresAt: '2099-01-01T00:00:00.000Z',
      scope: 'https://www.googleapis.com/auth/calendar.app.created'
    })
    vi.mocked(runGoogleSync).mockImplementationOnce(async () => {
      await invoke('google:disconnect')
      return { state: { t1: {} }, created: 1, updated: 0, deleted: 0, failures: [], stoppedBy: null } as never
    })

    await invoke('google:sync-now')

    expect(stored.tokens).toBeNull()
  })

  it('갱신 중 다시 연결 + 옛 그랜트 거절(invalid_grant) — 새로 받은 토큰은 지우지 않는다', async () => {
    refreshTokens.mockImplementation(async () => {
      stored = {
        ...stored,
        tokens: {
          accessToken: 'new-access',
          refreshToken: 'REFRESH-NEW',
          expiresAt: '2099-01-01T00:00:00.000Z',
          scope: 'https://www.googleapis.com/auth/calendar.app.created'
        }
      }
      throw new OAuthError('invalid_grant', '구글 연결이 만료되었습니다. 다시 연결해 주세요.')
    })

    await invoke('google:sync-now')

    // 거절된 것은 옛 그랜트다. 그것 때문에 방금 받은 연결을 끊으면 안 된다.
    expect(stored.tokens?.refreshToken).toBe('REFRESH-NEW')
  })
})
