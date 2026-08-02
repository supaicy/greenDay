import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import {
  createPkcePair,
  createState,
  buildAuthUrl,
  parseCallbackUrl,
  exchangeCode,
  refreshTokens,
  needsRefresh,
  revokeToken,
  OAuthError,
  SCOPES,
  type FetchLike,
  type TokenSet
} from './oauth'

const CLIENT_ID = '123-abc.apps.googleusercontent.com'
const REDIRECT = 'com.supaicy.haru:/oauth2redirect'
const NOW = '2026-08-02T00:00:00.000Z'

function jsonFetch(payload: unknown, status = 200): { fetchImpl: FetchLike; bodies: string[] } {
  const bodies: string[] = []
  const fetchImpl: FetchLike = async (_url, init) => {
    bodies.push(String(init.body ?? ''))
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' }
    })
  }
  return { fetchImpl, bodies }
}

describe('createPkcePair', () => {
  it('challenge는 verifier의 S256 해시다', () => {
    const { verifier, challenge } = createPkcePair()
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
  })

  it('verifier는 RFC 7636의 길이 범위(43~128) 안이고 URL-safe다', () => {
    const { verifier } = createPkcePair()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier.length).toBeLessThanOrEqual(128)
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/)
  })

  it('매번 다른 값을 만든다', () => {
    const seen = new Set(Array.from({ length: 20 }, () => createPkcePair().verifier))
    expect(seen.size).toBe(20)
  })
})

describe('buildAuthUrl', () => {
  const url = new URL(
    buildAuthUrl({ clientId: CLIENT_ID, redirectUri: REDIRECT, challenge: 'CH', state: 'ST' })
  )

  it('PKCE 파라미터를 S256으로 싣는다', () => {
    expect(url.searchParams.get('code_challenge')).toBe('CH')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })

  it('클라이언트 시크릿을 담지 않는다 (데스크톱 앱은 공개 클라이언트다)', () => {
    expect(url.searchParams.get('client_secret')).toBeNull()
    expect(url.toString()).not.toContain('secret')
  })

  it('앱이 만든 일정으로 범위를 한정한다', () => {
    expect(url.searchParams.get('scope')).toBe(SCOPES.join(' '))
    expect(url.searchParams.get('scope')).toContain('calendar.app.created')
    // 사용자의 기존 일정 전체를 읽는 범위는 요청하지 않는다.
    expect(url.searchParams.get('scope')).not.toContain('auth/calendar ')
  })

  it('리프레시 토큰을 받도록 offline + consent를 요청한다', () => {
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
  })
})

describe('parseCallbackUrl', () => {
  it('정상 콜백에서 코드를 꺼낸다', () => {
    const result = parseCallbackUrl(`${REDIRECT}?code=abc&state=ST`, 'ST')
    expect(result.code).toBe('abc')
  })

  it('fragment로 온 응답도 읽는다', () => {
    expect(parseCallbackUrl(`${REDIRECT}#code=abc&state=ST`, 'ST').code).toBe('abc')
  })

  it('state가 다르면 거부한다 (다른 곳에서 유도된 콜백일 수 있다)', () => {
    expect(() => parseCallbackUrl(`${REDIRECT}?code=abc&state=OTHER`, 'ST')).toThrow(OAuthError)
    try {
      parseCallbackUrl(`${REDIRECT}?code=abc&state=OTHER`, 'ST')
    } catch (error) {
      expect((error as OAuthError).code).toBe('state_mismatch')
    }
  })

  it('기대하는 state가 비어 있으면 무조건 거부한다', () => {
    expect(() => parseCallbackUrl(`${REDIRECT}?code=abc&state=`, '')).toThrow(OAuthError)
  })

  it('사용자가 취소하면 그 사실을 구분해 알린다', () => {
    try {
      parseCallbackUrl(`${REDIRECT}?error=access_denied&state=ST`, 'ST')
      expect.unreachable()
    } catch (error) {
      expect((error as OAuthError).code).toBe('access_denied')
    }
  })

  it('코드가 없으면 실패한다', () => {
    expect(() => parseCallbackUrl(`${REDIRECT}?state=ST`, 'ST')).toThrow(OAuthError)
  })

  it('URL이 아니면 실패한다', () => {
    expect(() => parseCallbackUrl('그냥 문자열', 'ST')).toThrow(OAuthError)
  })
})

