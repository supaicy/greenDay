import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Regression: 진단 2.6 / 3장 #10·#17 — macOS Cmd+Q가 DB를 플러시하지 않았다.
 * Found by /qa on 2026-09-25
 * Report: docs/reports/2026-09-25-전체-진단.html
 *
 * `closeDatabase()`를 부르는 곳이 `window-all-closed` 하나뿐이었는데, Electron은
 * **종료 중에는 그 이벤트를 내지 않는다**(Cmd+Q / `app.quit()` → `before-quit` →
 * 창 닫기 → `will-quit`). 그래서 macOS의 정상 종료 경로에서 마지막 저장이
 * 통째로 건너뛰어졌고, 저장이 300ms 디바운스라 방금 적은 것이 조용히 사라졌다.
 *
 * 테스트 1450개가 전부 초록이었던 이유: 이 배선을 보는 테스트가 없었다.
 * DB 테스트들은 전부 `db.closeDatabase()`를 손으로 부른다 — 누가 부르는지는
 * 아무도 확인하지 않았다. 그 자리를 여기서 못박는다.
 */

const listeners = new Map<string, ((...args: unknown[]) => unknown)[]>()
const closeDatabase = vi.fn(() => true)
const showErrorBox = vi.fn()

vi.mock('electron', () => ({
  app: {
    requestSingleInstanceLock: () => true,
    // whenReady를 영원히 붙잡아 둔다 — 이 테스트가 보는 것은 모듈 수준의 배선이라
    // 부팅 본문(DB 초기화·창 생성·IPC 등록)까지 끌고 올 이유가 없다.
    whenReady: () => new Promise(() => {}),
    on: (event: string, cb: (...args: unknown[]) => unknown) => {
      listeners.set(event, [...(listeners.get(event) ?? []), cb])
    },
    quit: vi.fn(),
    setAsDefaultProtocolClient: vi.fn(),
    getPath: () => '/tmp/greenday-test',
    isPackaged: false
  },
  BrowserWindow: Object.assign(
    function BrowserWindow() {},
    { getAllWindows: () => [], getFocusedWindow: () => null }
  ),
  dialog: { showErrorBox, showSaveDialog: vi.fn(), showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  globalShortcut: { register: vi.fn(), unregisterAll: vi.fn() },
  Notification: Object.assign(
    function Notification() {
      return { show: vi.fn() }
    },
    { isSupported: () => true }
  ),
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: vi.fn(), decryptString: vi.fn() },
  nativeTheme: { on: vi.fn() },
  Menu: { buildFromTemplate: (t: unknown) => t, setApplicationMenu: vi.fn() }
}))

vi.mock('electron-updater', () => ({
  autoUpdater: { on: vi.fn(), checkForUpdates: vi.fn(), autoDownload: false, autoInstallOnAppQuit: false }
}))

vi.mock('./database', () => ({
  closeDatabase,
  initDatabase: vi.fn(),
  getTasks: () => [],
  holdSaves: vi.fn()
}))

vi.mock('@electron-toolkit/utils', () => ({
  electronApp: { setAppUserModelId: vi.fn() },
  optimizer: { watchWindowShortcuts: vi.fn() },
  is: { dev: false }
}))

vi.mock('./reminders', () => ({ dueReminders: () => [] }))
vi.mock('./ipc-handlers', () => ({ setupIpcHandlers: vi.fn() }))
vi.mock('./app-ipc', () => ({ setupAppIpc: vi.fn() }))
vi.mock('./migration/boot', () => ({ runMigrationOnBoot: vi.fn(), setupMigrationIpc: vi.fn() }))
vi.mock('./app-menu', () => ({ applyAppMenu: vi.fn() }))
vi.mock('./licensing/service', () => ({ initLicensing: vi.fn(), disposeLicensing: vi.fn() }))
vi.mock('./google-auth-flow', () => ({ handleGoogleCallback: vi.fn() }))

// 모듈 수준에서 app.on(...)을 등록하므로, import 자체가 배선이다.
await import('./index')

function fire(event: string): void {
  const cbs = listeners.get(event)
  expect(cbs, `'${event}' 리스너가 등록되지 않았다`).toBeDefined()
  for (const cb of cbs ?? []) cb()
}

beforeEach(() => {
  closeDatabase.mockClear()
  closeDatabase.mockReturnValue(true)
  showErrorBox.mockClear()
})

describe('종료 경로가 DB를 플러시한다', () => {
  it("'before-quit'에 리스너가 걸려 있다 — Cmd+Q가 지나는 유일한 자리다", () => {
    // Electron 문서: "If the user pressed Cmd+Q ... the window-all-closed event
    // would not be emitted." 그래서 before-quit이 없으면 macOS 종료는 플러시를 못 만난다.
    expect(listeners.get('before-quit')).toBeDefined()
  })

  it("'before-quit'이 closeDatabase를 부른다", () => {
    fire('before-quit')
    expect(closeDatabase).toHaveBeenCalledTimes(1)
  })

  it("'window-all-closed'(윈도·리눅스 창 닫기)도 계속 플러시한다", () => {
    fire('window-all-closed')
    expect(closeDatabase).toHaveBeenCalledTimes(1)
  })

  it('플러시가 실패하면 조용히 넘어가지 않고 사용자에게 알린다', () => {
    // closeDatabase()가 boolean을 돌려주는 이유가 "마지막 편집을 잃은 종료와
    // 정상 종료를 구별하라"였는데, 그 값을 아무도 읽지 않고 버리고 있었다.
    closeDatabase.mockReturnValue(false)
    fire('before-quit')
    expect(showErrorBox).toHaveBeenCalledTimes(1)
  })

  it('플러시가 성공하면 아무것도 띄우지 않는다', () => {
    fire('before-quit')
    expect(showErrorBox).not.toHaveBeenCalled()
  })
})
