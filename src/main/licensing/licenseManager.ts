/**
 * 라이선스 상태 기계 — 미인증 / 트라이얼 / 트라이얼만료 / 라이선스 / 유예.
 *
 * 이 모듈이 지키는 규칙 하나: **권한은 서명 검증을 통과한 페이로드에서만
 * 파생된다.** 디스크에 적힌 어떤 숫자도, 앱이 스스로 기록한 어떤 시각도 권한을
 * 만들지 못한다. `lastSeen`과 `trialStart`가 파일에 있지만, 둘 다 권한을 *제한*할
 * 뿐 부여하지 않는다.
 *
 * 모든 허용 상태는 자기 마감을 들고 다닌다. 매 접근마다 ed25519 검증을 다시
 * 돌리지 않기 위해서이고(이 경로에 렌더러 요청이 올라탄다), 동시에
 * `allowsPaidFeatures`가 **매번 실제 시각과 자기 마감을 비교**하기 위해서다 —
 * 만료를 타이머에만 맡기면 절전에서 깨어난 앱이 만료된 라이선스로 계속 돈다.
 */

import type { KeyObject } from 'node:crypto'
import { verifyToken, type TokenPayload, type VerifyResult } from './activationToken'
import { looksValidKey, normalizeKey } from './licenseKey'
import { isServerRefusal, type LicenseClient } from './licenseClient'
import type { LicenseRecord, LicenseStore } from './licenseStore'
import type { ActivateFailure, DeactivateFailure, LicenseStatus } from '../../shared/license'
import {
  effectiveNow,
  GRACE_DURATION_MS,
  isTrialOpen,
  TRIAL_DURATION_MS,
  trialEndsAt
} from './trialWindow'

/**
 * 마감을 들고 다니는 상태들. 나머지는 마감이 없다.
 *
 * 이름 집합은 `shared/license.ts`의 `LICENSE_STATUSES`에서 파생된다 — 거기 값이
 * 하나 늘면 여기서 컴파일 에러가 나고, 렌더러의 목록도 같은 배열을 쓴다.
 * 손으로 쓴 대칭 어설션이 하던 일을 타입이 대신한다.
 */
type WithDeadline = 'trial' | 'licensed' | 'grace'

export type LicenseState =
  | { status: Exclude<LicenseStatus, WithDeadline> }
  | { status: WithDeadline; untilMs: number }

export interface ManagerDeps {
  client: LicenseClient
  store: LicenseStore
  publicKey: KeyObject
  /**
   * 해시된 기기 id를 준다. 못 읽었으면 null — 그러면 아무 권한도 못 얻는다.
   *
   * 값이 아니라 함수인 이유: 읽는 데 서브프로세스(macOS는 `ioreg`)가 필요한데,
   * 토큰도 키도 없는 설치에서는 한 번도 필요하지 않다. enforcement가 꺼져 있는
   * 동안은 그게 **모든** 설치라서, 값으로 받으면 전원이 실행할 때마다 쓰지도
   * 않을 서브프로세스 비용을 낸다.
   */
  device: () => string | null
  /** 관리자 화면 표시용. */
  deviceName: string | null
  /** 유료 전환 스위치. false면 아무것도 잠기지 않고 트라이얼도 시작되지 않는다. */
  enforced: boolean
  now: () => number
  /** 지연 뒤 실행하고 취소 함수를 준다. 테스트가 손으로 깨울 수 있게 주입한다. */
  setTimer: (ms: number, fn: () => void) => () => void
  onChange?: (state: LicenseState) => void
}

export interface LicenseManager {
  getState(): LicenseState
  /** 화면에 보일 가린 키. 키 자체는 렌더러로 내려가지 않는다. */
  getMaskedKey(): string | null
  allowsPaidFeatures(): boolean
  activate(rawKey: string): Promise<ActivateFailure | null>
  deactivate(): Promise<DeactivateFailure | null>
  revalidateIfNeeded(): Promise<void>
  dispose(): void
}

/** setTimeout이 정직하게 다룰 수 있는 최대 지연. 넘기면 1ms로 취급해 즉시 깬다. */
const MAX_TIMEOUT_MS = 2_147_483_647

interface VerifiedToken {
  payload: TokenPayload
  expiresAtMs: number
}

