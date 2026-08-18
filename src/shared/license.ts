/**
 * 렌더러와 메인이 라이선스에 대해 주고받는 것 전부 — 단일 출처.
 *
 * `shared/capabilities.ts`와 같은 이유로 여기 있다: electron도 node:crypto도
 * import하지 않아 양쪽에서 쓸 수 있고, 실패 코드가 두 곳에 적혀 어긋나는 일이 없다.
 * (실패 코드가 어긋나면 증상은 "활성화가 실패했는데 아무 메시지도 안 뜬다"이다.)
 */

/**
 * 상태 이름 — **런타임 배열이 원본이고 타입은 여기서 파생된다.**
 *
 * 예전에는 이름 집합이 손으로 세 벌 복사돼 있었다(여기 타입, main의 `LicenseState`,
 * 렌더러의 `STATUSES` 배열). 그중 앞의 두 벌만 컴파일 타임에 묶여 있었고, 세 번째는
 * **부분집합이어도 타입이 통과**했다. 그래서 상태를 하나 추가하면 렌더러의 배열만
 * 조용히 빠진 채 지나가고, `normalize()`가 그 상태를 못 찾아 UNKNOWN(=잠그지 않음)을
 * 돌려줬다 — **새 잠금 상태를 추가할수록 그 상태의 사용자만 게이트를 통과했다.**
 * 리뷰 중에 실제로 값을 하나 넣어 재현했다.
 *
 * 배열 하나에서 파생시키면 세 벌이 한 벌이 된다.
 */
export const LICENSE_STATUSES = ['unlicensed', 'trial', 'trialExpired', 'licensed', 'grace'] as const
export type LicenseStatus = (typeof LICENSE_STATUSES)[number]

/**
 * 렌더러가 받는 전부. **키도 토큰도 여기 없다.**
 */
export interface PublicLicenseState {
  status: LicenseStatus
  /** 현재 권한이 끝나는 시각(ms). 끝이 없는 상태면 null. */
  untilMs: number | null
  allowsPaidFeatures: boolean
  /** 유료 전환 전이면 false — 화면이 잠금이나 만료를 말하지 않게 한다. */
  enforced: boolean
  /** 가린 키(`GREENDAY-••••-••••-••••-G8H9`). 없으면 null. */
  maskedKey: string | null
}

/** 서버가 답했거나, 답하지 않았거나. */
export type ClientError =
  | 'unknownKey'
  | 'revoked'
  | 'deviceLimit'
  | 'deactivationLimit'
  | 'deviceNotActive'
  | 'malformedKey'
  | 'network'

export type ActivateFailure =
  | 'invalidKey'
  | 'noDevice'
  | 'badToken'
  /** 서버는 승인했는데 디스크에 못 적었다 — 재시작하면 사라지므로 성공이라 답하지 않는다. */
  | 'saveFailed'
  | 'incomplete'
  | ClientError
export type DeactivateFailure = 'nothing' | 'noDevice' | 'deactivationLimit' | 'refused' | 'network'

/**
 * 어느 화면에서 구매 페이지로 갔는지. 나중에는 알아낼 방법이 없다.
 * 위와 같은 이유로 배열이 원본이다.
 */
export const PURCHASE_SOURCES = ['settings', 'locked'] as const
export type PurchaseSource = (typeof PURCHASE_SOURCES)[number]

/** 아직 메인에서 답이 오기 전 렌더러가 들고 있는 값. 잠그지 않는 쪽으로 기운다. */
export const UNKNOWN_LICENSE_STATE: PublicLicenseState = {
  status: 'unlicensed',
  untilMs: null,
  allowsPaidFeatures: true,
  enforced: false,
  maskedKey: null
}
