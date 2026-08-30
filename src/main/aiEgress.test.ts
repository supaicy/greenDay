/**
 * C3(b) 회귀 — AI 요청이 나가는 주소.
 *
 * 감사가 실측한 우회 넷이 여기 그대로 들어 있다. 옛 `isAllowedUrl`은
 *   - IPv6를 아예 안 봤고(`http://[fd00::1]/`, `http://[::ffff:10.0.0.5]/`),
 *   - DNS 이름을 안 봤고(`http://metadata.google.internal/`),
 *   - 링크로컬을 `.254` 한 주소만 막았다(`http://169.254.169.253/`).
 * 무엇보다 **검사가 `setAiConfig`에만 있었다** — 요청을 실제로 보내는 다섯 자리 중
 * 어느 것도 부르지 않았으므로, 손으로 고친 `ai-config.json` 하나면 통째로 우회됐다.
 * 응답 본문은 렌더러로 돌아가므로 읽기까지 되는 SSRF였다.
 *
 * `./database`와 `node:dns/promises`를 목킹해서 디스크와 진짜 DNS를 타지 않는다.
 * (형제 파일 `ai-service.test.ts`는 목이 없어야 해서 여기를 따로 뒀다 — 그쪽 40여 개
 * 테스트가 전부 `localhost` 리터럴이라 관문에서 DNS를 안 친다.)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AiConfig } from '../shared/ai-config'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

/** 디스크에 있다고 칠 설정. 손으로 고친 `ai-config.json`을 흉내 낸다. */
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
    return found.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
  }
}))

beforeEach(() => {
  mockFetch.mockReset()
  disk.config = null
  dns.clear()
})

async function loadAiService() {
  vi.resetModules()
  return await import('./ai-service')
}

/** 손으로 고쳐진 설정 파일이 이미 있는 상태에서 모듈을 올린다. */
async function withStoredConfig(overrides: Partial<AiConfig>) {
  disk.config = {
    provider: 'ollama',
    baseUrl: 'http://localhost:11434',
    model: 'llama3.2:latest',
    apiKey: null,
    maxHistoryMessages: 200,
    localOnly: false,
    ...overrides
  }
  const ai = await loadAiService()
  // 앱이 시작하면서 설정을 읽는 자리(`ai:get-config`)와 같다.
  ai.getAiConfigInternal()
  return ai
}

/** 감사가 실측한 우회 넷. 하나라도 통과하면 그 자리가 다시 열린 것이다. */
const AUDITED_BYPASSES: [string, string][] = [
  ['http://[fd00::1]:11434', 'IPv6 ULA — 사설망'],
  ['http://[::ffff:10.0.0.5]:11434', 'IPv4 매핑 → 10.0.0.5'],
  ['http://metadata.google.internal', 'DNS 이름 → 169.254.169.254'],
  ['http://169.254.169.253:11434', '링크로컬 — .254 하나만 막혀 있었다']
]

