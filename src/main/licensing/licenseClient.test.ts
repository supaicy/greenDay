import { describe, it, expect } from 'vitest'
import { createLicenseClient, isServerRefusal } from './licenseClient'
import type { ClientError } from '../../shared/license'

const KEY = 'GREENDAY-A2B3-C4D5-E6F7-G8H9'
const DEVICE = 'a'.repeat(64)
const BASE = 'https://pay.begreen.dev'

type Reply = { status: number; body: string }

function clientReplying(...replies: Reply[]): {
  client: ReturnType<typeof createLicenseClient>
  calls: { url: string; body: unknown }[]
} {
  const calls: { url: string; body: unknown }[] = []
  let i = 0
  const client = createLicenseClient({
    baseUrl: BASE,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) })
      const reply = replies[Math.min(i++, replies.length - 1)]
      return new Response(reply.body, { status: reply.status })
    }
  })
  return { client, calls }
}

const json = (status: number, value: unknown): Reply => ({ status, body: JSON.stringify(value) })
const ok = (expiresAt: number): Reply => json(200, { token: 'tok', expiresAt })

describe('activate — 요청', () => {
  it('키·기기·기기이름을 활성화 엔드포인트로 보낸다', async () => {
    const { client, calls } = clientReplying(ok(1_800_000_000))
    await client.activate(KEY, DEVICE, 'supaicy의 MacBook')
    expect(calls[0].url).toBe(`${BASE}/v1/activate`)
    expect(calls[0].body).toEqual({ key: KEY, device: DEVICE, deviceName: 'supaicy의 MacBook' })
  })

  it('validate는 같은 모양으로 다른 엔드포인트를 친다', async () => {
    const { client, calls } = clientReplying(ok(1_800_000_000))
    await client.validate(KEY, DEVICE)
    expect(calls[0].url).toBe(`${BASE}/v1/validate`)
    expect(calls[0].body).toEqual({ key: KEY, device: DEVICE })
  })

  it('토큰과 만료를 ms로 돌려준다', async () => {
    const { client } = clientReplying(ok(1_800_000_000))
    const result = await client.activate(KEY, DEVICE, null)
    expect(result).toEqual({ ok: true, value: { token: 'tok', expiresAtMs: 1_800_000_000_000 } })
  })
})

describe('응답 분류 — 서버가 거부한 것', () => {
  const cases: [string, Reply, ClientError][] = [
    ['409는 봉투 없이도 기기 한도다', { status: 409, body: '' }, 'deviceLimit'],
    ['404 + revoked', json(404, { error: 'revoked' }), 'revoked'],
    ['404 + unknown_key', json(404, { error: 'unknown_key' }), 'unknownKey']
  ]
  for (const [name, reply, expected] of cases) {
    it(name, async () => {
      const { client } = clientReplying(reply)
      expect(await client.activate(KEY, DEVICE, null)).toEqual({ ok: false, error: expected })
      expect(isServerRefusal(expected)).toBe(true)
    })
  }
})

describe('응답 분류 — 서버가 말한 것이 아닌 것', () => {
  it('Cloudflare의 HTML 404는 판정이 아니다', async () => {
    // 이게 이 파일에서 가장 중요한 한 줄이다. 거부는 라이선스를 닫으므로,
    // 프록시의 오류 페이지를 판정으로 읽으면 워커 라우트 이름 하나 잘못 바꾼 날
    // 유료 사용자 전원이 다음 실행에서 라이선스를 잃는다. 서버를 고치고 나서도
    // 전원이 재활성화해야 회복된다.
    const { client } = clientReplying({ status: 404, body: '<!DOCTYPE html><title>404</title>' })
    expect(await client.activate(KEY, DEVICE, null)).toEqual({ ok: false, error: 'network' })
    expect(isServerRefusal('network')).toBe(false)
  })

  it('봉투 없는 400도 판정이 아니다', async () => {
    const { client } = clientReplying({ status: 400, body: 'Bad Request' })
    expect(await client.activate(KEY, DEVICE, null)).toEqual({ ok: false, error: 'network' })
  })

  it('봉투 있는 400은 형식 오류지만 라이선스를 닫지는 않는다', async () => {
    // 앱은 이미 형태를 확인한 키만 보내고 재검증은 활성화에 성공했던 키를 다시
    // 보내므로, 진짜 malformed_key는 사실상 도달 불가다. 반대로 워커가 요청
    // 스키마를 조이면 완벽한 JSON 봉투와 함께 400이 오는데, 그걸 판정으로 읽으면
    // 유료 사용자 전원이 한꺼번에 라이선스를 잃는다.
    const { client } = clientReplying(json(400, { error: 'malformed_key' }))
    expect(await client.activate(KEY, DEVICE, null)).toEqual({ ok: false, error: 'malformedKey' })
    expect(isServerRefusal('malformedKey')).toBe(false)
  })

  it('500도, 못 닿는 것도 network', async () => {
    const { client } = clientReplying(json(500, { error: 'internal' }))
    expect(await client.activate(KEY, DEVICE, null)).toEqual({ ok: false, error: 'network' })

    const offline = createLicenseClient({
      baseUrl: BASE,
      fetchImpl: async () => {
        throw new Error('getaddrinfo ENOTFOUND')
      }
    })
    expect(await offline.activate(KEY, DEVICE, null)).toEqual({ ok: false, error: 'network' })
  })

  it('200인데 본문이 토큰이 아니면 network', async () => {
    // 캡티브 포털이 200에 로그인 페이지를 실어 보내는 상황이다. 성공으로 읽으면
    // 검증도 안 된 문자열이 토큰 자리에 저장된다.
    const { client } = clientReplying({ status: 200, body: '<html>Sign in to WiFi</html>' })
    expect(await client.activate(KEY, DEVICE, null)).toEqual({ ok: false, error: 'network' })

    const { client: noToken } = clientReplying(json(200, { expiresAt: 1 }))
    expect(await noToken.activate(KEY, DEVICE, null)).toEqual({ ok: false, error: 'network' })

    const { client: badExp } = clientReplying(json(200, { token: 'tok', expiresAt: 'soon' }))
    expect(await badExp.activate(KEY, DEVICE, null)).toEqual({ ok: false, error: 'network' })
  })
})

