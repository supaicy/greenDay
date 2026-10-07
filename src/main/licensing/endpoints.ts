/**
 * 라이선스 서버의 주소와 그 위에 얹히는 URL들.
 *
 * **`src/shared`가 아니라 여기 있다.** `shared/license.ts`는 렌더러와 메인이
 * *주고받는 것*의 자리인데, 이 파일의 값은 렌더러도 preload도 한 번도 읽지
 * 않는다 — 구매 링크는 렌더러가 `license:purchase` IPC로 부탁하면 메인이
 * `shell.openExternal`로 연다. 렌더러에 URL을 내려보내지 않는 것이 그 설계다.
 *
 * (한때 "electron을 import하는 파일에 두면 테스트할 수 없다"는 이유로 shared에
 * 뒀는데, 그건 사실이 아니었다. 이 파일은 electron을 import하지 않아 노드에서
 * 그대로 테스트된다. 같은 디렉터리라도 `service.ts`는 예외다 — electron 배선이
 * 거기 모여 있어서 그 테스트만 `vi.mock('electron')`이 필요하다.)
 */

/**
 * 어느 화면에서 구매 페이지로 갔는지. 나중에는 알아낼 방법이 없다.
 * 값 집합이 손으로 복사되지 않게 배열이 원본이고 타입이 파생된다.
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
 * `src` 파라미터는 주석대로 "나중에는 알아낼 방법이 없는" 유입 경로 계측인데,
 * 오타가 나도 아무도 모르고 매출 귀속만 조용히 사라진다. 그래서 순수 함수로 두고
 * 테스트로 못 박는다.
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
