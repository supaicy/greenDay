import { app, shell, BrowserWindow, dialog, globalShortcut, Notification } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { initDatabase, closeDatabase, getTasks } from './database'
import { dueReminders } from './reminders'
import { setupIpcHandlers } from './ipc-handlers'
import { setupAppIpc } from './app-ipc'
import { uiStrings } from './ui-language'
import { currentCapabilities } from './capabilities'
import { applyAppMenu } from './app-menu'
import { disposeLicensing, initLicensing } from './licensing/service'
import { handleGoogleCallback } from './google-auth-flow'
import { appDocumentUrl, isAppDocumentUrl } from './navigation-guard'
import { APP_BUNDLE_ID, isAppScheme, findAppSchemeArg } from '../shared/app-id'

// 리마인더 폴러 인터벌 핸들 (모듈 스코프에서 선언해 will-quit 핸들러에서 접근 가능)
let reminderInterval: ReturnType<typeof setInterval> | null = null

/** 브라우저에서 돌아왔으니 창을 앞으로 가져온다. */
function focusMainWindow(): void {
  const [win] = BrowserWindow.getAllWindows()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
}

/**
 * 구글 OAuth 콜백 URL 하나를 처리한다. macOS(open-url)와 Windows(second-instance argv)가
 * 같은 자리로 들어오도록 한 곳에 모았다 — 두 경로가 갈리면 한쪽만 고쳐지는 일이 생긴다.
 */
function receiveOAuthCallback(url: string): void {
  void handleGoogleCallback(url)
  focusMainWindow()
}

function createWindow(): void {
  const startUrl = appDocumentUrl(
    is.dev ? process.env.ELECTRON_RENDERER_URL : undefined,
    join(__dirname, '../renderer/index.html')
  )
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    backgroundColor: '#1C1C1E',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const parsed = new URL(details.url)
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        shell.openExternal(details.url)
      }
    } catch {
      /* ignore */
    }
    return { action: 'deny' }
  })

  // **이 창은 앱 문서 밖으로 나가지 않는다** (`navigation-guard.ts` 참고).
  //
  // 위 `setWindowOpenHandler`는 **새 창**만 본다. 같은 창이 다른 문서로 넘어가는 길 —
  // 창에 파일 떨어뜨리기, `location.href`, `target=_self` 링크, 폼 제출 — 은 하나도
  // 지나지 않는다. 그리고 넘어간 문서에서 preload가 다시 돌아 `window.api`가 통째로
  // 노출된다(Electron 40에서 실측: 79개 키).
  //
  // **두 이벤트 다 건다.** `will-navigate`는 최상위 프레임만 보고,
  // `will-frame-navigate`는 하위 프레임까지 본다(그리고 최상위에서는 이쪽이 먼저
  // 발화한다). 오늘 이 앱에 iframe이 없다는 것은 방어가 아니라 우연이다.
  const blockForeignNavigation = (details: { url: string; preventDefault: () => void }): void => {
    if (isAppDocumentUrl(details.url, startUrl)) return
    details.preventDefault()
    console.warn('[security] 앱 문서 밖으로의 네비게이션을 막았다:', details.url)
  }
  mainWindow.webContents.on('will-navigate', blockForeignNavigation)
  mainWindow.webContents.on('will-frame-navigate', blockForeignNavigation)

  // 가드가 비교할 기준과 실제로 로드하는 값이 **같은 문자열**이어야 한다. 예전처럼
  // `loadFile(경로)`가 URL을 스스로 만들면 기준을 손으로 한 번 더 조립하게 되고,
  // 둘이 갈리는 순간 가드가 정상 문서를 막아 앱이 아예 안 뜬다.
  mainWindow.loadURL(startUrl)
}

// 단일 인스턴스 락. 두 가지를 동시에 한다:
//
//   1. 데이터: DB는 JSON 파일 하나를 통째로 덮어쓴다(database.ts:77). 인스턴스가 둘이면
//      같은 파일을 두 곳에서 쓰게 된다. macOS도 `open -n` 으로 재현된다.
//   2. Windows 딥링크: Windows는 open-url을 발화하지 않는다. 구글 콜백은 "앱을 한 번 더
//      실행하면서 넘기는 argv"로 오고, 그걸 받는 자리가 아래 second-instance 다.
//
// 락 검사는 반드시 whenReady 앞이다. 뒤에 두면 물러날 인스턴스가 initDatabase()와
// createWindow()까지 실행해 창이 깜빡인다.
if (!app.requestSingleInstanceLock()) {
  // 우리가 받은 argv는 아래 second-instance로 첫 인스턴스에 전달된다. 조용히 물러난다.
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const url = findAppSchemeArg(argv)
    if (url) receiveOAuthCallback(url)
    else focusMainWindow() // 그냥 두 번 실행한 경우 — 새 창 대신 기존 창을 앞으로
  })

  bootstrap()
}

