/**
 * 렌더러와 메인이 라이선스에 대해 주고받는 것 전부 — 단일 출처.
 *
 * `shared/capabilities.ts`와 같은 이유로 여기 있다: electron도 node:crypto도
 * import하지 않아 양쪽에서 쓸 수 있고, 실패 코드가 두 곳에 적혀 어긋나는 일이 없다.
 * (실패 코드가 어긋나면 증상은 "활성화가 실패했는데 아무 메시지도 안 뜬다"이다.)
 */

export type LicenseStatus = 'unlicensed' | 'trial' | 'trialExpired' | 'licensed' | 'grace'

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

export type ActivateFailure = 'invalidKey' | 'noDevice' | 'badToken' | 'incomplete' | ClientError
export type DeactivateFailure = 'nothing' | 'noDevice' | 'deactivationLimit' | 'refused' | 'network'

/** 어느 화면에서 구매 페이지로 갔는지. 나중에는 알아낼 방법이 없다. */
export type PurchaseSource = 'settings' | 'locked' | 'expiry'
export const PURCHASE_SOURCES: PurchaseSource[] = ['settings', 'locked', 'expiry']

/** 아직 메인에서 답이 오기 전 렌더러가 들고 있는 값. 잠그지 않는 쪽으로 기운다. */
export const UNKNOWN_LICENSE_STATE: PublicLicenseState = {
  status: 'unlicensed',
  untilMs: null,
  allowsPaidFeatures: true,
  enforced: false,
  maskedKey: null
}
