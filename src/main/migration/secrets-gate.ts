/**
 * 비밀값 **보호 모드**.
 *
 * 새 번들 ID로 처음 뜬 앱이 Keychain 접근을 거부당하면(또는 항목이 사라졌으면)
 * `safeStorage.decryptString`이 던지고, 세 저장소는 모두 "비밀 없음"으로 읽는다
 * (`decodeApiKey`·`decodeConfig`·`decodeGoogleConfig`). 거기까지는 괜찮다. 문제는 그
 * 다음이다 — 그 상태에서 설정을 한 번이라도 저장하면 `*_enc` 칸이 null로 덮여
 * **원본 암호문이 사라진다.** 사용자가 나중에 Keychain을 허용해도 돌아올 것이 없다.
 *
 * 그래서 sentinel 검사가 실패하면 여기를 잠그고, 세 writer가 저장 직전에
 * `preserveCiphertext`로 **파일에 있던 암호문을 되살린다.** 새 비밀을 넣는 저장
 * (값이 있는 저장)은 막지 않는다 — 그건 사용자의 명시적 선택이다.
 *
 * 모듈 상태인 이유: 세 writer가 서로 다른 파일에 있고, 모두 같은 답을 봐야 한다.
 */

import type { SentinelCheck } from '../../shared/migration'
import { readRawJson } from './handoff'

interface GateState {
  locked: boolean
  reason: SentinelCheck | null
}

let gate: GateState = { locked: false, reason: null }

export function lockSecrets(reason: SentinelCheck): void {
  gate = { locked: true, reason }
}

export function unlockSecrets(): void {
  gate = { locked: false, reason: null }
}

export function secretsLocked(): boolean {
  return gate.locked
}

export function secretsGate(): Readonly<GateState> {
  return gate
}

/** 테스트 전용 — 모듈 상태를 처음으로. */
export function _resetSecretsGateForTests(): void {
  gate = { locked: false, reason: null }
}

/**
 * 잠긴 동안, 비어 있는 `field`를 파일의 기존 암호문으로 되살린다.
 *
 * `clearSecret`이 true면 되살리지 않는다 — 연결 해제처럼 사용자가 **지우겠다고**
 * 한 저장이다. 보호 모드는 실수를 막는 것이지 사용자의 결정을 뒤집는 것이 아니다.
 */
export function preserveCiphertext<T extends object>(
  next: T,
  existingFilePath: string,
  field: string,
  clearSecret = false
): T {
  if (!gate.locked || clearSecret) return next
  const value = (next as Record<string, unknown>)[field]
  if (typeof value === 'string' && value.length > 0) return next
  const existing = readRawJson(existingFilePath)
  const previous = existing?.[field]
  if (typeof previous !== 'string' || previous.length === 0) return next
  return { ...next, [field]: previous }
}
