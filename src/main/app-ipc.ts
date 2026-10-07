/**
 * `ipc-handlers.ts`에 안 들어가는 세 채널 — 언어와 자동 업데이트.
 *
 * **원래 `index.ts` 안에 있었고, 그게 문제였다.** 등급을 인자로 옮긴 뒤에도
 * `ipc-gate.test.ts`는 `setupIpcHandlers()`만 부르므로 `index.ts`가 등록하는
 * 채널은 `registeredTiers()`에 아예 나타나지 않았다. 세 채널의 등급을 `paid`로
 * 뒤집어도 테스트 861개가 전부 통과했다 — `ipc-gate.ts`가 허용 목록 방식의
 * 결함으로 지목한 "index.ts가 등록하는 채널을 테스트가 볼 수조차 없었다"가
 * 등록만 고쳐지고 감시는 그대로 남아 있었던 것이다.
 *
 * 여기로 빼면 테스트가 부를 수 있고, `index.ts`에는 `autoUpdater` 배선만 남는다.
 */

import { autoUpdater } from 'electron-updater'
import { handle } from './ipc-gate'
import { currentCapabilities } from './capabilities'
import { applyLanguage } from './app-menu'

export function setupAppIpc(isDev: boolean): void {
  // 언어가 실제로 바뀌었을 때만 메뉴를 다시 짓는다 — `applyLanguage` 참고.
  handle('set-language', 'free', (_, language: unknown) => applyLanguage(language, isDev))

  // 업데이트는 무료다 — 잠긴 사람도 최신 버전을 받을 수 있어야 하고, 구버전에
  // 묶어 두는 것은 아무에게도 이득이 아니다. 스토어 빌드에서는 no-op(스토어가 담당).
  handle('download-update', 'free', () => {
    if (!currentCapabilities().canSelfUpdate) return
    return autoUpdater.downloadUpdate()
  })
  handle('install-update', 'free', () => {
    if (!currentCapabilities().canSelfUpdate) return
    autoUpdater.quitAndInstall(false, true)
  })
}
