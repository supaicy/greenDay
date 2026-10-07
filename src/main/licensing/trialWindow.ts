/**
 * 트라이얼 창과 시계 산술 — 순수 함수만. 디스크도, 실제 시각도 읽지 않는다.
 *
 * 상태 기계에서 떼어낸 이유: 여기가 공격당하는 자리이고, 공격을 재현하려면
 * 시각을 마음대로 넣을 수 있어야 한다. 파일·타이머·빌드 플래그가 섞이면
 * "시계를 2100년으로 돌렸을 때" 같은 시험을 쓸 수가 없다.
 */

/** 트라이얼 30일. */
export const TRIAL_DURATION_MS = 30 * 24 * 60 * 60 * 1000

/**
 * 토큰이 만료된 뒤에도 오프라인으로 버틸 수 있는 기간.
 *
 * 트라이얼과 우연히 같은 30일이지만 서로 다른 숫자다 — 한쪽을 바꿔도 다른 쪽은
 * 따라가지 않는다.
 */
export const GRACE_DURATION_MS = 30 * 24 * 60 * 60 * 1000

export function trialEndsAt(startedAtMs: number): number {
  return startedAtMs + TRIAL_DURATION_MS
}

/**
 * 이 앱이 정당화할 수 있는 가장 나중 시각.
 *
 * 트라이얼 비교는 `Date.now()` 대신 이걸 읽는다. 시스템 시계를 되돌리는 것은
 * 로컬 만료에 대한 한 줄짜리 공격인데, 이 값에는 통하지 않는다 — 창은 여태 본
 * 가장 먼 지점의 속도로 계속 닫힌다. 앞으로 돌리는 것은 트라이얼을 일찍
 * 끝낼 뿐이라 아무도 일부러 하지 않는다.
 */
export function effectiveNow(systemMs: number, lastSeenMs: number): number {
  return Math.max(systemMs, lastSeenMs)
}

/**
 * 창이 아직 열려 있는가. **유효 시각으로만** 판정한다.
 *
 * 시스템 시계를 따로 한 번 더 보지 않는 이유: `effectiveNow`가 max라서
 * `effective < endsAt`이면 `system < endsAt`은 자동으로 참이다. 두 번 보는 것은
 * 방어가 아니라 중복이고, 중복은 "여기서 뭔가를 지키고 있다"는 잘못된 인상을 준다.
 *
 * `lastSeen`을 미래로 조작하는 공격은 여기서 막히지 않는다 — 그건 창을 **일찍**
 * 닫을 뿐이라 조작한 사람에게 이득이 없다. 시작일을 미래로 조작하는 공격은
 * 상태 기계가 시작일을 시스템 시계에 클램프하고, 그 결과를 프로세스당 한 번만
 * 도출해서 막는다(licenseManager.ts resolveTrialStart).
 */
export function isTrialOpen(startedAtMs: number, effectiveMs: number): boolean {
  return effectiveMs < trialEndsAt(startedAtMs)
}
