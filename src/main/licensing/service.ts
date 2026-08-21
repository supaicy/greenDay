/**
 * 라이선스 모듈을 electron에 붙이는 얇은 층.
 *
 * 판단 로직은 여기 없다 — 이 파일은 electron·OS에서 **사실만 모아** 넘기고,
 * 렌더러가 볼 수 있는 형태로 결과를 되돌린다. 순수 모듈들이 electron을 import하지
 * 않아 테스트가 싼 이유가 이 분리다(`capabilities.ts`와 같은 방식).
 */

import { app, BrowserWindow } from 'electron'
import { currentCapabilities } from '../capabilities'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { importRawPublicKey, PRODUCTION_PUBLIC_KEY_BASE64 } from './activationToken'
import { createLicenseClient } from './licenseClient'
import { createLicenseManager, type LicenseManager } from './licenseManager'
import { createFileStore } from './licenseStore'
import { resolveDeviceId } from './deviceIdentity'
import { LICENSE_BASE_URL } from './endpoints'
import { UNKNOWN_LICENSE_STATE, type PublicLicenseState } from '../../shared/license'

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
 * 이 빌드가 실제로 잠글 것인가.
 *
 * `IS_ENFORCED`만으로는 부족하다. 스토어 빌드에서 켜지면 **Apple로 결제한 사람이
 * 우리 키가 없다는 이유로 잠기고**, 잠금 화면에는 키 입력 칸과 외부 구매 링크가
 * 뜬다 — 가이드라인 3.1.1 위반이자 심사 거절 사유다. `needsLicenseKey`가
 * "직판 채널인가"를 이미 알고 있으니 그 항을 쓴다.
 *
 * 한 곳에서 정해야 한다는 것이 핵심이다. 렌더러에서 따로 확인하면 게이트와
 * 설정 화면이 서로 다른 판단을 하게 된다.
 *
 * 술어는 `needsLicenseKey`가 아니라 **`enforcesLicense`**다. 앞엣것은 "키 입력을
 * 그려도 되는가"라 개발 빌드에서도 참이고(`capabilities.test.ts`가 일부러 못
 * 박는다), 그걸 그대로 쓰면 enforcement를 켜는 날 `npm run dev`가 진짜
 * 트라이얼을 시작하고 30일 뒤 개발 환경이 스스로 잠긴다 — 넣을 키도 없이.
 */
function enforcementActive(): boolean {
  return IS_ENFORCED && currentCapabilities().enforcesLicense
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

  // **대입이 먼저다.** `createLicenseManager`는 돌려주기 전에 `settle()`을 도는데,
  // 그게 상태를 옮기면 `onChange`가 여기서 불린다 — 그때 `manager`가 아직 null이라
  // `publicLicenseState()`가 `UNKNOWN_LICENSE_STATE`(잠그지 않음)를 내보낸다.
  // 앱이 내보내는 **첫 방송이 정반대 값**이 되는 것이다. 오늘 무해한 이유는
  // 창이 아직 구독하지 않았다는 순서 하나뿐이고, enforcement를 켜면 거의 매
  // 실행에서 발화한다. 그래서 알림을 한 박자 미루고, 대입 뒤에 직접 한 번 쏜다.
  let ready = false
  manager = createLicenseManager({
    client: createLicenseClient({ baseUrl: LICENSE_BASE_URL }),
    store: createFileStore(join(app.getPath('userData'), 'license.json')),
    publicKey,
    device: currentDeviceId,
    deviceName: deviceLabel(),
    enforced: enforcementActive(),
    now: () => Date.now(),
    setTimer: (ms, fn) => {
      const handle = setTimeout(fn, ms)
      return () => clearTimeout(handle)
    },
    onChange: () => {
      if (ready) broadcast()
    }
  })
  ready = true

  // 생성자가 상태를 옮겼을 수 있다. 이제 매니저가 대입돼 있으니 진짜 값이 나간다.
  broadcast()

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
    enforced: enforcementActive(),
    maskedKey: manager.getMaskedKey(),
    deviceName: deviceLabel()
  }
}

/** 상태는 타이머로도 스스로 움직인다 — 화면이 그걸 모르면 만료된 것을 "활성"이라 말한다. */
function broadcast(): void {
  const payload = publicLicenseState()
  for (const win of BrowserWindow.getAllWindows()) {
    // **창 하나가 던져도 나머지를 죽이지 않는다.** 정리 중인 `webContents`로
    // 보내면 던지는데, 이 함수는 `apply()` 안에서 불리므로 그 던짐이
    // `revalidateIfNeeded`의 재예약까지 타고 올라가 폴을 영영 멈춘다.
    // (매니저 쪽에도 `finally`를 뒀다. 여기까지 오는 게 애초에 낫다.)
    try {
      win.webContents.send('license:changed', payload)
    } catch {
      /* 닫히는 중인 창이다 */
    }
  }
}

export function disposeLicensing(): void {
  manager?.dispose()
  manager = null
  cachedDeviceId = null
  // **`null`이 아니라 `undefined`다.** 두 캐시의 "아직 안 읽음"이 서로 다른데,
  // 그게 일부러다(각각의 선언부 주석 참고). 여기서 위 줄을 복사해 `null`을 쓰면
  // `deviceLabel()`이 "읽었는데 없더라"로 읽어, 이 프로세스가 끝날 때까지
  // 기기 이름이 영영 null이 된다 — 조용하고, 테스트가 잡지 못한다.
  cachedDeviceLabel = undefined
}

// ── 기기 식별 ────────────────────────────────────────────────────────────────

/** 한 번만 읽는다 — 하드웨어 조회는 서브프로세스이고, 결과는 실행 중에 안 바뀐다. */
let cachedDeviceId: string | null = null

function currentDeviceId(): string | null {
  // `readDeviceId`는 `fallbackId` 덕에 사실상 항상 문자열을 낸다. 그 드문 null에서
  // 다음 호출이 다시 시도하는 것은 오히려 맞는 동작이라, "아직 안 읽음"과
  // "읽었는데 null"을 구분하는 래퍼가 필요 없다.
  cachedDeviceId ??= readDeviceId()
  return cachedDeviceId
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
function persistedFallbackId(): string | null {
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
    // **못 적으면 내주지 않는다.** 예전에는 "이번 실행 동안만 유효한 id"라며
    // 그냥 돌려줬는데, 그건 실행마다 다른 기기로 보인다는 뜻이다 — 재검증이
    // `/v1/validate`에서 슬롯을 새로 INSERT하므로 몇 번 껐다 켜면 기기 한도가
    // 남의 슬롯도 아닌 자기 유령들로 가득 찬다. 식별 실패는 아무것도 안 하는
    // 쪽이 낫다: 호출처가 `noDevice`로 받아 서버를 건드리지 않는다.
    return null
  }
  return fresh
}

/**
 * 서버로 보내는 기기 이름 — **한 번만 읽어 양쪽이 같은 값을 쓴다.**
 *
 * 전에는 활성화에 실리는 값과 화면에 "이게 나갑니다"라고 적는 값이 서로 다른
 * 읽기였다. 두 시점 사이에 호스트명이 바뀌면(회사 MDM이 이름을 밀어 넣는 일이
 * 흔하다) 고지가 거짓말이 된다. 고지는 **구성상** 참이어야 한다.
 */
let cachedDeviceLabel: string | null | undefined
function deviceLabel(): string | null {
  if (cachedDeviceLabel === undefined) {
    try {
      cachedDeviceLabel = hostname() || null
    } catch {
      cachedDeviceLabel = null
    }
  }
  return cachedDeviceLabel
}
