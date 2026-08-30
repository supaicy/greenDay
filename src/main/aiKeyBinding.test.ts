/**
 * C3(a) + M3(AI 키 절반) 회귀 — 저장된 API 키가 누구의 것인가.
 *
 * **C3(a)**: 마스킹된 키가 돌아오면 원본 키를 유지하면서 `baseUrl`·`provider` 변경은
 * 그대로 받아들였다. 렌더러가 엔드포인트만 공격자 서버로 바꾸고 연결 확인을 부르면
 * 메인이 보관한 키가 `Bearer`로 그 서버에 나간다.
 *
 * **M3**: `safeStorage` 암호문에는 맥락이 하나도 실리지 않는다. AI 키·CalDAV 앱 암호·
 * Google 토큰이 같은 형식의 base64라, userData에 쓸 수 있는 사람은 암호문을 파일
 * 사이에서 **옮기기만** 하면 된다(위조 불필요). 받는 쪽이 자기 것인 줄 알고 바깥으로
 * 보낸다 — confused deputy.
 *
 * 두 결함의 해법이 같은 물건이다: 암호화되는 평문 안에 버전·용도·계정을 넣고,
 * 복호화한 뒤 셋을 다 확인한다.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

/**
 * `database.ts`가 `apiKey`를 암호화하기 **직전**의 값을 여기서 본다.
 * 봉투 검사는 평문에 대한 것이라 이 자리가 정확히 시험 지점이다.
 */
const disk: { config: Record<string, unknown> | null } = { config: null }
vi.mock('./database', () => ({
  getAiConfig: () => disk.config,
  saveAiConfig: (next: Record<string, unknown>) => {
    disk.config = next
  }
}))

const dns = new Map<string, string[]>()
vi.mock('node:dns/promises', () => ({
  lookup: async (host: string) => {
    const found = dns.get(host)
    if (!found) throw Object.assign(new Error(`ENOTFOUND ${host}`), { code: 'ENOTFOUND' })
    return found.map((address) => ({ address, family: 4 }))
  }
}))

// `vi.spyOn`은 이미 스파이가 걸린 메서드에 대해 **같은 스파이를 돌려준다.**
// 테스트마다 다시 부르면서 호출 기록이 쌓이면, "로그를 남긴다"는 단언이 앞 테스트의
// 호출로 통과하고 "아무 말도 하지 않는다"는 단언이 앞 테스트의 호출로 실패한다.
// 한 번만 걸고 매번 비운다.
const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

beforeEach(() => {
  mockFetch.mockReset()
  consoleError.mockClear()
  disk.config = null
  dns.clear()
  dns.set('api.openai.com', ['93.184.216.34'])
  dns.set('evil.example', ['93.184.216.35'])
})

async function loadAiService() {
  vi.resetModules()
  return await import('./ai-service')
}

