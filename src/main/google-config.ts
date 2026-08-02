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
  if (tokens && crypto.available()) {
    try {
      stored.tokens_enc = crypto.encrypt(JSON.stringify(tokens))
    } catch {
      // 암호화 실패 시 저장하지 않는다. 다시 로그인시키는 편이 평문 보관보다 낫다.
      stored.tokens_enc = null
    }
  }
  return stored
}

export function decodeGoogleConfig(raw: Record<string, unknown>, crypto: KeyCrypto): GoogleConfig {
  const stored = raw as Partial<StoredGoogleConfig>
  let tokens: TokenSet | null = null
  if (typeof stored.tokens_enc === 'string' && stored.tokens_enc && crypto.available()) {
    try {
      const parsed = JSON.parse(crypto.decrypt(stored.tokens_enc)) as Partial<TokenSet>
      if (typeof parsed.accessToken === 'string' && typeof parsed.expiresAt === 'string') {
        tokens = {
          accessToken: parsed.accessToken,
          refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : null,
          expiresAt: parsed.expiresAt,
          scope: typeof parsed.scope === 'string' ? parsed.scope : ''
        }
      }
    } catch {
      // 다른 기기의 키로 암호화됐거나 형식이 깨졌다. 다시 연결받아야 한다.
      tokens = null
    }
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
