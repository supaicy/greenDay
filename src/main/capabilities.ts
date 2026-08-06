/**
 * 런타임 사실을 모아 이 빌드의 능력을 계산한다.
 *
 * 규칙 자체는 `shared/capabilities.ts` 에 있다(electron을 import하지 않아 테스트가 싸다).
 * 여기는 electron에서 사실만 읽어 넘기는 얇은 층이다.
 */
import { is } from '@electron-toolkit/utils'
import { capabilitiesFor, type Capabilities } from '../shared/capabilities'

export function currentCapabilities(): Capabilities {
  return capabilitiesFor({
    isDev: is.dev,
    isMas: Boolean(process.mas),
    isWindowsStore: Boolean(process.windowsStore),
    platform: process.platform
  })
}