/** 디스크에 적힌 봉투(암호화 전 평문). */
function storedEnvelope(): Record<string, unknown> | null {
  const raw = disk.config?.apiKey
  if (typeof raw !== 'string') return null
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

/** 마지막 요청에 실린 Authorization 헤더. */
function sentAuthorization(): string | undefined {
  const init = mockFetch.mock.calls.at(-1)?.[1] as { headers?: Record<string, string> } | undefined
  return init?.headers?.Authorization
}

describe('키를 provider + 오리진에 결속한다', () => {
  it('저장되는 것은 원본 키가 아니라 봉투다', async () => {
    const ai = await loadAiService()
    ai.setAiConfig({ provider: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'sk-real-secret' })

    expect(disk.config?.apiKey).not.toBe('sk-real-secret')
    expect(storedEnvelope()).toEqual({
      v: 1,
      purpose: 'ai.apiKey',
      account: 'openai|https://api.openai.com',
      secret: 'sk-real-secret'
    })
  })

  /**
   * 이게 C3(a)의 공격이다. 렌더러는 키를 몰라도 된다 — 마스킹된 값을 그대로 돌려주면서
   * 주소만 바꾸면 메인이 알아서 실어 보내 줬다.
   */
  it('렌더러가 엔드포인트만 바꾸면 키가 따라가지 않는다', async () => {
    const ai = await loadAiService()
    ai.setAiConfig({ provider: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'sk-real-secret' })
    const masked = ai.getAiConfig().apiKey
    expect(masked).toBe('••••••cret')

    // 렌더러가 하는 짓: 마스킹된 키를 그대로 되돌려주면서 주소만 자기 서버로.
    ai.setAiConfig({ baseUrl: 'https://evil.example', apiKey: masked })

    expect(ai.getAiConfig().apiKey).toBeNull()
    mockFetch.mockResolvedValueOnce({ ok: true })
    await ai.checkConnection()
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(sentAuthorization()).toBeUndefined()
  })

  it('키를 아예 빼고 주소만 바꿔도 마찬가지다', async () => {
    const ai = await loadAiService()
    ai.setAiConfig({ provider: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'sk-real-secret' })

    ai.setAiConfig({ baseUrl: 'https://evil.example' })

    expect(ai.getAiConfig().apiKey).toBeNull()
    expect(storedEnvelope()).toBeNull()
  })

  it('provider만 바뀌어도 버린다', async () => {
    const ai = await loadAiService()
    ai.setAiConfig({ provider: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'sk-real-secret' })

    ai.setAiConfig({ provider: 'custom' })

    expect(ai.getAiConfig().apiKey).toBeNull()
  })

  // 스킴 다운그레이드도 오리진이 다르다 — 평문 HTTP로 키를 흘리지 못한다.
  it('https → http 다운그레이드도 다른 오리진이다', async () => {
    const ai = await loadAiService()
    ai.setAiConfig({ provider: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'sk-real-secret' })

    ai.setAiConfig({ baseUrl: 'http://api.openai.com' })

    expect(ai.getAiConfig().apiKey).toBeNull()
  })

  it('같은 오리진의 경로 변경은 키를 지킨다', async () => {
    const ai = await loadAiService()
    ai.setAiConfig({ provider: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'sk-real-secret' })

    ai.setAiConfig({ baseUrl: 'https://api.openai.com/v1' })

    expect(ai.getAiConfig().apiKey).toBe('••••••cret')
  })

  it('주소와 함께 새 키를 주면 새 결속이 생긴다', async () => {
    const ai = await loadAiService()
    ai.setAiConfig({ provider: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'sk-real-secret' })

    ai.setAiConfig({ baseUrl: 'https://evil.example', apiKey: 'sk-different' })

    expect(storedEnvelope()).toMatchObject({ account: 'openai|https://evil.example', secret: 'sk-different' })
  })

  it('키와 무관한 설정 변경은 키를 건드리지 않는다', async () => {
    const ai = await loadAiService()
    ai.setAiConfig({ provider: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'sk-real-secret' })

    ai.setAiConfig({ maxHistoryMessages: 50 })

    expect(ai.getAiConfig().apiKey).toBe('••••••cret')
    expect(ai.getAiConfig().maxHistoryMessages).toBe(50)
  })

  it('결속이 맞으면 키가 실제로 실린다', async () => {
    const ai = await loadAiService()
    ai.setAiConfig({ provider: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'sk-real-secret' })
    mockFetch.mockResolvedValueOnce({ ok: true })

    await ai.checkConnection()

    expect(sentAuthorization()).toBe('Bearer sk-real-secret')
  })
})

describe('디스크에서 읽을 때 봉투를 엄격히 확인한다', () => {
  /** 파일에 이 평문이 있는 상태로 모듈을 올린다(= `safeStorage` 복호화 직후 상태). */
  async function loadWithStoredKey(apiKey: unknown, config: Record<string, unknown> = {}) {
    disk.config = {
      provider: 'openai',
      baseUrl: 'https://api.openai.com',
      model: 'gpt-4o-mini',
      maxHistoryMessages: 200,
      localOnly: false,
      apiKey,
      ...config
    }
    const ai = await loadAiService()
    return ai
  }

  it('맞는 봉투는 열린다', async () => {
    const sealed = JSON.stringify({
      v: 1,
      purpose: 'ai.apiKey',
      account: 'openai|https://api.openai.com',
      secret: 'sk-real-secret'
    })
    const ai = await loadWithStoredKey(sealed)
    expect(ai.getAiConfig().apiKey).toBe('••••••cret')
  })

  /**
   * M3의 공격이다. `calendar-config.json`의 `password_enc`를 `ai-config.json`의
   * `apiKey_enc` 자리로 옮기면, 복호화는 성공하고 평문은 그냥 문자열이다.
   * 봉투 검사가 없으면 사용자의 iCloud 앱 암호가 `Bearer`로 나간다.
   */
  it('CalDAV 앱 암호를 옮겨 넣어도 열리지 않는다', async () => {
    const ai = await loadWithStoredKey('user-icloud-app-password')

    expect(ai.getAiConfig().apiKey).toBeNull()
    mockFetch.mockResolvedValueOnce({ ok: true })
    await ai.checkConnection()
    expect(sentAuthorization()).toBeUndefined()
  })

  /** Google 토큰은 JSON이라 `JSON.parse`는 통과한다 — 그래서 `purpose`가 필요하다. */
  it('Google 토큰 뭉치를 옮겨 넣어도 열리지 않는다', async () => {
    const ai = await loadWithStoredKey(
      JSON.stringify({ accessToken: 'ya29.a0Af...', refreshToken: '1//0g...', expiresAt: '2026-09-01T00:00:00Z' })
    )
    expect(ai.getAiConfig().apiKey).toBeNull()
  })

  it('용도가 다른 봉투는 거절한다', async () => {
    const sealed = JSON.stringify({
      v: 1,
      purpose: 'caldav.password',
      account: 'openai|https://api.openai.com',
      secret: 'sk-real-secret'
    })
    expect((await loadWithStoredKey(sealed)).getAiConfig().apiKey).toBeNull()
  })

  it('계정이 다른 봉투는 거절한다 — 다른 오리진에서 만들어진 키다', async () => {
    const sealed = JSON.stringify({
      v: 1,
      purpose: 'ai.apiKey',
      account: 'openai|https://evil.example',
      secret: 'sk-real-secret'
    })
    expect((await loadWithStoredKey(sealed)).getAiConfig().apiKey).toBeNull()
  })

  it('버전이 다른 봉투는 거절한다', async () => {
    const sealed = JSON.stringify({
      v: 2,
      purpose: 'ai.apiKey',
      account: 'openai|https://api.openai.com',
      secret: 'sk-real-secret'
    })
    expect((await loadWithStoredKey(sealed)).getAiConfig().apiKey).toBeNull()
  })

  it('버린 이유를 로그로 남긴다 — 조용히 사라지면 "인증 오류"로만 보인다', async () => {
    const ai = await loadWithStoredKey('user-icloud-app-password')
    ai.getAiConfig()
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('다시 입력'))
  })

  it('키가 없던 설정에는 아무 말도 하지 않는다', async () => {
    const ai = await loadWithStoredKey(null)
    expect(ai.getAiConfig().apiKey).toBeNull()
    expect(consoleError).not.toHaveBeenCalled()
  })
})