export function createLicenseManager(deps: ManagerDeps): LicenseManager {
  const record: LicenseRecord = deps.store.read()
  let state: LicenseState = { status: 'unlicensed' }
  /** 기기 id는 필요한 순간에만 읽는다 — deps.device의 주석 참고. */
  const deviceId = (): string | null => deps.device()
  let cancelTimer: (() => void) | null = null
  /**
   * `dispose()` 이후인가.
   *
   * 종료 중에도 진행 중인 `validate` 요청은 착륙한다. 그게 `settle()`을 부르면
   * 몇 주짜리 타이머가 **다시 걸려** 프로세스가 그만큼 안 끝난다. 취소는
   * "지금 걸린 타이머 하나"가 아니라 "이제부터 아무것도 안 건다"여야 한다.
   */
  let disposed = false
  /** 이 프로세스가 도출한 트라이얼 시작. 한 번 정해지면 안 움직인다 — resolveTrialStart 참고. */
  let trialStartedAt: number | null = null
  /** `resolveTrialStart`가 레코드를 건드렸는가 — 플러시는 `evaluateTrial`이 한 번만 한다. */
  let trialStartDirty = false

  // ── 시계 ───────────────────────────────────────────────────────────────────

  /**
   * 이 앱이 정당화할 수 있는 가장 나중 시각. 모든 만료 비교가 이걸 읽는다.
   *
   * 래칫을 **조건 없이** 쓴다. 한때 "시스템 시계보다 30일 넘게 앞선 lastSeen은
   * 못 믿는다"고 버렸는데, 그건 두 방향으로 틀렸다.
   *
   *   1. **시계를 30일 넘게 되돌리면 정확히 그 조건이 만들어진다.** 되돌리기를
   *      막으려던 장치가 되돌리기로 무력화되고, 만료돼 유예 중이던 토큰이
   *      다시 유효해진다. 리뷰에서 60일 되돌리기로 실증했다.
   *   2. 임계값을 아무리 키워도 2단계로 게임된다 — 시계를 임계값 너머로 올려
   *      한 번 실행해 래칫을 부풀리면, 그 임계값이 래칫을 영구히 버려 준다.
   *      상대 임계값으로는 닫을 수 없는 구멍이다.
   *
   * 그래서 낮추는 길은 하나만 남긴다: `anchorClockToServerTime`. 서버가 방금
   * 서명한 토큰만이 진짜 시각의 증거다. 시계가 미래로 튄 뒤의 회복 경로는
   *   - 유료 사용자: 온라인에서 재활성화 (서버가 바닥을 내려 준다)
   *   - 트라이얼 사용자: 설정 폴더 삭제 — 이미 문서화된, 받아들인 리셋 경로다
   * 둘 다 있다. 없는 회복 경로를 위해 우회를 열어 두는 것보다 낫다.
   *
   * (참고: 메인보드 배터리가 죽는 흔한 고장은 시계를 **과거로** 되돌린다.
   * 그 경우 래칫이 진짜 시각을 들고 있어 오히려 정상 동작한다.)
   */
  function clockSafeNow(): number {
    return effectiveNow(deps.now(), record.lastSeenMs)
  }

  function touchClock(): boolean {
    return advanceClockFloor(deps.now())
  }

  /**
   * 래칫 — 올리기만 한다. 올렸으면 true.
   *
   * 여기서 바로 쓰지 않는 이유: `evaluateTrial`이 이 뒤에 `trialStartMs`도 건드려서,
   * 각자 쓰면 마이크로초 간격으로 `writeFileSync`가 두 번 돈다. 더티만 알리고
   * 플러시는 호출자가 한 번 한다.
   */
  function advanceClockFloor(reachedMs: number): boolean {
    if (reachedMs <= record.lastSeenMs) return false
    record.lastSeenMs = reachedMs
    return true
  }

  /**
   * 서버의 말에 따라 시계를 지금으로 다시 맞춘다.
   *
   * 서버가 방금 발급한 토큰은 진짜 시각의 증거이고, `lastSeen`을 **낮출 수 있는
   * 유일한 것**이다. 이게 없으면 시계가 한 번 앞서 튄 기기는 재활성화로도
   * 회복하지 못한다.
   */
  function anchorClockToServerTime(): void {
    record.lastSeenMs = deps.now()
  }

  /** 디스크에 확정됐으면 true. 대부분의 호출자는 최선 노력이라 무시한다. */
  function persist(): boolean {
    return deps.store.write({ ...record })
  }

  // ── 토큰 ───────────────────────────────────────────────────────────────────

  /**
   * 저장된 토큰을 **한 번만** 검증하고 결과를 그대로 돌려준다.
   *
   * 예전에는 성공/실패만 돌려줘서, 바로 뒤의 유예 계산이 `exp` 하나 읽으려고
   * ed25519 검증을 다시 돌렸다. 유예 상태로 시작하는 실행은 검증이 네 번이었다.
   */
  function verifyCurrent(): VerifyResult | null {
    if (!record.token) return null
    const device = deviceId()
    if (!device) return null
    return verifyToken(record.token, {
      publicKey: deps.publicKey,
      device,
      key: record.key,
      nowMs: clockSafeNow()
    })
  }

  /**
   * 이 기기의 토큰이 얻는 오프라인 마감, 없으면 null.
   *
   * 토큰 자체에서 파생하고, 앱이 적어둔 어떤 값에서도 파생하지 않는다.
   * `verifyToken`이 `expired`를 돌려주는 것은 서명·기기 결속·제품 클레임이 **모두**
   * 통과한 뒤뿐이라, 여기 닿은 토큰은 그저 나이를 먹은 진짜 토큰이고 그 `exp`는
   * 서버가 서명한 숫자다. 위조·변조·남의 기기·남의 제품은 아무것도 못 얻는다.
   *
   * 기기를 못 읽으면 유예도 없다. 하드웨어 조회 실패에 관대해 보이는 선택이지만,
   * 복사된 파일과 구별이 안 된다 — 이 기기가 그 토큰을 가졌던 적이 있다는 증거가
   * 디스크에 하나도 없기 때문이다.
   *
   * 그 규칙을 실제로 강제하는 것은 아래의 이른 반환이 아니라 `verifyToken`의 기기
   * 검사다(뮤테이션으로 확인했다 — 이 줄을 지워도 토큰의 `dev`가 안 맞아 여전히
   * null이 나온다). 여기 있는 것은 ed25519 검증 한 번을 아끼는 지름길이다.
   */
  function graceDeadlineOf(result: VerifyResult | null): number | null {
    if (result === null || result.ok || result.reason !== 'expired') return null
    return result.payload.exp * 1000 + GRACE_DURATION_MS
  }

  // ── 상태 ───────────────────────────────────────────────────────────────────

  function apply(next: LicenseState): void {
    const changed = !sameState(state, next)
    state = next
    if (next.status === 'trial' || next.status === 'licensed' || next.status === 'grace') {
      scheduleClose(next.untilMs)
    } else {
      cancelClose()
    }
    if (changed) deps.onChange?.(next)
  }

  /** 디스크에 있는 것으로부터 상태를 다시 도출하고, 다음 마감을 건다. */
  function settle(): VerifiedToken | null {
    const result = verifyCurrent()
    if (result?.ok) {
      const token = { payload: result.payload, expiresAtMs: result.expiresAtMs }
      apply({ status: 'licensed', untilMs: token.expiresAtMs })
      return token
    }
    const deadline = graceDeadlineOf(result)
    if (deadline !== null && clockSafeNow() < deadline) {
      apply({ status: 'grace', untilMs: deadline })
      return null
    }
    apply(evaluateTrial())
    return null
  }

  /**
   * 트라이얼의 현재 위치. enforcement가 꺼져 있으면 **아무것도 쓰지 않는다** —
   * 그게 무료 기간을 정직하게 만든다. 지금 쓰는 사람들의 30일이 살 것도 없는
   * 상태에서 타들어가면 안 되고, 켜는 날 모두가 온전한 창을 받아야 한다.
   */
  function evaluateTrial(): LicenseState {
    if (!deps.enforced) return { status: 'unlicensed' }
    // 두 갱신을 먼저 모으고 디스크는 한 번만 만진다.
    const dirty = touchClock()
    const startedAt = resolveTrialStart()
    if (dirty || trialStartDirty) persist()
    trialStartDirty = false
    return isTrialOpen(startedAt, clockSafeNow())
      ? { status: 'trial', untilMs: trialEndsAt(startedAt) }
      : { status: 'trialExpired' }
  }

  /**
   * 창이 시작된 시각. 미래로 적힌 값은 시스템 시계로 클램프한다 — 창이
   * `시작 + 30일`이라, 2100년을 써넣으면 서명 없는 영구 라이선스가 된다.
   *
   * 클램프한 값을 **디스크에 되쓰는 것은 오차가 작을 때뿐이다.** NTP 흔들림,
   * 타임존 없는 첫 부팅, 서머타임 계산 같은 것은 이 기기가 계속 쓸 시계라
   * 처음 본 값에 창을 고정하는 게 맞다. 반면 몇 년씩 앞선 값은 위조이거나
   * 메인보드 배터리가 죽어 2001년으로 올라온 기기이고, 여기서는 둘이 똑같아
   * 보인다. 고정해 버리면 정직한 쪽이 낙인찍힌다 — 시계가 회복되는 순간 창은
   * 이미 몇십 년 지난 것이 되고 앱 안에 되돌릴 방법이 없다. 안 쓰면 조작한
   * 사람은 실행마다 창 하나를 얻는데, 그건 설정을 지우면 어차피 얻는 것이다.
   *
   * 시스템 시계로 클램프한다 — `clockSafeNow`로 하면 그 바닥인 `lastSeen`도
   * 쓰기 가능하므로, 두 값을 다 2100으로 써넣으면 "보정"이 2100을 시작일로
   * 고정해 준다.
   */
  function resolveTrialStart(): number {
    // **프로세스당 한 번만 도출한다.** 이게 없으면 위 문단의 근거가 성립하지
    // 않는다: 되쓰지 않은 미래 시작일은 마감 타이머가 깰 때마다 다시 "지금"으로
    // 보정되고, 그때마다 창이 새로 열려 **재시작 없이 영원히 미끄러진다.**
    // 리뷰에서 400일을 시뮬레이션해 실증했다. 한 번만 도출하면 조작한 사람이
    // 얻는 것이 실제로 실행당 창 하나가 되어, 설정을 지워 얻는 것과 같아진다.
    if (trialStartedAt !== null) return trialStartedAt

    const systemNow = deps.now()
    const recorded = record.trialStartMs
    if (recorded === null) {
      trialStartedAt = clockSafeNow()
      record.trialStartMs = trialStartedAt
      trialStartDirty = true
      return trialStartedAt
    }
    // 과거로 당긴 시작일은 트라이얼을 일찍 끝낼 뿐이라 바닥이 필요 없다.
    if (recorded <= systemNow) {
      trialStartedAt = recorded
      return trialStartedAt
    }
    if (recorded - systemNow <= TRIAL_DURATION_MS) {
      record.trialStartMs = systemNow
      trialStartDirty = true
    }
    trialStartedAt = systemNow
    return trialStartedAt
  }

  // ── 마감 타이머 ────────────────────────────────────────────────────────────

  function cancelClose(): void {
    cancelTimer?.()
    cancelTimer = null
  }

  /**
   * 현재 권한이 실제로 끝나는 순간 `state`를 딱 한 번 움직인다.
   *
   * `allowsPaidFeatures`가 스스로 마감을 넘겼는지 보긴 하지만, 화면은 상태 변화
   * 알림으로만 갱신된다. 데스크톱 앱은 몇 주씩 안 꺼지므로 그동안 설정 화면이
   * 만료된 라이선스를 "활성"이라고 말하고 있게 된다.
   *
   * 30일은 `setTimeout`의 한계(약 24.8일)를 넘는다. 넘기면 지연이 1ms로 취급돼
   * 즉시 깨어 `settle`을 무한히 다시 돌린다. 그래서 조각으로 나눠 건다.
   */
  function scheduleClose(deadlineMs: number): void {
    cancelClose()
    if (disposed) return
    const remaining = deadlineMs - deps.now()
    if (remaining <= 0) return
    const wait = Math.min(remaining, MAX_TIMEOUT_MS)
    const reachedMs = clockSafeNow() + wait
    cancelTimer = deps.setTimer(wait, () => {
      cancelTimer = null
      // 자고 났다는 것은 벽시계에 물어볼 수 없는 사실을 안다는 뜻이다:
      // setTimeout은 단조 시계로 재므로 날짜를 아무리 고쳐도 이 줄이 돌았다면
      // 그만큼의 시간이 실제로 흘렀다. 기록해 두면 되돌리기가 막힌다 —
      // 아니면 활성화 시점으로 되돌린 시계가 만료된 토큰을 다시 유효하게 만들고,
      // 같은 거짓말로 또 한 번의 창이 걸린다.
      if (advanceClockFloor(reachedMs)) persist()
      settle()
    })
  }

  // ── 공개 동작 ──────────────────────────────────────────────────────────────

  async function activate(rawKey: string): Promise<ActivateFailure | null> {
    if (!looksValidKey(rawKey)) return 'invalidKey'
    const device = deviceId()
    if (!device) return 'noDevice'
    const key = normalizeKey(rawKey)

    const result = await deps.client.activate(key, device, deps.deviceName)
    if (!result.ok) return result.error

    // 서버의 답도 검증한다. hosts를 고쳐 세운 가짜 서버가 여기서 걸린다.
    const verified = verifyToken(result.value.token, {
      publicKey: deps.publicKey,
      device,
      key,
      nowMs: deps.now()
    })
    if (!verified.ok) return 'badToken'

    record.key = key
    record.token = result.value.token
    // 토큰의 `expiresAt`이 아니라 토큰 자체의 `exp`를 쓴다 — 옆에 실려 온
    // 숫자는 서명 밖에 있다.
    anchorClockToServerTime()
    // 여기서만 확정 여부를 본다. 못 적었는데 성공이라고 답하면, 사용자는
    // 활성화됐다고 믿고 서버 슬롯은 소모된 채, 재시작하면 사라져 있다.
    if (!persist()) {
      record.key = null
      record.token = null
      return 'saveFailed'
    }
    settle()

    // 서버도 앱도 예라고 했는데 화면만 아니라고 하는 상태를 만들지 않는다.
    return state.status === 'licensed' ? null : 'incomplete'
  }

  /**
   * 이 기기의 슬롯을 돌려준다.
   *
   * 서버가 확인해야만 로컬을 지운다. 실패했는데 지우면 라이선스도 없고 슬롯은
   * 잡힌 채인 상태가 되는데, 그건 지원 메일 말고는 빠져나올 길이 없는
   * 유일한 결과다.
   */
  async function deactivate(): Promise<DeactivateFailure | null> {
    const key = record.key
    if (!key) return 'nothing'
    const device = deviceId()
    if (!device) {
      // 슬롯은 실제로 잡혀 있는데 이 기기가 자기 이름을 못 댄다. "해제할 게
      // 없다"고 말하면 두 번째 기기를 여는 유일한 방법에서 사용자를 돌려보내게 된다.
      return 'noDevice'
    }

    const result = await deps.client.deactivate(key, device)
    if (!result.ok) {
      if (result.error === 'deactivationLimit') return 'deactivationLimit'
      // 서버에 그 슬롯이 이미 없다 — 로컬에 들고 있어봐야 아무에게도 도움이 안 된다.
      if (result.error !== 'unknownKey' && result.error !== 'deviceNotActive') {
        return isServerRefusal(result.error) ? 'refused' : 'network'
      }
    }

    // 요청이 나가 있는 동안 다른 키가 도착했으면, 아무도 놓아달라고 하지 않은
    // 라이선스를 버리는 셈이 된다.
    if (record.key !== key) return null
    clearLocalLicense(false)
    return null
  }

  /**
   * 싸고 조용하다 — 실행할 때마다 부른다. 반감기를 지난 토큰만 갱신하므로
   * 한 달에 한 번 온라인이 되는 기기도 유예 끝에 몰리지 않는다.
   */
  async function revalidateIfNeeded(): Promise<void> {
    const key = record.key
    if (!key || !record.token) {
      // 이 기기에 키가 없으니 움직일 수 있는 것은 트라이얼뿐이다. 마감을 걸친
      // 실행이라면 다음 실행을 기다리지 말고 여기서 창을 닫는다.
      apply(evaluateTrial())
      return
    }
    const device = deviceId()
    if (!device) return

    touchClock()
    const token = settle()
    if (!token) {
      // 유예 중이다. 반감기를 따질 토큰이 없으니 무조건 시도한다.
      await refresh(key, device)
      return
    }
    const lifetimeMs = (token.payload.exp - token.payload.iat) * 1000
    if (deps.now() > token.payload.iat * 1000 + lifetimeMs / 2) {
      await refresh(key, device)
    }
  }

  async function refresh(key: string, device: string): Promise<void> {
    const result = await deps.client.validate(key, device)

    if (result.ok) {
      // 저 `await`는 중단점이고, 그 사이에 사용자가 해제를 끝낼 수 있다 —
      // 슬롯은 서버에서 풀렸고 키는 여기서 지워졌다. 그 뒤에 이 토큰을 쓰면
      // 다른 기기가 가져갈 수 있는 슬롯 위에서 라이선스가 되살아난다. 기기
      // 한도가 느린 응답 하나로 무너지는 것이다. 다른 키로 재활성화한 경우도
      // 같은 검사가 막는다 — 이 답은 물어본 그 키에 대한 것이다.
      if (record.key !== key) return
      const verified = verifyToken(result.value.token, {
        publicKey: deps.publicKey,
        device,
        key,
        nowMs: deps.now()
      })
      if (!verified.ok) return
      record.token = result.value.token
      anchorClockToServerTime()
      persist()
      settle()
      return
    }

    // 서버에 못 닿은 것은 판정이 아니다. 검증된 토큰과 그것이 얻은 유예가
    // 그대로 선다 — 이걸 거부처럼 다루면 기차 터널 하나가 라이선스를 지운다.
    if (!isServerRefusal(result.error)) return
    if (record.key !== key) return
    // 키는 남긴다. 취소는 서명 없이 도착하므로 잘못된 취소는 재활성화 한 번으로
    // 회복 가능한 자리에 있어야 한다 — 진짜 취소는 다시 거부당한다.
    clearLocalLicense(true)
  }

  /**
   * 이 기기를 라이선스 상태로 만드는 것을 한꺼번에 버린다.
   *
   * 호출자마다 따로 지우면, 나중에 필드가 하나 늘었을 때 한쪽에서만 기억되고
   * 다른 쪽에서 잊힌다.
   */
  function clearLocalLicense(keepKey: boolean): void {
    // 토큰을 버리면 유예도 같이 사라진다 — 마감이 토큰에서 계산되므로 잊어야 할
    // 두 번째 자격증명이 없다.
    record.token = null
    if (!keepKey) record.key = null
    persist()
    // 트라이얼이 뭐라고 하든 그리로 돌아간다. 2주 전에 설치한 사람에게는
    // "만료"다. 기록된 시작일이 판정하므로 이걸로 새 창을 만들 수는 없다.
    settle()
  }

  function allowsPaidFeatures(): boolean {
    if (!deps.enforced) return true
    // 허용 상태는 저마다 자기 마감과 **지금** 비교된다. `state`는 실행 시점과
    // 마감 타이머에서만 움직이는데, 데스크톱 앱은 몇 주씩 안 꺼진다.
    switch (state.status) {
      case 'licensed': {
        if (clockSafeNow() < state.untilMs) return true
        // 만료된 라이선스는 절벽이 아니라 같은 토큰이 얻는 유예로 떨어진다.
        // 새벽 3시에 토큰이 만료된 유료 사용자를 앱이 꺼질 때까지 거절하고
        // 트라이얼 만료 안내를 보여주는 것은 정확히 틀린 사람을 벌주는 것이다.
        const ceiling = graceDeadlineOf(verifyCurrent())
        return ceiling !== null && clockSafeNow() < ceiling
      }
      case 'grace':
      case 'trial':
        return clockSafeNow() < state.untilMs
      case 'unlicensed':
      case 'trialExpired':
        return false
    }
  }

  settle()

  return {
    getState: () => state,
    getMaskedKey: () => (record.key ? maskKey(record.key) : null),
    allowsPaidFeatures,
    activate,
    deactivate,
    revalidateIfNeeded,
    dispose: () => {
      disposed = true
      cancelClose()
    }
  }
}

/**
 * 설정 화면에 보일 형태. 마지막 묶음만 남긴다 — 사용자가 "내가 넣은 그 키가 맞나"를
 * 확인하기엔 충분하고, 지원 문의에 붙는 스크린샷으로 키가 새지는 않는다.
 */
export function maskKey(key: string): string {
  const parts = key.split('-')
  if (parts.length !== 5) return key
  return [parts[0], '••••', '••••', '••••', parts[4]].join('-')
}

function sameState(a: LicenseState, b: LicenseState): boolean {
  if (a.status !== b.status) return false
  return 'untilMs' in a && 'untilMs' in b ? a.untilMs === b.untilMs : true
}
