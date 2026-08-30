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
import { caldavAccount, openSecret, peekAccount, sealSecret, type SecretPurpose } from './secret-envelope'

/**
 * 이 파일이 봉인하고 여는 유일한 용도.
 *
 * 상수로 두는 이유는 오타 방지가 아니라, **이 값이 곧 격리 경계**이기 때문이다.
 * 다른 저장소(Google 토큰·AI 키)의 암호문을 `password_enc`로 옮겨도 여기서 걸린다.
 */
const CALDAV_PURPOSE: SecretPurpose = 'caldav.password'

/**
 * 저장된 비밀번호가 **어디에 대해** 저장된 것인가.
 *
 * 이게 없으면 `serverUrl`이나 `username`만 바꿔도 예전 비밀번호가 그대로 재사용되고,
 * 그 값은 새 오리진으로 `Authorization: Basic`에 실려 나간다 — 설정 파일 한 줄만
 * 고치면 iCloud 앱 암호를 임의 서버로 보낼 수 있었다.
 *
 * **비밀번호 값을 함께 들고 다닌다.** 그래야 "사용자가 방금 새로 입력한 비밀번호"와
 * "파일에서 읽어 온 예전 비밀번호"를 구별할 수 있다. 앞엣것은 지금 설정에 새로
 * 결속해야 하고, 뒤엣것은 예전 결속을 그대로 검사해야 한다. 구별하지 않으면 둘 중
 * 하나가 반드시 깨진다 — 저장할 때마다 새로 결속하면 검사가 무의미해지고(공격자가
 * 바꾼 오리진에 곧바로 재결속된다), 항상 예전 결속을 쓰면 서버를 옮긴 사용자가
 * 새 비밀번호를 넣어도 계속 지워진다.
 *
 * 렌더러로 나가지 않고(`toPublicConfig`), 파일에 평문으로도 쓰이지 않는다
 * (`encodeConfig`) — 둘 다 명시적으로 걷어낸다.
 */
export interface PasswordBinding {
  /** `new URL(serverUrl).origin`. 호스트 대소문자와 기본 포트가 정규화된다. */
  origin: string
  username: string
  /** 이 결속이 가리키는 비밀번호. 신원 확인용이라 비교에만 쓴다. */
  password: string
}

export interface CalendarConfig {
  provider: 'icloud' | 'caldav'
  serverUrl: string
  username: string
  /** 복호화된 비밀번호. 파일에는 이 필드로 저장하지 않는다. */
  password: string | null
  /** 위 `password`가 어느 오리진·계정에 대해 저장됐는가. 새로 입력한 값이면 null. */
  passwordBinding: PasswordBinding | null
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
  passwordBinding: null,
  calendarUrl: null,
  calendarName: null,
  enabled: false,
  lastSyncAt: null,
  lastError: null,
  syncState: {}
}

/** 파일에 저장되는 형태. password는 없고 password_enc만 있다. */
interface StoredConfig extends Omit<CalendarConfig, 'password' | 'passwordBinding'> {
  password_enc?: string | null
}

/**
 * 비교에 쓰는 오리진. 파싱할 수 없는 주소는 **자기 자신과도 같지 않게** 만든다 —
 * 빈 문자열로 접으면 망가진 주소 둘이 서로 일치한다고 나온다.
 */
function originOf(serverUrl: string): string | null {
  try {
    return new URL(serverUrl).origin
  } catch {
    return null
  }
}

/** 이 주소가 iCloud인가, 직접 넣은 CalDAV 서버인가. 주소 하나로 결정된다. */
export function providerFor(serverUrl: string): CalendarConfig['provider'] {
  const origin = originOf(serverUrl)
  return origin !== null && origin === originOf(DEFAULT_CONFIG.serverUrl) ? 'icloud' : 'caldav'
}

/**
 * 지금 설정에 대해 이 비밀번호를 써도 되는가, 그리고 못 쓴다면 무엇까지 버려야 하는가.
 *
 * 오리진이나 계정이 바뀌었으면 비밀번호만 버려서는 부족하다. 고른 캘린더 URL과
 * 동기화 상태는 **이전 서버의 리소스를 가리키는 값**이라, 남겨 두면 새 서버에
 * 존재하지 않는 href를 갱신하려 들거나(매번 실패) 더 나쁘게는 새 서버의 같은
 * 경로에 남의 일정을 덮어쓴다.
 */
export function enforceCredentialBinding(config: CalendarConfig): CalendarConfig {
  if (!config.password) return { ...config, passwordBinding: null }

  const binding = config.passwordBinding
  // 결속이 없거나 다른 비밀번호의 것이면, 사용자가 방금 입력한 값이다.
  // 지금 설정에 새로 결속한다.
  if (!binding || binding.password !== config.password) {
    const origin = originOf(config.serverUrl)
    if (origin === null) return { ...config, password: null, passwordBinding: null }
    return { ...config, passwordBinding: { origin, username: config.username, password: config.password } }
  }

  const origin = originOf(config.serverUrl)
  if (origin !== null && origin === binding.origin && config.username === binding.username) {
    return config
  }
  return {
    ...config,
    password: null,
    passwordBinding: null,
    calendarUrl: null,
    calendarName: null,
    // 캘린더를 못 고른 상태이므로 켜져 있다고 말하지 않는다.
    enabled: false,
    syncState: {}
  }
}

