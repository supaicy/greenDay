/**
 * `main-window.ts`의 두 약속 — 창이 앱 문서 밖으로 나가지 않는다, 그리고
 * 앱이 준비되기 전에는 창을 만들지 않는다.
 *
 * 하네스는 `globalQuickAdd.test.ts`와 같다: `BrowserWindow`를 가짜 창을 돌려주는
 * 생성자로 바꾸고 `createWindow()`를 실제로 돌린다. 판정 자체(`isAppDocumentUrl`)는
 * `navigation-guard.test.ts`가 본다 — 여기서 보는 것은 **창에 걸렸는가**다.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

type Listener = (details: { url: string; preventDefault: () => void }) => void

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

let windows: FakeWindow[] = []
let ready = true

function constructWindow(): FakeWindow {
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

const BrowserWindowMock = Object.assign(vi.fn(constructWindow), { getAllWindows: () => windows })

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('electron', () => ({
  app: { isReady: () => ready },
  BrowserWindow: BrowserWindowMock,
  shell: { openExternal: vi.fn() }
}))

const { createWindow, showOrCreateMainWindow } = await import('./main-window')

beforeEach(() => {
  windows = []
  ready = true
  BrowserWindowMock.mockClear()
})

/** 그 창의 webContents에 `event`로 걸린 리스너. 없으면 undefined. */
function listenerFor(win: FakeWindow, event: string): Listener | undefined {
  const call = win.webContents.on.mock.calls.find((c) => c[0] === event)
  return call?.[1] as Listener | undefined
}

describe('createWindow가 네비게이션 가드를 건다', () => {
  // 세 이벤트가 각각 다른 길을 막는다(main-window.ts의 주석). 하나라도 빠지면
  // 그 길로 넘어간 문서가 preload를 다시 받아 `window.api`를 통째로 물려받는다.
  for (const event of ['will-navigate', 'will-frame-navigate', 'will-redirect']) {
    it(`'${event}'에서 앱 밖 URL을 막는다`, () => {
      const win = createWindow() as unknown as FakeWindow
      const listener = listenerFor(win, event)
      expect(listener, `'${event}' 리스너가 걸리지 않았다`).toBeTypeOf('function')

      const preventDefault = vi.fn()
      listener?.({ url: 'https://evil.example/phish', preventDefault })
      expect(preventDefault).toHaveBeenCalled()
    })
  }

  it('앱 문서 자체로의 이동은 막지 않는다 — 가드가 정상 로드를 막으면 앱이 안 뜬다', () => {
    const win = createWindow() as unknown as FakeWindow
    const startUrl = String(win.loadURL.mock.calls[0]?.[0])
    const preventDefault = vi.fn()
    listenerFor(win, 'will-navigate')?.({ url: startUrl, preventDefault })
    expect(preventDefault).not.toHaveBeenCalled()
  })
})

/**
 * Regression: macOS에서 greenday:// 링크로 앱을 처음 켜면 크래시했다.
 *
 * `open-url`은 콜드 런치 때 'ready'보다 먼저 온다 — 그래서 index.ts가 그 리스너를
 * whenReady 밖에 건다. 그런데 그 리스너가 부르는 `showOrCreateMainWindow()`는 창이
 * 없으면 `new BrowserWindow`를 했고, 준비 전의 그것은 "Cannot create BrowserWindow
 * before app is ready"로 던진다. 살아남았더라도 whenReady의 `createWindow()`가 창을
 * 하나 더 만들었을 것이다. 준비 전에는 아무것도 만들지 않는다 — 창은 whenReady가 띄운다.
 */
describe('showOrCreateMainWindow — 앱이 준비되기 전', () => {
  it('창을 만들지 않는다', () => {
    ready = false
    expect(showOrCreateMainWindow()).toBeNull()
    expect(BrowserWindowMock).not.toHaveBeenCalled()
    expect(windows).toEqual([])
  })

  it('준비된 뒤에는 창이 없으면 만든다 — 위 가드가 원래 길을 막지 않는다', () => {
    expect(showOrCreateMainWindow()).not.toBeNull()
    expect(BrowserWindowMock).toHaveBeenCalledTimes(1)
  })
})
