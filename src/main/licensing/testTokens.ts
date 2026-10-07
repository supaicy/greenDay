/**
 * 테스트 전용 — 진짜 ed25519 키쌍으로 토큰을 만든다.
 *
 * 가짜 검증 함수를 주입하지 않는 이유: 이 모듈이 막으려는 것이 바로 서명 위조라,
 * 서명을 흉내 내는 순간 테스트가 지키는 것이 사라진다. 서버가 하는 것과 같은
 * 방식으로 실제로 서명하고 실제로 검증한다.
 *
 * 프로덕션 코드는 이 파일을 import하지 않으므로 번들에 들어가지 않는다.
 */

import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { importRawPublicKey } from './activationToken'

export interface TestKeyPair {
  publicKey: KeyObject
  privateKey: KeyObject
  /** 앱에 임베드되는 형태 — raw 32바이트 base64. */
  rawBase64: string
}

export function makeKeyPair(): TestKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  // SPKI DER의 앞 12바이트는 알고리즘 헤더고, 그 뒤 32바이트가 raw 공개키다.
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12)
  return { publicKey, privateKey, rawBase64: raw.toString('base64') }
}

/** 앱이 하는 것과 같은 경로로 공개키를 읽는다. 못 읽으면 테스트가 거기서 멈춰야 한다. */
export function importTestKey(rawBase64: string): KeyObject {
  const key = importRawPublicKey(rawBase64)
  if (!key) throw new Error('테스트 공개키를 읽지 못했다')
  return key
}

/** 서버와 같은 와이어 형식: `base64url(payload-json).base64url(sig)`. */
export function signTestToken(payload: unknown, privateKey: KeyObject): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf-8')
  const signature = sign(null, body, privateKey)
  return `${body.toString('base64url')}.${signature.toString('base64url')}`
}
