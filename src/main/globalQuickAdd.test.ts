/**
 * **창이 하나도 없을 때의 전역 퀵 추가(Cmd+Shift+A).**
 *
 * macOS는 마지막 창을 닫아도 앱을 끝내지 않는다(`index.ts`의 `window-all-closed`가
 * darwin에서 `app.quit()`을 부르지 않는다). 독에만 남고 창은 없는 그 상태가 바로
 * 시스템 전역 단축키가 존재하는 이유인데, 핸들러는 `getAllWindows()`가 비면 아무
 * 것도 하지 않고 돌아갔다. 등록은 `will-quit`까지 살아 있으므로 다른 앱의
 * Cmd+Shift+A를 계속 가로채면서 아무것도 돌려주지 않았다 — 없는 것보다 나쁘다.
 *
 * 하네스는 `ipc-gate.test.ts`와 같다: 실제로 등록시키고, 목킹된
 * `globalShortcut.register`가 받아 둔 콜백을 우리가 직접 누른다. "정책이 옳다"와
 * "배선이 됐다"는 따로 깨진다 — 여기서 확인하는 것은 배선 쪽이다.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

/** OS 대신 우리가 누를 핫키. `globalShortcut.register`가 받아 둔 콜백이다. */
let hotkey: (() => void) | null = null

/** `createWindow()`가 실제로 건드리는 것만 갖춘 가짜 창. */
interface FakeWindow {
  webContents: {
    send: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    setWindowOpenHandler: ReturnType<typeof vi.fn>
  }
  on: ReturnType<typeof vi.fn>
  loadURL: ReturnType<typeof vi.fn>
  isMinimized: () => boolean
  restore: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
}

/** 살아 있는 창. 빈 배열 = 사용자가 빨간불로 창을 닫은 macOS 상태. */
let windows: FakeWindow[] = []

function makeWindow(): FakeWindow {
  const win: FakeWindow = {
    webContents: { send: vi.fn(), on: vi.fn(), setWindowOpenHandler: vi.fn() },
    on: vi.fn(),
    loadURL: vi.fn(),
    isMinimized: () => false,
    restore: vi.fn(),
    focus: vi.fn()
  }
  windows.push(win)
  return win
}

/** `new BrowserWindow(...)`로 불린다 — 화살표 함수는 생성자가 될 수 없다. */
function constructWindow(): FakeWindow {
  return makeWindow()
}

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false }, electronApp: {}, optimizer: {} }))
vi.mock('electron-updater', () => ({
  autoUpdater: { downloadUpdate: vi.fn(), quitAndInstall: vi.fn() }
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, listener: Handler) => handlers.set(channel, listener) },
  app: { getPath: () => '/tmp/greenday-quickadd-test', getVersion: () => '0.0.0-test' },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  Notification: Object.assign(
    vi.fn(() => ({ show: vi.fn() })),
    { isSupported: () => false }
  ),
  globalShortcut: {
    register: (_accelerator: string, callback: () => void) => {
      hotkey = callback
      return true
    },
    unregisterAll: vi.fn()
  },
  BrowserWindow: Object.assign(vi.fn(constructWindow), { getAllWindows: () => windows }),
  shell: { openPath: vi.fn(), openExternal: vi.fn() },
  Menu: { buildFromTemplate: (t: unknown) => t, setApplicationMenu: vi.fn() }
}))

const { setupIpcHandlers } = await import('./ipc-handlers')
setupIpcHandlers()

/**
 * 앱 문서 URL을 **이 테스트가 아는 값**으로 고정한다(`ipc-gate.test.ts`와 같은 방식).
 * 게이트의 발신자 검사를 지나야 핸들러 본문까지 간다. 끝나면 되돌린다 — 같은
 * 워커에서 도는 다른 파일이 이 값을 물려받으면 안 된다.
 */
const APP_ORIGIN = 'http://localhost:5173'
const APP_DOCUMENT = `${APP_ORIGIN}/index.html`
const previousRendererUrl = process.env.ELECTRON_RENDERER_URL

beforeAll(() => {
  process.env.ELECTRON_RENDERER_URL = APP_ORIGIN
})

afterAll(() => {
  if (previousRendererUrl === undefined) delete process.env.ELECTRON_RENDERER_URL
  else process.env.ELECTRON_RENDERER_URL = previousRendererUrl
})

/** 그 창의 렌더러가 부른 것처럼 채널을 호출한다. */
function invokeFrom(win: FakeWindow, channel: string): unknown {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`등록되지 않은 채널: ${channel}`)
  return handler({ senderFrame: { url: APP_DOCUMENT }, sender: win.webContents })
}

function sentChannels(win: FakeWindow): string[] {
  return win.webContents.send.mock.calls.map((call) => String(call[0]))
}

describe('전역 퀵 추가', () => {
  beforeEach(() => {
    windows = []
    hotkey = null
  })

  it('창이 없어도 창을 만들고 퀵 추가를 띄운다', () => {
    // 1) 앱이 켜지고, 첫 창의 렌더러가 마운트하면서 단축키를 등록한다.
    const first = makeWindow()
    expect(invokeFrom(first, 'register-global-shortcut')).toBe(true)
    expect(typeof hotkey, '단축키가 등록되지 않았다').toBe('function')

    // 2) 사용자가 빨간불로 창을 닫는다. macOS는 앱을 끝내지 않는다.
    windows = []

    // 3) 다른 앱에서 Cmd+Shift+A — 전역 단축키가 존재하는 이유인 바로 그 상황.
    hotkey?.()
    expect(windows.length, '핫키가 창을 만들지 않았다').toBe(1)

    // 4) 새 창의 렌더러가 뜨면서 리스너를 걸고 단축키를 다시 등록한다.
    //    밀린 퀵 추가는 이 시점에 흘러야 한다 — `did-finish-load`는 React의
    //    이펙트보다 먼저 올 수 있어서 받는 사람 없이 사라진다.
    const second = windows[0]
    invokeFrom(second, 'register-global-shortcut')
    expect(sentChannels(second), '새 창이 퀵 추가를 못 받았다').toContain('global-quick-add')
  })

  it('창이 있으면 앞으로 가져와 바로 보낸다', () => {
    // 이미 동작하던 길을 깨서 위 테스트를 통과시킬 수 없게 못 박는다.
    const win = makeWindow()
    invokeFrom(win, 'register-global-shortcut')
    hotkey?.()
    expect(win.focus).toHaveBeenCalled()
    expect(win.webContents.send).toHaveBeenCalledWith('global-quick-add')
  })
})
