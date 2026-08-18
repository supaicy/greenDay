/**
 * 활성화 토큰 — "이 기기가 활성화 슬롯을 갖고 있다"는 서버의 서명된 증명.
 *
 * 와이어 형식: `base64url(payload-json) + "." + base64url(ed25519-sig)`.
 *
 * 검증은 임베드된 공개키로 **전부 로컬에서** 한다. 서버는 토큰을 *받을* 때만
 * 부른다(활성화 + 30일 재검증). 그래서 비행기 안에서도 유료 기능이 계속 돈다.
 *
 * 이 파일이 지키는 단 하나의 규칙: **권한은 서명 검증을 통과한 페이로드에서만
 * 파생된다.** 파일에 적힌 어떤 숫자도, 앱이 스스로 기록한 어떤 시각도 권한을
 * 만들지 못한다.
 */

import { createPublicKey, verify, type KeyObject } from 'node:crypto'

/** 이 앱이 받아들이는 제품 slug. 서버 `products.slug`와 같고 출시 후 바뀌지 않는다. */
export const PRODUCT_SLUG = 'greenday'

/**
 * 프로덕션 ed25519 공개키 — raw 32바이트 base64.
 *
 * 나머지 반쪽은 워커의 `ED25519_PRIVATE_KEY` 시크릿에만 있다. 이 상수를 바꾸면
 * 이미 발급된 모든 토큰이 무효가 되므로, 딱 한 번만 바뀐다.
 *
 * BicMac과 같은 값이다 — 시크릿 하나가 모든 제품에 서명한다. 그래서 서명만으로는
 * 이 토큰이 haru를 위한 것인지 알 수 없고, `prod` 검사가 제품 격리의 전부가 된다.
 */
export const PRODUCTION_PUBLIC_KEY_BASE64 = 'DU0LPrFmCWTbM/6myq7+ov4fe1vPfUu1Sn0kvXLo5WM='

/** raw 32바이트를 SPKI DER로 감싸는 고정 헤더. */
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

/** base64url 문자만 있는지. Buffer는 잘못된 글자를 조용히 버리므로 직접 본다. */
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/

export interface TokenPayload {
  /** 라이선스 키의 SHA256. 키 자체는 토큰에 실리지 않는다. */
  lic: string
  /** 이 토큰이 묶인 기기 해시. */
  dev: string
  /** 어느 제품의 키로 발급됐는가. */
  prod: string
  /** unix 초. 이 값이 곧 오프라인 유예의 기준점이다. */
  exp: number
  iat: number
}

export type VerifyResult =
  | { ok: true; payload: TokenPayload; expiresAtMs: number }
  /**
   * 서명·기기·제품이 **모두 통과한** 진짜 토큰이 나이만 먹은 경우.
   *
   * 페이로드를 들려 보내는 이유: 유예 마감이 이 `exp`로부터 계산되고, 그 숫자는
   * 서버가 서명한 것이어야 한다. 앱이 따로 적어둔 타임스탬프는 그것이 보증하려는
   * 토큰과 똑같이 위조 가능하다.
   */
  | { ok: false; reason: 'expired'; payload: TokenPayload }
  | { ok: false; reason: 'malformed' | 'badSignature' | 'wrongDevice' | 'wrongProduct' }

export function importRawPublicKey(base64Raw: string): KeyObject | null {
  try {
    const raw = Buffer.from(base64Raw, 'base64')
    // ed25519 공개키는 정확히 32바이트다. Buffer가 이상한 입력을 조용히 짧은
    // 버퍼로 만들어 주므로 길이를 직접 본다.
    if (raw.length !== 32) return null
    return createPublicKey({
      key: Buffer.concat([SPKI_ED25519_PREFIX, raw]),
      format: 'der',
      type: 'spki'
    })
  } catch {
    return null
  }
}

export function verifyToken(
  raw: string,
  opts: { publicKey: KeyObject; device: string; nowMs: number }
): VerifyResult {
  const parts = raw.split('.')
  if (parts.length !== 2 || !BASE64URL_RE.test(parts[0]) || !BASE64URL_RE.test(parts[1])) {
    return { ok: false, reason: 'malformed' }
  }

  const body = Buffer.from(parts[0], 'base64url')
  const signature = Buffer.from(parts[1], 'base64url')

  // 디코드한 **그 바이트열** 위에서 검증한다. JSON을 다시 직렬화해 검증하면 키
  // 순서나 공백 한 칸에 서명이 깨지고, 서버가 보낸 진짜 토큰이 떨어진다.
  let signatureOk = false
  try {
    signatureOk = verify(null, body, opts.publicKey, signature)
  } catch {
    signatureOk = false
  }
  if (!signatureOk) return { ok: false, reason: 'badSignature' }

  const payload = parsePayload(body)
  if (!payload) return { ok: false, reason: 'malformed' }

  if (payload.dev !== opts.device) return { ok: false, reason: 'wrongDevice' }
  // 서명이 이 토큰을 이 앱의 것으로 만들어 주지 않는다 — 허브가 모든 제품에
  // 같은 키로 서명한다. BicMac 키로 haru가 열리면 안 된다.
  if (payload.prod !== PRODUCT_SLUG) return { ok: false, reason: 'wrongProduct' }

  const expiresAtMs = payload.exp * 1000
  if (expiresAtMs <= opts.nowMs) return { ok: false, reason: 'expired', payload }
  return { ok: true, payload, expiresAtMs }
}

/**
 * 서명을 통과했다고 내용까지 우리가 기대하는 모양인 것은 아니다.
 *
 * `exp`가 문자열이면 비교가 조용히 이상해지고, 그 조용함이 여기서는 곧 만료되지
 * 않는 토큰이다. 타입을 못 박는다.
 */
function parsePayload(body: Buffer): TokenPayload | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(body.toString('utf-8'))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const o = parsed as Record<string, unknown>
  if (typeof o.lic !== 'string' || typeof o.dev !== 'string') return null
  if (typeof o.exp !== 'number' || !Number.isFinite(o.exp)) return null
  if (typeof o.iat !== 'number' || !Number.isFinite(o.iat)) return null
  // `prod`가 없는 것은 위조가 아니라 이 앱이 거절해야 할 모양이다 — 허브가 되기
  // 전의 옛 토큰이 그렇게 생겼다. malformed가 아니라 wrongProduct로 떨어지도록
  // 빈 문자열로 통과시킨다.
  const prod = typeof o.prod === 'string' ? o.prod : ''

  return { lic: o.lic, dev: o.dev, prod, exp: o.exp, iat: o.iat }
}
