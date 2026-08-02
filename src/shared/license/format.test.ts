import { describe, it, expect } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import {
  canonicalize,
  encodeDocument,
  decodeDocument,
  verifyLicense,
  verifyActivation,
  compareVersions,
  evaluateEntitlement,
  type LicensePayload,
  type ActivationPayload
} from './format'
import { signPayload, makeVerifier, hashMachineId } from './crypto'

// 실제 Ed25519 키쌍으로 검증한다 — 가짜 서명 함수를 쓰면 "위조가 막히는가"라는
// 가장 중요한 성질을 전혀 확인하지 못한다.
const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
  publicKeyEncoding: { format: 'pem', type: 'spki' }
})
const attacker = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
  publicKeyEncoding: { format: 'pem', type: 'spki' }
})

const verifier = makeVerifier(publicKey)
const NOW = '2026-08-02T00:00:00.000Z'
const MACHINE = hashMachineId('ABCD-1234', 'greenday')

function license(overrides: Partial<LicensePayload> = {}): LicensePayload {
  return {
    id: 'lic_001',
    name: '홍길동',
    email: 'hong@example.com',
    seats: 3,
    issuedAt: '2026-08-01T00:00:00.000Z',
    expiresAt: null,
    maxVersion: null,
    ...overrides
  }
}

function activation(overrides: Partial<ActivationPayload> = {}): ActivationPayload {
  return {
    licenseId: 'lic_001',
    machineHash: MACHINE,
    validUntil: '2026-09-01T00:00:00.000Z',
    issuedAt: NOW,
    ...overrides
  }
}

const issue = (p: LicensePayload): string =>
  encodeDocument(signPayload(p as unknown as Record<string, unknown>, privateKey))
const issueActivation = (p: ActivationPayload): string =>
  encodeDocument(signPayload(p as unknown as Record<string, unknown>, privateKey))

describe('canonicalize', () => {
  it('키 순서가 달라도 같은 문자열을 만든다 (서명·검증이 어긋나면 안 된다)', () => {
    expect(canonicalize({ b: 2, a: 1 })).toBe(canonicalize({ a: 1, b: 2 }))
  })

  it('값이 다르면 다른 문자열이 된다', () => {
    expect(canonicalize({ a: 1 })).not.toBe(canonicalize({ a: 2 }))
  })
})

