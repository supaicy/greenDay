/**
 * Google OAuth 2.0 (설치형 앱, PKCE).
 *
 * 왜 PKCE + 커스텀 URL 스킴인가:
 * - 데스크톱 앱은 클라이언트 시크릿을 숨길 수 없다. 공개 클라이언트로 두고 PKCE로
 *   인가 코드 가로채기를 막는 것이 구글이 권장하는(그리고 유일하게 허용하는) 방식이다.
 * - 리다이렉트를 루프백(http://127.0.0.1:포트)으로 받으면 로컬 서버를 열어야 하고,
 *   그러면 Mac App Store 샌드박스에서 `network.server` 권한이 필요해진다. 커스텀 URL
 *   스킴은 그 권한 없이 동작한다.
 *
 * 이 파일에는 순수 함수와 fetch를 주입받는 함수만 둔다.
 */

import { createHash, randomBytes } from 'node:crypto'

export const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
export const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'

/**
 * 요청하는 권한.
 *
 * 예전에는 `calendar.app.created` 하나였고, **그것으로는 이 앱이 하는 일을 할 수 없었다.**
 * 그 범위는 "앱이 만든 캘린더"에만 닿는데, 앱은 캘린더를 만들지 않고 사용자의 기존
 * 캘린더를 고르게 한다. 그래서 `GET /users/me/calendarList`가 403으로 떨어졌다 —
 * 클라이언트 ID를 넣어도 캘린더 목록에서 더 갈 수 없었다.
 *
 * 그래서 둘을 받는다. **둘 다 필요하고, 각자 최소다:**
 *
 *   - `calendar.calendarlist.readonly` — 캘린더 **목록**만 읽는다. 일정 내용에는
 *     닿지 않는다. 사용자가 어디로 내보낼지 고르려면 이 목록이 있어야 한다.
 *     (`calendar.readonly`는 모든 일정 내용까지 읽어서 여기엔 과하다.)
 *   - `calendar.events` — 고른 캘린더에 일정을 쓴다. 구글에는 "이 캘린더 하나에만
 *     쓴다"는 범위가 없으므로, 사용자가 기존 캘린더를 고르는 이상 이것이 최소다.
 *
 * **대안을 고르지 않은 이유.** `calendar.app.created`를 유지하려면 앱 전용 보조
 * 캘린더를 만들어 거기에만 써야 하는데, 그러면 캘린더 선택 UI가 사라지고 "내가 쓰던
 * 캘린더에 올라온다"는 지금의 약속이 깨진다. 제품 결정이라 코드로 몰래 바꾸지 않았다.
 *
 * **`calendar.events`는 구글의 민감 범위다.** production 클라이언트에는 심사가
 * 필요하고, 심사 전에는 등록된 테스트 사용자만 로그인할 수 있다.
 *
 * **문구를 함께 고쳐야 한다.** `googleSync.scopeNote`가 "Greenday가 만든 일정만
 * 접근합니다. 기존 캘린더 일정은 읽지 않습니다"라고 말하는데 이 조합에서는 참이
 * 아니다. 로케일 파일은 이 워크트리 소유가 아니라 여기서 고치지 않았고, 보고했다.
 */
export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events'
]

export interface PkcePair {
  verifier: string
  challenge: string
}

/** RFC 7636 §4.1 — 43~128자의 URL-safe 난수 */
export function createPkcePair(): PkcePair {
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function createState(): string {
  return randomBytes(16).toString('base64url')
}

export interface AuthUrlOptions {
  clientId: string
  redirectUri: string
  challenge: string
  state: string
}

export function buildAuthUrl(options: AuthUrlOptions): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    code_challenge: options.challenge,
    code_challenge_method: 'S256',
    state: options.state,
    // 리프레시 토큰은 최초 동의 때만 내려온다. 재동의를 강제해야 토큰을 잃었을 때
    // 사용자가 연결을 복구할 수 있다.
    access_type: 'offline',
    prompt: 'consent'
  })
  return `${AUTH_ENDPOINT}?${params.toString()}`
}

export interface CallbackResult {
  code: string
  state: string
}

export class OAuthError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'OAuthError'
    this.code = code
  }
}

/**
 * 브라우저가 되돌려준 리다이렉트 URL에서 인가 코드를 꺼낸다.
 * state가 우리가 보낸 값과 다르면 거부한다 — 다른 곳에서 유도된 콜백일 수 있다.
 */
