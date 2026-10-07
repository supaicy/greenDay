import { describe, it, expect, vi } from 'vitest'

/**
 * Regression: 메인이 스스로 띄우는 대화상자가 한국어가 아닌 OS에서도 한국어로 떴다.
 *
 * `ui-language.ts`의 `uiLanguage` 기본값은 'ko'였고, 그 값을 바꾸는 유일한 길이
 * 렌더러의 `set-language` IPC였다. 그 IPC는 창이 뜨고 페이지가 로드된 뒤에야
 * 도착하는데, 메인이 직접 띄우는 대화상자 둘은 `createWindow()` **앞**에 뜬다 —
 * 번들 ID 이전 설치의 Keychain 안내(`migration/boot.ts`의 `notifyKeychain`)와
 * 데이터 손상 알림(`index.ts`의 initDatabase catch). 그래서 영어 사용자는
 * "항상 허용"을 누를지 정하는 그 순간에 한국어 모달을 봤고(거부하면 AI 키·캘린더
 * 앱 암호·Google 연결이 함께 끊긴다), `shared/main-strings.ts`의 영어 문구 다섯 —
 * `keychainNotice*` 셋 · `dbFailed*` 둘 — 은 아무도 못 보는 죽은 번역이었다.
 *
 * **배선을 본다.** `seedUiLanguage()`가 로케일을 옳게 매핑하는지만 확인하면 부족하다
 * — 그 함수를 `initDatabase()`보다 뒤에서 부르거나 아예 안 불러도 그런 단위 테스트는
 * 통과한다. `app-menu.ts`의 `applyLanguage` 주석이 남긴 것과 같은 함정이다. 그래서
 * 여기서는 부팅 본문을 실제로 돌리고 **대화상자가 불린 그 순간의 문구**를 본다.
 */

const showErrorBox = vi.fn()
/** `runMigrationOnBoot`가 불린 그 순간의 문구 — Keychain 안내가 읽는 값이다. */
const atMigration: { title: string | null } = { title: null }

vi.mock('electron', () => ({
  app: {
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    on: vi.fn(),
    quit: vi.fn(),
    // 이 테스트의 전제. 한국어가 아닌 OS다.
    getLocale: () => 'en-US',
    setAsDefaultProtocolClient: vi.fn(),
    getPath: () => '/tmp/greenday-boot-language-test',
    getVersion: () => '2.0.0',
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
  dialog: { showErrorBox, showMessageBoxSync: vi.fn(() => 0) },
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
vi.mock('@electron-toolkit/utils', () => ({
  electronApp: { setAppUserModelId: vi.fn() },
  optimizer: { watchWindowShortcuts: vi.fn() },
  is: { dev: true }
}))

// 데이터 파일이 깨진 세션 — index.ts가 showErrorBox로 직접 알리는 분기다.
vi.mock('./database', () => ({
  initDatabase: () => {
    throw new Error('corrupt')
  },
  closeDatabase: vi.fn(() => true),
  getTasks: () => [],
  holdSaves: vi.fn()
}))
vi.mock('./reminders', () => ({ dueReminders: () => [] }))
vi.mock('./ipc-handlers', () => ({ setupIpcHandlers: vi.fn() }))
vi.mock('./app-ipc', () => ({ setupAppIpc: vi.fn() }))
vi.mock('./app-menu', () => ({ applyAppMenu: vi.fn() }))
vi.mock('./google-auth-flow', () => ({ handleGoogleCallback: vi.fn() }))
vi.mock('./licensing/service', () => ({
  initLicensing: vi.fn(),
  disposeLicensing: vi.fn(),
  // 라이선스 안내는 이 테스트의 관심이 아니다 — showErrorBox 호출이 섞이지 않게 끈다.
  licenseStoreSalvaged: () => false
}))
// Keychain 안내는 실제로 `runArrival` 안쪽에서 뜨므로, 여기서는 **불린 시점의 문구**만
// 잡는다. 씨앗이 이 호출보다 뒤에 있으면 여기 담기는 값이 한국어가 된다.
vi.mock('./migration/boot', async () => {
  const { uiStrings } = await import('./ui-language')
  return {
    runMigrationOnBoot: vi.fn(() => {
      atMigration.title = uiStrings().keychainNoticeTitle
    }),
    setupMigrationIpc: vi.fn()
  }
})

const { seedUiLanguage, setUiLanguage, uiStrings } = await import('./ui-language')
const { mainStrings } = await import('../shared/main-strings')
// 모듈 수준에서 whenReady().then(...)을 건다 — import 자체가 부팅이다.
await import('./index')

describe('한국어가 아닌 OS에서의 부팅 문구', () => {
  it('창보다 먼저 뜨는 대화상자 둘이 OS 언어를 따른다', async () => {
    await new Promise((r) => setTimeout(r, 0))

    // (a) 데이터 손상 알림 — 원본을 보존했다는 말이 여기 말고는 없다.
    expect(showErrorBox, '부팅 본문이 안 돌았다 — 아래 단언이 무의미해진다').toHaveBeenCalledTimes(1)
    expect(showErrorBox.mock.calls[0][0]).toBe(mainStrings('en').dbFailedTitle)
    expect(showErrorBox.mock.calls[0][1]).toBe(mainStrings('en').dbFailedBody)

    // (b) Keychain 안내 — 씨앗이 `runMigrationOnBoot`보다 **앞**이어야 한다.
    expect(atMigration.title, 'Keychain 안내가 씨앗보다 먼저 읽혔다').toBe(mainStrings('en').keychainNoticeTitle)
  })

  // 위 테스트와 독립이다 — 씨앗이 어떤 값을 남겼든 여기서 렌더러가 다시 말한다.
  // (반환값 계약은 `app-menu.test.ts`가 따로 못박는다.)
  it('렌더러가 말하면 그쪽이 이긴다 — 설정에서 고른 언어는 localStorage에 있어 메인이 못 읽는다', () => {
    setUiLanguage('ko')
    expect(uiStrings().dbFailedTitle).toBe(mainStrings('ko').dbFailedTitle)
    // 뒤늦게 불린 씨앗이 사용자의 선택을 OS 로케일로 되돌리지 않는다.
    seedUiLanguage('en-US')
    expect(uiStrings().dbFailedTitle).toBe(mainStrings('ko').dbFailedTitle)
  })
})
