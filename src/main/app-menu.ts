/**
 * 앱 메뉴 — 출하 빌드에서 **개발자 도구 항목을 뺀다.**
 *
 * 이 파일이 생긴 이유: 잠금이 렌더러에만 있던 동안, Electron 기본 메뉴의
 * `View > Toggle Developer Tools`가 그대로 출하되고 있었다. 다이얼로그 DOM 노드
 * 하나만 지우면 잠긴 앱이 열렸다 — "앱의 JS를 고친다"보다 싼 우회다.
 *
 * 이제 진짜 게이트는 메인 프로세스에 있으므로(`ipc-handlers.ts`의 `handle`)
 * DevTools를 열어도 유료 IPC가 거절된다. 그래도 항목을 빼는 이유는, 우회 시도를
 * **한 단계 더 뒤로 미루는 것이 이 설계의 목표**이기 때문이다. 깨지지 않는 DRM을
 * 만드는 것이 아니라 의도적인 노력이 들게 하는 것까지다.
 *
 * `Menu.setApplicationMenu(null)`은 답이 아니다. macOS에서는 메뉴가 사라지면
 * Cmd+C/V/X/A 같은 편집 단축키도 함께 죽는다 — 그건 우회를 막는 게 아니라
 * 앱을 망가뜨리는 것이다. 그래서 표준 역할은 다 남기고 View 하나만 손으로 짓는다.
 */

import { Menu, type MenuItemConstructorOptions } from 'electron'
import { uiStrings } from './ui-language'

/**
 * `viewMenu` 역할을 그대로 쓰지 않고 손으로 짓는다 — 그 역할 안에
 * `toggleDevTools`가 들어 있고, 항목만 빼는 방법이 없다.
 *
 * `reload`/`forceReload`도 뺀다. 잠금 화면을 다시 그리게 하는 것 말고는 이
 * 앱에서 쓸 일이 없고(웹 페이지가 아니다), 개발 중에는 어차피 이 메뉴를 안 쓴다.
 */
function viewSubmenu(): MenuItemConstructorOptions[] {
  return [
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    { role: 'togglefullscreen' }
  ]
}

/**
 * 개발 빌드에는 기본 메뉴를 그대로 둔다 — DevTools 없이 개발할 수 없고,
 * 여기서 막아봐야 `--remote-debugging-port`로 붙는 QA 하네스만 불편해진다.
 */
export function buildAppMenu(isDev: boolean): Menu | null {
  if (isDev) return null

  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    // 역할 이름은 OS가 현지화한다. 이 라벨만 우리 몫이라 `main-strings.ts`에서
    // 가져온다 — 메인이 직접 띄우는 문구가 두 주소를 갖지 않게. (`uiStrings()`는
    // 동기이고 기본이 'ko'라, 메뉴가 창보다 먼저 서는 것과 무관하게 부를 수 있다.)
    { label: uiStrings().menuView, submenu: viewSubmenu() },
    { role: 'windowMenu' }
  ]
  return Menu.buildFromTemplate(template)
}

export function applyAppMenu(isDev: boolean): void {
  const menu = buildAppMenu(isDev)
  if (menu) Menu.setApplicationMenu(menu)
}
