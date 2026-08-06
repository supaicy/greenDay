import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * 2026-08-06 plan-eng-review에서 만든 테스트.
 *
 * 이 모듈은 그동안 테스트가 0건이었다. 구글 로그인의 마지막 관문 —
 * 브라우저가 돌려준 콜백 URL을 토큰으로 바꾸는 자리 — 인데도 그랬고,
 * 그래서 U-2(딥링크 복귀)를 자동으로 확인할 방법이 없었다.
 *
 * 여기서 검증하는 것은 콜백 **처리**다. 콜백이 어떤 경로로 도착하는지
 * (macOS open-url / Windows second-instance argv)는 shared/app-id.test.ts 담당.
 */

// shell.openExternal만 쓰므로 그것만 흉내 낸다.
const openExternal = vi.fn().mockResolvedValue(undefined)
vi.mock('electron', () => ({ shell: { openExternal: (...a: unknown[]) => openExternal(...a) } }))

import { startGoogleAuth, handleGoogleCallback, cancelGoogleAuth, REDIRECT_URI } from './google-auth-flow'

const CLIENT_ID = 'test-client.apps.googleusercontent.com'

/** startGoogleAuth가 브라우저로 연 URL에서 state를 꺼낸다 — 콜백을 만들려면 필요하다. */
function stateFromLastAuthUrl(): string {
  const url = new URL(openExternal.mock.calls.at(-1)?.[0] as string)
  return url.searchParams.get('state') ?? ''
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
  vi.useFakeTimers()
})

afterEach(() => {
  cancelGoogleAuth()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('handleGoogleCallback', () => {
  // 다른 앱이나 오래된 링크가 이 스킴을 열 수 있다. 기다리는 흐름이 없으면 무시해야 한다.
  it('ignores a callback when no auth flow is pending', async () => {
    await expect(handleGoogleCallback(`${REDIRECT_URI}?code=abc&state=xyz`)).resolves.toBe(false)
  })

  it('resolves the pending flow with tokens on a valid callback', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okTokenResponse({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, scope: 'calendar.app.created' })
      )
    )

    const pending = startGoogleAuth(CLIENT_ID)
    const state = stateFromLastAuthUrl()

    await expect(handleGoogleCallback(`${REDIRECT_URI}?code=abc&state=${state}`)).resolves.toBe(true)
    await expect(pending).resolves.toMatchObject({ accessToken: 'at-1', refreshToken: 'rt-1' })
  })

  // state는 CSRF 방어다. 어긋나면 토큰 교환까지 가지 않고 거절해야 한다.
  it('rejects a callback whose state does not match, without calling the token endpoint', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const pending = startGoogleAuth(CLIENT_ID)
    pending.catch(() => {}) // 아래에서 따로 단언한다

    await expect(handleGoogleCallback(`${REDIRECT_URI}?code=abc&state=WRONG`)).resolves.toBe(true)
    await expect(pending).rejects.toThrow(/일치하지 않습니다/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // 사용자가 동의 화면에서 취소한 경우.
  it('rejects when Google returns an error instead of a code', async () => {
    const pending = startGoogleAuth(CLIENT_ID)
    pending.catch(() => {})
    const state = stateFromLastAuthUrl()

    await expect(handleGoogleCallback(`${REDIRECT_URI}?error=access_denied&state=${state}`)).resolves.toBe(true)
    await expect(pending).rejects.toThrow(/취소/)
  })

  it('rejects when the token exchange fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const pending = startGoogleAuth(CLIENT_ID)
    pending.catch(() => {})
    const state = stateFromLastAuthUrl()

    await expect(handleGoogleCallback(`${REDIRECT_URI}?code=abc&state=${state}`)).resolves.toBe(true)
    await expect(pending).rejects.toThrow()
  })

  // 한 번 처리하고 나면 대기 흐름이 비워져야 한다 — 같은 URL이 두 번 와도(맥의
  // open-url과 윈도우의 argv가 겹치는 경우 등) 두 번 처리되면 안 된다.
  it('clears the pending flow so a repeated callback is ignored', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okTokenResponse({ access_token: 'at-1', expires_in: 3600 })))

    const pending = startGoogleAuth(CLIENT_ID)
    const state = stateFromLastAuthUrl()
    const url = `${REDIRECT_URI}?code=abc&state=${state}`

    await expect(handleGoogleCallback(url)).resolves.toBe(true)
    await pending
    await expect(handleGoogleCallback(url)).resolves.toBe(false)
  })
})

describe('startGoogleAuth', () => {
  it('opens the system browser, not an in-app webview', async () => {
    startGoogleAuth(CLIENT_ID).catch(() => {})
    expect(openExternal).toHaveBeenCalledTimes(1)
    const opened = openExternal.mock.calls[0][0] as string
    expect(opened.startsWith('https://accounts.google.com/')).toBe(true)
    expect(opened).toContain(encodeURIComponent(REDIRECT_URI))
  })

  // 버튼을 두 번 누르면 콜백이 어느 쪽 것인지 알 수 없다. 이전 흐름은 취소된다.
  it('cancels the previous flow when started again', async () => {
    const first = startGoogleAuth(CLIENT_ID)
    first.catch(() => {})
    const second = startGoogleAuth(CLIENT_ID)
    second.catch(() => {})

    await expect(first).rejects.toThrow(/취소/)
    expect(openExternal).toHaveBeenCalledTimes(2)
  })

  // 5분이 지나도 콜백이 안 오면 끊는다. Windows에서 딥링크 수신 경로가 없던 시절
  // 사용자가 보던 화면이 정확히 이것이다.
  it('times out after five minutes', async () => {
    const pending = startGoogleAuth(CLIENT_ID)
    const assertion = expect(pending).rejects.toThrow(/시간이 초과/)
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    await assertion
  })

  it('rejects when the browser cannot be opened', async () => {
    openExternal.mockRejectedValueOnce(new Error('no browser'))
    await expect(startGoogleAuth(CLIENT_ID)).rejects.toThrow(/브라우저/)
  })
})

describe('cancelGoogleAuth', () => {
  // 회귀: settle()이 action() 앞에서 pending을 비우기 때문에, 취소 콜백이 모듈 변수를
  // 참조하면 옵셔널 체이닝에 삼켜져 Promise가 영원히 안 끝났다. 타이머도 이미 지워진
  // 뒤라 5분 타임아웃으로도 구제되지 않았다. 지역 flow를 붙잡아야 한다.
  it('actually rejects the pending flow instead of leaving it hanging', async () => {
    const pending = startGoogleAuth(CLIENT_ID)
    cancelGoogleAuth()
    await expect(pending).rejects.toThrow(/취소/)
  })

  it('is a no-op when nothing is pending', () => {
    expect(() => cancelGoogleAuth()).not.toThrow()
  })
})
