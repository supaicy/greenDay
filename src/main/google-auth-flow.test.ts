import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { request as httpRequest } from 'node:http'

/**
 * 2026-08-06 plan-eng-review에서 만든 테스트. **C6에서 루프백 전환에 맞춰 다시 썼다.**
 *
 * 예전에는 `handleGoogleCallback(url)`을 직접 불러 콜백 처리를 검증했다. 이제 콜백은
 * 우리가 띄운 루프백 리스너로 **실제 HTTP 요청**으로 도착하므로, 테스트도 그 경로로
 * 두드린다 — 리스너가 실제로 열리는지, 어디에 바인드하는지, 언제 닫히는지가 전부
 * 이 파일이 지켜야 할 것들이고 그건 함수 호출로는 확인되지 않는다.
 *
 * 콜백은 `node:http`로 직접 보낸다. 토큰 교환용 전역 `fetch`를 스텁하기 때문에,
 * 콜백까지 fetch로 보내면 둘이 얽힌다.
 */

// shell.openExternal만 쓰므로 그것만 흉내 낸다.
const openExternal = vi.fn().mockResolvedValue(undefined)
vi.mock('electron', () => ({ shell: { openExternal: (...a: unknown[]) => openExternal(...a) } }))

import { startGoogleAuth, handleGoogleCallback, cancelGoogleAuth } from './google-auth-flow'
import { OAUTH_LOOPBACK_HOST, OAUTH_LOOPBACK_PATH } from '../shared/app-id'

const CLIENT_ID = 'test-client.apps.googleusercontent.com'

/** startGoogleAuth가 브라우저로 연 URL. state·redirect_uri를 여기서 꺼낸다. */
function lastAuthUrl(): URL {
  return new URL(openExternal.mock.calls.at(-1)?.[0] as string)
}

function stateFromLastAuthUrl(): string {
  return lastAuthUrl().searchParams.get('state') ?? ''
}

function redirectUriFromLastAuthUrl(): string {
  return lastAuthUrl().searchParams.get('redirect_uri') ?? ''
}

/** 브라우저가 하는 일 — 리다이렉트 주소를 그냥 GET한다. */
function visit(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: 'GET' }, (res) => {
      let body = ''
      res.setEncoding('utf-8')
      res.on('data', (chunk) => {
        body += chunk
      })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

/** 콜백 한 번. 쿼리는 호출처가 붙인다. */
function callback(query: string): Promise<{ status: number; body: string }> {
  return visit(`${redirectUriFromLastAuthUrl()}?${query}`)
}

/** 리스너가 실제로 열릴 때까지 기다린다 — openExternal은 listen 뒤에 불린다. */
async function started(times = 1): Promise<void> {
  await vi.waitFor(() => expect(openExternal).toHaveBeenCalledTimes(times))
}

function okTokenResponse(body: Record<string, unknown>): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as unknown as Response
}

beforeEach(() => {
  openExternal.mockClear()
  openExternal.mockResolvedValue(undefined)
})

afterEach(() => {
  cancelGoogleAuth()
  vi.unstubAllGlobals()
})