export function encodeConfig(config: CalendarConfig, crypto: KeyCrypto): StoredConfig {
  // 저장 직전에 한 번 더 강제한다. 이렇게 해야 **파일에는 결속이 어긋난 비밀번호가
  // 아예 존재하지 않는다** — 읽기 쪽 검사 하나에만 기대면, 그 검사를 지나치는
  // 경로가 하나만 생겨도 조용히 뚫린다.
  const safe = enforceCredentialBinding(config)
  const { password, passwordBinding, ...rest } = safe
  const stored: StoredConfig = { ...rest, password_enc: null }
  if (password && passwordBinding) {
    // 용도(`caldav.password`)와 주인(`오리진|계정`)을 **암호문 안에** 봉인한다.
    // 암호화가 불가능하거나 실패하면 `sealSecret`이 null을 준다 — 평문으로
    // 흘리느니 다시 입력받는 편이 낫다.
    stored.password_enc = sealSecret(
      password,
      CALDAV_PURPOSE,
      caldavAccount(passwordBinding.origin, passwordBinding.username),
      crypto
    )
  }
  return stored
}

/**
 * 암호문을 푼다. **봉투가 아니거나 용도·주인이 어긋나면 아무것도 내주지 않는다.**
 *
 * 옛 형식(봉투 없는 맨 암호문)은 더 이상 받지 않는다 — 그 관대함이 M3의 통로였다.
 * `userData`에 쓸 수 있는 주체가 다른 저장소의 암호문을 여기로 옮기면, 복호화된
 * 값이 그대로 CalDAV의 `Authorization: Basic`에 실려 나갔다. 맨 문자열 비밀
 * (AI API 키 등)은 내용만으로는 진짜 앱 암호와 구별할 방법이 아예 없다.
 *
 * 대가는 봉투 이전에 저장된 앱 암호를 한 번 다시 입력받는 것이고, 자격증명이
 * 공격자 서버로 나가는 것보다 싸다. 화면에는 "저장됨" 대신 입력 안내가 뜬다.
 */
function decryptSecret(
  ciphertext: string,
  crypto: KeyCrypto
): { password: string; binding: Omit<PasswordBinding, 'password'> } | null {
  // 닭과 달걀: `openSecret`은 주인을 알아야 열어 주는데, M1의 결속 판단에 필요한
  // 것이 바로 그 주인이다. 그래서 용도만 확인하고 주인을 먼저 꺼낸 뒤,
  // 그 값으로 정식으로 연다 — 검증을 건너뛰는 것이 아니라 순서를 맞추는 것이다.
  const account = peekAccount(ciphertext, CALDAV_PURPOSE, crypto)
  if (account === null) return null
  const password = openSecret(ciphertext, CALDAV_PURPOSE, account, crypto)
  if (password === null) return null

  // `오리진|계정`. 계정에 `|`가 들어갈 수 있으므로 **앞에서 한 번만** 자른다.
  const separator = account.indexOf('|')
  if (separator < 0) return null
  return {
    password,
    binding: { origin: account.slice(0, separator), username: account.slice(separator + 1) }
  }
}

export function decodeConfig(raw: Record<string, unknown>, crypto: KeyCrypto): CalendarConfig {
  const stored = raw as Partial<StoredConfig>
  const secret =
    typeof stored.password_enc === 'string' && stored.password_enc
      ? decryptSecret(stored.password_enc, crypto)
      : null

  const serverUrl = typeof stored.serverUrl === 'string' ? stored.serverUrl : DEFAULT_CONFIG.serverUrl
  const username = typeof stored.username === 'string' ? stored.username : ''
  const decoded: CalendarConfig = {
    // **저장된 값이 아니라 주소에서 도출한다.** `provider`를 쓰는 코드가 없었고
    // 쓰는 코드도 없어서, 이 필드는 늘 'icloud'로 남아 있었다. 무엇을 쓰고 있는지는
    // 결국 서버 주소가 정하므로, 두 값이 어긋날 수 없게 한쪽에서 파생시킨다.
    provider: providerFor(serverUrl),
    serverUrl,
    username,
    password: secret?.password ?? null,
    // 결속은 언제나 봉투에서 온다. 파일이 말하는 serverUrl·username으로 대신
    // 채우지 않는다 — 그러면 파일을 고쳐 결속을 만들어 낼 수 있어 검사가 무의미해진다.
    passwordBinding: secret ? { ...secret.binding, password: secret.password } : null,
    calendarUrl: typeof stored.calendarUrl === 'string' ? stored.calendarUrl : null,
    calendarName: typeof stored.calendarName === 'string' ? stored.calendarName : null,
    enabled: Boolean(stored.enabled),
    lastSyncAt: typeof stored.lastSyncAt === 'string' ? stored.lastSyncAt : null,
    lastError: typeof stored.lastError === 'string' ? stored.lastError : null,
    syncState: isSyncState(stored.syncState) ? stored.syncState : {}
  }

  // 파일을 손으로 고쳐 `serverUrl`만 바꾼 경우가 여기서 걸린다 — 결속은 암호문
  // 안에 있어 같이 고칠 수 없다.
  return enforceCredentialBinding(decoded)
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

/**
 * 렌더러로 보낼 형태. 비밀번호는 절대 넘기지 않고 설정 여부만 알린다.
 *
 * **`passwordBinding`도 반드시 걷어낸다** — 그 안에 비밀번호 원문이 들어 있다.
 * 나머지를 스프레드로 넘기는 구조라, 필드를 하나 늘릴 때 여기서 빼지 않으면
 * 그대로 렌더러로 새어 나간다.
 */
export function toPublicConfig(config: CalendarConfig): Record<string, unknown> {
  const { password, passwordBinding, syncState, ...rest } = config
  return { ...rest, hasPassword: Boolean(password), syncedCount: Object.keys(syncState).length }
}
