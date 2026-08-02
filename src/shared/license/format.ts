/**
 * 라이선스 키·활성화 토큰의 형식과 검증 — 순수 함수만. 네트워크도 파일도 없다.
 *
 * 두 종류의 서명된 문서가 오간다.
 *
 *   1. 라이선스 키   — 사장님이 발급. 구매자와 허용 대수를 담는다.
 *   2. 활성화 토큰   — 서버가 발급. "이 기기에서 언제까지 유효한지"를 담는다.
 *
 * 둘 다 Ed25519로 서명하고, 앱에는 공개키만 넣는다. 앱을 뜯어봐도 유효한 키를
 * 만들어낼 수 없다는 것이 이 구조의 핵심이다 — 앱 안에 정답 목록이 없기 때문이다.
 *
 * 토큰까지 서명하는 이유: 앱이 캐시해 둔 활성화 결과를 오프라인에서 검증할 수 있어야
 * 한다. 서명이 없으면 hosts를 고쳐 가짜 서버를 세우거나 캐시 파일을 손으로 고치는
 * 것만으로 무제한 사용이 가능해진다.
 */

export interface LicensePayload {
  /** 라이선스 고유 id. 서버가 활성화 대수를 세는 기준. */
  id: string
  /** 구매자 이름 — 설정 화면에 표시해 공유를 억제한다. */
  name: string
  email: string
  /** 동시에 활성화할 수 있는 기기 수 */
  seats: number
  /** 발급 시각(UTC ISO) */
  issuedAt: string
  /** 구독이면 만료일, 평생 라이선스면 null */
  expiresAt: string | null
  /** 이 라이선스로 쓸 수 있는 최대 버전. null이면 제한 없음. */
  maxVersion: string | null
}

export interface ActivationPayload {
  /** 어떤 라이선스에 대한 활성화인가 */
  licenseId: string
  /** 기기 식별자의 해시. 원본 하드웨어 값은 서버에도 저장하지 않는다. */
  machineHash: string
  /** 이 토큰이 유효한 기한(UTC ISO). 지나면 재확인이 필요하다. */
  validUntil: string
  issuedAt: string
}

/** 서명된 문서 공통 형태 */
export interface Signed<T> {
  payload: T
  /** base64url Ed25519 서명 */
  signature: string
}

export type LicenseKey = Signed<LicensePayload>
export type ActivationToken = Signed<ActivationPayload>

export type VerifyResult<T> =
  | { ok: true; payload: T }
  | { ok: false; reason: LicenseError }

export type LicenseError =
  | 'malformed'
  | 'bad_signature'
  | 'expired'
  | 'version_too_new'
  | 'machine_mismatch'
  | 'license_mismatch'

/**
 * 서명 대상 문자열. 서명하는 쪽과 검증하는 쪽이 **완전히 같은 바이트**를 만들어야
 * 하므로, 키 순서를 JSON.stringify 의 우연에 맡기지 않고 명시적으로 고정한다.
 */
export function canonicalize(payload: Record<string, unknown>): string {
  const keys = Object.keys(payload).sort()
  return JSON.stringify(payload, keys)
}

/** 사람이 주고받기 쉬운 한 줄 문자열로. */
export function encodeDocument<T>(doc: Signed<T>): string {
  const json = JSON.stringify(doc)
  return Buffer.from(json, 'utf-8').toString('base64url')
}

