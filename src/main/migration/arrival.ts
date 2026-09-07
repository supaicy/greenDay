/**
 * 새 번들 ID(com.begreen.greenday)의 첫 실행 — codex 6단계.
 *
 *   다른 인스턴스 확인 → 데이터 잠금 → 백업 → bridge marker 확인 → Keychain 안내 먼저
 *   → sentinel 복호화 → 성공 시 실제 비밀값 → 실패 시 **암호문을 절대 덮어쓰지 않고**
 *   안내만 → OAuth 재로그인 유도 → 정상 확인 후 옛 앱 제거 안내 → **마지막에만 저장 시작**
 *
 * 첫 버전에서 DB 스키마를 바꾸지 않는다 — 여기는 `ticktick-data.json`을 읽지도 쓰지도
 * 않는다(무결성 판정은 파싱만). 롤백(옛 앱으로 돌아가기)이 언제나 가능해야 한다.
 *
 * electron을 import하지 않는다. 대화상자·저장 잠금·파일 존재 확인은 전부 주입받는다 —
 * 그래서 분기마다 회귀 테스트가 있다(arrival.test.ts).
 */

import { join } from 'node:path'
import type { KeyCrypto } from '../database'
import type { ArrivalStatus, SentinelCheck } from '../../shared/migration'
import {
  BRIDGE_BACKUP_DIR,
  MIGRATION_STATE_FILE,
  SENTINEL_FILE,
  backupExists,
  backupUserData,
  checkSentinel,
  emptyState,
  hasStoredCiphertexts,
  readRawJson,
  readState,
  writeSentinel,
  writeStateAtomic,
  type MigrationState
} from './handoff'
import { lockSecrets, unlockSecrets } from './secrets-gate'

export interface ArrivalDeps {
  userData: string
  appVersion: string
  bundleId: string
  crypto: KeyCrypto
  now: () => string
  /** `app.requestSingleInstanceLock()`의 결과. false면 아무것도 하지 않는다 — 곧 물러날 인스턴스다. */
  singleInstance: boolean
  /** 저장 잠금. `database.ts`의 holdSaves/releaseSaves. */
  holdSaves: () => void
  releaseSaves: () => void
  /**
   * sentinel을 열기 **전에** 띄우는 Keychain 안내. macOS 프롬프트가 왜 뜨는지 먼저 말해야
   * 사용자가 "거부"를 누르지 않는다. 동기다 — 안내가 닫힌 뒤에 복호화가 시작된다.
   */
  notifyKeychain: () => void
  /** `/Applications/haru.app` 같은 옛 앱이 아직 있는가. */
  oldAppPresent: () => boolean
  /** Google 토큰이 실제로 읽히는가 — sentinel이 ok일 때만 부른다. */
  googleTokensReadable: () => boolean
}

export interface ArrivalOutcome {
  status: ArrivalStatus
  state: MigrationState
}

/** 잠기는 sentinel 결과. `ok`와 `skipped`만 연다. */
const LOCKING: ReadonlySet<SentinelCheck> = new Set(['missing', 'unavailable', 'denied', 'mismatch', 'corrupt'])

