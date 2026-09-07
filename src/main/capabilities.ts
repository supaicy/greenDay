/**
 * 런타임 사실을 모아 이 빌드의 능력을 계산한다.
 *
 * 규칙 자체는 `shared/capabilities.ts` 에 있다(electron을 import하지 않아 테스트가 싸다).
 * 여기는 electron에서 사실만 읽어 넘기는 얇은 층이다.
 */
import { is } from '@electron-toolkit/utils'

/** `electron.vite.config.ts`가 빌드 때 주입한다. 실행 방식으로 바뀌지 않는다. */
declare const __IS_DEV_BUILD__: boolean
/** `BRIDGE_BUILD=1`로 빌드할 때만 true — 옛 번들 ID(com.haru.app)로 나가는 브리지 릴리스. */
declare const __BRIDGE_BUILD__: boolean
import { capabilitiesFor, type Capabilities } from '../shared/capabilities'
import { bundleIdFor } from '../shared/app-id'

export function isBridgeBuild(): boolean {
  return typeof __BRIDGE_BUILD__ === 'boolean' ? __BRIDGE_BUILD__ : false
}

/** 이 빌드가 OS에 등록하는 번들 ID. 브리지면 옛 것(com.haru.app). */
export function currentBundleId(): string {
  return bundleIdFor(isBridgeBuild())
}

export function currentCapabilities(): Capabilities {
  return capabilitiesFor({
    isDev: is.dev,
    // 런타임 탐지가 아니라 빌드 시점 값이다 — `Capabilities.isDevBuild` 주석 참고.
    // 주입이 없는 환경(테스트 등)에서는 개발로 본다: 그쪽이 안전한 기본값이다.
    isDevBuild: typeof __IS_DEV_BUILD__ === 'boolean' ? __IS_DEV_BUILD__ : true,
    isMas: Boolean(process.mas),
    isWindowsStore: Boolean(process.windowsStore),
    isBridgeBuild: isBridgeBuild()
  })
}