describe('감사 실측 우회 4개 — 요청 시점에 막힌다', () => {
  it.each(AUDITED_BYPASSES)('%s (%s)', async (baseUrl) => {
    dns.set('metadata.google.internal', ['169.254.169.254'])
    const ai = await withStoredConfig({ baseUrl })

    const result = await ai.checkConnection()

    expect(result.connected).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

/**
 * 관문이 **요청을 보내는 자리 전부**에 걸려 있는가.
 *
 * 예전에는 `setAiConfig`에만 있었다. 한 자리라도 빠지면 그 자리가 SSRF 창구가 된다.
 */
describe('요청을 보내는 다섯 자리 전부가 관문을 지난다', () => {
  const BLOCKED = 'http://169.254.169.254'

  it('checkConnection', async () => {
    const ai = await withStoredConfig({ baseUrl: BLOCKED })
    await expect(ai.checkConnection()).resolves.toEqual({ connected: false })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('warmupModel', async () => {
    const ai = await withStoredConfig({ baseUrl: BLOCKED })
    await expect(ai.warmupModel()).resolves.toBeUndefined()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('pullModel', async () => {
    const ai = await withStoredConfig({ baseUrl: BLOCKED })
    const onError = vi.fn()
    await ai.pullModel('exaone3.5', vi.fn(), vi.fn(), onError)
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('허용되지 않은 서버 주소'))
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('callLlm (createTaskFromNL)', async () => {
    const ai = await withStoredConfig({ baseUrl: BLOCKED })
    await expect(ai.createTaskFromNL('회의 잡아줘', [])).rejects.toThrow('허용되지 않은 서버 주소')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('streamChat', async () => {
    const ai = await withStoredConfig({ baseUrl: BLOCKED })
    const onError = vi.fn()
    await ai.streamChat('안녕', [], [], vi.fn(), vi.fn(), onError)
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('허용되지 않은 서버 주소'))
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('이름은 해석된 주소로 판정한다', () => {
  /**
   * 이게 요점이다. 저장 시점 검사는 이름을 통과시킬 수밖에 없다(동기 함수라 DNS를
   * 못 본다). 그래서 진짜 판정이 요청 시점에 있어야 한다.
   */
  it('저장은 통과하지만 요청은 막힌다', async () => {
    const ai = await loadAiService()
    dns.set('internal.corp.example', ['10.1.2.3'])

    expect(() => ai.setAiConfig({ provider: 'ollama', baseUrl: 'http://internal.corp.example' })).not.toThrow()
    expect(ai.isAllowedUrl('http://internal.corp.example')).toBe(true) // 싼 사전 검사는 이름을 못 본다

    await expect(ai.checkConnection()).resolves.toEqual({ connected: false })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('공개 주소로 풀리는 이름은 나간다', async () => {
    const ai = await loadAiService()
    dns.set('api.example.com', ['93.184.216.34'])
    ai.setAiConfig({ provider: 'openai', baseUrl: 'https://api.example.com' })
    mockFetch.mockResolvedValueOnce({ ok: true })

    await expect(ai.checkConnection()).resolves.toEqual({ connected: true })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  /**
   * DNS 리바인딩. `localhost`라고 **쓴** 것만 루프백을 얻는다 — 이름이 루프백으로
   * 풀리는 것은 사용자가 의도한 로컬 Ollama가 아니다.
   */
  it('이름이 루프백으로 풀리면 막는다', async () => {
    const ai = await loadAiService()
    dns.set('rebind.example', ['127.0.0.1'])
    ai.setAiConfig({ provider: 'ollama', baseUrl: 'http://rebind.example:11434' })

    await expect(ai.checkConnection()).resolves.toEqual({ connected: false })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('여러 주소 중 하나만 사설이어도 막는다', async () => {
    const ai = await loadAiService()
    dns.set('mixed.example', ['93.184.216.34', '10.0.0.5'])
    ai.setAiConfig({ provider: 'openai', baseUrl: 'https://mixed.example' })

    await expect(ai.checkConnection()).resolves.toEqual({ connected: false })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('해석 자체가 실패하면 닫는 쪽이다', async () => {
    const ai = await loadAiService()
    ai.setAiConfig({ provider: 'openai', baseUrl: 'https://nowhere.example' })

    await expect(ai.checkConnection()).resolves.toEqual({ connected: false })
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('로컬 Ollama는 그대로 동작한다', () => {
  it.each(['http://localhost:11434', 'http://127.0.0.1:11434', 'http://[::1]:11434'])(
    '%s 로는 요청이 나간다',
    async (baseUrl) => {
      const ai = await withStoredConfig({ baseUrl })
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ models: [] }) })

      await expect(ai.checkConnection()).resolves.toEqual({ connected: true, models: [] })
      expect(mockFetch).toHaveBeenCalledTimes(1)
    }
  )

  it('localhost는 DNS를 치지 않는다', async () => {
    // dns 맵이 비어 있으므로, 조회를 시도했다면 위 목이 던져 connected:false가 된다.
    const ai = await withStoredConfig({ baseUrl: 'http://localhost:11434' })
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ models: [] }) })
    await expect(ai.checkConnection()).resolves.toEqual({ connected: true, models: [] })
  })
})

/**
 * 설정 화면의 자물쇠 문구는 "외부 AI 제공자를 차단해 데이터가 기기를 벗어나지
 * 않습니다"인데, `localOnly` 검사가 `callLlm`·`streamChat`에만 있어서 **연결 확인
 * 버튼이 그 약속을 깨고** 있었다. 약속과 강제가 같은 자리에 있어야 한다.
 */
describe('localOnly는 요청을 보내는 자리 전부에서 강제된다', () => {
  const EXTERNAL: Partial<AiConfig> = { provider: 'openai', baseUrl: 'https://api.openai.com', localOnly: true }

  it('checkConnection이 잠금을 지킨다', async () => {
    dns.set('api.openai.com', ['93.184.216.34'])
    const ai = await withStoredConfig(EXTERNAL)

    await expect(ai.checkConnection()).resolves.toEqual({ connected: false })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('warmupModel이 잠금을 지킨다', async () => {
    dns.set('ollama.example', ['93.184.216.34'])
    const ai = await withStoredConfig({ provider: 'ollama', baseUrl: 'http://ollama.example:11434', localOnly: true })

    await ai.warmupModel()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('pullModel이 잠금을 지킨다', async () => {
    dns.set('ollama.example', ['93.184.216.34'])
    const ai = await withStoredConfig({ provider: 'ollama', baseUrl: 'http://ollama.example:11434', localOnly: true })

    const onError = vi.fn()
    await ai.pullModel('exaone3.5', vi.fn(), vi.fn(), onError)
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('로컬 전용'))
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('잠금이 켜져 있어도 로컬은 나간다', async () => {
    const ai = await withStoredConfig({ provider: 'ollama', baseUrl: 'http://localhost:11434', localOnly: true })
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ models: [] }) })

    await expect(ai.checkConnection()).resolves.toEqual({ connected: true, models: [] })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

/**
 * 웨이브 1.5 — 관문이 **첫 홉만** 검사하던 것.
 *
 * 기본 `fetch`는 3xx를 조용히 따라간다. 실측: 허용된 주소가
 * `302 Location: http://[fd00::1]:8080/` 하나만 줘도 요청이 그 주소까지 도달했고
 * (`EHOSTUNREACH`), `169.254.169.254`도 마찬가지였다(4초 타임아웃 = 연결 시도).
 * 관문을 지나지 않는 홉이 하나라도 있으면 관문이 아니다.
 */
describe('리다이렉트 — 홉마다 다시 검사한다', () => {
  const redirect = (location: string, status = 302) => ({
    status,
    ok: false,
    headers: { get: (name: string) => (name.toLowerCase() === 'location' ? location : null) },
    body: null
  })
  const ok = (json: unknown = { models: [] }) => ({
    status: 200,
    ok: true,
    json: async () => json,
    headers: { get: () => null },
    body: null
  })

  it('자동 추적을 끈다 — 모든 요청이 redirect:manual 이다', async () => {
    const ai = await withStoredConfig({ baseUrl: 'http://localhost:11434' })
    mockFetch.mockResolvedValueOnce(ok())
    await ai.checkConnection()
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
  })

  it.each([
    ['http://[fd00::1]:8080/', 'IPv6 ULA'],
    ['http://169.254.169.254/latest/meta-data/', '메타데이터'],
    ['http://10.0.0.5/', '사설망']
  ])('차단 대상(%s)으로 가는 302는 따라가지 않는다', async (location) => {
    const ai = await withStoredConfig({ baseUrl: 'http://localhost:11434' })
    mockFetch.mockResolvedValueOnce(redirect(location))

    await expect(ai.checkConnection()).resolves.toEqual({ connected: false })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls.map((c) => c[0])).not.toContain(location)
  })

  it('이름으로 오는 302도 해석해서 판정한다', async () => {
    dns.set('internal.corp.example', ['10.1.2.3'])
    const ai = await withStoredConfig({ baseUrl: 'http://localhost:11434' })
    mockFetch.mockResolvedValueOnce(redirect('http://internal.corp.example/'))

    await expect(ai.checkConnection()).resolves.toEqual({ connected: false })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('허용되는 곳으로 가는 302는 따라간다 (본문 없는 요청)', async () => {
    dns.set('mirror.example', ['93.184.216.34'])
    const ai = await withStoredConfig({ baseUrl: 'http://localhost:11434' })
    mockFetch.mockResolvedValueOnce(redirect('http://mirror.example/api/tags'))
    mockFetch.mockResolvedValueOnce(ok({ models: [{ name: 'llama3.2:latest' }] }))

    await expect(ai.checkConnection()).resolves.toEqual({ connected: true, models: ['llama3.2:latest'] })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  /** 오리진 A에 결속된 키가 B로 따라가면 C3(a)를 리다이렉트로 되돌리는 셈이다. */
  it('오리진이 바뀌면 Authorization을 떼고 간다', async () => {
    dns.set('api.openai.com', ['93.184.216.34'])
    dns.set('mirror.example', ['93.184.216.35'])
    const ai = await loadAiService()
    ai.setAiConfig({ provider: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'sk-real-secret' })
    mockFetch.mockResolvedValueOnce(redirect('https://mirror.example/v1/models'))
    mockFetch.mockResolvedValueOnce(ok())

    await ai.checkConnection()

    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-real-secret')
    expect(mockFetch.mock.calls[1][1].headers.Authorization).toBeUndefined()
  })

  it('같은 오리진 안에서는 Authorization을 유지한다', async () => {
    dns.set('api.openai.com', ['93.184.216.34'])
    const ai = await loadAiService()
    ai.setAiConfig({ provider: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'sk-real-secret' })
    mockFetch.mockResolvedValueOnce(redirect('https://api.openai.com/v1/models/'))
    mockFetch.mockResolvedValueOnce(ok())

    await ai.checkConnection()

    expect(mockFetch.mock.calls[1][1].headers.Authorization).toBe('Bearer sk-real-secret')
  })

  /**
   * 본문을 두 번째 호스트로 다시 보내는 것은 홉을 검사해도 유출이다 — 프롬프트와 키가
   * 함께 간다. 3xx를 그대로 돌려주면 호출처가 실패로 다룬다.
   */
  it('본문이 있는 요청은 302를 따라가지 않는다', async () => {
    dns.set('mirror.example', ['93.184.216.34'])
    const ai = await withStoredConfig({ baseUrl: 'http://localhost:11434' })
    mockFetch.mockResolvedValueOnce(redirect('http://mirror.example/api/pull'))

    const onError = vi.fn()
    await ai.pullModel('exaone3.5', vi.fn(), vi.fn(), onError)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('302'))
  })

  it('리다이렉트 고리는 상한에서 끊는다', async () => {
    dns.set('loop.example', ['93.184.216.34'])
    const ai = await withStoredConfig({ baseUrl: 'http://localhost:11434' })
    mockFetch.mockResolvedValue(redirect('http://loop.example/loop'))

    await expect(ai.checkConnection()).resolves.toEqual({ connected: false })
    expect(mockFetch.mock.calls.length).toBeLessThanOrEqual(7)
  })
})

/**
 * 웨이브 1.5 — 해석한 주소를 검사에만 쓰고 버리면, `fetch`가 연결 시점에 이름을 다시
 * 해석한다(DNS 재바인딩). 검사한 주소로 실제 연결을 고정한다.
 */
describe('검증한 주소로 연결을 고정한다', () => {
  it('http는 URL의 호스트를 검증된 IP로 바꿔 보낸다', async () => {
    dns.set('ollama.example', ['93.184.216.34'])
    const ai = await withStoredConfig({ provider: 'ollama', baseUrl: 'http://ollama.example:11434' })
    mockFetch.mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ models: [] }), body: null })

    await ai.checkConnection()

    expect(mockFetch.mock.calls[0][0]).toBe('http://93.184.216.34:11434/api/tags')
  })

  it('IPv6로 풀리면 대괄호를 씌운다', async () => {
    dns.set('ollama.example', ['2001:4860:4860::8888'])
    const ai = await withStoredConfig({ provider: 'ollama', baseUrl: 'http://ollama.example:11434' })
    mockFetch.mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ models: [] }), body: null })

    await ai.checkConnection()

    expect(mockFetch.mock.calls[0][0]).toBe('http://[2001:4860:4860::8888]:11434/api/tags')
  })

  /**
   * https는 이름을 유지한다 — IP로 바꾸면 SNI가 IP가 되어 인증서 검증이 깨지고 정상
   * 제공자가 전부 죽는다. 대신 TLS 자체가 고정 역할을 한다.
   */
  it('https는 호스트명을 그대로 둔다 (SNI·인증서)', async () => {
    dns.set('api.openai.com', ['93.184.216.34'])
    const ai = await withStoredConfig({ provider: 'openai', baseUrl: 'https://api.openai.com' })
    mockFetch.mockResolvedValueOnce({ status: 200, ok: true, body: null })

    await ai.checkConnection()

    expect(mockFetch.mock.calls[0][0]).toBe('https://api.openai.com/v1/models')
  })

  it('이미 IP면 DNS도 고정도 없이 그대로 간다', async () => {
    const ai = await withStoredConfig({ baseUrl: 'http://127.0.0.1:11434' })
    mockFetch.mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ models: [] }), body: null })

    await ai.checkConnection()

    expect(mockFetch.mock.calls[0][0]).toBe('http://127.0.0.1:11434/api/tags')
  })
})

/**
 * 웨이브 1.5 — `await` 중에 설정이 바뀌면 검사한 주소·키·모델이 서로 다른 시점의
 * 값으로 조합된다. 요청 하나는 시작할 때 찍은 스냅샷만 쓴다.
 */
describe('요청 하나는 설정 스냅샷 하나만 쓴다', () => {
  it('재시도 중에 설정이 바뀌어도 원래 목적지·키로 간다', async () => {
    dns.set('api.openai.com', ['93.184.216.34'])
    dns.set('evil.example', ['93.184.216.35'])
    const ai = await loadAiService()
    ai.setAiConfig({ provider: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'sk-real-secret' })

    mockFetch.mockImplementationOnce(async () => {
      // 첫 시도가 실패하는 동안 렌더러가 목적지를 자기 서버로 돌려놓는다.
      ai.setAiConfig({ baseUrl: 'https://evil.example', apiKey: 'sk-attacker' })
      throw new Error('boom')
    })
    mockFetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"action":"chat_response","message":"hi"}' } }] }),
      body: null
    })

    await ai.createTaskFromNL('회의 잡아줘', []).catch(() => {})

    const urls = mockFetch.mock.calls.map((c) => c[0])
    expect(urls.every((u: string) => u.startsWith('https://api.openai.com/'))).toBe(true)
    for (const call of mockFetch.mock.calls) {
      expect(call[1].headers.Authorization).toBe('Bearer sk-real-secret')
    }
  })
})

describe('classifyAddress', () => {
  const cases: [string, 'loopback' | 'blocked' | 'public' | null][] = [
    // IPv4
    ['127.0.0.1', 'loopback'],
    ['127.1.2.3', 'loopback'],
    ['0.0.0.0', 'blocked'],
    ['10.0.0.5', 'blocked'],
    ['100.64.0.1', 'blocked'], // CGNAT
    ['169.254.169.254', 'blocked'],
    ['169.254.169.253', 'blocked'], // 감사 실측
    ['172.16.0.1', 'blocked'],
    ['172.31.255.255', 'blocked'],
    ['172.32.0.1', 'public'], // 경계 — 172.16/12 밖
    ['192.0.0.1', 'blocked'],
    ['192.168.1.10', 'blocked'],
    ['198.18.0.1', 'blocked'],
    ['224.0.0.1', 'blocked'],
    ['255.255.255.255', 'blocked'],
    // 웨이브 1.5에서 더한 special-use 대역
    ['192.88.99.1', 'blocked'], // 6to4 릴레이 애니캐스트
    ['198.51.100.1', 'blocked'], // 문서용
    ['203.0.113.1', 'blocked'], // 문서용
    ['93.184.216.34', 'public'],
    ['8.8.8.8', 'public'],
    // IPv6
    ['::1', 'loopback'],
    ['::', 'blocked'],
    ['fd00::1', 'blocked'], // 감사 실측 — ULA
    ['fc00::1', 'blocked'],
    ['fe80::1', 'blocked'],
    ['febf::1', 'blocked'],
    ['ff02::1', 'blocked'],
    ['::ffff:10.0.0.5', 'blocked'], // 감사 실측 — IPv4 매핑
    ['::ffff:a00:5', 'blocked'], // WHATWG URL이 정규화해 내놓는 형태
    ['::ffff:93.184.216.34', 'public'],
    ['2002:a00:5::1', 'blocked'], // 6to4가 감싼 10.0.0.5
    ['64:ff9b::a00:5', 'blocked'], // NAT64가 감싼 10.0.0.5
    ['2001:4860:4860::8888', 'public'],
    // 웨이브 1.5 — 차단 목록에서 새어 나가던 것들. 이제 2000::/3 허용 목록으로 판정한다.
    ['fec0::1', 'blocked'], // 사이트로컬(폐기됨) — 예전엔 public이었다
    ['100::1', 'blocked'], // discard-only — 예전엔 public이었다
    ['::ffff:0:10.0.0.5', 'blocked'], // IPv4 변환 ::ffff:0:0/96 — 예전엔 public이었다
    ['::ffff:0:a00:5', 'blocked'], // 같은 것을 URL이 정규화한 모양
    ['::ffff:0:93.184.216.34', 'public'], // 감싼 v4가 공개면 통과한다
    ['2001::1', 'blocked'], // Teredo — 임의 v4를 감싼다
    ['2001:db8::1', 'blocked'], // 문서용
    ['2001:2::1', 'blocked'], // 벤치마크
    ['3000::1', 'public'], // 2000::/3 안
    ['1000::1', 'blocked'], // 2000::/3 밖
    ['4000::1', 'blocked'], // 2000::/3 밖
    // IP가 아닌 것 — null은 "이름이라 DNS를 봐야 한다"이지 허용이 아니다
    ['example.com', null],
    ['metadata.google.internal', null],
    ['', null],
    ['not:an:address:at:all:x:y:z', null]
  ]

  it.each(cases)('%s → %s', async (value, expected) => {
    const ai = await loadAiService()
    expect(ai.classifyAddress(value)).toBe(expected)
  })
})
