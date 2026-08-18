/**
 * 라이선스 모듈을 electron에 붙이는 얇은 층.
 *
 * 판단 로직은 여기 없다 — 이 파일은 electron·OS에서 **사실만 모아** 넘기고,
 * 렌더러가 볼 수 있는 형태로 결과를 되돌린다. 순수 모듈들이 electron을 import하지
 * 않아 테스트가 싼 이유가 이 분리다(`capabilities.ts`와 같은 방식).
 */

import { app, BrowserWindow } from 'electron'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { importRawPublicKey, PRODUCT_SLUG, PRODUCTION_PUBLIC_KEY_BASE64 } from './activationToken'
import { createLicenseClient } from './licenseClient'
import { createLicenseManager, type LicenseManager } from './licenseManager'
import { createFileStore } from './licenseStore'
import { resolveDeviceId } from './deviceIdentity'
import { UNKNOWN_LICENSE_STATE, type PublicLicenseState, type PurchaseSource } from '../../shared/license'

export type { PurchaseSource, PublicLicenseState }

/**
 * 유료 전환 스위치. **꺼진 채로 출하한다.**
 *
 * 이게 false인 동안 미인증 상태는 앱의 동작을 아무것도 바꾸지 않고, 트라이얼
 * 시작일조차 기록되지 않는다. 배관을 잠들어 있는 채로 넣어 두면, 유료 전환이
 * 재설계가 아니라 **플래그 하나 + 서버 배포**가 된다.
 *
 * 켜는 시점: 서버 배포가 끝나고 실거래로 활성화까지 확인한 뒤.
 */
export const IS_ENFORCED = false

/**
 * 서버가 사는 곳. 하나의 상수인 이유는 같은 배포가 양쪽을 다 하기 때문이다 —
 * 워커가 `v1/activate`에 답하고 구매 페이지도 서빙한다. 따로 적으면 워커를 옮길 때
 * 반쪽씩 반대 방향으로 깨진다(활성화가 안 되거나, 구매 링크가 404거나).
 */
export const LICENSE_BASE_URL = 'https://pay.begreen.dev'

export function purchaseUrl(source: PurchaseSource): string {
  return `${LICENSE_BASE_URL}/buy?product=${PRODUCT_SLUG}&src=${source}`
}

export function recoverUrl(): string {
  return `${LICENSE_BASE_URL}/recover`
}

let manager: LicenseManager | null = null

export function initLicensing(): void {
  if (manager) return

  const publicKey = importRawPublicKey(PRODUCTION_PUBLIC_KEY_BASE64)
  if (!publicKey) {
    // 상수에 오타가 난 빌드다. 여기서 조용히 넘어가면 증상이 "결제했는데 활성화가
    // 안 된다"로만 나타나고, 그때는 이미 사람이 돈을 낸 뒤다.
    console.error('[licensing] 임베드된 공개키를 읽지 못했다 — 활성화가 전부 실패한다')
    return
  }

  manager = createLicenseManager({
    client: createLicenseClient({ baseUrl: LICENSE_BASE_URL }),
    store: createFileStore(join(app.getPath('userData'), 'license.json')),
    publicKey,
    device: currentDeviceId,
    deviceName: safeHostname(),
    enforced: IS_ENFORCED,
    now: () => Date.now(),
    setTimer: (ms, fn) => {
      const handle = setTimeout(fn, ms)
      return () => clearTimeout(handle)
    },
    onChange: broadcast
  })

  // 실행할 때마다 조용히 한 번. 반감기를 지난 토큰만 네트워크를 치므로, 한 달에
  // 한 번 온라인이 되는 기기도 유예 끝에 몰리지 않는다.
  void manager.revalidateIfNeeded()
}

export function licensing(): LicenseManager | null {
  return manager
}

export function publicLicenseState(): PublicLicenseState {
  // 초기화에 실패한 빌드에서 앱을 잠그지는 않는다. 우리 실수로 돈 낸 사람을
  // 막는 것보다, 못 막는 편이 낫다.
  if (!manager) return UNKNOWN_LICENSE_STATE
  const state = manager.getState()
  return {
    status: state.status,
    untilMs: 'untilMs' in state ? state.untilMs : null,
    allowsPaidFeatures: manager.allowsPaidFeatures(),
    enforced: IS_ENFORCED,
    maskedKey: manager.getMaskedKey()
  }
}

/** 상태는 타이머로도 스스로 움직인다 — 화면이 그걸 모르면 만료된 것을 "활성"이라 말한다. */
function broadcast(): void {
  const payload = publicLicenseState()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('license:changed', payload)
  }
}

export function disposeLicensing(): void {
  manager?.dispose()
  manager = null
  cachedDeviceId = null
}

// ── 기기 식별 ────────────────────────────────────────────────────────────────

/** 한 번만 읽는다 — 하드웨어 조회는 서브프로세스이고, 결과는 실행 중에 안 바뀐다. */
let cachedDeviceId: { value: string | null } | null = null

function currentDeviceId(): string | null {
  if (!cachedDeviceId) cachedDeviceId = { value: readDeviceId() }
  return cachedDeviceId.value
}

function readDeviceId(): string | null {
  try {
    return resolveDeviceId({
      platform: process.platform,
      runCommand: (command, args) => {
        try {
          return execFileSync(command, args, { encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })
        } catch {
          return null
        }
      },
      readTextFile: (path) => {
        try {
          return readFileSync(path, 'utf-8')
        } catch {
          return null
        }
      },
      fallbackId: persistedFallbackId
    })
  } catch {
    return null
  }
}

/**
 * 하드웨어를 못 읽었을 때 쓰는 난수 id. 파일 하나에 보관한다.
 *
 * 약한 식별자다 — 지우면 리셋된다. 그래도 새 구멍은 아니다: 트라이얼 시작일도
 * 같은 폴더에 있어서 어차피 같이 리셋된다. Electron 앱에서 목표는 깨지지 않는
 * DRM이 아니라 우회에 의도적인 노력이 들게 하는 것까지다.
 */
function persistedFallbackId(): string {
  const path = join(app.getPath('userData'), 'device-id')
  try {
    if (existsSync(path)) {
      const saved = readFileSync(path, 'utf-8').trim()
      if (saved) return saved
    }
  } catch {
    // 못 읽으면 새로 만든다.
  }
  const fresh = randomUUID()
  try {
    writeFileSync(path, fresh, 'utf-8')
  } catch {
    // 못 쓰면 이번 실행 동안만 유효한 id가 된다. 활성화는 다음 실행에서 다시 필요해진다.
  }
  return fresh
}

/** 관리자 화면 표시용. 실패해도 활성화를 막지는 않는다. */
function safeHostname(): string | null {
  try {
    return hostname() || null
  } catch {
    return null
  }
}