describe('루프백 리스너', () => {
  it('127.0.0.1의 임의 포트로 콜백을 받는다', async () => {
    const pending = startGoogleAuth(CLIENT_ID)
    pending.catch(() => {})
    await started()

    const redirect = new URL(redirectUriFromLastAuthUrl())
    expect(redirect.protocol).toBe('http:')
    // localhost가 아니라 127.0.0.1이어야 한다 — localhost는 ::1로 먼저 풀릴 수 있고,
    // 그러면 IPv4로 바인드한 서버에 콜백이 닿지 않는다.
    expect(redirect.hostname).toBe(OAUTH_LOOPBACK_HOST)
    expect(redirect.pathname).toBe(OAUTH_LOOPBACK_PATH)
    // 포트를 고정하지 않는다. 고정하면 선점한 프로세스가 인가 코드를 받는다.
    expect(Number(redirect.port)).toBeGreaterThan(0)
  })

  it('두 번 시작하면 다른 포트를 쓴다 (포트를 고정하지 않는다)', async () => {
    const first = startGoogleAuth(CLIENT_ID)
    first.catch(() => {})
    await started(1)
    const portA = new URL(redirectUriFromLastAuthUrl()).port

    const second = startGoogleAuth(CLIENT_ID)
    second.catch(() => {})
    await started(2)
    const portB = new URL(redirectUriFromLastAuthUrl()).port

    expect(portA).not.toBe(portB)
  })

  it('우리 경로가 아닌 요청은 흐름을 건드리지 않는다 (브라우저의 /favicon.ico)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okTokenResponse({ access_token: 'at-1', expires_in: 3600 })))
    const pending = startGoogleAuth(CLIENT_ID)
    await started()

    const base = new URL(redirectUriFromLastAuthUrl())
    expect((await visit(`${base.origin}/favicon.ico`)).status).toBe(404)

    // 흐름은 그대로 살아 있어 진짜 콜백을 받는다.
    await callback(`code=abc&state=${stateFromLastAuthUrl()}`)
    await expect(pending).resolves.toMatchObject({ accessToken: 'at-1' })
  })

  it('끝나면 포트를 닫는다 — 로그인하지 않는 동안 열어 두지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okTokenResponse({ access_token: 'at-1', expires_in: 3600 })))
    const pending = startGoogleAuth(CLIENT_ID)
    await started()
    const origin = new URL(redirectUriFromLastAuthUrl()).origin

    await callback(`code=abc&state=${stateFromLastAuthUrl()}`)
    await pending

    await expect(visit(`${origin}/`)).rejects.toThrow()
  })

  it('취소해도 포트를 닫는다', async () => {
    const pending = startGoogleAuth(CLIENT_ID)
    pending.catch(() => {})
    await started()
    const origin = new URL(redirectUriFromLastAuthUrl()).origin

    cancelGoogleAuth()
    await expect(pending).rejects.toThrow(/취소/)
    await expect(visit(`${origin}/`)).rejects.toThrow()
  })
})

describe('콜백 처리', () => {
  it('올바른 콜백이면 토큰으로 끝난다', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          okTokenResponse({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, scope: 'calendar.events' })
        )
    )
    const pending = startGoogleAuth(CLIENT_ID)
    await started()

    const reply = await callback(`code=abc&state=${stateFromLastAuthUrl()}`)
    expect(reply.status).toBe(200)
    // 브라우저 탭에 결과를 남긴다 — 사용자가 앱으로 돌아가야 한다는 것을 알아야 한다.
    expect(reply.body).toContain('연결됐습니다')
    await expect(pending).resolves.toMatchObject({ accessToken: 'at-1', refreshToken: 'rt-1' })
  })

  it('교환 요청의 redirect_uri가 인가 요청의 것과 같다', async () => {
    // 구글이 요구하는 대조다. 포트가 실행마다 달라지므로 어긋나기 쉬운 자리다.
    const fetchSpy = vi.fn().mockResolvedValue(okTokenResponse({ access_token: 'at-1', expires_in: 3600 }))
    vi.stubGlobal('fetch', fetchSpy)
    const pending = startGoogleAuth(CLIENT_ID)
    await started()
    const redirectUri = redirectUriFromLastAuthUrl()

    await callback(`code=abc&state=${stateFromLastAuthUrl()}`)
    await pending

    const body = String((fetchSpy.mock.calls[0][1] as { body: string }).body)
    expect(new URLSearchParams(body).get('redirect_uri')).toBe(redirectUri)
  })

  // state는 CSRF 방어다. 어긋나면 토큰 교환까지 가지 않고 거절해야 한다.
  it('state가 어긋나면 토큰 엔드포인트를 부르지 않는다', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const pending = startGoogleAuth(CLIENT_ID)
    pending.catch(() => {})
    await started()

    await callback('code=abc&state=WRONG')
    await expect(pending).rejects.toThrow(/일치하지 않습니다/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('사용자가 동의를 취소하면 그렇게 끝난다', async () => {
    const pending = startGoogleAuth(CLIENT_ID)
    pending.catch(() => {})
    await started()

    const reply = await callback(`error=access_denied&state=${stateFromLastAuthUrl()}`)
    expect(reply.body).toContain('연결하지 못했습니다')
    await expect(pending).rejects.toThrow(/취소/)
  })

  it('토큰 교환이 실패하면 거절한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const pending = startGoogleAuth(CLIENT_ID)
    pending.catch(() => {})
    await started()

    await callback(`code=abc&state=${stateFromLastAuthUrl()}`)
    await expect(pending).rejects.toThrow()
  })
})

