/**
 * 부팅 때 마이그레이션을 돌리고, 그 결과를 렌더러에 내주는 IPC — electron을 아는 얇은 층.
 *
 * 규칙은 `bridge.ts`·`arrival.ts`에 있고 여기서는 electron의 사실(userData 경로·버전·
 * 대화상자·옛 앱 존재)만 모아 넘긴다. 실패해도 부팅을 막지 않는다 — 안내가 안 뜨는 것이
 * 앱이 안 뜨는 것보다 낫고, 상태 파일이 안 남으면 다음 실행이 다시 시도한다.
 */

import { app, dialog } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { handle } from '../ipc-gate'
import { realCrypto, releaseSaves, holdSaves } from '../database'
import { uiStrings } from '../ui-language'
import { currentCapabilities, isBridgeBuild } from '../capabilities'
import { readGoogleConfig } from '../google-config'
import type { MigrationStatus } from '../../shared/migration'
import { clearBridgeSnooze, runBridge, snoozeBridgeNotice } from './bridge'
import { dismissOldAppHint, releaseSecretsLock, runArrival } from './arrival'
import { secretsGate } from './secrets-gate'

let status: MigrationStatus = { mode: 'none' }

/** 옛 앱이 남아 있을 자리. 사용자가 다른 곳에 뒀으면 못 보지만, 그때는 안내를 안 하는 쪽이 맞다. */
function oldAppPaths(): string[] {
  return ['/Applications/haru.app', join(app.getPath('home'), 'Applications', 'haru.app')]
}

/**
 * 옛 앱이 보이는가 — **이어받는 빌드에서만** 묻는다.
 *
 * MAS 판에서 `/Applications/haru.app` 이 보인다고 안내를 띄우면, 샌드박스 컨테이너에
 * 새로 쌓인 자기 데이터를 "haru 에게서 이어받았다"고 잘못 말하게 된다. 그쪽에서는
 * 질문 자체를 하지 않는다(`capabilities.inheritsLegacyData`).
 */
function oldAppVisible(): boolean {
  return currentCapabilities().inheritsLegacyData && oldAppPaths().some((p) => existsSync(p))
}

export function runMigrationOnBoot(input: { singleInstance: boolean; bundleId: string }): MigrationStatus {
  const userData = app.getPath('userData')
  const now = (): string => new Date().toISOString()
  try {
    if (isBridgeBuild()) {
      status = runBridge({ userData, appVersion: app.getVersion(), bundleId: input.bundleId, crypto: realCrypto, now }).status
      // 브리지는 저장을 붙들 이유가 없지만, index.ts가 initDatabase 앞에서 붙들었으므로 푼다.
      releaseSaves()
    } else {
      status = runArrival({
        userData,
        appVersion: app.getVersion(),
        bundleId: input.bundleId,
        crypto: realCrypto,
        now,
        singleInstance: input.singleInstance,
        holdSaves,
        releaseSaves,
        notifyKeychain: () => {
          const s = uiStrings()
          dialog.showMessageBoxSync({
            type: 'info',
            title: s.keychainNoticeTitle,
            message: s.keychainNoticeTitle,
            detail: s.keychainNoticeBody,
            buttons: [s.keychainNoticeButton],
            defaultId: 0
          })
        },
        oldAppPresent: oldAppVisible,
        googleTokensReadable: () => readGoogleConfig(join(userData, 'google-config.json'), realCrypto).tokens !== null
      }).status
    }
  } catch (error) {
    console.error('[migration] 첫 실행 시퀀스 실패 — 앱은 계속 뜬다', error)
    releaseSaves()
  }
  return status
}

/**
 * 렌더러가 부르는 채널. `app-ipc.ts`처럼 **index.ts 가 따로 부른다** — 그래야
 * `ipc-gate.test.ts`가 등급을 볼 수 있다(그 파일의 첫 주석이 설명하는 결함).
 */
export function setupMigrationIpc(): void {
  const userData = app.getPath('userData')
  const now = (): string => new Date().toISOString()
  // 전부 무료 등급이다 — 잠긴 사람도 자기 데이터가 어디로 가는지 알아야 하고,
  // 옮겨가라는 안내를 유료 뒤에 두는 것은 말이 안 된다.
  handle('migration:status', 'free', () => status)
  handle('migration:snooze', 'free', () => {
    if (status.mode === 'bridge') status = snoozeBridgeNotice(userData, now())
    return status
  })
  handle('migration:reopen', 'free', () => {
    if (status.mode === 'bridge') status = clearBridgeSnooze(userData, now())
    return status
  })
  handle('migration:dismiss-old-app', 'free', () => {
    if (status.mode === 'arrival') {
      dismissOldAppHint(userData)
      status = { ...status, oldAppRemovable: false, oldAppHintDismissed: true }
    }
    return status
  })
  handle('migration:release-lock', 'free', () => {
    if (status.mode === 'arrival' && status.secretsLocked && releaseSecretsLock(userData, realCrypto)) {
      status = { ...status, secretsLocked: false, lockReason: null, sentinel: 'ok' }
    }
    // 게이트의 실제 상태를 한 번 더 반영한다 — 위 분기와 어긋나면 이쪽이 맞다.
    if (status.mode === 'arrival' && status.secretsLocked !== secretsGate().locked) {
      status = { ...status, secretsLocked: secretsGate().locked }
    }
    return status
  })
}