export function parseCallbackUrl(url: string, expectedState: string): CallbackResult {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new OAuthError('invalid_callback', '인증 응답을 이해할 수 없습니다.')
  }

  // 커스텀 스킴에서는 쿼리가 search에 올 수도, fragment에 올 수도 있다.
  const params = new URLSearchParams(parsed.search || parsed.hash.replace(/^#/, ''))

  const error = params.get('error')
  if (error) {
    throw new OAuthError(
      error === 'access_denied' ? 'access_denied' : 'auth_failed',
      error === 'access_denied' ? '사용자가 권한 요청을 취소했습니다.' : `인증에 실패했습니다 (${error}).`
    )
  }

  const state = params.get('state') ?? ''
  if (!expectedState || state !== expectedState) {
    throw new OAuthError('state_mismatch', '인증 응답이 이 요청과 일치하지 않습니다. 다시 시도하세요.')
  }

  const code = params.get('code')
  if (!code) throw new OAuthError('no_code', '인증 코드를 받지 못했습니다.')

  return { code, state }
}

export interface TokenSet {
  accessToken: string
  refreshToken: string | null
  /** 만료 시각(UTC ISO). 갱신 판단에 쓴다. */
  expiresAt: string
  scope: string
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

async function postToken(
  fetchImpl: FetchLike,
  body: URLSearchParams,
  now: string
): Promise<TokenResponse & { expiresAt: string }> {
  let response: Response
  try {
    response = await fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    })
  } catch (cause) {
    const error = new OAuthError('network', '구글 서버에 연결하지 못했습니다.')
    error.cause = cause
    throw error
  }

  let payload: TokenResponse
  try {
    payload = (await response.json()) as TokenResponse
  } catch {
    throw new OAuthError('bad_response', '구글 응답을 이해할 수 없습니다.')
  }

  if (!response.ok || payload.error) {
    // invalid_grant는 대개 "리프레시 토큰이 취소됨" — 사용자에게 재연결을 안내해야 한다.
    const code = payload.error === 'invalid_grant' ? 'invalid_grant' : 'token_failed'
    throw new OAuthError(
      code,
      code === 'invalid_grant'
        ? '구글 연결이 만료되었습니다. 다시 연결해 주세요.'
        : `토큰 발급에 실패했습니다 (${payload.error ?? response.status}).`
    )
  }

  const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 3600
  return { ...payload, expiresAt: new Date(new Date(now).getTime() + expiresIn * 1000).toISOString() }
}

export async function exchangeCode(
  input: { clientId: string; redirectUri: string; code: string; verifier: string; now: string },
  fetchImpl: FetchLike
): Promise<TokenSet> {
  const payload = await postToken(
    fetchImpl,
    new URLSearchParams({
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      code: input.code,
      code_verifier: input.verifier,
      grant_type: 'authorization_code'
    }),
    input.now
  )

  if (!payload.access_token) throw new OAuthError('no_token', '액세스 토큰을 받지 못했습니다.')
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresAt: payload.expiresAt,
    scope: payload.scope ?? SCOPES.join(' ')
  }
}

export async function refreshTokens(
  input: { clientId: string; refreshToken: string; now: string },
  fetchImpl: FetchLike
): Promise<TokenSet> {
  const payload = await postToken(
    fetchImpl,
    new URLSearchParams({
      client_id: input.clientId,
      refresh_token: input.refreshToken,
      grant_type: 'refresh_token'
    }),
    input.now
  )

  if (!payload.access_token) throw new OAuthError('no_token', '액세스 토큰을 받지 못했습니다.')
  return {
    accessToken: payload.access_token,
    // 갱신 응답에는 보통 리프레시 토큰이 없다. 기존 것을 계속 쓴다.
    refreshToken: payload.refresh_token ?? input.refreshToken,
    expiresAt: payload.expiresAt,
    scope: payload.scope ?? SCOPES.join(' ')
  }
}

/** 만료까지 이 시간보다 적게 남았으면 미리 갱신한다. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000

export function needsRefresh(tokens: TokenSet, now: string): boolean {
  return new Date(tokens.expiresAt).getTime() - new Date(now).getTime() < REFRESH_MARGIN_MS
}

/** 연결 해제 시 서버 쪽 권한까지 회수한다. 실패해도 로컬 토큰은 지운다. */
export async function revokeToken(token: string, fetchImpl: FetchLike): Promise<boolean> {
  try {
    const response = await fetchImpl(REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString()
    })
    return response.ok
  } catch {
    return false
  }
}
