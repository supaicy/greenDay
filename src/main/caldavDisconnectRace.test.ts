/**
 * CalDAV 동기화·연결 확인이 **끝난 뒤의 저장**이 그 사이의 연결 해제를 되돌리던 것.
 *
 * `calendar:sync-now`는 시작할 때 설정(복호화된 비밀번호 포함)을 읽고, `runSync`
 * (바뀐 할일마다 요청 한 건, 건마다 최대 30초)가 끝나면 그 **시작 사본**을 통째로
 * 썼다. `calendar:disconnect`는 무료이고 즉시 끝나므로 그 사이 누를 수 있다 — 그러면
 * 끝의 저장이 사용자명·비밀번호·캘린더 주소·동기화 상태를 되살린다. 사용자는 끊었다고
 * 믿는데 자격증명이 돌아와 있고 앱은 계속 그 캘린더에 쓴다. Google 쪽
 * (`isSameGrant`/`storeIfSameGrant`)에서 닫은 것과 같은 종류다.
 *
 * 하네스는 `calendarIpcBoundary.test.ts`와 같다 — 핸들러를 실제로 등록하고,
 * 디스크 대신 `stored`에 쓴다. 원격은 `runSync`와 `CalDavClient`에서 막고,
 * 테스트가 그 약속을 손에 쥐고 있다가 "요청이 걸려 있는 동안" 다른 채널을 부른다.
 */

import { describe, it, expect, vi, afterAll, beforeAll, beforeEach } from 'vitest'
import type { CalendarConfig } from './calendar-config'
import { CalDavError } from './caldav/client'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false }, electronApp: {}, optimizer: {} }))
vi.mock('electron-updater', () => ({ autoUpdater: { downloadUpdate: vi.fn(), quitAndInstall: vi.fn() } }))
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, listener: Handler) => handlers.set(channel, listener) },
  app: { getPath: () => '/tmp/greenday-caldav-race-test', getVersion: () => '0.0.0-test' },
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
  return { ...actual, isDatabaseReadOnly: () => false, getTasks: () => [] }
})

/** 디스크 대신 여기에 든다. 핸들러가 끝에 무엇을 저장하는지가 이 파일의 관심사다. */
let stored: CalendarConfig
vi.mock('./calendar-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./calendar-config')>()
  return {
    ...actual,
    readConfigFile: () => structuredClone(stored),
    writeConfigFile: (_path: string, config: CalendarConfig) => {
      stored = structuredClone(config)
    }
  }
})

/** 걸려 있는 원격 요청. 테스트가 끝낼 시점을 고른다. */
interface Pending<T> {
  resolve: (value: T) => void
  reject: (error: unknown) => void
}
let pendingSync: Pending<unknown> | null = null
let pendingDiscover: Pending<unknown> | null = null

vi.mock('./calendar-sync', () => ({
  runSync: vi.fn(
    () =>
      new Promise((resolve, reject) => {
        pendingSync = { resolve, reject }
      })
  )
}))

vi.mock('./caldav/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./caldav/client')>()
  class CalDavClient {
    discoverCalendars(): Promise<unknown> {
      return new Promise((resolve, reject) => {
        pendingDiscover = { resolve, reject }
      })
    }
  }
  return { ...actual, CalDavClient }
})

const { setupIpcHandlers } = await import('./ipc-handlers')
const { DEFAULT_CONFIG } = await import('./calendar-config')
setupIpcHandlers()

const APP_ORIGIN = 'http://localhost:5173'
const previousRendererUrl = process.env.ELECTRON_RENDERER_URL
beforeAll(() => {
  process.env.ELECTRON_RENDERER_URL = APP_ORIGIN
})
afterAll(() => {
  if (previousRendererUrl === undefined) delete process.env.ELECTRON_RENDERER_URL
  else process.env.ELECTRON_RENDERER_URL = previousRendererUrl
})

function invoke(channel: string, ...args: unknown[]): unknown {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`등록되지 않은 채널: ${channel}`)
  return handler({ senderFrame: { url: `${APP_ORIGIN}/index.html` } }, ...args)
}

