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
  checkIntegrity,
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
  /**
   * `/Applications/haru.app` 같은 옛 앱이 아직 있는가.
   * 옛 데이터를 **이어받지 못하는** 빌드(MAS 샌드박스)에서는 호출처가 항상 false 를 준다 —
   * `boot.ts` 의 `oldAppVisible()` 과 `capabilities.inheritsLegacyData` 참고.
   */
  oldAppPresent: () => boolean
  /** Google 토큰이 실제로 읽히는가 — sentinel이 ok일 때만 부른다. */
  googleTokensReadable: () => boolean
}

export interface ArrivalOutcome {
  status: ArrivalStatus
  state: MigrationState
}

/**
 * 잠길 **수 있는** sentinel 결과. `ok`와 `skipped`는 애초에 여기 없고, 여기 있어도
 * 실제로 잠그는지는 `applyGate`가 "지킬 암호문이 있는가"까지 보고 정한다.
 */
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
      refreshSentinelIfOpen(sentinelPath, deps.crypto, sentinel, locked)
      return {
        status: {
          mode: 'arrival',
          performed: false,
          bridgeMarker: existing.bridge !== null,
          sentinel,
          secretsLocked: locked,
          lockReason: locked ? sentinel : null,
          googleReconnect: needsGoogleReconnect(deps, locked),
          // 닫은 안내가 먼저다 — 다시 뜨지 않을 안내를 위해 매 실행 데이터 파일과 `.bak`을
          // 통째로 파싱하지 않는다.
          oldAppRemovable: !existing.arrival?.oldAppHintDismissed && canRemoveOldApp(deps, locked),
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

    // 재 볼 것이 없었거나(skipped) 지킬 것이 없어 면제로 열렸으면 지금 sentinel을 심는다 —
    // 다음 실행부터는 "같은 키인가"를 잴 수 있다. 잠긴 상태에서는 심지 않는다.
    refreshSentinelIfOpen(sentinelPath, deps.crypto, sentinel, locked)

    // 8. OAuth. 잠겼으면 토큰을 읽을 수 없으니 재로그인이다. 열렸어도 실제로 읽히는지
    //    한 번 본다(봉투 형식·계정 결속은 그쪽 모듈의 규칙이다).
    const googleReconnect = needsGoogleReconnect(deps, locked)

    // 9. 정상 확인 후에만 옛 앱 제거 안내.
    const oldAppRemovable = canRemoveOldApp(deps, locked)

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

/**
 * "옛 haru.app 은 지워도 됩니다" 안내를 띄워도 되는가 — **두 분기가 같은 답을 쓴다.**
 *
 * 배너 문구(`migration.arrival.oldAppBody`)는 "새 Greenday가 데이터를 정상적으로
 * 읽었습니다"라고 **단언한다.** 그런데 판정은 `!locked && oldAppPresent()` 뿐이어서,
 * 한 건도 이어받지 못한 설치에서도 같은 말을 했다: userData 가 통째로 비었을 때(MAS
 * 샌드박스 컨테이너가 늘 그렇다), `ticktick-data.json` 이 깨져 `initDatabase()` 가 던지고
 * `dbFailedTitle` 대화상자가 뜬 **직후**에도. 그 말을 믿고 haru.app 을 지우면 그 데이터를
 * 열 수 있던 유일한 앱을 방금 지운 것이 된다 — 되돌릴 길은 백업 아카이브뿐이다.
 * 그래서 "실제로 읽히는가"가 판정에 들어간다.
 *
 * `completedBefore` 분기에도 **같은 함수**를 쓴다. 첫 실행만 고치면 MAS 는 고쳐지지 않는다:
 * 컨테이너는 첫 실행 때 비어 있어 닫히지만, 사용자가 할일을 만든 다음 실행부터 그 분기가
 * 'ok' 를 보고 다시 연다.
 */
function canRemoveOldApp(deps: ArrivalDeps, locked: boolean): boolean {
  if (locked || !deps.oldAppPresent()) return false
  // primary 가 없어도 `.bak` 이 읽히면 'ok' 다 — database.ts 가 실제로 그쪽에서 복구한다.
  return checkIntegrity(deps.userData).status === 'ok'
}

/** 게이트를 sentinel 결과에 맞춘다. 잠겼는가를 돌려준다. */
function applyGate(sentinel: SentinelCheck | 'skipped', ciphertexts: boolean): boolean {
  if (sentinel === 'skipped' || sentinel === 'ok') {
    unlockSecrets()
    return false
  }
  // 지킬 것이 없으면 sentinel 결과가 무엇이든 잠그지 않는다.
  //
  // 보호 모드가 실제로 하는 일은 `preserveCiphertext`가 저장 직전에 **파일에 있던
  // 암호문을 되살리는 것** 하나다(호출처 셋 — ai `apiKey_enc`, caldav `password_enc`,
  // google `tokens_enc`, 그리고 그 셋이 `hasStoredCiphertexts`가 재는 바로 그 칸들이다).
  // 셋 중 아무것도 없으면 되살릴 것이 없으니 잠금은 아무것도 지키지 못하고, 대신 닫는
  // 버튼 없는 보호 모드 배너를 매 실행 띄우고 9단계의 `oldAppRemovable`을 영원히 false로
  // 만든다 — "옛 haru 앱은 지워도 됩니다" 안내가 영영 안 뜨면 두 앱이 같은 userData를
  // 보며 나란히 남는다. 마이그레이션이 없애려던 바로 그 상태다.
  //
  // 전에는 이 면제가 `missing`에만 걸려 있었다. 그래서 연동을 하나도 안 쓴 v1.4.1
  // 사용자가 브리지가 심어 둔 sentinel 앞에서 Keychain을 거부하면(`denied`, 혹은
  // `unavailable`·`mismatch`·`corrupt`) 지킬 것이 없는데도 영구히 잠겼다. 판정은
  // sentinel 결과가 아니라 "지킬 것이 있는가"에 걸려야 한다.
  //
  // 여기서 열면 낡은 sentinel을 지금 키로 바꿔 심어야 한다 — 호출처의
  // `refreshSentinelIfOpen`이 한다. 안 그러면 사용자가 다음에 넣은 비밀값이 잠긴다.
  if (!ciphertexts) {
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

/**
 * 게이트가 열렸는데 sentinel이 `ok`가 아니면 지금 키로 새로 심는다 — **두 분기가 같이 쓴다.**
 * `releaseSecretsLock`이 하는 일과 같고, 다른 점은 "사용자가 눌렀는가" 대신 "지킬 것이
 * 없었는가"가 근거라는 것뿐이다.
 *
 * 열렸는데 `ok`가 아닌 경우는 둘이다: 재 볼 것이 없었다(`skipped`, 첫 실행), 혹은
 * `applyGate`의 "지킬 암호문이 없다" 면제로 열렸다(`missing`·`denied`·`unavailable`·
 * `mismatch`·`corrupt`). 뒤쪽에서 낡은 sentinel을 그대로 두면 안 된다. 면제가 열어 주는
 * 사람은 연동을 하나도 안 쓴 v1.4.1 사용자이고, 그 사람이 다음에 하는 일이 바로 AI 키·
 * CalDAV 암호·Google 연결을 **지금 키로** 넣는 것이다. 그러면 다음 실행(`completedBefore`)이
 * `ciphertexts=true`와 같은 낡은 결과를 보고 잠근다 — 방금 올바르게 넣은 비밀값 앞에서
 * 닫을 수 없는 보호 모드 배너, 거짓 "Google 다시 연결", `oldAppRemovable=false`.
 *
 * 잠겼으면 절대 심지 않는다: 지킬 옛 암호문이 있는데 새 키로 sentinel을 만들면 그것을
 * "검증"하는 척하게 된다. 반대로 열린 경우는 정의상 지킬 암호문이 없으니(`applyGate`)
 * 새 sentinel이 거짓으로 보증할 대상이 없다.
 *
 * 최선 노력이다. `writeSentinel`은 실패를 로그로 남기고 `'failed'`/`'unavailable'`을
 * 돌려줄 뿐이며, 그래도 게이트는 이미 열린 채다 — 다음 실행이 같은 면제로 다시 시도한다.
 */
function refreshSentinelIfOpen(
  sentinelPath: string,
  crypto: KeyCrypto,
  sentinel: SentinelCheck | 'skipped',
  locked: boolean
): void {
  if (locked || sentinel === 'ok') return
  writeSentinel(sentinelPath, crypto)
}

/**
 * "Google 을 다시 연결해 주세요" 안내를 띄울 것인가 — **두 분기가 같은 답을 쓴다.**
 *
 * `completedBefore` 분기만 `locked ? googleHasTokens(...) : false` 였다. 잠기지 않았으면
 * 무조건 false 라, 잠금과 **무관한** 이유로 토큰을 못 읽는 경우가 통째로 빠졌다 —
 * sentinel 은 ok 인데 봉투(`v`·`purpose`·`account`)나 토큰 모양 검사에서 거절되는 경우다
 * (`secret-envelope.ts` 의 `openSecret` 은 복호화가 성공해도 거기서 null 을 돌려준다).
 * 그래서 안내가 첫 실행에 딱 한 번 뜨고, 닫거나 앱을 껐다 켜면 영영 사라졌다 —
 * `MigrationBanner` 의 dismiss 는 실행마다 초기화되는 useState 라 원래 매 실행 다시
 * 조르라는 뜻이었다. Google 동기화는 조용히 죽은 채 남고 사용자는 이유를 모른다.
 *
 * 순서가 곧 안전장치다: `googleHasTokens` 가 먼저라 `tokens_enc` 가 없으면 복호화를
 * 시도하지 않고, 잠겼으면 `||` 가 단락되어 `googleTokensReadable()` 을 아예 부르지 않는다 —
 * "sentinel 이 ok 일 때만 부른다"(`ArrivalDeps`)가 그대로 지켜진다.
 */
function needsGoogleReconnect(deps: ArrivalDeps, locked: boolean): boolean {
  return googleHasTokens(deps.userData) && (locked || !deps.googleTokensReadable())
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
