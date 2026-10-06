import { describe, it, expect, vi, afterAll, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

/**
 * Regression: autoUpdater에 'error' 리스너가 없어 오프라인 실행이 크래시 창을 띄웠다.
 *
 * `autoUpdater`는 EventEmitter다. electron-updater의 `checkForUpdates()`는 실패를
 * `emit('error', e, …)`로 알리는데(`out/AppUpdater.js`), 'error'는 **리스너가 없으면
 * emit 자체가 던진다**. 그 예외가 `checkForUpdates()`의 프라미스를 거절시키고,
 * index.ts가 그 프라미스를 버려서 처리되지 않은 rejection이 됐다 — Electron 기본
 * 핸들러가 "A JavaScript error occurred in the main process" 모달을 띄운다.
 * 실행할 때 한 번, 그 뒤 60분마다 한 번씩. 비행기 안에서 앱을 켜 둔 사람에게는
 * 한 시간에 한 번씩 스택 트레이스가 뜬다.
 *
 * 그리고 렌더러는 available/not-available 두 IPC로만 `updateChecked`를 올리므로
 * 설정의 '버전 정보'가 "업데이트 확인 중…"에서 영영 멈췄다. 두 증상이 같은
 * 누락에서 나온다.
 *
 * 이 파일이 잡는 것은 리스너의 존재가 아니라 **결과**다 — 새는 rejection이 없고,
 * 렌더러가 실패를 통보받는다. 형제 파일 `quitFlush.test.ts`와 같은 이유로 존재한다:
 * 부팅 배선은 아무도 안 보는 자리라 테스트 1400개가 초록이어도 깨져 있을 수 있다.
 */

const listeners = new Map<string, ((...a: unknown[]) => unknown)[]>()
const sent: [string, ...unknown[]][] = []

const fakeWindow = {
  on: vi.fn(),
  once: vi.fn(),
  show: vi.fn(),
  focus: vi.fn(),
  restore: vi.fn(),
  isMinimized: () => false,
  loadURL: vi.fn(),
  loadFile: vi.fn(),
  setWindowOpenHandler: vi.fn(),
  webContents: {
    send: (ch: string, ...rest: unknown[]) => {
      sent.push([ch, ...rest])
    },
    setWindowOpenHandler: vi.fn(),
    on: vi.fn(),
    session: { webRequest: { onBeforeRequest: vi.fn() } }
  }
}

vi.mock('electron', () => ({
  app: {
    requestSingleInstanceLock: () => true,
    // quitFlush.test.ts와 달리 **whenReady를 풀어 준다** — 업데이터 배선은
    // `whenReady().then()` 본문 안에 있어서, 붙잡아 두면 이 파일은 아무것도 못 본다.
    whenReady: () => Promise.resolve(),
    on: (event: string, cb: (...a: unknown[]) => unknown) => {
      listeners.set(event, [...(listeners.get(event) ?? []), cb])
    },
    quit: vi.fn(),
    setAsDefaultProtocolClient: vi.fn(),
    getPath: () => '/tmp/greenday-test',
    getLocale: () => 'ko-KR',
    isPackaged: true
  },
  BrowserWindow: Object.assign(
    function BrowserWindow() {
      return fakeWindow
    },
    { getAllWindows: () => [fakeWindow], getFocusedWindow: () => fakeWindow }
  ),
  dialog: {
    showErrorBox: vi.fn(),
    showSaveDialog: vi.fn(),
    showOpenDialog: vi.fn(),
    showMessageBox: vi.fn()
  },
  globalShortcut: { register: vi.fn(), unregisterAll: vi.fn() },
  Notification: Object.assign(
    function Notification() {
      return { show: vi.fn() }
    },
    // 리마인더 폴러는 이 파일의 관심사가 아니다 — 60초 인터벌을 안 걸어 둔다.
    { isSupported: () => false }
  ),
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: vi.fn(), decryptString: vi.fn() },
  nativeTheme: { on: vi.fn() },
  Menu: { buildFromTemplate: (t: unknown) => t, setApplicationMenu: vi.fn() }
}))

/**
 * electron-updater의 실패 모양을 **그대로** 흉내낸다(`out/AppUpdater.js`):
 *   doCheckForUpdates().catch(e => { this.emit("error", e, …); throw e })
 * 여기서 진짜 EventEmitter로 만드는 것이 핵심이다 — `vi.fn()` 짝퉁이면 emit이
 * 던지지 않아서 이 버그가 통째로 가려진다.
 */