/** 걸린 요청이 생길 때까지 마이크로태스크를 돌린다. */
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !check(); i++) await Promise.resolve()
  if (!check()) throw new Error('원격 요청이 시작되지 않았다')
}

const ICLOUD = 'https://caldav.icloud.com'
const CONNECTED: CalendarConfig = {
  provider: 'icloud',
  serverUrl: ICLOUD,
  username: 'me@icloud.com',
  password: 'app-specific-password',
  passwordBinding: { origin: new URL(ICLOUD).origin, username: 'me@icloud.com', password: 'app-specific-password' },
  calendarUrl: `${ICLOUD}/123/calendars/home/`,
  calendarName: '집',
  enabled: true,
  lastSyncAt: null,
  lastError: null,
  syncState: {
    'task-1': { href: `${ICLOUD}/123/calendars/home/a.ics`, etag: '"1"', fingerprint: 'x', sequence: 0 }
  }
}

const SYNCED_STATE = {
  'task-1': { href: `${ICLOUD}/123/calendars/home/a.ics`, etag: '"2"', fingerprint: 'y', sequence: 1 },
  'task-2': { href: `${ICLOUD}/123/calendars/home/b.ics`, etag: '"1"', fingerprint: 'z', sequence: 0 }
}
const SYNC_RESULT = { state: SYNCED_STATE, created: 1, updated: 1, deleted: 0, failures: [], skippedNoDate: 0 }

beforeEach(() => {
  stored = structuredClone(CONNECTED)
  pendingSync = null
  pendingDiscover = null
})

describe('calendar:sync-now — 끝난 뒤의 저장이 그 사이의 변경을 되돌리지 않는다', () => {
  it('동기화 도중 연결을 해제하면, 끝나도 자격증명과 동기화 상태가 돌아오지 않는다', async () => {
    const running = invoke('calendar:sync-now') as Promise<{ ok: boolean }>
    await until(() => pendingSync !== null)

    await invoke('calendar:disconnect')
    pendingSync?.resolve(SYNC_RESULT)
    const response = await running

    // 화면에는 이번 실행의 결과를 그대로 돌려준다 — 원격에는 실제로 그만큼 갔다.
    expect(response.ok).toBe(true)
    expect(stored.password).toBeNull()
    expect(stored.username).toBe('')
    expect(stored.calendarUrl).toBeNull()
    expect(stored.syncState).toEqual({})
    expect(stored).toEqual(DEFAULT_CONFIG)
  })

  it('동기화 도중 다른 서버로 옮기면, 새 설정을 옛 사본으로 덮지 않는다', async () => {
    const running = invoke('calendar:sync-now') as Promise<{ ok: boolean }>
    await until(() => pendingSync !== null)

    invoke('calendar:save-credentials', {
      serverUrl: 'https://dav.fastmail.com',
      username: 'me@fastmail.com',
      password: 'new-app-password'
    })
    const moved = structuredClone(stored)
    pendingSync?.resolve(SYNC_RESULT)
    await running

    expect(stored).toEqual(moved)
    expect(stored.serverUrl).toBe('https://dav.fastmail.com')
    expect(stored.password).toBe('new-app-password')
    expect(stored.calendarUrl).toBeNull()
    expect(stored.syncState).toEqual({})
  })

  it('동기화 도중 다른 캘린더를 고르면, 옛 캘린더의 상태를 새 캘린더에 붙이지 않는다', async () => {
    const running = invoke('calendar:sync-now') as Promise<{ ok: boolean }>
    await until(() => pendingSync !== null)

    invoke('calendar:select', `${ICLOUD}/123/calendars/work/`, '일')
    pendingSync?.resolve(SYNC_RESULT)
    await running

    expect(stored.calendarUrl).toBe(`${ICLOUD}/123/calendars/work/`)
    expect(stored.syncState).toEqual({})
  })

  it('동기화 도중 연결을 해제하고 동기화가 실패하면, 비운 설정에 오류를 남기지 않는다', async () => {
    const running = invoke('calendar:sync-now') as Promise<{ ok: boolean; message: string | null }>
    await until(() => pendingSync !== null)

    await invoke('calendar:disconnect')
    pendingSync?.reject(new CalDavError('unauthorized', '인증 실패', 401))
    const response = await running

    // 화면에는 여전히 실패를 알린다.
    expect(response.ok).toBe(false)
    expect(response.message).toBeTruthy()
    expect(stored).toEqual(DEFAULT_CONFIG)
  })

  /** 고친 것이 정상 경로를 막지 않는지 — 저장이 아예 사라지면 위 테스트는 전부 통과한다. */
  it('그 사이 아무것도 바뀌지 않았으면 결과를 그대로 저장한다', async () => {
    stored.lastError = '이전 오류'
    const running = invoke('calendar:sync-now') as Promise<{ ok: boolean }>
    await until(() => pendingSync !== null)
    pendingSync?.resolve(SYNC_RESULT)
    await running

    expect(stored.syncState).toEqual(SYNCED_STATE)
    expect(stored.lastSyncAt).not.toBeNull()
    expect(stored.lastError).toBeNull()
    expect(stored.password).toBe('app-specific-password')
  })

  it('같은 연결에서 실패하면 오류를 적는다', async () => {
    const running = invoke('calendar:sync-now') as Promise<{ ok: boolean; message: string | null }>
    await until(() => pendingSync !== null)
    pendingSync?.reject(new CalDavError('unauthorized', '인증 실패', 401))
    const response = await running

    expect(stored.lastError).toBe(response.message)
    expect(stored.syncState).toEqual(CONNECTED.syncState)
  })

  it('같은 연결이면 그 사이 바뀐 비밀번호를 사본으로 되돌리지 않는다', async () => {
    const running = invoke('calendar:sync-now') as Promise<{ ok: boolean }>
    await until(() => pendingSync !== null)
    invoke('calendar:save-credentials', { serverUrl: ICLOUD, username: 'me@icloud.com', password: 'rotated' })
    pendingSync?.resolve(SYNC_RESULT)
    await running

    expect(stored.password).toBe('rotated')
    expect(stored.syncState).toEqual(SYNCED_STATE)
  })
})

