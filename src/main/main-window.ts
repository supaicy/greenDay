/**
 * 메인 창의 **유일한 출처** — 만들기, 앞으로 가져오기, 그리고 "없으면 만들기".
 *
 * `index.ts` 안에 있는 동안에는 이 셋을 아무도 부를 수 없었다. 그 파일은 import만으로
 * `app.requestSingleInstanceLock()`부터 도는 부트스트랩이라 다른 모듈이 불러올 수도,
 * 테스트가 열 수도 없다 — `navigation-guard.ts`와 `app-ipc.ts`가 같은 이유로 갈라져
 * 나왔다. 그래서 `ipc-handlers.ts`의 전역 단축키에는 창을 만들 길이 아예 없었고,
 * `getAllWindows()`가 비면 조용히 돌아가는 것 말고 할 수 있는 게 없었다.
 *
 * `__dirname`은 여기서도 `out/main`이다 — electron-vite가 메인 프로세스를
 * `out/main/index.js` 하나로 번들한다. 파일이 갈렸다고 preload·렌더러 경로가
 * 달라지지 않는다.
 */

import { BrowserWindow, shell, type WebContents } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { appDocumentUrl, isAppDocumentUrl } from './navigation-guard'

export function createWindow(): BrowserWindow {
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
  // **세 이벤트 다 건다.**
  //   - `will-navigate`      최상위 프레임의 시작 네비게이션
  //   - `will-frame-navigate` 하위 프레임까지 (최상위에서는 이쪽이 먼저 발화한다).
  //                          오늘 iframe이 없다는 것은 방어가 아니라 우연이다.
  //   - `will-redirect`      **서버가 주는 3xx.** 앞의 둘은 리다이렉트 홉에서 발화하지
  //                          않는다 — 허용된 URL로 출발해 302 한 번이면 가드를 넘어
  //                          다른 오리진에 착륙하고, 그 문서가 `window.api`를 물려받는다.
  //                          Electron 40에서 실측했다(79개 키). 홉마다 다시 검사한다.
  const blockForeignNavigation = (details: { url: string; preventDefault: () => void }): void => {
    if (isAppDocumentUrl(details.url, startUrl)) return
    details.preventDefault()
    console.warn('[security] 앱 문서 밖으로의 네비게이션을 막았다:', details.url)
  }
  mainWindow.webContents.on('will-navigate', blockForeignNavigation)
  mainWindow.webContents.on('will-frame-navigate', blockForeignNavigation)
  mainWindow.webContents.on('will-redirect', blockForeignNavigation)

  // 가드가 비교할 기준과 실제로 로드하는 값이 **같은 문자열**이어야 한다. 예전처럼
  // `loadFile(경로)`가 URL을 스스로 만들면 기준을 손으로 한 번 더 조립하게 되고,
  // 둘이 갈리는 순간 가드가 정상 문서를 막아 앱이 아예 안 뜬다.
  mainWindow.loadURL(startUrl)
  return mainWindow
}

/**
 * 창을 앞으로 가져온다. **없으면 만든다.**
 *
 * 뒷문장이 요점이다. macOS는 마지막 창을 닫아도 앱을 끝내지 않으므로
 * (`index.ts`의 `window-all-closed`는 darwin에서 `app.quit()`을 부르지 않는다)
 * "창 0개로 살아 있는 앱"이 정상 상태다. 이 함수의 옛 형태(`index.ts`의
 * `focusMainWindow`)는 그때 그냥 `return`했다 — 창을 닫아 둔 채 브라우저에서
 * 구글 OAuth를 마치고 돌아오면 토큰은 저장되는데 보여 줄 창이 없어 아무 일도
 * 일어나지 않았고, 사용자는 성공했는지 알 길이 없었다.
 */
export function showOrCreateMainWindow(): BrowserWindow {
  const [win] = BrowserWindow.getAllWindows()
  if (!win) return createWindow()
  if (win.isMinimized()) win.restore()
  win.focus()
  return win
}

/**
 * 창이 없던 동안 눌린 전역 핫키. **불린 하나면 된다** — 창이 뜨는 사이 열 번을
 * 눌러도 사용자가 원하는 것은 퀵 추가 하나다.
 *
 * 왜 미루는가: 방금 만든 창에 바로 `send`하면 그 메시지는 그대로 사라진다. 렌더러가
 * `global-quick-add` 리스너를 거는 것은 React의 이펙트라 `did-finish-load`(문서의
 * load)보다 늦을 수 있고, 먼저 도착한 메시지는 받는 사람이 없다. "창은 떴는데 퀵
 * 추가는 안 뜬다"는 실패는 원래 버그와 구분되지 않는다 — 그래서 로드 이벤트가
 * 아니라, 렌더러가 스스로 "이제 받을 수 있다"고 알려 오는 시점에 흘려보낸다
 * (`flushPendingQuickAdd`).
 */
let quickAddPending = false

/**
 * 전역 단축키(Cmd+Shift+A)가 눌렸다. 창이 없으면 만들고, 퀵 추가를 띄운다.
 *
 * 예전에는 이 자리가 `if (wins.length > 0)` 하나였다. 그래서 macOS에서 빨간불로
 * 창을 닫은 상태 — 전역 단축키가 존재하는 **바로 그 이유** — 에서 핫키가 아무
 * 반응도 하지 않았다. 등록은 `will-quit`까지 살아 있으므로 다른 앱의
 * Cmd+Shift+A를 계속 가로채면서 아무것도 돌려주지 않았다: 없는 것보다 나쁘다.
 */
export function requestQuickAdd(): void {
  const hadWindow = BrowserWindow.getAllWindows().length > 0
  const win = showOrCreateMainWindow()
  if (!hadWindow) {
    quickAddPending = true
    return
  }
  win.webContents.send('global-quick-add')
}

/**
 * 렌더러가 리스너를 다 걸었다고 알려 왔다 — `register-global-shortcut`의 부수
 * 의미다(App.tsx가 그 invoke 바로 다음 줄에서 `onGlobalQuickAdd`를 건다. invoke는
 * 비동기라 이 핸들러는 그 줄보다 뒤에 돈다). 밀린 퀵 추가를 여기서 흘려보낸다.
 */
export function flushPendingQuickAdd(sender: WebContents): void {
  if (!quickAddPending) return
  quickAddPending = false
  sender.send('global-quick-add')
}