describe('분류는 엔드포인트마다 같다', () => {
  // 지금까지 activate로만 시험했다. validate가 404를 다르게 읽으면 배경 갱신이
  // 조용히 라이선스를 닫고, deactivate가 409를 기기 한도로 읽으면 슬롯을 풀려는
  // 사람에게 "기기가 다 찼습니다"라고 말한다.
  const cases: [Reply, ClientError][] = [
    [{ status: 409, body: '' }, 'deviceLimit'],
    [json(404, { error: 'revoked' }), 'revoked'],
    [{ status: 404, body: '<!DOCTYPE html>' }, 'network'],
    [json(500, { error: 'internal' }), 'network']
  ]
  for (const [reply, expected] of cases) {
    it(`${reply.status} → ${expected} (activate·validate)`, async () => {
      const a = clientReplying(reply)
      expect(await a.client.activate(KEY, DEVICE, null)).toEqual({ ok: false, error: expected })
      const v = clientReplying(reply)
      expect(await v.client.validate(KEY, DEVICE)).toEqual({ ok: false, error: expected })
    })
  }

  it('기기 이름이 없으면 빈 문자열로 보낸다 — 서버 스키마가 null을 안 받는다', async () => {
    const { client, calls } = clientReplying(ok(1_800_000_000))
    await client.activate(KEY, DEVICE, null)
    expect(calls[0].body).toEqual({ key: KEY, device: DEVICE, deviceName: '' })
  })
})

describe('요청 자체', () => {
  it('리다이렉트를 따라가지 않는다 — 본문에 원본 키가 들어 있다', async () => {
    // 307/308은 POST 본문을 그대로 다시 보낸다. 잘못 설정되거나 탈취된 오리진
    // 하나가 라이선스 키를 다른 호스트로 흘린다.
    const inits: RequestInit[] = []
    const client = createLicenseClient({
      baseUrl: BASE,
      fetchImpl: async (_url, init) => {
        inits.push(init)
        return new Response(JSON.stringify({ token: 'tok', expiresAt: 1 }), { status: 200 })
      }
    })
    await client.activate(KEY, DEVICE, null)
    await client.deactivate(KEY, DEVICE)
    expect(inits).toHaveLength(2)
    for (const init of inits) expect(init.redirect).toBe('error')
  })
})

describe('deactivate', () => {
  it('성공하면 ok', async () => {
    const { client, calls } = clientReplying(json(200, { ok: true }))
    expect(await client.deactivate(KEY, DEVICE)).toEqual({ ok: true, value: undefined })
    expect(calls[0].url).toBe(`${BASE}/v1/deactivate`)
    expect(calls[0].body).toEqual({ key: KEY, device: DEVICE })
  })

  it('200인데 본문이 서버 답이 아니면 성공으로 읽지 않는다', async () => {
    // 캡티브 포털이 로그인 페이지를 200으로 실어 보낸다. 성공으로 읽으면 슬롯은
    // 서버에 잡힌 채 로컬 자격증명만 지워져, 지원 메일 말고는 빠져나올 길이 없다.
    for (const body of ['<html>Sign in to WiFi</html>', '{}', JSON.stringify({ ok: false })]) {
      const { client } = clientReplying({ status: 200, body })
      expect(await client.deactivate(KEY, DEVICE)).toEqual({ ok: false, error: 'network' })
    }
  })

  it('429는 해제 한도 — 라이선스가 나쁘다는 뜻이 아니다', async () => {
    // 다른 엔드포인트에서 429가 뜻하는 것과 다르다. 슬롯을 얼마나 자주 옮길 수
    // 있는지에 대한 것이지 키가 유효한지에 대한 것이 아니다.
    const { client } = clientReplying(json(429, { error: 'deactivation_limit' }))
    expect(await client.deactivate(KEY, DEVICE)).toEqual({ ok: false, error: 'deactivationLimit' })
    expect(isServerRefusal('deactivationLimit')).toBe(false)
  })

  it('이미 해제된 기기는 device_not_active', async () => {
    const { client } = clientReplying(json(404, { error: 'device_not_active' }))
    expect(await client.deactivate(KEY, DEVICE)).toEqual({ ok: false, error: 'deviceNotActive' })
    expect(isServerRefusal('deviceNotActive')).toBe(false)
  })
})
