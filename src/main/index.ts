import { app, BrowserWindow, dialog, globalShortcut, Notification } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { initDatabase, closeDatabase, getTasks, holdSaves } from './database'
import { dueReminders } from './reminders'
import { setupIpcHandlers } from './ipc-handlers'
import { setupAppIpc } from './app-ipc'
import { seedUiLanguage, uiStrings } from './ui-language'
import { currentBundleId, currentCapabilities } from './capabilities'
import { runMigrationOnBoot, setupMigrationIpc } from './migration/boot'
import { applyAppMenu } from './app-menu'
import { disposeLicensing, initLicensing, licenseStoreSalvaged } from './licensing/service'
import { handleGoogleCallback } from './google-auth-flow'
import { createWindow, showOrCreateMainWindow } from './main-window'
import { isAppScheme, findAppSchemeArg } from '../shared/app-id'

// 리마인더 폴러 인터벌 핸들 (모듈 스코프에서 선언해 will-quit 핸들러에서 접근 가능)
let reminderInterval: ReturnType<typeof setInterval> | null = null

/**
 * 구글 OAuth 콜백 URL 하나를 처리한다. macOS(open-url)와 Windows(second-instance argv)가
 * 같은 자리로 들어오도록 한 곳에 모았다 — 두 경로가 갈리면 한쪽만 고쳐지는 일이 생긴다.
 */
