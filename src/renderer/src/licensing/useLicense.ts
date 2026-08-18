import { useSyncExternalStore } from 'react'
import { LICENSE_STATUSES, UNKNOWN_LICENSE_STATE, type PublicLicenseState } from '../../../shared/license'

/**
 * 라이선스 상태를 렌더러 전체가 하나만 보게 한다.
 *
 * 컴포넌트마다 `licenseGetState()`를 부르면 IPC 왕복이 화면 수만큼 늘고, 무엇보다
 * 마감 타이머가 상태를 움직였을 때 **일부 화면만 갱신된다** — 설정은 "만료"라고
 * 하는데 잠금 화면은 아직 안 뜬 상태가 된다. 구독을 한 번만 걸고 결과를 나눈다.
 *
 * Zustand 스토어에 얹지 않은 이유: 이 값은 렌더러가 절대 쓰지 않는 읽기 전용
 * 사실이고, 스토어에 두면 그 사실이 흐려진다.
 */

let state: PublicLicenseState = UNKNOWN_LICENSE_STATE
const listeners = new Set<() => void>()
let stop: (() => void) | null = null

function publish(next: PublicLicenseState): void {
  state = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    // `.catch`가 없으면 IPC 거절이 unhandled rejection이 되고, 상태는
    // UNKNOWN(=잠그지 않음)에 영구히 머문다. 모르는 것과 "물어봤는데 실패한 것"을
    // 같은 값으로 두되, 실패를 조용히 삼키지는 않는다.
    void window.api
      .licenseGetState()
      .then((value: unknown) => publish(normalize(value)))
      .catch((error: unknown) => console.error('[license] 상태를 받아오지 못했다', error))
    stop = window.api.onLicenseChanged((value: unknown) => publish(normalize(value)))
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      stop?.()
      stop = null
      // 구독을 끊은 뒤의 캐시는 더 이상 갱신되지 않는다. 들고 있다가 다음
      // 마운트에서 첫 프레임에 쓰면, 그 사이 만료됐거나 활성화된 상태를 모른 채
      // 옛 판정으로 한 프레임을 그린다. 모르는 상태로 돌아가는 편이 정확하다.
      state = UNKNOWN_LICENSE_STATE
    }
  }
}

/**
 * IPC 너머에서 온 값이라 모양을 믿지 않는다.
 *
 * 특히 `allowsPaidFeatures`가 undefined면 `!allows`가 참이 되어 **멀쩡한 유료
 * 사용자에게 잠금 화면이 뜬다.** 모르면 잠그지 않는 쪽으로 기운다.
 */
function normalize(value: unknown): PublicLicenseState {
  if (typeof value !== 'object' || value === null) return UNKNOWN_LICENSE_STATE
  const o = value as Record<string, unknown>
  const status = LICENSE_STATUSES.find((s) => s === o.status)
  if (!status) return UNKNOWN_LICENSE_STATE
  return {
    status,
    untilMs: typeof o.untilMs === 'number' && Number.isFinite(o.untilMs) ? o.untilMs : null,
    allowsPaidFeatures: o.allowsPaidFeatures !== false,
    enforced: o.enforced === true,
    maskedKey: typeof o.maskedKey === 'string' ? o.maskedKey : null
  }
}

export function useLicense(): PublicLicenseState {
  return useSyncExternalStore(subscribe, () => state, () => state)
}

/** 상태를 새로 받아온다. 활성화·해제 직후처럼 우리가 원인인 변화에 쓴다. */
export async function refreshLicense(): Promise<void> {
  try {
    publish(normalize(await window.api.licenseGetState()))
  } catch (error) {
    console.error('[license] 상태를 새로 받아오지 못했다', error)
  }
}

/** 마감까지 남은 일수. 오늘이 마지막 날이면 0. */
export function daysLeft(untilMs: number | null, nowMs = Date.now()): number {
  if (untilMs === null) return 0
  return Math.max(0, Math.floor((untilMs - nowMs) / 86_400_000))
}