describe('exchangeCode', () => {
  it('verifier를 함께 보내고 만료 시각을 계산한다', async () => {
    const { fetchImpl, bodies } = jsonFetch({
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3600,
      scope: SCOPES.join(' ')
    })
    const tokens = await exchangeCode(
      { clientId: CLIENT_ID, redirectUri: REDIRECT, code: 'c', verifier: 'v', now: NOW },
      fetchImpl
    )
    const sent = new URLSearchParams(bodies[0])
    expect(sent.get('code_verifier')).toBe('v')
    expect(sent.get('grant_type')).toBe('authorization_code')
    expect(sent.get('client_secret')).toBeNull()
    expect(tokens.accessToken).toBe('at')
    expect(tokens.refreshToken).toBe('rt')
    expect(tokens.expiresAt).toBe('2026-08-02T01:00:00.000Z')
  })

  it('expires_in이 없으면 1시간으로 본다', async () => {
    const { fetchImpl } = jsonFetch({ access_token: 'at' })
    const tokens = await exchangeCode(
      { clientId: CLIENT_ID, redirectUri: REDIRECT, code: 'c', verifier: 'v', now: NOW },
      fetchImpl
    )
    expect(tokens.expiresAt).toBe('2026-08-02T01:00:00.000Z')
  })

  it('구글이 오류를 주면 그대로 실패한다', async () => {
    const { fetchImpl } = jsonFetch({ error: 'invalid_request' }, 400)
    await expect(
      exchangeCode(
        { clientId: CLIENT_ID, redirectUri: REDIRECT, code: 'c', verifier: 'v', now: NOW },
        fetchImpl
      )
    ).rejects.toBeInstanceOf(OAuthError)
  })
})

describe('refreshTokens', () => {
  it('응답에 리프레시 토큰이 없으면 기존 것을 유지한다', async () => {
    const { fetchImpl } = jsonFetch({ access_token: 'new', expires_in: 3600 })
    const tokens = await refreshTokens(
      { clientId: CLIENT_ID, refreshToken: 'old-rt', now: NOW },
      fetchImpl
    )
    expect(tokens.accessToken).toBe('new')
    expect(tokens.refreshToken).toBe('old-rt')
  })

  it('취소된 토큰(invalid_grant)은 재연결을 안내한다', async () => {
    const { fetchImpl } = jsonFetch({ error: 'invalid_grant' }, 400)
    try {
      await refreshTokens({ clientId: CLIENT_ID, refreshToken: 'rt', now: NOW }, fetchImpl)
      expect.unreachable()
    } catch (error) {
      expect((error as OAuthError).code).toBe('invalid_grant')
      expect((error as OAuthError).message).toContain('다시 연결')
    }
  })
})

describe('needsRefresh', () => {
  const tokens = (expiresAt: string): TokenSet => ({
    accessToken: 'at',
    refreshToken: 'rt',
    expiresAt,
    scope: SCOPES.join(' ')
  })

  it('만료가 5분 넘게 남으면 갱신하지 않는다', () => {
    expect(needsRefresh(tokens('2026-08-02T00:10:00.000Z'), NOW)).toBe(false)
  })

  it('5분 이내로 남으면 미리 갱신한다 (요청 도중 만료되는 것을 피한다)', () => {
    expect(needsRefresh(tokens('2026-08-02T00:04:00.000Z'), NOW)).toBe(true)
  })

  it('이미 만료됐으면 갱신한다', () => {
    expect(needsRefresh(tokens('2026-08-01T23:00:00.000Z'), NOW)).toBe(true)
  })
})

describe('revokeToken', () => {
  it('실패해도 예외를 던지지 않는다 (로컬 토큰은 어차피 지운다)', async () => {
    const fetchImpl: FetchLike = () => Promise.reject(new Error('offline'))
    await expect(revokeToken('t', fetchImpl)).resolves.toBe(false)
  })

  it('성공하면 true', async () => {
    const { fetchImpl } = jsonFetch({})
    await expect(revokeToken('t', fetchImpl)).resolves.toBe(true)
  })
})

describe('createState', () => {
  it('매번 다른 값을 만든다', () => {
    expect(new Set(Array.from({ length: 20 }, createState)).size).toBe(20)
  })
})
