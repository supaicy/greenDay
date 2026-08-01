/**
 * 캘린더 연동 설정 저장.
 *
 * 앱 암호는 safeStorage로 암호화해 둔다 — 평문으로는 절대 파일에 쓰지 않는다.
 * AI 설정(ai-config.json)과 같은 방식이고, 암호화가 불가능한 환경에서는 비밀번호를
 * 저장하지 않고 세션 동안만 메모리에 둔다.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { KeyCrypto } from './database'
import type { SyncState } from './caldav/sync'

export interface CalendarConfig {
  provider: 'icloud' | 'caldav'
  serverUrl: string
  username: string
  /** 복호화된 비밀번호. 파일에는 이 필드로 저장하지 않는다. */
  password: string | null
  /** 동기화 대상 캘린더. 아직 고르지 않았으면 null. */
  calendarUrl: string | null
  calendarName: string | null
  enabled: boolean
  lastSyncAt: string | null
  /** 마지막 오류 메시지. 사용자에게 상태를 보여주기 위한 것. */
  lastError: string | null
  syncState: SyncState
}

export const DEFAULT_CONFIG: CalendarConfig = {
  provider: 'icloud',
  serverUrl: 'https://caldav.icloud.com',
  username: '',
  password: null,
  calendarUrl: null,
  calendarName: null,
  enabled: false,
  lastSyncAt: null,
  lastError: null,
  syncState: {}
}

/** 파일에 저장되는 형태. password는 없고 password_enc만 있다. */
interface StoredConfig extends Omit<CalendarConfig, 'password'> {
  password_enc?: string | null
}

export function encodeConfig(config: CalendarConfig, crypto: KeyCrypto): StoredConfig {
  const { password, ...rest } = config
  const stored: StoredConfig = { ...rest, password_enc: null }
  if (password && crypto.available()) {
    try {
      stored.password_enc = crypto.encrypt(password)
    } catch {
      // 암호화에 실패하면 저장하지 않는다. 평문으로 흘리느니 다시 입력받는 편이 낫다.
      stored.password_enc = null
    }
  }
  return stored
}

export function decodeConfig(raw: Record<string, unknown>, crypto: KeyCrypto): CalendarConfig {
  const stored = raw as Partial<StoredConfig>
  let password: string | null = null
  if (typeof stored.password_enc === 'string' && stored.password_enc && crypto.available()) {
    try {
      password = crypto.decrypt(stored.password_enc)
    } catch {
      // 다른 기기·다른 키체인에서 복사된 파일. 사용자에게 다시 입력받아야 한다.
      password = null
    }
  }
  return {
    provider: stored.provider === 'caldav' ? 'caldav' : 'icloud',
    serverUrl: typeof stored.serverUrl === 'string' ? stored.serverUrl : DEFAULT_CONFIG.serverUrl,
    username: typeof stored.username === 'string' ? stored.username : '',
    password,
    calendarUrl: typeof stored.calendarUrl === 'string' ? stored.calendarUrl : null,
    calendarName: typeof stored.calendarName === 'string' ? stored.calendarName : null,
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

export function readConfigFile(filePath: string, crypto: KeyCrypto): CalendarConfig {
  if (!filePath || !existsSync(filePath)) return { ...DEFAULT_CONFIG }
  try {
    return decodeConfig(JSON.parse(readFileSync(filePath, 'utf-8')), crypto)
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function writeConfigFile(filePath: string, config: CalendarConfig, crypto: KeyCrypto): void {
  if (!filePath) return
  writeFileSync(filePath, JSON.stringify(encodeConfig(config, crypto), null, 2), 'utf-8')
}

/** 렌더러로 보낼 형태. 비밀번호는 절대 넘기지 않고 설정 여부만 알린다. */
export function toPublicConfig(config: CalendarConfig): Record<string, unknown> {
  const { password, syncState, ...rest } = config
  return { ...rest, hasPassword: Boolean(password), syncedCount: Object.keys(syncState).length }
}
