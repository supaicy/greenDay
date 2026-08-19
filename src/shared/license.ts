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
  /**
   * 활성화할 때 서버로 함께 가는 이 기기의 이름(`os.hostname()`).
   *
   * 화면에 그대로 보여 주려고 내려보낸다. macOS와 Windows에서는 대개 소유자
   * 실명이 들어 있고("철수의 MacBook Pro"), 기기 목록에서 골라 해제하려면 그
   * 이름이 필요하다 — 업계 표준이 그렇게 하는 이유다. 다만 **뭐가 나가는지
   * 사용자가 모르는 것은 다른 문제**라, 보내기 전에 같은 화면에 적어 둔다.
   */
  deviceName: string | null
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
export type DeactivateFailure =
  | 'nothing'
  | 'noDevice'
  | 'deactivationLimit'
  | 'refused'
  /** 서버는 슬롯을 풀었는데 로컬에서 못 지웠다 — 재시작하면 옛 토큰이 되살아난다. */
  | 'saveFailed'
  | 'network'

/**
 * 어느 화면에서 구매 페이지로 갔는지. 나중에는 알아낼 방법이 없다.
 * 위와 같은 이유로 배열이 원본이다.
 */
export const PURCHASE_SOURCES = ['settings', 'locked'] as const
export type PurchaseSource = (typeof PURCHASE_SOURCES)[number]

/**
 * 서버가 사는 곳. 하나의 상수인 이유는 같은 배포가 양쪽을 다 하기 때문이다 —
 * 워커가 `v1/activate`에 답하고 구매 페이지도 서빙한다. 따로 적으면 워커를 옮길 때
 * 반쪽씩 반대 방향으로 깨진다(활성화가 안 되거나, 구매 링크가 404거나).
 */
export const LICENSE_BASE_URL = 'https://pay.begreen.dev'

/** 이 앱이 받아들이는 제품 slug. 출시 후 바뀌지 않는다 — 발급된 키가 전부 여기 묶인다. */
export const PRODUCT_SLUG = 'greenday'

/**
 * 구매·복구 URL과 그 입력 검증.
 *
 * electron을 import하는 파일에 두면 테스트할 수가 없다. `src` 파라미터는 주석대로
 * "나중에는 알아낼 방법이 없는" 유입 경로 계측인데, 오타가 나도 아무도 모르고
 * 매출 귀속만 조용히 사라진다. `shared/app-id.ts`가 같은 이유로 순수 함수를 여기 둔다.
 */
export function purchaseUrl(source: PurchaseSource): string {
  return `${LICENSE_BASE_URL}/buy?product=${PRODUCT_SLUG}&src=${source}`
}

export function recoverUrl(): string {
  return `${LICENSE_BASE_URL}/recover`
}

/** 렌더러가 준 문자열이 그대로 URL에 들어가지 않게 한다. */
export function asPurchaseSource(value: unknown): PurchaseSource {
  return PURCHASE_SOURCES.find((s) => s === value) ?? 'settings'
}

/**
 * 잠긴 채널이 렌더러에 돌려주는 거절.
 *
 * `undefined`를 돌려주면 호출한 쪽이 성공으로 읽고 화면에만 존재하는 유령 편집이
 * 남는다. 거절은 거절처럼 생겨야 하고, 렌더러가 "잠김"과 "핸들러가 터짐"을
 * 구분할 수 있어야 하므로 양쪽이 아는 자리에 둔다.
 */
export const LICENSE_REQUIRED = 'license_required'

/** 아직 메인에서 답이 오기 전 렌더러가 들고 있는 값. 잠그지 않는 쪽으로 기운다. */
export const UNKNOWN_LICENSE_STATE: PublicLicenseState = {
  status: 'unlicensed',
  untilMs: null,
  allowsPaidFeatures: true,
  enforced: false,
  maskedKey: null,
  deviceName: null
}