function receiveOAuthCallback(url: string): void {
  void handleGoogleCallback(url)
  // 창을 닫아 둔 채 브라우저에서 돌아오는 경우가 있다 — macOS는 마지막 창을 닫아도
  // 앱을 끝내지 않는다. 그때는 만들어서 보여 준다: 예전에는 여기서 조용히 돌아가
  // 토큰만 저장되고 사용자는 성공했는지 알 수 없었다.
  showOrCreateMainWindow()
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
const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) {
  // 우리가 받은 argv는 아래 second-instance로 첫 인스턴스에 전달된다. 조용히 물러난다.
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const url = findAppSchemeArg(argv)
    if (url) receiveOAuthCallback(url)
    else showOrCreateMainWindow() // 그냥 두 번 실행한 경우 — 새 창 대신 기존 창을 앞으로
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

    // 브리지 빌드는 옛 번들 ID(com.haru.app)로 등록한다 — capabilities.ts 참고.
    const bundleId = currentBundleId()
    electronApp.setAppUserModelId(bundleId)

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // 구글 OAuth 콜백을 받을 커스텀 스킴. 루프백 서버를 열지 않으므로 MAS 샌드박스에서
    // network.server 권한이 필요 없다.
    if (is.dev && process.platform === 'darwin') {
      // 개발 중에는 Electron 실행 파일이 아니라 이 프로젝트를 핸들러로 등록해야 한다.
      app.setAsDefaultProtocolClient(bundleId, process.execPath, [join(__dirname, '../..')])
    } else {
      app.setAsDefaultProtocolClient(bundleId)
    }

    // **메인이 스스로 띄우는 문구의 언어를 여기서 정한다.** 바로 아래 두 대화상자 —
    // initDatabase 실패 알림과 `runMigrationOnBoot`의 Keychain 안내 — 는 창보다 먼저
    // 뜨므로 렌더러의 `set-language`가 도착하기 전이다. 씨앗이 없으면 기본값 'ko'에
    // 묶여 영어 사용자도 한국어 모달을 봤다(`ui-language.ts` 참고). 렌더러가 말하면
    // 그쪽이 이긴다.
    //
    // `app.getLocale()`은 whenReady 뒤라야 값이 선다. 그래도 감싸는 이유는 이 줄이
    // 그 위 주석("창 만드는 길을 먼저 연다")과 같은 구간에 있기 때문이다 — 여기서
    // 던지면 `createWindow()`까지 전부 안 돌아 창 없는 독 아이콘이 남는다. 언어 하나
    // 때문에 앱이 안 뜨는 것보다, 기본값으로 계속 가고 로그를 남기는 편이 낫다.
    try {
      seedUiLanguage(app.getLocale())
    } catch (error) {
      console.error('[bootstrap] OS 로케일을 읽지 못했다 — 기본 언어로 계속한다', error)
    }

    // **번들 ID 마이그레이션 — 디스크 쓰기를 먼저 붙든다.** 첫 실행 시퀀스(백업·
    // Keychain 검증)가 끝난 뒤에야 `releaseSaves()`로 푼다. IPC 핸들러가 아직
    // 없으므로 렌더러의 mutation이 그 사이에 끼어들 길도 없다.
    //
    // 여기 "initDatabase는 읽기만 한다"고 적혀 있었는데 거짓이었다. 손상본 격리
    // (rename)와 첨부 GC(unlink)는 `save()`를 지나지 않아 `holdSaves()`를 비껴갔고,
    // 그래서 전환 전 백업이 만들어지기 **전에** 사용자의 첨부를 영구 삭제했다.
    // 이제 그 둘을 `database.ts`가 붙들린 동안 미룬다 — 여기 순서는 그대로 두되,
    // **이 구간이 안전하다는 보장은 저쪽에 있다**(`quarantineWhenReleased`).
    holdSaves()
    try {
      initDatabase()
    } catch (error) {
      // 데이터 파일이 깨졌다. 여기서 그냥 던지면 아래가 전부 안 돌아 창도,
      // IPC도, 메뉴도 없는 상태가 된다 — 사용자에게는 반응 없는 독 아이콘이다.
      // 무엇이 잘못됐는지 말해 주고, 창은 띄운다.
      console.error('[bootstrap] 데이터베이스 초기화 실패', error)
      dialog.showErrorBox(uiStrings().dbFailedTitle, uiStrings().dbFailedBody)
    }
    // 브리지 빌드: 무결성·백업·sentinel·상태 파일. 새 빌드: 백업·표식·Keychain 검증.
    // 둘 다 끝에서 저장 잠금을 푼다. 창은 그 뒤에 뜬다 — Keychain 안내가 먼저다.
    runMigrationOnBoot({ singleInstance, bundleId })
    // 출하 빌드에서 개발자 도구 메뉴 항목을 뺀다 (app-menu.ts).
    applyAppMenu(is.dev)
    setupIpcHandlers()

    setupAppIpc(is.dev)
    setupMigrationIpc()
    createWindow()

    // **창을 띄운 뒤에** 초기화한다. 토큰이 있는 설치에서는 여기서 기기 id를
    // 읽느라 동기 서브프로세스(macOS는 ioreg)가 돌고, 그게 창 생성 앞에 있으면
    // 유료 사용자만 매 실행 그만큼 늦게 창을 본다. 핸들러는 이미 등록돼 있고
    // `licensing()`을 호출 시점에 읽으므로 순서가 뒤여도 안전하다 —
    // 렌더러의 첫 IPC는 페이지 로드 뒤라 이 줄보다 한참 뒤다.
    initLicensing()

    // **깨진 license.json 을 옆으로 치운 부팅은 그 사실을 말한다.**
    //
    // `licenseStore.read()`는 못 읽는 파일을 `.corrupt-<ts>` 사본으로 복사해 두고 빈
    // 레코드로 시작한다(licenseStore.ts). 그 사건이 `console.error` 한 줄로만 남아
    // 있어서, 돈 낸 사람에게는 등록한 키가 이유 없이 사라지고 enforcement를 켠 뒤에는
    // "체험 기간이 끝났습니다"만 떴다 — 옆에 복구되는 사본이 있다는 것도, 키를 다시
    // 넣으면 끝이라는 것도 알 길이 없었다. `licenseStoreSalvaged()`는 바로 이 한 줄을
    // 위해 만들어 두고 **부르는 곳이 하나도 없던** 함수다. `initLicensing()`이 읽기를
    // 딱 한 번 하므로 이 질문은 여기서 한 번만 물으면 된다.
    //
    // 스토어 빌드에서는 띄우지 않는다. 그쪽은 키를 쓰지 않아 안내가 거짓말이고,
    // "키를 다시 넣으세요"는 앱 안에서 외부 결제로 유도하는 문구라 Apple 3.1.1에
    // 걸린다 — 그 질문의 답은 이미 `needsLicenseKey`가 갖고 있다(capabilities.ts).
    // 잠그는가(`enforcesLicense`)가 아니라 **키를 쓰는 채널인가**가 기준이다:
    // 지금은 enforcement가 꺼져 있어도 사라진 등록 정보는 똑같이 사라진 것이다.
    if (licenseStoreSalvaged() && currentCapabilities().needsLicenseKey) {
      dialog.showErrorBox(uiStrings().licenseSalvagedTitle, uiStrings().licenseSalvagedBody)
    }

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
            downloadUrl: `https://github.com/supaicy/greenDay/releases/tag/v${info.version}`
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

  /**
   * 종료 전 마지막 플러시. **`before-quit`에도 걸어야 한다.**
   *
   * 예전에는 `window-all-closed`에만 걸려 있었는데, Electron은 **종료 중에는 그
   * 이벤트를 내지 않는다**(Cmd+Q / `app.quit()` → `before-quit` → 창 닫기 →
   * `will-quit`). 그래서 macOS의 정상 종료 경로에서 플러시가 통째로 건너뛰어졌다.
   *
   * 저장은 300ms 디바운스이고 쓰기가 실패하면 최대 30초까지 재시도 대기열에
   * 머무는데, 그동안 IPC는 렌더러에 이미 "성공"이라고 답한 상태다. 즉 방금 적은
   * 제목·노트·마감일이 경고 한 줄 없이 사라질 수 있었다. 업데이터의
   * `autoInstallOnAppQuit` 재시작도 같은 경로를 탄다.
   *
   * `flushSave()`는 멱등이라(이미 확정됐으면 바로 true) 두 경로에 다 걸어도 된다 —
   * Windows·Linux의 창 닫기 경로는 `window-all-closed`가 계속 맡는다.
   *
   * 판정을 버리지 않는다. `closeDatabase()`가 boolean을 돌려주는 이유가 바로
   * "마지막 편집을 잃은 종료와 정상 종료를 구별하라"는 것이었는데(database.ts),
   * 아무도 그 값을 읽지 않고 있었다. 종료를 막지는 않는다 — 못 나가게 가두는
   * 편이 더 나쁘다 — 대신 조용히 잃지는 않게 알린다.
   */
  const flushBeforeExit = (): void => {
    if (closeDatabase()) return
    dialog.showErrorBox(uiStrings().quitFlushFailedTitle, uiStrings().quitFlushFailedBody)
  }

  app.on('before-quit', flushBeforeExit)

  app.on('window-all-closed', () => {
    flushBeforeExit()
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
