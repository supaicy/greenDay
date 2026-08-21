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
import { effectiveNow, GRACE_DURATION_MS, isTrialOpen, trialEndsAt } from './trialWindow'

/**
 * 마감을 들고 다니는 상태들. 나머지는 마감이 없다.
 *
 * 이름 집합은 `shared/license.ts`의 `LICENSE_STATUSES`에서 파생된다 — 거기 값이
 * 하나 늘면 여기서 컴파일 에러가 나고, 렌더러의 목록도 같은 배열을 쓴다.
 * 손으로 쓴 대칭 어설션이 하던 일을 타입이 대신한다.
 */
type WithDeadline = 'trial' | 'licensed' | 'grace'

export type LicenseState = { status: Exclude<LicenseStatus, WithDeadline> } | { status: WithDeadline; untilMs: number }

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

/**
 * 재검증을 얼마나 자주 들여다보는가.
 *
 * 매번 네트워크를 치는 주기가 아니다 — 반감기를 지났는지 **확인**하는 주기다.
 * 실행할 때 한 번만 보면, 몇 주 켜 두는 데스크톱 앱이 취소도 해제도 모른 채
 * 토큰 만료와 유예를 다 쓴다.
 */
const REVALIDATE_POLL_MS = 6 * 60 * 60 * 1000

/**
 * 서버에 못 닿았을 때의 재시도 간격과 상한.
 *
 * 이게 없으면 **시작할 때 잠깐 오프라인이었던 것만으로** 연결이 돌아와도 영영
 * 다시 시도하지 않고, 유예가 끝나는 날 멀쩡한 구매자가 잠긴다. 반대로 촘촘히
 * 재시도하면 비행기 안에서 배터리를 태운다.
 */
const RETRY_BASE_MS = 60_000
const RETRY_MAX_MS = 60 * 60 * 1000

/**
 * 한 번의 재검증이 무엇으로 끝났는가 — 다음 예약 간격이 여기서 갈린다.
 *
 * 두 갈래뿐이다. 한때 `refreshed`·`refused`·`notNeeded`를 따로 뒀는데 셋이
 * 같은 길로 갔다 — 이름이 실제로 없는 4단 정책을 암시했다.
 *
 * `settled`는 "서버가 답했다"가 **아니다.** 서버를 아예 부르지 않는 자리에서도
 * 이 값이 나온다: 키·토큰이 없을 때, 기기 id를 못 읽을 때, 반감기 전일 때,
 * 받아온 토큰의 서명이 깨졌을 때. 뜻하는 것은 "못 닿은 것이 아니다" 하나이고,
 * 가르는 기준도 하나다 — 보통 폴 간격으로 갈 것인가, 물러서며 재시도할 것인가.
 * (그래서 예전 이름 `answered`는 네 자리에서 거짓이었다.)
 */
type RevalidateOutcome = 'settled' | 'unreachable'

interface VerifiedToken {
  payload: TokenPayload
  expiresAtMs: number
}