describe('calendar:test-connection — 같은 종류', () => {
  it('확인 도중 연결을 해제하면, 끝나도 자격증명이 돌아오지 않는다', async () => {
    const running = invoke('calendar:test-connection') as Promise<{ ok: boolean }>
    await until(() => pendingDiscover !== null)

    await invoke('calendar:disconnect')
    pendingDiscover?.resolve([])
    const response = await running

    expect(response.ok).toBe(true)
    expect(stored).toEqual(DEFAULT_CONFIG)
  })

  it('확인 도중 연결을 해제하고 확인이 실패하면, 비운 설정에 오류를 남기지 않는다', async () => {
    const running = invoke('calendar:test-connection') as Promise<{ ok: boolean }>
    await until(() => pendingDiscover !== null)

    await invoke('calendar:disconnect')
    pendingDiscover?.reject(new CalDavError('unauthorized', '인증 실패', 401))
    const response = await running

    expect(response.ok).toBe(false)
    expect(stored).toEqual(DEFAULT_CONFIG)
  })

  it('그 사이 캘린더를 골랐으면 그 선택을 되돌리지 않는다', async () => {
    const running = invoke('calendar:test-connection') as Promise<{ ok: boolean }>
    await until(() => pendingDiscover !== null)

    invoke('calendar:select', `${ICLOUD}/123/calendars/work/`, '일')
    pendingDiscover?.reject(new CalDavError('unauthorized', '인증 실패', 401))
    const response = (await running) as { ok: boolean; message: string | null }

    expect(stored.calendarUrl).toBe(`${ICLOUD}/123/calendars/work/`)
    // 계정이 그대로이므로 오류는 이 연결의 것이다.
    expect(stored.lastError).toBe(response.message)
  })
})