describe('openAiKey / aiKeyAccount', () => {
  it('계정은 provider와 정규화한 오리진이다', async () => {
    const ai = await loadAiService()
    expect(ai.aiKeyAccount({ provider: 'openai', baseUrl: 'https://API.OpenAI.com/v1/' })).toBe(
      'openai|https://api.openai.com'
    )
    expect(ai.aiKeyAccount({ provider: 'ollama', baseUrl: 'http://localhost:11434' })).toBe(
      'ollama|http://localhost:11434'
    )
  })

  it('주소가 파싱되지 않으면 계정도 없다 — 결속할 대상이 없다', async () => {
    const ai = await loadAiService()
    expect(ai.aiKeyAccount({ provider: 'custom', baseUrl: 'not a url' })).toBeNull()
  })

  it('계정이 null이면 어떤 봉투도 열리지 않는다', async () => {
    const ai = await loadAiService()
    const sealed = JSON.stringify({ v: 1, purpose: 'ai.apiKey', account: 'x', secret: 's' })
    expect(ai.openAiKey(sealed, null)).toBeNull()
  })

  it('빈 secret은 키가 아니다', async () => {
    const ai = await loadAiService()
    const sealed = JSON.stringify({ v: 1, purpose: 'ai.apiKey', account: 'x', secret: '' })
    expect(ai.openAiKey(sealed, 'x')).toBeNull()
  })
})
