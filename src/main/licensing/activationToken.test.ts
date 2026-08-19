import { describe, it, expect } from 'vitest'
import { PRODUCTION_PUBLIC_KEY_BASE64, importRawPublicKey, verifyToken } from './activationToken'
import { PRODUCT_SLUG } from './endpoints'
import { importTestKey, makeKeyPair, signTestToken } from './testTokens'

const DEVICE = 'a'.repeat(64)
const NOW_MS = Date.UTC(2026, 7, 18)
const NOW_S = Math.floor(NOW_MS / 1000)

const pair = makeKeyPair()
const publicKey = importTestKey(pair.rawBase64)

const payload = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  lic: 'f'.repeat(64),
  dev: DEVICE,
  prod: PRODUCT_SLUG,
  exp: NOW_S + 30 * 86400,
  iat: NOW_S,
  ...over
})

const token = (over: Record<string, unknown> = {}): string => signTestToken(payload(over), pair.privateKey)

const verify = (raw: string, nowMs = NOW_MS): ReturnType<typeof verifyToken> =>
  verifyToken(raw, { publicKey, device: DEVICE, nowMs })

describe('importRawPublicKey', () => {
  it('앱에 박히는 프로덕션 공개키가 실제로 읽힌다', () => {
    // 이 상수에 오타가 나면 모든 토큰이 조용히 거절되고, 증상은 "결제했는데
    // 활성화가 안 된다"로만 나타난다. 키가 형태부터 맞는지 여기서 고정한다.
    expect(importRawPublicKey(PRODUCTION_PUBLIC_KEY_BASE64)).not.toBeNull()
  })

  it('깨진 키로는 아무것도 통과시키지 않는다', () => {
    expect(importRawPublicKey('not-base64!!')).toBeNull()
    expect(importRawPublicKey('')).toBeNull()
    // 길이가 32바이트가 아니면 ed25519 공개키가 아니다.
    expect(importRawPublicKey(Buffer.alloc(31).toString('base64'))).toBeNull()
  })
})

describe('verifyToken — 통과', () => {
  it('이 기기·이 제품 앞으로 서명된 유효한 토큰', () => {
    const result = verify(token())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.payload.dev).toBe(DEVICE)
      expect(result.expiresAtMs).toBe((NOW_S + 30 * 86400) * 1000)
    }
  })
})

describe('verifyToken — 서명', () => {
  it('다른 키쌍이 서명한 토큰은 거절한다', () => {
    const other = makeKeyPair()
    expect(verify(signTestToken(payload(), other.privateKey))).toEqual({ ok: false, reason: 'badSignature' })
  })

  it('페이로드를 고치면 서명이 깨진다', () => {
    // 서명은 base64url로 디코드한 **그 바이트열** 위에서 검증돼야 한다.
    // JSON을 다시 직렬화해 검증하면 키 순서·공백이 달라져 진짜 토큰이 떨어지거나,
    // 더 나쁘게는 의미가 다른 바이트열이 같은 서명으로 통과할 수 있다.
    const [body, sig] = token().split('.')
    const tampered = JSON.parse(Buffer.from(body, 'base64url').toString())
    tampered.exp = NOW_S + 100 * 365 * 86400
    const forged = `${Buffer.from(JSON.stringify(tampered)).toString('base64url')}.${sig}`
    expect(verify(forged)).toEqual({ ok: false, reason: 'badSignature' })
  })
})

describe('verifyToken — 결속', () => {
  it('다른 기기의 토큰은 거절한다', () => {
    // license.json을 통째로 복사해 온 경우다. 서명은 완벽하다.
    expect(verify(token({ dev: 'b'.repeat(64) }))).toEqual({ ok: false, reason: 'wrongDevice' })
  })

  it('다른 제품의 토큰은 거절한다 — 제품 격리는 이것뿐이다', () => {
    // 워커 시크릿 하나가 모든 제품에 서명하므로, 서명만으로는 이 토큰이 haru를
    // 위한 것인지 알 수 없다. BicMac 키로 haru가 열리면 안 된다.
    expect(verify(token({ prod: 'bicmac' }))).toEqual({ ok: false, reason: 'wrongProduct' })
  })

  it('제품이 안 적힌 토큰도 거절한다', () => {
    // 위조가 아니라 이 앱이 받아들이면 안 되는 모양이다 — 허브가 되기 전의
    // 옛 토큰이 그렇게 생겼다.
    expect(verify(token({ prod: undefined }))).toEqual({ ok: false, reason: 'wrongProduct' })
  })
})

describe('verifyToken — 만료', () => {
  it('exp를 지나면 페이로드를 들고 만료로 답한다', () => {
    // 유예 기간이 이 exp로부터 계산되므로, 만료된 토큰도 페이로드를 돌려줘야
    // 한다. 그 숫자는 서버가 서명한 것이라 앱이 늘릴 수 없다.
    const raw = token({ exp: NOW_S - 1 })
    const result = verify(raw)
    expect(result.ok).toBe(false)
    if (!result.ok && result.reason === 'expired') {
      expect(result.payload.exp).toBe(NOW_S - 1)
    } else {
      expect.unreachable('만료로 판정돼야 한다')
    }
  })

  it('만료 판정보다 서명·기기·제품 검사가 먼저다', () => {
    // 순서가 뒤집히면 위조된 만료 토큰이 페이로드를 들고 나가고, 유예 기간이
    // 그 페이로드의 exp에서 계산된다 — 손으로 쓴 숫자가 유예를 만든다.
    const other = makeKeyPair()
    expect(verify(signTestToken(payload({ exp: NOW_S - 1 }), other.privateKey))).toEqual({
      ok: false,
      reason: 'badSignature'
    })
    expect(verify(token({ exp: NOW_S - 1, dev: 'b'.repeat(64) }))).toEqual({ ok: false, reason: 'wrongDevice' })
    expect(verify(token({ exp: NOW_S - 1, prod: 'bicmac' }))).toEqual({ ok: false, reason: 'wrongProduct' })
  })

  it('exp 정각은 만료로 본다', () => {
    expect(verify(token({ exp: NOW_S }), NOW_S * 1000).ok).toBe(false)
    expect(verify(token({ exp: NOW_S + 1 }), NOW_S * 1000).ok).toBe(true)
  })
})

describe('verifyToken — 모양', () => {
  it('형식이 아닌 것은 malformed', () => {
    for (const raw of ['', '.', 'nodot', 'a.b.c', 'not-base64!!.zzz']) {
      expect(verify(raw)).toEqual({ ok: false, reason: 'malformed' })
    }
  })

  it('서명은 맞지만 페이로드가 토큰 모양이 아니면 malformed', () => {
    // 서명 검증을 통과했다고 해서 내용이 우리가 기대하는 모양이라는 보장은 없다.
    // exp가 문자열이면 비교가 조용히 이상해진다 — 숫자로 못 박는다.
    expect(verify(signTestToken({ ...payload(), exp: '9999999999' }, pair.privateKey))).toEqual({
      ok: false,
      reason: 'malformed'
    })
    expect(verify(signTestToken({ ...payload(), dev: 42 }, pair.privateKey))).toEqual({
      ok: false,
      reason: 'malformed'
    })
    expect(verify(signTestToken([1, 2, 3], pair.privateKey))).toEqual({ ok: false, reason: 'malformed' })
    expect(verify(signTestToken(null, pair.privateKey))).toEqual({ ok: false, reason: 'malformed' })
  })
})