export function decodeDocument<T>(encoded: string): Signed<T> | null {
  try {
    // 사용자가 붙여넣을 때 섞이는 공백·줄바꿈은 걷어낸다.
    const cleaned = encoded.replace(/\s+/g, '')
    if (!cleaned) return null
    const json = Buffer.from(cleaned, 'base64url').toString('utf-8')
    const parsed = JSON.parse(json) as Signed<T>
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.signature !== 'string' || !parsed.signature) return null
    if (!parsed.payload || typeof parsed.payload !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

function isLicensePayload(value: unknown): value is LicensePayload {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    typeof p.email === 'string' &&
    typeof p.seats === 'number' &&
    typeof p.issuedAt === 'string' &&
    (p.expiresAt === null || typeof p.expiresAt === 'string') &&
    (p.maxVersion === null || typeof p.maxVersion === 'string')
  )
}

function isActivationPayload(value: unknown): value is ActivationPayload {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  return (
    typeof p.licenseId === 'string' &&
    typeof p.machineHash === 'string' &&
    typeof p.validUntil === 'string' &&
    typeof p.issuedAt === 'string'
  )
}

/** 서명 검증 함수. 플랫폼마다 구현이 달라 주입받는다. */
export type VerifySignature = (message: string, signature: string) => boolean

export function verifyLicense(encoded: string, verify: VerifySignature): VerifyResult<LicensePayload> {
  const doc = decodeDocument<LicensePayload>(encoded)
  if (!doc || !isLicensePayload(doc.payload)) return { ok: false, reason: 'malformed' }
  if (!verify(canonicalize(doc.payload as unknown as Record<string, unknown>), doc.signature)) {
    return { ok: false, reason: 'bad_signature' }
  }
  return { ok: true, payload: doc.payload }
}

export function verifyActivation(
  encoded: string,
  verify: VerifySignature
): VerifyResult<ActivationPayload> {
  const doc = decodeDocument<ActivationPayload>(encoded)
  if (!doc || !isActivationPayload(doc.payload)) return { ok: false, reason: 'malformed' }
  if (!verify(canonicalize(doc.payload as unknown as Record<string, unknown>), doc.signature)) {
    return { ok: false, reason: 'bad_signature' }
  }
  return { ok: true, payload: doc.payload }
}

/** major.minor.patch 비교. 같으면 0, a가 크면 양수. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const [x, y] = [parse(a), parse(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export interface EntitlementInput {
  license: LicensePayload
  activation: ActivationPayload
  machineHash: string
  appVersion: string
  now: string
  /** 토큰 만료 후에도 이만큼은 더 봐준다. 출장·비행기 등 오프라인 상황 대비. */
  graceDays: number
}

export type Entitlement =
  | { state: 'active'; until: string }
  /** 토큰은 만료됐지만 유예 기간 안. 재확인을 권하되 계속 쓸 수 있다. */
  | { state: 'grace'; until: string }
  | { state: 'invalid'; reason: LicenseError }

/**
 * 지금 이 기기에서 유료 기능을 쓸 수 있는가.
 *
 * 만료 하나로 곧장 잠그지 않고 유예를 두는 이유: 돈을 낸 사용자가 인터넷이 없다는
 * 이유로 앱을 못 쓰는 상황이 가장 나쁘다. 반대로 유예를 무한정 두면 활성화가
 * 무의미해지므로 기한은 둔다.
 */
export function evaluateEntitlement(input: EntitlementInput): Entitlement {
  const { license, activation, machineHash, appVersion, now, graceDays } = input

  if (activation.licenseId !== license.id) return { state: 'invalid', reason: 'license_mismatch' }
  if (activation.machineHash !== machineHash) return { state: 'invalid', reason: 'machine_mismatch' }

  const nowMs = new Date(now).getTime()

  // 구독 만료는 유예 없이 즉시 끝난다 — 기간제 상품의 기간이 끝난 것이라
  // 오프라인 여부와 무관하다.
  if (license.expiresAt && nowMs > new Date(license.expiresAt).getTime()) {
    return { state: 'invalid', reason: 'expired' }
  }

  // 평생 라이선스라도 "이 버전까지"로 한정할 수 있다(예: v2까지 구매).
  if (license.maxVersion && compareVersions(appVersion, license.maxVersion) > 0) {
    return { state: 'invalid', reason: 'version_too_new' }
  }

  const validUntilMs = new Date(activation.validUntil).getTime()
  if (nowMs <= validUntilMs) return { state: 'active', until: activation.validUntil }

  const graceUntilMs = validUntilMs + graceDays * 24 * 60 * 60 * 1000
  if (nowMs <= graceUntilMs) {
    return { state: 'grace', until: new Date(graceUntilMs).toISOString() }
  }

  return { state: 'invalid', reason: 'expired' }
}