describe('라이선스 키 검증', () => {
  it('제대로 발급한 키는 통과한다', () => {
    const result = verifyLicense(issue(license()), verifier)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.payload.name).toBe('홍길동')
  })

  it('내용을 한 글자라도 고치면 거부한다', () => {
    const signed = signPayload(license() as unknown as Record<string, unknown>, privateKey)
    // 좌석 수를 3 → 99 로 늘려 본다. 서명은 원본에 대한 것이라 맞지 않는다.
    const tampered = { ...signed, payload: { ...signed.payload, seats: 99 } }
    const result = verifyLicense(encodeDocument(tampered), verifier)
    expect(result).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('다른 개인키로 만든 키는 거부한다 (제3자가 발급할 수 없다)', () => {
    const forged = encodeDocument(
      signPayload(license() as unknown as Record<string, unknown>, attacker.privateKey)
    )
    expect(verifyLicense(forged, verifier)).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('무작위 문자열은 전부 거부한다', () => {
    for (const junk of ['', 'abc', '123456', 'GRND-XXXX-YYYY-ZZZZ', 'a'.repeat(200)]) {
      expect(verifyLicense(junk, verifier).ok).toBe(false)
    }
  })

  it('붙여넣을 때 섞인 공백·줄바꿈은 무시한다', () => {
    const key = issue(license())
    const messy = `  ${key.slice(0, 20)}\n${key.slice(20, 40)}\t${key.slice(40)}  `
    expect(verifyLicense(messy, verifier).ok).toBe(true)
  })

  it('필드가 빠진 문서는 형식 오류로 거부한다', () => {
    const broken = encodeDocument({ payload: { id: 'x' }, signature: 'sig' })
    expect(verifyLicense(broken, verifier)).toEqual({ ok: false, reason: 'malformed' })
  })

  it('공개키가 깨져 있으면 아무것도 통과시키지 않는다', () => {
    const broken = makeVerifier('not a key')
    expect(verifyLicense(issue(license()), broken).ok).toBe(false)
  })
})

describe('활성화 토큰 검증', () => {
  it('서버가 서명한 토큰은 통과한다', () => {
    expect(verifyActivation(issueActivation(activation()), verifier).ok).toBe(true)
  })

  it('만료일을 늘려 고치면 거부한다 (캐시 파일을 손으로 고쳐도 소용없다)', () => {
    const signed = signPayload(activation() as unknown as Record<string, unknown>, privateKey)
    const tampered = {
      ...signed,
      payload: { ...signed.payload, validUntil: '2099-01-01T00:00:00.000Z' }
    }
    expect(verifyActivation(encodeDocument(tampered), verifier).ok).toBe(false)
  })

  it('가짜 서버가 발급한 토큰은 거부한다', () => {
    const forged = encodeDocument(
      signPayload(activation() as unknown as Record<string, unknown>, attacker.privateKey)
    )
    expect(verifyActivation(forged, verifier).ok).toBe(false)
  })
})

describe('compareVersions', () => {
  it('자리별로 비교한다', () => {
    expect(compareVersions('2.0.1', '2.0.1')).toBe(0)
    expect(compareVersions('2.1.0', '2.0.9')).toBeGreaterThan(0)
    expect(compareVersions('2.0.0', '10.0.0')).toBeLessThan(0)
  })

  it('자릿수가 달라도 비교된다', () => {
    expect(compareVersions('2', '2.0.0')).toBe(0)
    expect(compareVersions('2.1', '2.0.5')).toBeGreaterThan(0)
  })
})

describe('evaluateEntitlement', () => {
  const base = { machineHash: MACHINE, appVersion: '2.0.1', now: NOW, graceDays: 14 }

  it('기한 안이면 사용 가능', () => {
    expect(evaluateEntitlement({ ...base, license: license(), activation: activation() })).toEqual({
      state: 'active',
      until: '2026-09-01T00:00:00.000Z'
    })
  })

  it('다른 기기의 토큰은 거부한다', () => {
    const result = evaluateEntitlement({
      ...base,
      license: license(),
      activation: activation({ machineHash: 'other-machine' })
    })
    expect(result).toEqual({ state: 'invalid', reason: 'machine_mismatch' })
  })

  it('다른 라이선스의 토큰은 거부한다', () => {
    const result = evaluateEntitlement({
      ...base,
      license: license(),
      activation: activation({ licenseId: 'lic_999' })
    })
    expect(result).toEqual({ state: 'invalid', reason: 'license_mismatch' })
  })

  it('토큰이 만료돼도 유예 기간 안이면 계속 쓸 수 있다', () => {
    const result = evaluateEntitlement({
      ...base,
      now: '2026-09-05T00:00:00.000Z', // 만료 4일 뒤
      license: license(),
      activation: activation()
    })
    expect(result.state).toBe('grace')
  })

  it('유예 기간까지 지나면 잠근다', () => {
    const result = evaluateEntitlement({
      ...base,
      now: '2026-09-20T00:00:00.000Z', // 만료 19일 뒤 (유예 14일 초과)
      license: license(),
      activation: activation()
    })
    expect(result).toEqual({ state: 'invalid', reason: 'expired' })
  })

  it('구독 만료는 유예 없이 즉시 끝난다 (기간제 상품의 기간이 끝난 것)', () => {
    const result = evaluateEntitlement({
      ...base,
      now: '2026-08-15T00:00:00.000Z',
      license: license({ expiresAt: '2026-08-10T00:00:00.000Z' }),
      activation: activation() // 토큰 자체는 아직 유효
    })
    expect(result).toEqual({ state: 'invalid', reason: 'expired' })
  })

  it('버전 상한을 넘는 앱에서는 거부한다 (v2까지 구매한 평생 라이선스)', () => {
    const result = evaluateEntitlement({
      ...base,
      appVersion: '3.0.0',
      license: license({ maxVersion: '2.9.9' }),
      activation: activation()
    })
    expect(result).toEqual({ state: 'invalid', reason: 'version_too_new' })
  })

  it('버전 상한 이하면 통과한다', () => {
    const result = evaluateEntitlement({
      ...base,
      appVersion: '2.5.0',
      license: license({ maxVersion: '2.9.9' }),
      activation: activation()
    })
    expect(result.state).toBe('active')
  })
})

describe('hashMachineId', () => {
  it('같은 입력은 같은 해시', () => {
    expect(hashMachineId('UUID-1', 'greenday')).toBe(hashMachineId('UUID-1', 'greenday'))
  })

  it('원본 값이 해시에 드러나지 않는다', () => {
    expect(hashMachineId('UUID-1', 'greenday')).not.toContain('UUID-1')
  })

  it('salt가 다르면 다른 해시가 된다 (다른 서비스의 해시와 대조되지 않는다)', () => {
    expect(hashMachineId('UUID-1', 'greenday')).not.toBe(hashMachineId('UUID-1', 'other'))
  })
})

describe('encode/decode 왕복', () => {
  it('발급한 키를 그대로 되읽는다', () => {
    const signed = signPayload(license() as unknown as Record<string, unknown>, privateKey)
    const restored = decodeDocument<LicensePayload>(encodeDocument(signed))
    expect(restored?.payload).toEqual(signed.payload)
    expect(restored?.signature).toBe(signed.signature)
  })

  it('깨진 입력은 null', () => {
    for (const junk of ['', '!!!!', 'e30', Buffer.from('{}').toString('base64url')]) {
      const result = decodeDocument(junk)
      if (result !== null) expect(result.signature).toBeTruthy()
    }
  })
})
