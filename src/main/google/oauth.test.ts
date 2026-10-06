import { describe, it, expect, afterEach, vi } from 'vitest'
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

  /**
   * 2026-09-09 제품 결정 — 앱이 만든 캘린더만 쓴다. `calendar.app.created` 하나면
   * 사용자의 기존 캘린더에는 목록조차 닿지 않고, 구글의 민감 범위 심사도 없다.
   * (한때 `calendarlist.readonly` + `calendar.events`를 받아 기존 캘린더를 고르게 했다 —
   * 그 조합은 `calendar.events`가 민감 범위라 심사 전에는 테스트 사용자만 로그인됐다.)
   */
  it('앱이 만든 캘린더 범위 하나만 요청한다', () => {
    const scope = url.searchParams.get('scope') ?? ''
    expect(scope).toBe(SCOPES.join(' '))
    expect(scope.split(' ')).toEqual(['https://www.googleapis.com/auth/calendar.app.created'])
  })

  it('사용자의 기존 캘린더에 닿는 범위는 요청하지 않는다', () => {
    const scopes = (url.searchParams.get('scope') ?? '').split(' ')
    for (const wide of ['calendar', 'calendar.readonly', 'calendar.events', 'calendar.calendarlist.readonly']) {
      expect(scopes).not.toContain(`https://www.googleapis.com/auth/${wide}`)
    }
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

  /**
   * 그랜트를 영구히 거절하는 이름은 `invalid_grant`만이 아니다. 릴리스 사이에 빌드의
   * 클라이언트 ID가 바뀌었거나 OAuth 클라이언트가 지워졌으면 구글은 `invalid_client`·
   * `unauthorized_client`로 답한다. 이것을 `token_failed`(일시 장애와 같은 칸)로 접으면
   * 호출처가 죽은 토큰을 영원히 들고 "연결됨"이라고 말한다.
   */
  it.each([
    ['invalid_client', 401],
    ['unauthorized_client', 400]
  ])('영구 거절(%s)은 이름을 그대로 code로 남긴다', async (name, status) => {
    const { fetchImpl } = jsonFetch({ error: name, error_description: 'The OAuth client was deleted.' }, status)
    await expect(
      refreshTokens({ clientId: CLIENT_ID, refreshToken: 'rt', now: NOW }, fetchImpl)
    ).rejects.toMatchObject({ name: 'OAuthError', code: name })
  })

  it('모르는 이름과 5xx는 여전히 token_failed다 — 거절 목록을 이름 없이 넓히지 않는다', async () => {
    for (const [payload, status] of [
      [{ error: 'server_error' }, 503],
      [{ error: 'temporarily_unavailable' }, 400],
      [{}, 500]
    ] as const) {
      const { fetchImpl } = jsonFetch(payload, status)
      await expect(
        refreshTokens({ clientId: CLIENT_ID, refreshToken: 'rt', now: NOW }, fetchImpl)
      ).rejects.toMatchObject({ name: 'OAuthError', code: 'token_failed' })
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

describe('토큰 요청 상한', () => {
  /** 연결만 받고 응답하지 않는 서버. 상한이 없으면 이 promise는 끝나지 않는다. */
  const stallingFetch =
    (seen: (AbortSignal | null | undefined)[]): FetchLike =>
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        seen.push(init.signal)
        const signal = init.signal
        if (!signal) return
        if (signal.aborted) return reject(signal.reason)
        signal.addEventListener('abort', () => reject(signal.reason))
      })

  /** 30초를 실제로 기다릴 수는 없다. 요청한 값만 받아 두고 타이머는 20ms로 줄인다. */
  const shrink = (): number[] => {
    const real = AbortSignal.timeout.bind(AbortSignal)
    const asked: number[] = []
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      asked.push(ms)
      return real(20)
    })
    return asked
  }

  const settleWithin = (work: Promise<unknown>): Promise<unknown> => {
    work.catch(() => {})
    return Promise.race([
      work.then(
        (value) => ({ resolved: value }),
        (error: unknown) => error
      ),
      new Promise((resolve) => setTimeout(() => resolve('hung'), 500))
    ])
  }

  afterEach(() => vi.restoreAllMocks())

  it('refreshTokens: 응답하지 않는 서버에서도 끝난다', async () => {
    const asked = shrink()
    const seen: (AbortSignal | null | undefined)[] = []

    const settled = await settleWithin(
      refreshTokens({ clientId: CLIENT_ID, refreshToken: 'rt', now: NOW }, stallingFetch(seen))
    )

    // 여기가 끝나지 않으면 `google:sync-now`가 갱신 단계에서 통째로 멈춘다.
    expect(settled, '상한이 없어 토큰 갱신이 끝나지 않았다').not.toBe('hung')
    // 타입만 보면 `token_failed`(거부 쪽으로 읽힐 수 있는 값)로 바뀌어도 통과한다.
    // 응답하지 않은 것은 **불통**이다 — 호출처가 토큰을 남기는 근거가 이 code다.
    expect(settled).toMatchObject({ name: 'OAuthError', code: 'network' })
    expect(seen[0]).toBeInstanceOf(AbortSignal)
    expect(asked).toEqual([30_000])
  })

  it('revokeToken: 응답하지 않는 서버에서도 끝나고 false를 준다', async () => {
    shrink()
    const seen: (AbortSignal | null | undefined)[] = []

    // `google:disconnect`는 이 await **뒤에** 로컬 토큰을 지운다. 여기가 안 끝나면
    // 사용자가 해제를 눌러도 리프레시 토큰이 디스크에 그대로 남는다.
    const settled = await settleWithin(revokeToken('rt', stallingFetch(seen)))

    expect(settled, '상한이 없어 토큰 회수가 끝나지 않았다').not.toBe('hung')
    expect(settled).toEqual({ resolved: false })
    expect(seen[0]).toBeInstanceOf(AbortSignal)
  })
})
