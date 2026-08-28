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
 * **서버가 말해 준** 거절 사유. 상태 이름과 다른 축이다.
 *
 * `status`는 "지금 무엇이 열려 있는가"(trial·licensed·grace…)이고, 이건 "왜
 * 그렇게 됐는가"다. 둘을 한 축으로 뭉치면 취소된 키의 사용자가 `trialExpired`가
 * 되고 화면에는 "체험 기간이 끝났습니다"가 뜬다 — 그 사람은 돈을 냈고,
 * 필요한 안내는 환불 문의이지 구매가 아니다.
 *
 * **이름을 `ClientError`에서 빌려 온다.** 렌더러가 `license.error.<이름>`으로
 * 문구를 찾으므로, 이미 활성화 실패에 쓰는 그 표가 그대로 답이 된다 —
 * 같은 사실에 두 벌의 문구를 두지 않는다.
 *
 * 둘뿐인 이유: 서버의 판정(`isServerRefusal`) 중 사용자가 **행동을 바꿔야 하는**
 * 것이 이 둘이다. `unknownKey`는 여기 오지 않는다 — 활성화 시점에만 나오고,
 * 그때는 입력한 사람이 그 자리에서 실패 문구로 본다.
 */
export const LICENSE_BLOCK_REASONS = ['revoked', 'deviceLimit'] as const
export type LicenseBlockReason = (typeof LICENSE_BLOCK_REASONS)[number]

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
  /**
   * 서버가 마지막으로 말해 준 거절 사유. 없으면 null.
   *
   * `status`와 **독립이다.** `deviceLimit`은 토큰이 살아 있는 동안에도 붙는다 —
   * 그게 요점이다: 아직 쓸 수 있을 때 알려 줘야 웹에서 슬롯을 정리할 시간이 있다.
   * 유예가 끝난 뒤에 말하면 그건 통보다.
   */
  blockedReason: LicenseBlockReason | null
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
 * 잠긴 채널이 돌려주는 거절.
 *
 * `undefined`를 돌려주면 호출한 쪽이 성공으로 읽고 화면에만 존재하는 유령 편집이
 * 남는다. 거절은 거절처럼 생겨야 한다.
 *
 * **양쪽이 쓴다.** 메인의 `ipc-gate.ts`가 던지고, 렌더러의 `useStore`가 그걸 보고
 * 잠금 화면을 띄운다. 한때 "그렇게 구분하는 렌더러 코드가 없다"며 main으로
 * 옮겼는데, 바로 그 코드를 만들면서 문자열을 렌더러에 다시 선언하고 있었다 —
 * 이름을 바꾸면 아무것도 안 깨진 채 게이트 알림만 조용히 죽는 모양이었다.
 *
 * **비교는 `includes`로 한다.** `ipcRenderer.invoke`가 거절을
 * `Error invoking remote method 'create-task': Error: license_required`로 감싸므로
 * `===`가 맞지 않는다.
 */
export const LICENSE_REQUIRED = 'license_required'

/** 아직 메인에서 답이 오기 전 렌더러가 들고 있는 값. 잠그지 않는 쪽으로 기운다. */
export const UNKNOWN_LICENSE_STATE: PublicLicenseState = {
  status: 'unlicensed',
  untilMs: null,
  allowsPaidFeatures: true,
  enforced: false,
  maskedKey: null,
  deviceName: null,
  blockedReason: null
}