class FakeUpdater extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = false
  checkCalls = 0
  /**
   * 켜 두면 확인이 끝나지 않고 매달린다 — 한 시간마다 도는 확인이 **진행 중인 동안**
   * 다른 'error'가 오는 상황을 만든다. `settle`로 풀어 준다.
   */
  hangChecks = false
  settle: (() => void) | null = null
  checkForUpdates(): Promise<unknown> {
    this.checkCalls += 1
    if (this.hangChecks) {
      return new Promise((resolve) => {
        this.settle = () => resolve(null)
      })
    }
    return Promise.reject(new Error('net::ERR_INTERNET_DISCONNECTED')).catch((e: Error) => {
      this.emit('error', e, `Cannot check for updates: ${e.stack}`)
      throw e
    })
  }
  /**
   * 다운로드 실패도 같은 'error'로 온다(`downloadUpdate`의 `errorHandler` →
   * `dispatchError` → `emit("error", e, …)`). 확인 실패와 이벤트 이름이 같다는 것이
   * 이 파일 아래쪽 describe의 요점이다.
   */
  downloadUpdate(): Promise<unknown> {
    return Promise.reject(new Error('net::ERR_CONNECTION_RESET')).catch((e: Error) => {
      this.emit('error', e, String(e.stack))
      throw e
    })
  }
  quitAndInstall = vi.fn()
}
const fakeUpdater = new FakeUpdater()
vi.mock('electron-updater', () => ({ autoUpdater: fakeUpdater }))