function bootstrap(): void {
  app.whenReady().then(async () => {
    // **창 만드는 길을 먼저 연다.** 아래 초기화가 던지면 그 뒤가 전부 안 도는데,
    // macOS에서는 `window-all-closed`가 앱을 끝내지 않으므로 `activate` 핸들러가
    // 등록되기 전에 던지면 창을 영영 만들 수 없는 독 아이콘이 남는다. 데이터
    // 파일이 한 번 깨지면 재설치 말고는 빠져나올 길이 없다.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })

    electronApp.setAppUserModelId(APP_BUNDLE_ID)

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // 구글 OAuth 콜백을 받을 커스텀 스킴. 루프백 서버를 열지 않으므로 MAS 샌드박스에서
    // network.server 권한이 필요 없다.
    if (is.dev && process.platform === 'darwin') {
      // 개발 중에는 Electron 실행 파일이 아니라 이 프로젝트를 핸들러로 등록해야 한다.
      app.setAsDefaultProtocolClient(APP_BUNDLE_ID, process.execPath, [join(__dirname, '../..')])
    } else {
      app.setAsDefaultProtocolClient(APP_BUNDLE_ID)
    }

    try {
      initDatabase()
    } catch (error) {
      // 데이터 파일이 깨졌다. 여기서 그냥 던지면 아래가 전부 안 돌아 창도,
      // IPC도, 메뉴도 없는 상태가 된다 — 사용자에게는 반응 없는 독 아이콘이다.
      // 무엇이 잘못됐는지 말해 주고, 창은 띄운다.
      console.error('[bootstrap] 데이터베이스 초기화 실패', error)
      dialog.showErrorBox(uiStrings().dbFailedTitle, uiStrings().dbFailedBody)
    }
    // 출하 빌드에서 개발자 도구 메뉴 항목을 뺀다 (app-menu.ts).
    applyAppMenu(is.dev)
    setupIpcHandlers()

    setupAppIpc(is.dev)
    createWindow()

    // **창을 띄운 뒤에** 초기화한다. 토큰이 있는 설치에서는 여기서 기기 id를
    // 읽느라 동기 서브프로세스(macOS는 ioreg)가 돌고, 그게 창 생성 앞에 있으면
    // 유료 사용자만 매 실행 그만큼 늦게 창을 본다. 핸들러는 이미 등록돼 있고
    // `licensing()`을 호출 시점에 읽으므로 순서가 뒤여도 안전하다 —
    // 렌더러의 첫 IPC는 페이지 로드 뒤라 이 줄보다 한참 뒤다.
    initLicensing()

    // 리마인더 폴러: 60초마다 도래한 리마인더를 확인하고 시스템 알림 발화.
    // isSupported()는 '플랫폼이 알림을 띄울 수 있는가'만 답한다(사용자 허용 여부는 알 수 없다).
    // 못 띄우는 플랫폼이면 폴러를 아예 걸지 않는다 — 창을 열어 두면 lastReminderCheck만
    // 전진해 그 구간의 리마인더가 영영 소모돼 버린다.
    if (Notification.isSupported()) {
      let lastReminderCheck = new Date().toISOString() // 앱 시작 시점 기록 (과거 리마인더 무시)
      reminderInterval = setInterval(() => {
        const now = new Date().toISOString()
        for (const t of dueReminders(getTasks() as Record<string, unknown>[], lastReminderCheck, now)) {
          new Notification({ title: uiStrings().reminder, body: String(t.title ?? '') }).show()
        }
        lastReminderCheck = now
      }, 60 * 1000)
    }

    // 자동 업데이트 설정. 스토어 빌드와 개발 빌드에서는 꺼진다 (shared/capabilities.ts)
    if (currentCapabilities().canSelfUpdate) {
      autoUpdater.autoDownload = false
      autoUpdater.autoInstallOnAppQuit = true

      autoUpdater.on('update-available', (info) => {
        const wins = BrowserWindow.getAllWindows()
        if (wins.length > 0) {
          wins[0].webContents.send('update-available', {
            version: info.version,
            downloadUrl: `https://github.com/supaicy/haru/releases/tag/v${info.version}`
          })
        }
      })

      autoUpdater.on('update-not-available', () => {
        const wins = BrowserWindow.getAllWindows()
        if (wins.length > 0) {
          wins[0].webContents.send('update-not-available')
        }
      })

      autoUpdater.on('download-progress', (progress) => {
        const wins = BrowserWindow.getAllWindows()
        if (wins.length > 0) {
          wins[0].webContents.send('update-download-progress', Math.round(progress.percent))
        }
      })

      autoUpdater.on('update-downloaded', () => {
        const wins = BrowserWindow.getAllWindows()
        if (wins.length > 0) {
          wins[0].webContents.send('update-downloaded')
        }
      })

      autoUpdater.checkForUpdates()
      const updateInterval = setInterval(() => autoUpdater.checkForUpdates(), 60 * 60 * 1000)
      app.on('will-quit', () => clearInterval(updateInterval))
    }
  })

  // macOS는 이미 실행 중인 앱에 open-url로 콜백을 전달한다. whenReady 밖에 둬야
  // 앱이 스킴 링크로 처음 켜지는 경우도 놓치지 않는다.
  // (Windows는 이 이벤트를 발화하지 않는다 — 위 second-instance가 그 역할이다.)
  app.on('open-url', (event, url) => {
    if (!isAppScheme(url)) return
    event.preventDefault()
    receiveOAuthCallback(url)
  })

  app.on('window-all-closed', () => {
    closeDatabase()
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('will-quit', () => {
    // 리마인더 폴러 정리
    if (reminderInterval) clearInterval(reminderInterval)
    // 라이선스 마감 타이머 정리 — 안 끄면 종료가 최대 24일 지연된다.
    disposeLicensing()
    globalShortcut.unregisterAll()
  })
}