describe('startGoogleAuth', () => {
  it('앱 안의 웹뷰가 아니라 시스템 브라우저를 연다', async () => {
    const pending = startGoogleAuth(CLIENT_ID)
    pending.catch(() => {})
    await started()
    const opened = openExternal.mock.calls[0][0] as string
    expect(opened.startsWith('https://accounts.google.com/')).toBe(true)
    expect(opened).toContain(encodeURIComponent(redirectUriFromLastAuthUrl()))
  })

  it('PKCE 챌린지를 S256으로 보낸다', async () => {
    const pending = startGoogleAuth(CLIENT_ID)
    pending.catch(() => {})
    await started()
    const url = lastAuthUrl()
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBeTruthy()
  })

  it('캘린더 목록과 일정 범위를 함께 요청한다', async () => {
    // 목록 범위가 빠지면 calendarList.list가 403이고, 그 상태에서는 클라이언트 ID를
    // 넣어도 캘린더 선택 화면에서 더 갈 수 없다 — C6의 절반이 그것이었다.
    const pending = startGoogleAuth(CLIENT_ID)
    pending.catch(() => {})
    await started()
    const scope = lastAuthUrl().searchParams.get('scope') ?? ''
    expect(scope).toContain('calendar.calendarlist.readonly')
    expect(scope).toContain('calendar.events')
  })

  // 버튼을 두 번 누르면 콜백이 어느 쪽 것인지 알 수 없다. 이전 흐름은 취소된다.
  it('다시 시작하면 이전 흐름을 취소한다', async () => {
    const first = startGoogleAuth(CLIENT_ID)
    first.catch(() => {})
    await started(1)
    const second = startGoogleAuth(CLIENT_ID)
    second.catch(() => {})

    await expect(first).rejects.toThrow(/취소/)
    await started(2)
  })

  it('브라우저를 열지 못하면 거절한다', async () => {
    openExternal.mockRejectedValueOnce(new Error('no browser'))
    await expect(startGoogleAuth(CLIENT_ID)).rejects.toThrow(/브라우저/)
  })
})

describe('cancelGoogleAuth', () => {
  // 회귀: settle()이 action() 앞에서 pending을 비우기 때문에, 취소 콜백이 모듈 변수를
  // 참조하면 옵셔널 체이닝에 삼켜져 Promise가 영원히 안 끝났다. 타이머도 이미 지워진
  // 뒤라 5분 타임아웃으로도 구제되지 않았다. 지역 flow를 붙잡아야 한다.
  it('대기 중인 흐름을 실제로 거절한다 (매달린 채 두지 않는다)', async () => {
    const pending = startGoogleAuth(CLIENT_ID)
    await started()
    cancelGoogleAuth()
    await expect(pending).rejects.toThrow(/취소/)
  })

  it('대기 중인 것이 없으면 아무 일도 하지 않는다', () => {
    expect(() => cancelGoogleAuth()).not.toThrow()
  })
})

describe('커스텀 스킴은 더 이상 OAuth 경로가 아니다', () => {
  // `index.ts`의 open-url·second-instance 배선이 그대로 컴파일되도록 남겨 둔 자리다.
  // 오래된 링크나 다른 앱이 이 스킴을 열어도 진행 중인 로그인을 건드리면 안 된다.
  it('진행 중인 흐름이 있어도 스킴 콜백은 무시한다', async () => {
    const pending = startGoogleAuth(CLIENT_ID)
    pending.catch(() => {})
    await started()

    await expect(
      handleGoogleCallback(`com.begreen.greenday:/oauth2redirect?code=abc&state=${stateFromLastAuthUrl()}`)
    ).resolves.toBe(false)

    // 흐름은 여전히 살아 있다 — 루프백 콜백만이 그것을 끝낼 수 있다.
    cancelGoogleAuth()
    await expect(pending).rejects.toThrow(/취소/)
  })
})