export function runArrival(deps: ArrivalDeps): ArrivalOutcome {
  const statePath = join(deps.userData, MIGRATION_STATE_FILE)
  const sentinelPath = join(deps.userData, SENTINEL_FILE)

  // 1. 다른 인스턴스. 락을 못 얻은 프로세스는 곧 quit()한다 — 여기서 파일을 만지면
  //    첫 인스턴스의 시퀀스와 겹친다.
  if (!deps.singleInstance) {
    const state = readState(statePath) ?? emptyState()
    return { status: idle(state), state }
  }

  // 2. 데이터 잠금. 이 아래가 끝나기 전에는 어떤 mutation도 디스크에 닿지 않는다.
  deps.holdSaves()
  try {
    const existing = readState(statePath) ?? emptyState()
    const completedBefore =
      existing.arrival !== null && existing.arrival.completedAt !== null && existing.arrival.bundleId === deps.bundleId

    if (completedBefore) {
      // 이미 끝난 설치. 비밀값 상태만 매 실행 다시 잰다 — "거부"했던 사용자가
      // 나중에 허용하면 여기서 열린다. 백업도 안내도 다시 하지 않는다.
      const sentinel = checkSentinel(sentinelPath, deps.crypto)
      const locked = applyGate(sentinel, hasStoredCiphertexts(deps.userData))
      return {
        status: {
          mode: 'arrival',
          performed: false,
          bridgeMarker: existing.bridge !== null,
          sentinel,
          secretsLocked: locked,
          lockReason: locked ? sentinel : null,
          googleReconnect: locked ? googleHasTokens(deps.userData) : false,
          oldAppRemovable: !locked && deps.oldAppPresent() && !existing.arrival?.oldAppHintDismissed,
          oldAppHintDismissed: existing.arrival?.oldAppHintDismissed ?? false
        },
        state: existing
      }
    }

    const at = deps.now()

    // 3. 백업. 브리지가 이미 만들었으면 그것이 "전환 전"이다 — 덮지 않는다.
    const backup = backupExists(deps.userData, BRIDGE_BACKUP_DIR)
      ? { dir: join(deps.userData, BRIDGE_BACKUP_DIR), existed: true }
      : backupUserData(deps.userData, BRIDGE_BACKUP_DIR, { appVersion: deps.appVersion, at })

    // 4. bridge marker.
    const bridgeMarker = existing.bridge !== null
    const ciphertexts = hasStoredCiphertexts(deps.userData)

    // 5~7. 재 볼 것이 있을 때만 Keychain 안내 → sentinel. v1.4.1에서 바로 온 사용자는
    //      암호문이 없으므로(그 버전은 safeStorage를 쓰지 않았다) 아무것도 묻지 않는다.
    let sentinel: SentinelCheck | 'skipped' = 'skipped'
    if (bridgeMarker || ciphertexts) {
      deps.notifyKeychain()
      sentinel = checkSentinel(sentinelPath, deps.crypto)
    }
    const locked = applyGate(sentinel, ciphertexts)

    // 재 볼 것이 없었고 암호화가 되는 환경이면 지금 sentinel을 심는다 — 다음 실행부터는
    // "같은 키인가"를 잴 수 있다. 잠긴 상태에서는 심지 않는다: 새 키로 만든 sentinel이
    // 옛 암호문을 "검증"하는 척하게 된다.
    if (sentinel === 'skipped' && !locked) writeSentinel(sentinelPath, deps.crypto)

    // 8. OAuth. 잠겼으면 토큰을 읽을 수 없으니 재로그인이다. 열렸어도 실제로 읽히는지
    //    한 번 본다(봉투 형식·계정 결속은 그쪽 모듈의 규칙이다).
    const googleReconnect = googleHasTokens(deps.userData) && (locked || !deps.googleTokensReadable())

    // 9. 정상 확인 후에만 옛 앱 제거 안내.
    const oldAppRemovable = !locked && deps.oldAppPresent()

    const state: MigrationState = {
      ...existing,
      arrival: {
        appVersion: deps.appVersion,
        bundleId: deps.bundleId,
        at,
        backupDir: backup.dir,
        sentinel,
        completedAt: at,
        oldAppHintDismissed: false
      }
    }
    writeStateAtomic(statePath, state)

    return {
      status: {
        mode: 'arrival',
        performed: true,
        bridgeMarker,
        sentinel,
        secretsLocked: locked,
        lockReason: locked && sentinel !== 'skipped' ? sentinel : null,
        googleReconnect,
        oldAppRemovable,
        oldAppHintDismissed: false
      },
      state
    }
  } finally {
    // 10. 마지막에만 저장 시작. 위에서 던져도 앱이 영영 저장 못 하게 두지는 않는다 —
    //     시퀀스 실패는 로그로 남고, 상태 파일이 없으니 다음 실행이 다시 시도한다.
    deps.releaseSaves()
  }
}

/** 게이트를 sentinel 결과에 맞춘다. 잠겼는가를 돌려준다. */
function applyGate(sentinel: SentinelCheck | 'skipped', ciphertexts: boolean): boolean {
  if (sentinel === 'skipped' || sentinel === 'ok') {
    unlockSecrets()
    return false
  }
  if (sentinel === 'missing' && !ciphertexts) {
    // 잴 것도, 지킬 것도 없다.
    unlockSecrets()
    return false
  }
  if (LOCKING.has(sentinel)) {
    lockSecrets(sentinel)
    return true
  }
  unlockSecrets()
  return false
}

function googleHasTokens(userData: string): boolean {
  const raw = readRawJson(join(userData, 'google-config.json'))
  return typeof raw?.tokens_enc === 'string' && raw.tokens_enc.length > 0
}

function idle(state: MigrationState): ArrivalStatus {
  return {
    mode: 'arrival',
    performed: false,
    bridgeMarker: state.bridge !== null,
    sentinel: 'skipped',
    secretsLocked: false,
    lockReason: null,
    googleReconnect: false,
    oldAppRemovable: false,
    oldAppHintDismissed: state.arrival?.oldAppHintDismissed ?? false
  }
}

/** "옛 앱 지워도 됩니다" 안내를 닫는다 — 영구. */
export function dismissOldAppHint(userData: string): void {
  const statePath = join(userData, MIGRATION_STATE_FILE)
  const state = readState(statePath)
  if (!state?.arrival) return
  writeStateAtomic(statePath, { ...state, arrival: { ...state.arrival, oldAppHintDismissed: true } })
}

/**
 * 사용자가 "다시 연결했으니 보호 모드를 풀어 달라"고 명시적으로 눌렀을 때.
 * 새 sentinel을 지금 키로 심고 게이트를 연다. 자동으로는 절대 부르지 않는다.
 */
export function releaseSecretsLock(userData: string, crypto: KeyCrypto): boolean {
  const sentinelPath = join(userData, SENTINEL_FILE)
  if (writeSentinel(sentinelPath, crypto) !== 'written') return false
  if (checkSentinel(sentinelPath, crypto) !== 'ok') return false
  unlockSecrets()
  return true
}