vi.mock('./database', () => ({
  closeDatabase: () => true,
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
vi.mock('./app-menu', () => ({ applyAppMenu: vi.fn(), applyLanguage: vi.fn() }))
vi.mock('./licensing/service', () => ({
  initLicensing: vi.fn(),
  disposeLicensing: vi.fn(),
  licenseStoreSalvaged: () => false
}))
vi.mock('./google-auth-flow', () => ({ handleGoogleCallback: vi.fn() }))
// 창 생성은 이 파일의 관심사가 아니다 — 업데이터가 쓰는 건 getAllWindows()뿐이다.
vi.mock('./main-window', () => ({ createWindow: vi.fn(), showOrCreateMainWindow: vi.fn() }))
// 업데이터 블록은 canSelfUpdate 뒤에 있다 — 출하 빌드 흉내를 내야 들어간다.
vi.mock('./capabilities', () => ({
  currentBundleId: () => 'dev.begreen.greenday',
  currentCapabilities: () => ({
    canSelfUpdate: true,
    isStoreBuild: false,
    needsLicenseKey: true,
    enforcesLicense: true
  })
}))

const unhandled: unknown[] = []
const onUnhandled = (reason: unknown): void => {
  unhandled.push(reason)
}
// import 전에 걸어야 한다 — 부팅이 곧바로 checkForUpdates()를 부른다.
process.on('unhandledRejection', onUnhandled)
afterAll(() => process.off('unhandledRejection', onUnhandled))

/**
 * 한 시간 확인 인터벌의 콜백을 잡아 둔다. 진짜 타이머는 그대로 걸되(지연이 한 시간이라
 * 테스트 중에는 안 돈다) 콜백을 손에 쥐어야 "확인이 진행 중인 동안"을 만들 수 있다.
 */
const realSetInterval = globalThis.setInterval
const intervals: { fn: () => void; ms: number }[] = []
globalThis.setInterval = ((fn: () => void, ms?: number, ...rest: unknown[]) => {
  intervals.push({ fn, ms: ms ?? 0 })
  return realSetInterval(fn, ms, ...rest)
}) as typeof setInterval

await import('./index')
// `whenReady().then(...)` 본문과 마이크로태스크가 정리될 시간.
await new Promise((r) => setTimeout(r, 50))
globalThis.setInterval = realSetInterval
/** 부팅 확인이 남긴 것. 아래 다운로드 describe가 `sent`를 비우기 전에 찍어 둔다. */
const sentAtBoot = sent.map((s) => s[0])

describe('업데이트 확인이 실패했을 때', () => {
  it('부팅이 실제로 checkForUpdates를 불렀다 — 프로브가 헛돌지 않는지 먼저 본다', () => {
    // 이 줄이 없으면 mock 하나가 어긋나 본문이 통째로 안 돌아도 아래가 전부 초록이 된다.
    expect(fakeUpdater.checkCalls).toBeGreaterThan(0)
  })

  it('처리되지 않은 rejection으로 새지 않는다', () => {
    // 새면 Electron 기본 핸들러가 네이티브 크래시 창을 띄운다. 오프라인 실행마다, 매시간.
    expect(unhandled).toEqual([])
  })

  it('렌더러에 실패를 알린다 — 설정이 "업데이트 확인 중…"에 갇히지 않게', () => {
    expect(sentAtBoot).toContain('update-error')
  })

  it('확인 실패를 다운로드 실패로 말하지 않는다', () => {
    expect(sentAtBoot).not.toContain('update-download-error')
  })
})

/**
 * Regression: 다운로드 실패가 "업데이트 확인 실패"로 보였고 진행 막대가 멈췄다.
 *
 * electron-updater는 다운로드 실패도 'error'로 알린다. 리스너가 그걸 전부
 * 'update-error'로 보내서, 렌더러는 `updateFailed`를 세우고 설정은 "업데이트 확인
 * 실패 — 네트워크를 확인하세요"를 **"새 버전 사용 가능" 카드 바로 위에** 띄웠다.
 * `updateDownloadProgress`는 그대로라 막대가 그 자리에서 멈추고 다시 받기 버튼도
 * 돌아오지 않았다 — 앱을 다시 켜는 것 말고는 빠져나갈 길이 없었다.
 */
describe('업데이트 다운로드가 실패했을 때', () => {
  it("확인 실패와 다른 채널('update-download-error')로 알린다", async () => {
    sent.length = 0
    // app-ipc.ts의 'download-update' 핸들러가 하는 일 — 렌더러가 '지금 다운로드'를 눌렀다.
    await fakeUpdater.downloadUpdate().catch(() => {})
    const channels = sent.map((s) => s[0])
    expect(channels).toContain('update-download-error')
    expect(channels).not.toContain('update-error')
  })
})

/**
 * Regression: 한 시간마다 도는 확인이 진행 중일 때 다운로드가 끊기면 '확인 실패'로 나갔다.
 *
 * 리스너는 `checksInFlight > 0`만 보고 확인 실패로 판정했다. 그런데 백그라운드 확인은
 * 사용자가 '지금 다운로드'를 누른 것과 상관없이 한 시간마다 돈다 — 그 확인이 날아가는
 * 중에 다운로드가 끊기면 'update-error'로 나갔고, 설정은 새 버전 카드가 있으면 확인 실패를
 * 숨기므로 아무 말도 없이 진행 막대만 그 자리에 얼었다. 다운로드가 진행 중이면 그쪽이 이긴다.
 */
describe('확인이 진행 중일 때 다운로드가 끊기면', () => {
  const hourly = (): { fn: () => void } => {
    const found = intervals.find((i) => i.ms === 60 * 60 * 1000)
    expect(found, '한 시간 확인 인터벌을 찾지 못했다 — 프로브가 헛돈다').toBeDefined()
    return found as { fn: () => void }
  }

  // 단언이 먼저 실패해도 매달린 확인을 풀어 다음 테스트가 오염되지 않게.
  afterEach(async () => {
    fakeUpdater.settle?.()
    fakeUpdater.settle = null
    fakeUpdater.hangChecks = false
    await new Promise((r) => setTimeout(r, 0))
  })

  it("다운로드 실패('update-download-error')로 알린다", async () => {
    sent.length = 0
    fakeUpdater.hangChecks = true
    hourly().fn() // 한 시간 확인이 시작돼 아직 안 끝났다
    fakeUpdater.emit('download-progress', { percent: 40 })
    fakeUpdater.emit('error', new Error('net::ERR_CONNECTION_RESET'))
    const channels = sent.map((s) => s[0])
    expect(channels).toContain('update-download-error')
    expect(channels).not.toContain('update-error')
  })

  it('다운로드가 끝난 뒤의 확인 실패는 다시 확인 실패다 — 깃발이 남지 않는다', async () => {
    sent.length = 0
    fakeUpdater.emit('download-progress', { percent: 10 })
    fakeUpdater.emit('error', new Error('net::ERR_CONNECTION_RESET'))
    sent.length = 0
    hourly().fn() // 이번 확인은 실패한다(기본 모드)
    await new Promise((r) => setTimeout(r, 0))
    const channels = sent.map((s) => s[0])
    expect(channels).toContain('update-error')
    expect(channels).not.toContain('update-download-error')
  })

  it("'update-downloaded'도 깃발을 내린다", async () => {
    fakeUpdater.emit('download-progress', { percent: 99 })
    fakeUpdater.emit('update-downloaded', {})
    sent.length = 0
    hourly().fn()
    await new Promise((r) => setTimeout(r, 0))
    expect(sent.map((s) => s[0])).toContain('update-error')
  })
})