export function createLicenseManager(deps: ManagerDeps): LicenseManager {
  const record: LicenseRecord = deps.store.read()
  let state: LicenseState = { status: 'unlicensed' }
  /** 기기 id는 필요한 순간에만 읽는다 — deps.device의 주석 참고. */
  const deviceId = (): string | null => deps.device()
  /**
   * 지금 걸려 있는 마감 타이머와 그 마감 시각 — **한 덩어리로 든다.**
   *
   * 취소 함수와 마감을 따로 두면 "둘 다 null이거나 둘 다 차 있다"를 손으로
   * 지켜야 하고, 어긋나는 순간의 증상이 둘 다 조용하다: 하나만 지우면 타이머가
   * 굶고(아래 `scheduleClose` 주석), 반대로 어긋나면 이른 반환이 영영 걸려 다시
   * 걸리지 않는다. 몇 주씩 안 꺼지는 앱에서만 보이는 종류의 고장이다.
   */
  let armed: { deadlineMs: number; cancel: () => void } | null = null
  /**
   * `dispose()` 이후인가.
   *
   * 종료 중에도 진행 중인 `validate` 요청은 착륙한다. 그게 `settle()`을 부르면
   * 몇 주짜리 타이머가 **다시 걸려** 프로세스가 그만큼 안 끝난다. 취소는
   * "지금 걸린 타이머 하나"가 아니라 "이제부터 아무것도 안 건다"여야 한다.
   */
  let disposed = false
  /** 재검증 예약. 마감 타이머와 별개다 — 둘은 서로 다른 것을 기다린다. */
  let cancelRevalidate: (() => void) | null = null
  /** 연속으로 서버에 못 닿은 횟수. 성공하면 0으로 돌아간다. */
  let unreachableStreak = 0
  /** 이 프로세스가 도출한 트라이얼 시작. 한 번 정해지면 안 움직인다 — resolveTrialStart 참고. */
  let trialStartedAt: number | null = null

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
   * 서버가 방금 서명한 시각으로 래칫을 다시 맞춘다.
   *
   * `lastSeen`을 **낮출 수 있는 유일한 것**이다. 이게 없으면 시계가 한 번 앞서
   * 튄 기기는 재활성화로도 회복하지 못한다.
   *
   * 기준은 토큰의 `iat`다 — `deps.now()`가 아니다. 로컬 벽시계는 이 래칫이
   * 애초에 방어하려는 대상이라, 그걸로 바닥을 내리면 유일한 하강 경로가 공격자가
   * 쓰는 값을 믿는 셈이 된다. `iat`는 서명 안에 있고 검증을 통과한 뒤에만 여기
   * 닿는다.
   */
  function anchorClockToServerTime(payload: TokenPayload): void {
    record.lastSeenMs = payload.iat * 1000
  }

  /**
   * 시계 래칫과 트라이얼 시작일 같은, **잃어도 자가 치유되는** 값의 저장.
   *
   * 그런데 배리어를 아예 안 걸 수는 없다. `store.write()`는 레코드를 **통째로**
   * 직렬화하므로 래칫 하나 올리는 쓰기도 같은 파일에 키와 토큰을 다시 쓴다.
   * 그게 플러시되기 전에 전원이 끊기면 자가 치유되는 것은 래칫뿐이고, 돈 낸
   * 사람의 라이선스는 사라진다 — 6시간 폴이 라이선스 설치에서 매번 이 길로
   * 오므로 드문 사고도 아니다.
   *
   * 그래서 **실려 있는 것으로 고른다.** 키도 토큰도 없는 트라이얼 설치에서만
   * 진짜로 값싼 쓰기이고, 그때가 하루 4번 4ms를 아끼는 것이 의미 있는
   * 유일한 경우다(그쪽이 사용자 대다수이기도 하다).
   */
  function persist(): boolean {
    const carriesCredentials = record.key !== null || record.token !== null
    return deps.store.write({ ...record }, carriesCredentials)
  }

  /**
   * 내구성 있는 저장 — **사용자에게 결과를 말하기 직전**의 것.
   *
   * 활성화·갱신·해제 셋뿐이다. 이 답 뒤에 전원이 끊겨 빈 파일이 남으면 서버
   * 슬롯은 움직였는데 앱에는 아무것도 없는 상태가 되고, 그건 지원 메일 말고는
   * 빠져나올 길이 없다. 그 한 줌에만 fsync 값을 낸다.
   */
  function commit(): boolean {
    return deps.store.write({ ...record }, true)
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
    const clockMoved = touchClock()
    const before = record.trialStartMs
    const startedAt = resolveTrialStart()
    if (clockMoved || record.trialStartMs !== before) persist()
    return isTrialOpen(startedAt, clockSafeNow())
      ? { status: 'trial', untilMs: trialEndsAt(startedAt) }
      : { status: 'trialExpired' }
  }

  /**
   * 창이 시작된 시각. 미래로 적힌 값은 시스템 시계로 클램프한다 — 창이
   * `시작 + 30일`이라, 2100년을 써넣으면 서명 없는 영구 라이선스가 된다.
   *
   * **클램프한 값은 디스크에 되쓴다.** 안 쓰면 위조된 미래 시작일이 실행마다
   * 새로 "지금"으로 보정돼, 한 번의 편집이 재시작마다 창 하나를 주는 영구
   * 라이선스가 된다 — 설정 삭제(30일마다 손을 대야 한다)보다 명백히 강해서
   * 문서화된 트레이드오프 선을 넘는다. 리뷰에서 실증했다.
   *
   * (이 자리에는 "되쓰면 정직한 쪽이 낙인찍힌다"고 적혀 있었는데 틀렸다.
   * 되쓰는 값은 **지금 시각**이라 정직한 사용자는 온전한 창을 새로 받는다.
   * 진짜 보호 대상은 다른 경우였다 — 아래.)
   *
   * **한 가지 예외: 시계 자체가 뒤로 갔을 때.** 메인보드 배터리가 죽어 2001년으로
   * 올라온 기기에서는 정상적인 시작일이 "한참 미래"로 보인다. 거기서 되쓰면
   * 진짜 시작일이 2001년으로 박제되고 앱 안에 되돌릴 방법이 없다. 두 상황은
   * 겉모습이 같지만 래칫이 가른다: `resolveTrialStart`는 `touchClock()` 바로
   * 뒤에서만 불리므로, 시계가 정상이면 `lastSeen === systemNow`이고 시계가
   * 뒤로 갔을 때만 `lastSeen > systemNow`다.
   *
   * `lastSeen`도 쓰기 가능하니 그걸 앞세워 되쓰기를 막을 수는 있다. 하지만 그
   * 순간 `clockSafeNow()`가 그 값이 되어 창이 오히려 먼저 닫힌다 — 살아남는
   * 구간은 `systemNow < lastSeen < systemNow + 30일`뿐이고, 실제 시각이 그
   * 값을 지나가면 래칫이 따라잡아 되쓰기가 발화한다. 즉 한 번의 편집이
   * 사 주는 것은 최대 한 창이고, 그건 설정을 지워 얻는 것과 같다.
   *
   * 클램프 자체는 시스템 시계로 한다 — `clockSafeNow`로 하면 두 값을 다 2100으로
   * 써넣었을 때 "보정"이 2100을 시작일로 고정해 준다.
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
      return trialStartedAt
    }
    // 과거로 당긴 시작일은 트라이얼을 일찍 끝낼 뿐이라 바닥이 필요 없다.
    if (recorded <= systemNow) {
      trialStartedAt = recorded
      return trialStartedAt
    }
    // 시계가 뒤로 가지 않았다면 되쓴다. 위 문단 참고.
    if (systemNow >= record.lastSeenMs) {
      record.trialStartMs = systemNow
    }
    trialStartedAt = systemNow
    return trialStartedAt
  }

  // ── 마감 타이머 ────────────────────────────────────────────────────────────

  function cancelClose(): void {
    armed?.cancel()
    armed = null
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
    if (disposed) return
    // **이미 이 마감을 기다리고 있으면 건드리지 않는다.**
    //
    // 이게 없으면 6시간 폴이 `settle()` → `apply()`를 돌 때마다 타이머를 취소하고
    // 다시 걸어, 6시간보다 먼 마감은 **영영 발화하지 못한다.** 그 타이머가 단조
    // 시계 방어의 전부다(깨어났다는 사실 자체가 시간이 흘렀다는 증거) — 굶기면
    // 벽시계를 묶어 둔 사용자에게 트라이얼이 안 닫힌다. 리뷰에서 실증했다.
    if (armed?.deadlineMs === deadlineMs) return
    cancelClose()
    // 남은 시간을 **래칫으로** 잰다. `deps.now()`(생 벽시계)로 재면, 시계를 묶어
    // 두거나 되돌린 사용자에게 `remaining`이 줄지 않아 조각이 깰 때마다 또 한
    // 조각(최대 24.8일)을 다시 걸고, 마감이 영원히 뒤로 물러난다. 바닥은 조각이
    // 깰 때마다 단조로 올라가므로, 그걸 기준으로 재야 실제로 줄어든다.
    const remaining = deadlineMs - clockSafeNow()
    // **오늘 기준 도달 불가다.** `apply()`가 마감을 거는 세 상태(trial·licensed·grace)는
    // 전부 `settle()`이 "아직 안 지났다"를 확인한 뒤에만 만들어지고, 그 확인이
    // `clockSafeNow()`로 이뤄지므로 여기 오는 `remaining`은 항상 양수다.
    // 그래서 뮤테이션 테스트를 걸지 말 것 — 지워도 아무것도 빨개지지 않는다.
    // 그런데도 남긴다: 실패 모드가 무한 루프다(음수 지연 → 즉시 발화 → settle →
    // apply → 다시 여기). 한 줄로 막을 수 있는 종류의 사고가 아니다.
    if (remaining <= 0) return
    const wait = Math.min(remaining, MAX_TIMEOUT_MS)
    const reachedMs = clockSafeNow() + wait
    const cancel = deps.setTimer(wait, () => {
      armed = null
      // 자고 났다는 것은 벽시계에 물어볼 수 없는 사실을 안다는 뜻이다:
      // setTimeout은 단조 시계로 재므로 날짜를 아무리 고쳐도 이 줄이 돌았다면
      // 그만큼의 시간이 실제로 흘렀다. 기록해 두면 되돌리기가 막힌다 —
      // 아니면 활성화 시점으로 되돌린 시계가 만료된 토큰을 다시 유효하게 만들고,
      // 같은 거짓말로 또 한 번의 창이 걸린다.
      if (advanceClockFloor(reachedMs)) persist()
      settle()
    })
    armed = { deadlineMs, cancel }
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

    // **되돌릴 것을 먼저 챙긴다.** 이미 라이선스가 있는 사람이 키를 다시
    // 넣었는데 디스크 쓰기가 한 번 실패하면, 되돌리기가 `null`을 쓰는 한
    // 멀쩡하던 라이선스가 메모리에서 사라진다 — 그리고 다음 `persist()`가
    // 그 빈 레코드를 디스크에 못 박는다. 일시적인 ENOSPC가 영구 손실이 된다.
    const before = { key: record.key, token: record.token, lastSeenMs: record.lastSeenMs }

    record.key = key
    record.token = result.value.token
    // 토큰의 `expiresAt`이 아니라 토큰 자체의 `exp`를 쓴다 — 옆에 실려 온
    // 숫자는 서명 밖에 있다.
    anchorClockToServerTime(verified.payload)
    // 여기서만 확정 여부를 본다. 못 적었는데 성공이라고 답하면, 사용자는
    // 활성화됐다고 믿고 서버 슬롯은 소모된 채, 재시작하면 사라져 있다.
    if (!commit()) {
      Object.assign(record, before)
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
    // 응답이 돌아왔을 때 "그 사이 아무 일도 없었나"를 판정할 기준. 키만으로는
    // 부족하다 — 아래 가드의 주석 참고.
    const token = record.token
    const device = deviceId()
    if (!device) {
      // 슬롯은 실제로 잡혀 있는데 이 기기가 자기 이름을 못 댄다. "해제할 게
      // 없다"고 말하면 두 번째 기기를 여는 유일한 방법에서 사용자를 돌려보내게 된다.
      return 'noDevice'
    }

    const result = await deps.client.deactivate(key, device)
    if (!result.ok) {
      if (result.error === 'deactivationLimit') return 'deactivationLimit'
      // `'refused'`는 지금 서버로는 도달 불가다 — `handleDeactivate`가 낼 수 있는
      // 것은 missing_fields(400)·unknown_key(404)·deactivation_limit(429)·
      // device_not_active(404)뿐이고, 위 세 줄이 그중 셋을 이미 걷어낸다.
      // 남기는 것은 `/v1/deactivate`가 나중에 revoked나 device_limit을 돌려주기
      // 시작했을 때 조용히 `network`(=재시도해도 된다)로 읽히지 않게 하기
      // 위해서다. 문구도 그래서 양쪽 로케일에 남아 있다.
      // 서버에 그 슬롯이 이미 없다 — 로컬에 들고 있어봐야 아무에게도 도움이 안 된다.
      if (result.error !== 'unknownKey' && result.error !== 'deviceNotActive') {
        return isServerRefusal(result.error) ? 'refused' : 'network'
      }
    }

    // 요청이 나가 있는 동안 자격증명이 바뀌었으면, 아무도 놓아달라고 하지 않은
    // 라이선스를 버리는 셈이 된다.
    //
    // **토큰도 같이 본다.** 키만 보면 반대 방향을 놓친다: 같은 키가 그 사이
    // 슬롯을 다시 잡은 경우 `record.key`는 내내 같은 값이라 가드가 통과하고,
    // 방금 만들어진 라이선스를 지운다. 창이 둘일 필요도 없다 — 서버의
    // `/v1/validate`가 `handleActivate`로 가서 슬롯이 없으면 다시 INSERT하므로,
    // 6시간 재검증 폴이 해제 왕복 사이에 끼기만 하면 된다. 그때 남는 상태가
    // 정확히 이 함수가 피하려던 것이다: 서버에는 슬롯이 잡혀 있는데 로컬에는
    // 토큰도 키도 없어 재검증조차 못 하고, 재입력하면 슬롯을 하나 더 먹는다.
    //
    // (오늘 기준 키를 바꾸는 경로는 전부 토큰도 함께 바꾸므로 뒷항이 앞항을
    // 덮는다 — 뮤테이션으로 확인했다. 앞항을 남기는 것은 원래 불변식을 문장
    // 그대로 적어 두기 위해서다. 여기에 뮤테이션 테스트를 걸려 하지 말 것.)
    if (record.key !== key || record.token !== token) return null
    // **디스크에서 지우지 못했으면 성공이라 답하지 않는다.** 서버 슬롯은 이미
    // 풀렸는데 옛 토큰이 파일에 남아 있으면, 재시작 때 그게 다시 읽히면서 같은
    // 키가 다른 기기에서도 활성인 상태가 된다. 활성화에만 걸어 뒀던 확인이다.
    return clearLocalLicense(false) ? null : 'saveFailed'
  }

  /**
   * 싸고 조용하다 — 실행할 때마다 부른다. 반감기를 지난 토큰만 갱신하므로
   * 한 달에 한 번 온라인이 되는 기기도 유예 끝에 몰리지 않는다.
   */
  async function revalidateIfNeeded(): Promise<void> {
    // **무슨 일이 있어도 다음 폴을 건다.** 여기서 던지면 재예약이 통째로
    // 건너뛰어지고, 데스크톱 앱은 몇 주씩 안 꺼지므로 그 세션 내내 취소도
    // 만료도 눈치채지 못한다. 던질 만한 자리가 실제로 있다: `apply()`가
    // `onChange`로 창에 방송하는데, 정리 중인 `webContents`는 던진다.
    let outcome: RevalidateOutcome = 'unreachable'
    try {
      outcome = await runRevalidation()
    } finally {
      armNextRevalidation(outcome)
    }
  }

  async function runRevalidation(): Promise<RevalidateOutcome> {
    const key = record.key
    if (!key || !record.token) {
      // 이 기기에 키가 없으니 움직일 수 있는 것은 트라이얼뿐이다. 마감을 걸친
      // 실행이라면 다음 실행을 기다리지 말고 여기서 창을 닫는다.
      apply(evaluateTrial())
      return 'settled'
    }
    const device = deviceId()
    if (!device) return 'settled'

    if (touchClock()) persist()
    const token = settle()
    if (!token) {
      // 유예 중이다. 반감기를 따질 토큰이 없으니 무조건 시도한다.
      return refresh(key, device)
    }
    const lifetimeMs = (token.payload.exp - token.payload.iat) * 1000
    // 래칫으로 잰다. 생 벽시계로 재면 시계를 되돌린 기기에서 토큰이 영영
    // "아직 반감기 전"으로 보여 재검증이 서버를 한 번도 안 친다 — 취소가
    // 도달하지 못한다. 이 파일의 다른 시각 비교는 전부 `clockSafeNow()`다.
    if (clockSafeNow() > token.payload.iat * 1000 + lifetimeMs / 2) {
      return refresh(key, device)
    }
    return 'settled'
  }

  /**
   * 다음 재검증을 예약한다.
   *
   * 못 닿았으면 물러서며 다시 시도하고(1분 → 2분 → … → 1시간), 그 외에는 그냥
   * 주기적으로 반감기를 확인한다. 서버가 **거부**한 경우는 재시도하지 않는다 —
   * 답이 왔고 그 답이 아니오였으므로, 다시 물어도 같은 답이 온다.
   */
  function armNextRevalidation(outcome: RevalidateOutcome): void {
    cancelRevalidateTimer()
    if (disposed) return
    unreachableStreak = outcome === 'unreachable' ? unreachableStreak + 1 : 0
    // 상한을 씌우지 않는다 — 둘 다 상수이고 가장 큰 `REVALIDATE_POLL_MS`(6시간)도
    // `MAX_TIMEOUT_MS`(약 24.8일)의 1/99이라 클램프가 발화할 수 없다.
    // `scheduleClose` 쪽은 마감이 토큰에서 오므로 진짜 상한이 필요하다.
    const delay =
      unreachableStreak === 0
        ? REVALIDATE_POLL_MS
        : Math.min(RETRY_BASE_MS * 2 ** (unreachableStreak - 1), RETRY_MAX_MS)
    cancelRevalidate = deps.setTimer(delay, () => {
      cancelRevalidate = null
      void revalidateIfNeeded()
    })
  }

  function cancelRevalidateTimer(): void {
    cancelRevalidate?.()
    cancelRevalidate = null
  }

  async function refresh(key: string, device: string): Promise<RevalidateOutcome> {
    const before = { token: record.token, lastSeenMs: record.lastSeenMs }
    const result = await deps.client.validate(key, device, deps.deviceName)

    if (result.ok) {
      // 저 `await`는 중단점이고, 그 사이에 사용자가 해제를 끝낼 수 있다 —
      // 슬롯은 서버에서 풀렸고 키는 여기서 지워졌다. 그 뒤에 이 토큰을 쓰면
      // 다른 기기가 가져갈 수 있는 슬롯 위에서 라이선스가 되살아난다. 기기
      // 한도가 느린 응답 하나로 무너지는 것이다. 다른 키로 재활성화한 경우도
      // 같은 검사가 막는다 — 이 답은 물어본 그 키에 대한 것이다.
      if (record.key !== key) return 'settled'
      const verified = verifyToken(result.value.token, {
        publicKey: deps.publicKey,
        device,
        key,
        nowMs: deps.now()
      })
      if (!verified.ok) return 'settled'
      record.token = result.value.token
      anchorClockToServerTime(verified.payload)
      if (!commit()) {
        // 디스크에 못 적었는데 새 토큰으로 화면을 갱신하면, 재시작 때 옛(만료된)
        // 토큰이 돌아와 사용자가 이유 없이 잠긴다. 메모리도 되돌리고, 이번은
        // 못 닿은 것으로 쳐서 곧 다시 시도한다.
        Object.assign(record, { token: before.token, lastSeenMs: before.lastSeenMs })
        return 'unreachable'
      }
      settle()
      return 'settled'
    }

    // 서버에 못 닿은 것은 판정이 아니다. 검증된 토큰과 그것이 얻은 유예가
    // 그대로 선다 — 이걸 거부처럼 다루면 기차 터널 하나가 라이선스를 지운다.
    if (!isServerRefusal(result.error)) return 'unreachable'
    if (record.key !== key) return 'settled'
    // **한도는 취소가 아니다.** `/v1/validate`는 서버에서 `handleActivate`로 가므로,
    // 이 기기의 슬롯이 관리자 조치나 오래된 활성화 회수로 빠진 뒤 키가 한도에 차
    // 있으면 `device_limit`이 온다. 그건 "이 라이선스가 무효다"가 아니라 "슬롯을
    // 하나 비워라"인데, 여기서 토큰을 지우면 돈 낸 사람이 유예도 없이 그 자리에서
    // 잠기고 폴은 6시간마다 같은 거절을 받는다. 토큰을 그대로 두면 `exp`+유예만큼
    // 시간이 생겨 웹에서 슬롯을 정리할 수 있고, 정리되는 순간 다음 폴이 통과한다.
    if (result.error === 'deviceLimit') return 'settled'
    // 키는 남긴다. 취소는 서명 없이 도착하므로 잘못된 취소는 재활성화 한 번으로
    // 회복 가능한 자리에 있어야 한다 — 진짜 취소는 다시 거부당한다.
    //
    // 못 지웠으면 `settled`라 답하지 않는다. 그러면 6시간을 기다리는데, 그동안
    // 취소된 자격증명이 디스크에 그대로 남아 재시작이 되살린다.
    return clearLocalLicense(true) ? 'settled' : 'unreachable'
  }

  /**
   * 이 기기를 라이선스 상태로 만드는 것을 한꺼번에 버린다.
   *
   * 호출자마다 따로 지우면, 나중에 필드가 하나 늘었을 때 한쪽에서만 기억되고
   * 다른 쪽에서 잊힌다.
   */
  function clearLocalLicense(keepKey: boolean): boolean {
    // **되돌릴 것을 먼저 챙긴다** — `activate`와 같은 이유다. 디스크에 못 적었는데
    // 메모리만 비워 두면, 호출처는 "해제 실패"를 사용자에게 보여 주는데 앱은 이미
    // 라이선스를 잃은 상태가 된다(잠금 화면이 뜨고 `getMaskedKey()`가 null이다).
    // 게다가 다음 폴의 `persist()`가 그 빈 레코드를 디스크에 그대로 적어, 실패라고
    // 답한 일이 조용히 성공해 버린다. 같은 커밋에서 `activate`만 고치고 여기를
    // 빠뜨렸었다.
    const before = { key: record.key, token: record.token }

    // 토큰을 버리면 유예도 같이 사라진다 — 마감이 토큰에서 계산되므로 잊어야 할
    // 두 번째 자격증명이 없다.
    record.token = null
    if (!keepKey) record.key = null
    if (!commit()) {
      Object.assign(record, before)
      return false
    }
    // 트라이얼이 뭐라고 하든 그리로 돌아간다. 2주 전에 설치한 사람에게는
    // "만료"다. 기록된 시작일이 판정하므로 이걸로 새 창을 만들 수는 없다.
    settle()
    return true
  }

  function allowsPaidFeatures(): boolean {
    if (!deps.enforced) return true
    // 허용 상태는 저마다 자기 마감과 **지금** 비교된다. `state`는 실행 시점과
    // 마감 타이머에서만 움직이는데, 데스크톱 앱은 몇 주씩 안 꺼진다.
    switch (state.status) {
      // 만료된 라이선스는 절벽이 아니라 같은 토큰이 얻는 유예로 떨어진다.
      // 새벽 3시에 토큰이 만료된 유료 사용자를 앱이 꺼질 때까지 거절하고
      // 트라이얼 만료 안내를 보여주는 것은 정확히 틀린 사람을 벌주는 것이다.
      //
      // 그 천장을 **산술로** 얻는다. `licensed`의 `untilMs`는 검증을 통과한
      // 토큰의 `exp`(ms) 그 자체라, 유예 끝은 거기에 상수를 더한 값이다 —
      // `graceDeadlineOf(verifyCurrent())`가 계산하는 것과 같은 숫자다.
      // 여기서 다시 검증하면 **모든 유료 IPC 앞에** ed25519 한 번(33µs)이
      // 붙는데, `licensed`에 들어왔다는 것 자체가 서명·기기·제품이 통과했다는
      // 뜻이고 그 뒤로 달라진 것은 시간뿐이라 새로 알아낼 것이 없다.
      case 'licensed':
        return clockSafeNow() < state.untilMs + GRACE_DURATION_MS
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
      cancelRevalidateTimer()
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
