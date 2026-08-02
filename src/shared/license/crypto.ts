/**
 * Ed25519 서명·검증. node:crypto만 쓰고 의존성을 추가하지 않는다.
 *
 * 개인키는 사장님 손에만 있고 앱에는 공개키만 들어간다. 서명 위조는 개인키 없이는
 * 계산상 불가능하므로, 무작위 입력으로 유효한 키를 만들어내는 일은 일어나지 않는다.
 * (앱 바이너리를 고쳐 검사 자체를 지우는 것은 별개 문제이며, 어떤 클라이언트 측
 * 라이선스도 그건 막지 못한다.)
 */

import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { canonicalize, type Signed } from './format'

/** PEM 개인키로 payload에 서명한다. 발급 도구와 서버에서만 쓴다. */
export function signPayload<T extends Record<string, unknown>>(
  payload: T,
  privateKeyPem: string
): Signed<T> {
  const key = createPrivateKey(privateKeyPem)
  // Ed25519는 알고리즘이 곧 해시까지 정하므로 첫 인자는 null이어야 한다.
  const signature = sign(null, Buffer.from(canonicalize(payload), 'utf-8'), key)
  return { payload, signature: signature.toString('base64url') }
}

/** 공개키로 서명을 확인한다. 앱에 들어가는 쪽. */
export function makeVerifier(publicKeyPem: string): (message: string, signature: string) => boolean {
  let key: ReturnType<typeof createPublicKey> | null = null
  try {
    key = createPublicKey(publicKeyPem)
  } catch {
    // 공개키가 비었거나 깨졌으면 어떤 서명도 통과시키지 않는다.
    return () => false
  }
  return (message, signature) => {
    try {
      return verify(null, Buffer.from(message, 'utf-8'), key, Buffer.from(signature, 'base64url'))
    } catch {
      return false
    }
  }
}

/**
 * 기기 식별자를 해시한다.
 *
 * 원본 하드웨어 UUID를 그대로 보내지 않는 이유: 서버에 남는 값이 특정 기기를 직접
 * 가리키지 않게 하기 위해서다. 해시에 제품 고유 salt를 섞어, 다른 서비스가 가진
 * 같은 UUID의 해시와도 대조되지 않게 한다.
 */
export function hashMachineId(rawId: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${rawId}`, 'utf-8').digest('base64url').slice(0, 32)
}
