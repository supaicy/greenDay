/**
 * 구글 캘린더 연동 설정.
 *
 * iCloud(calendar-config.ts)와 파일을 나눠 둔다. 같은 할일이라도 서비스마다 리소스
 * id가 달라 동기화 상태를 공유할 수 없고, 한쪽 연결을 끊는 것이 다른 쪽에 영향을
 * 주어서도 안 된다.
 *
 * 토큰은 safeStorage로 암호화한다. 리프레시 토큰은 사실상 계정 접근 권한이라
 * 평문으로는 절대 쓰지 않는다.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { KeyCrypto } from './database'
import type { SyncState } from './caldav/sync'
import type { TokenSet } from './google/oauth'
import { openSecret, sealSecret, type SecretPurpose } from './secret-envelope'

/** 이 파일이 봉인하고 여는 유일한 용도 — 곧 격리 경계다(`secret-envelope.ts`). */
const GOOGLE_PURPOSE: SecretPurpose = 'google.tokens'

/**
 * 구글 토큰의 "주인".
 *
 * CalDAV는 오리진·계정으로 주인을 가르지만(같은 앱 안에서 서버를 옮길 수 있다),
 * 구글 연결은 이 파일에 하나뿐이라 가를 것이 없다. 봉투 형식을 맞추기 위한 고정값이고,
 * 실제 격리는 `purpose`가 한다.
 */
const GOOGLE_ACCOUNT = 'google'

export interface GoogleConfig {
  tokens: TokenSet | null
  calendarId: string | null
  calendarName: string | null
  /** 연결된 계정 이메일. 어느 계정에 붙어 있는지 보여주기 위한 것. */
  account: string | null
  enabled: boolean
  lastSyncAt: string | null
  lastError: string | null
  syncState: SyncState
}

export const DEFAULT_GOOGLE_CONFIG: GoogleConfig = {
  tokens: null,
  calendarId: null,
  calendarName: null,
  account: null,
  enabled: false,
  lastSyncAt: null,
  lastError: null,
  syncState: {}
}

interface StoredGoogleConfig extends Omit<GoogleConfig, 'tokens'> {
  tokens_enc?: string | null
}

export function encodeGoogleConfig(config: GoogleConfig, crypto: KeyCrypto): StoredGoogleConfig {
  const { tokens, ...rest } = config
  const stored: StoredGoogleConfig = { ...rest, tokens_enc: null }
  if (tokens) {
    // 용도를 **암호문 안에** 봉인한다. 이 값을 `calendar-config.json`의
    // `password_enc`로 옮기면 저쪽에서 용도가 달라 거절된다 — 그 이동이
    // 실제로 Google 토큰을 CalDAV Basic 헤더로 내보내던 경로였다(M3).
    // 실패하면 저장하지 않는다: 다시 로그인시키는 편이 평문 보관보다 낫다.
    stored.tokens_enc = sealSecret(JSON.stringify(tokens), GOOGLE_PURPOSE, GOOGLE_ACCOUNT, crypto)
  }
  return stored
}

export function decodeGoogleConfig(raw: Record<string, unknown>, crypto: KeyCrypto): GoogleConfig {
  const stored = raw as Partial<StoredGoogleConfig>
  let tokens: TokenSet | null = null
  if (typeof stored.tokens_enc === 'string' && stored.tokens_enc) {
    tokens = readTokens(stored.tokens_enc, crypto)
  }
  return {
    tokens,
    calendarId: typeof stored.calendarId === 'string' ? stored.calendarId : null,
    calendarName: typeof stored.calendarName === 'string' ? stored.calendarName : null,
    account: typeof stored.account === 'string' ? stored.account : null,
    enabled: Boolean(stored.enabled),
    lastSyncAt: typeof stored.lastSyncAt === 'string' ? stored.lastSyncAt : null,
    lastError: typeof stored.lastError === 'string' ? stored.lastError : null,
    syncState: isSyncState(stored.syncState) ? stored.syncState : {}
  }
}

/** 문자열에서 TokenSet 모양을 읽는다. 모양이 아니면 null. */
function parseTokens(plain: string): TokenSet | null {
  let parsed: Partial<TokenSet>
  try {
    parsed = JSON.parse(plain) as Partial<TokenSet>
  } catch {
    return null
  }
  if (typeof parsed?.accessToken !== 'string' || typeof parsed.expiresAt !== 'string') return null
  return {
    accessToken: parsed.accessToken,
    refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : null,
    expiresAt: parsed.expiresAt,
    scope: typeof parsed.scope === 'string' ? parsed.scope : ''
  }
}

/**
 * 저장된 토큰을 읽는다 — 봉투가 우선, 없으면 옛 형식.
 *
 * **CalDAV 쪽과 달리 여기는 옛 형식을 계속 받는다.** 비대칭이 의도적이다:
 * 옛 Google 토큰은 `accessToken`·`expiresAt`을 가진 특정 모양이라, 다른 저장소의
 * 어떤 암호문을 옮겨 와도 그 모양이 되지 않는다(CalDAV 비밀번호는 이제 봉투 JSON,
 * AI 키는 맨 문자열이다). 즉 여기서 옛 형식을 받는 것은 통로를 열지 않는다.
 * 반대로 CalDAV 쪽의 옛 형식은 "아무 맨 문자열"이라 통로 그 자체였다.
 *
 * 그래도 모양 검사에만 기대지는 않는다 — 새로 저장되는 값에는 용도를 봉인하고,
 * 봉투가 있으면 그쪽을 **먼저** 엄격히 검증한다. 다음 저장에서 옛 형식은 사라진다.
 */
function readTokens(ciphertext: string, crypto: KeyCrypto): TokenSet | null {
  const sealed = openSecret(ciphertext, GOOGLE_PURPOSE, GOOGLE_ACCOUNT, crypto)
  if (sealed !== null) return parseTokens(sealed)

  // 봉투가 아니다. 옛 형식일 수 있으니 모양으로 한 번 더 본다.
  if (!crypto.available()) return null
  try {
    return parseTokens(crypto.decrypt(ciphertext))
  } catch {
    // 다른 기기의 키로 암호화됐거나 형식이 깨졌다. 다시 연결받아야 한다.
    return null
  }
}

function isSyncState(value: unknown): value is SyncState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value as Record<string, unknown>).every((entry) => {
    if (!entry || typeof entry !== 'object') return false
    const e = entry as Record<string, unknown>
    return typeof e.href === 'string' && typeof e.fingerprint === 'string'
  })
}

export function readGoogleConfig(filePath: string, crypto: KeyCrypto): GoogleConfig {
  if (!filePath || !existsSync(filePath)) return { ...DEFAULT_GOOGLE_CONFIG }
  try {
    return decodeGoogleConfig(JSON.parse(readFileSync(filePath, 'utf-8')), crypto)
  } catch {
    return { ...DEFAULT_GOOGLE_CONFIG }
  }
}

export function writeGoogleConfig(filePath: string, config: GoogleConfig, crypto: KeyCrypto): void {
  if (!filePath) return
  writeFileSync(filePath, JSON.stringify(encodeGoogleConfig(config, crypto), null, 2), 'utf-8')
}

/** 렌더러로 보낼 형태. 토큰은 존재 여부만 알린다. */
export function toPublicGoogleConfig(config: GoogleConfig): Record<string, unknown> {
  const { tokens, syncState, ...rest } = config
  return { ...rest, connected: Boolean(tokens), syncedCount: Object.keys(syncState).length }
}
