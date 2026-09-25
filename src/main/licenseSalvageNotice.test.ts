import { describe, it, expect, vi } from 'vitest'

/**
 * Regression: 깨진 `license.json`을 옆으로 치운 부팅이 **사용자에게 아무 말도 하지 않았다**.
 *
 * `licenseStore.read()`는 못 읽는 파일을 `.corrupt-<ts>` 사본으로 복사해 두고 빈
 * 레코드로 시작한다(licenseStore.ts). `service.licenseStoreSalvaged()`는 바로 그
 * 사실을 말하라고 만들어 둔 함수인데 main·preload·renderer 어디에도 부르는 곳이
 * 없었다 — 그래서 돈 낸 사람에게는 등록한 키가 이유 없이 사라지고, 옆에 복구되는
 * 사본이 있다는 것도 알 길이 없었다. `IS_ENFORCED`를 켜는 날에는 같은 경로가
 * "체험 기간이 끝났습니다" 잠금 화면으로 끝난다. 그 배선을 여기서 못박는다.
 *
 * **부팅 본문을 실제로 돌린다.** `quitFlush.test.ts`는 `whenReady`를 영원히 붙잡아
 * 모듈 수준 배선만 보는데, 이 줄은 `whenReady` 안쪽에 있어 그 방식으로는 안 보인다.
 */

const showErrorBox = vi.fn()
const initLicensing = vi.fn()
let salvaged = false
let readyResolve: () => void = () => {}
let ready: Promise<void> = Promise.resolve()

vi.mock('electron', () => ({
  app: {
    requestSingleInstanceLock: () => true,
    whenReady: () => ready,
    on: vi.fn(),
    quit: vi.fn(),
    setAsDefaultProtocolClient: vi.fn(),
    getPath: () => '/tmp/greenday-license-salvage-test',
    isPackaged: false
  },
  BrowserWindow: Object.assign(
    function BrowserWindow(this: Record<string, unknown>) {
      this.on = vi.fn()
      this.show = vi.fn()
      this.loadURL = vi.fn()
      this.webContents = { on: vi.fn(), setWindowOpenHandler: vi.fn(), send: vi.fn() }
    },
    { getAllWindows: () => [], getFocusedWindow: () => null }
  ),
  dialog: { showErrorBox, showSaveDialog: vi.fn(), showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  globalShortcut: { register: vi.fn(), unregisterAll: vi.fn() },
  // 알림을 못 띄우는 플랫폼으로 둔다 — 60초 리마인더 폴러가 안 걸려야 테스트가 끝난다.
  Notification: Object.assign(
    function Notification() {
      return { show: vi.fn() }
    },
    { isSupported: () => false }
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

// `is.dev`가 참이면 `canSelfUpdate`가 꺼져 업데이터의 1시간 인터벌이 안 걸린다.
// `needsLicenseKey`는 스토어 빌드 여부만 보므로 여전히 참이다 — 안내가 떠야 하는 빌드다.
vi.mock('@electron-toolkit/utils', () => ({
  electronApp: { setAppUserModelId: vi.fn() },
  optimizer: { watchWindowShortcuts: vi.fn() },
  is: { dev: true }
}))

vi.mock('./database', () => ({
  closeDatabase: vi.fn(() => true),
  initDatabase: vi.fn(),
  getTasks: () => [],
  holdSaves: vi.fn()
}))
vi.mock('./reminders', () => ({ dueReminders: () => [] }))
vi.mock('./ipc-handlers', () => ({ setupIpcHandlers: vi.fn() }))
vi.mock('./app-ipc', () => ({ setupAppIpc: vi.fn() }))
vi.mock('./migration/boot', () => ({ runMigrationOnBoot: vi.fn(), setupMigrationIpc: vi.fn() }))
vi.mock('./app-menu', () => ({ applyAppMenu: vi.fn() }))
vi.mock('./google-auth-flow', () => ({ handleGoogleCallback: vi.fn() }))
vi.mock('./licensing/service', () => ({
  initLicensing,
  disposeLicensing: vi.fn(),
  licenseStoreSalvaged: () => salvaged
}))

const { mainStrings } = await import('../shared/main-strings')
const s = mainStrings('ko')

/** 부팅 본문은 `whenReady` 안쪽이라, 모듈을 새로 들여와 그 약속을 풀어 줘야 돈다. */
async function boot(withSalvagedFile: boolean): Promise<void> {
  salvaged = withSalvagedFile
  showErrorBox.mockClear()
  initLicensing.mockClear()
  ready = new Promise<void>((r) => {
    readyResolve = r
  })
  vi.resetModules()
  await import('./index')
  readyResolve()
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
  expect(initLicensing, '부팅 본문이 안 돌았다 — 아래 단언이 무의미해진다').toHaveBeenCalledTimes(1)
}

describe('깨진 license.json 을 옆으로 치웠으면 사용자에게 말한다', () => {
  it('안내를 띄운다 — 말하지 않으면 유료 활성화가 조용히 사라진다', async () => {
    await boot(true)
    expect(showErrorBox, '깨진 라이선스 파일을 옆으로 치웠는데 사용자에게 아무 말도 하지 않았다').toHaveBeenCalledTimes(
      1
    )
    expect(showErrorBox.mock.calls[0]).toEqual([s.licenseSalvagedTitle, s.licenseSalvagedBody])
  })

  it('멀쩡하면 아무것도 띄우지 않는다', async () => {
    await boot(false)
    expect(showErrorBox).not.toHaveBeenCalled()
  })
})
