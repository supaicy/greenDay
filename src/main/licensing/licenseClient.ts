/**
 * 라이선스 서버(`pay.begreen.dev`)와 말하는 얇은 클라이언트.
 *
 * 이 파일이 지는 진짜 책임은 요청을 보내는 것이 아니라 **"서버가 거부했다"와
 * "서버에 못 닿았다"를 가르는 것**이다. 그 구분이 모듈 전체를 떠받친다:
 * 거부는 권위가 있어 라이선스를 닫아야 하고, 못 닿은 것은 절대 닫으면 안 된다.
 * 둘을 뭉치면 위조된 키가 서버와 접촉하고도 영원히 살아남거나, 반대로 워커
 * 배포 사고 한 번에 유료 사용자 전원이 라이선스를 잃는다.
 */

// 실패 코드는 렌더러가 문구로 바꿔야 해서 shared에 있다. 두 곳에 적으면 어긋나고,
// 어긋난 증상은 "활성화가 실패했는데 아무 메시지도 안 뜬다"이다.
//   deviceLimit       슬롯이 다 찼다 — 키를 돌려 쓰는 것을 멈추는 답.
//   deactivationLimit 짧은 기간에 너무 자주 옮겼다. 한 사람이 자기 기기들 사이를
//                     오가는 것처럼 보이지 않게 되는 지점이지, 키가 나쁘다는 뜻이 아니다.
//   deviceNotActive   해제하려는 기기가 애초에 활성이 아니었다. 이미 풀렸다는 뜻.
export type { ClientError } from '../../shared/license'
import type { ClientError } from '../../shared/license'

/**
 * 서버가 답을 했고, 그 답이 "아니오"였는가.
 *
 * `deactivationLimit`은 일부러 거부가 아니다 — 슬롯을 얼마나 자주 옮길 수 있는지에
 * 대한 것이지 라이선스가 유효한지에 대한 것이 아니다.
 *
 * `malformedKey`도 일부러 권위가 없다. 앱은 이미 형태를 확인한 키만 보내고
 * 재검증은 활성화에 성공했던 키를 다시 보내므로, 진짜 malformed_key 400은 판정을
 * 실행하는 경로에서 도달 불가다. 반대로 워커가 요청 스키마를 조이면 완벽한 JSON
 * 봉투와 함께 400이 오고, 그걸 판정으로 읽으면 유료 사용자 전원이 한꺼번에
 * 라이선스를 잃는다.
 */
export function isServerRefusal(error: ClientError): boolean {
  return error === 'unknownKey' || error === 'revoked' || error === 'deviceLimit'
}

export interface Activation {
  token: string
  expiresAtMs: number
}

export type ClientResult<T> = { ok: true; value: T } | { ok: false; error: ClientError }

export type FetchImpl = (url: string, init: RequestInit) => Promise<Response>

export interface LicenseClientOptions {
  baseUrl: string
  fetchImpl?: FetchImpl
}

export interface LicenseClient {
  activate(key: string, device: string, deviceName: string | null): Promise<ClientResult<Activation>>
  validate(key: string, device: string): Promise<ClientResult<Activation>>
  deactivate(key: string, device: string): Promise<ClientResult<void>>
}

const TIMEOUT_MS = 15_000

export function createLicenseClient(options: LicenseClientOptions): LicenseClient {
  const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init))

  async function send(path: string, body: Record<string, unknown>): Promise<{ status: number; text: string } | null> {
    try {
      const response = await fetchImpl(`${options.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
      return { status: response.status, text: await response.text() }
    } catch {
      return null
    }
  }

  async function activation(path: string, body: Record<string, unknown>): Promise<ClientResult<Activation>> {
    const reply = await send(path, body)
    if (!reply) return { ok: false, error: 'network' }
    if (reply.status !== 200) return { ok: false, error: classify(reply.status, reply.text) }

    const parsed = decode(reply.text)
    // 200이라고 해서 서버가 답한 것은 아니다 — 캡티브 포털이 로그인 페이지를
    // 200으로 실어 보낸다. 성공으로 읽으면 검증도 안 된 문자열이 토큰 자리에 앉는다.
    if (
      typeof parsed?.token !== 'string' ||
      !parsed.token ||
      typeof parsed.expiresAt !== 'number' ||
      !Number.isFinite(parsed.expiresAt)
    ) {
      return { ok: false, error: 'network' }
    }
    return { ok: true, value: { token: parsed.token, expiresAtMs: parsed.expiresAt * 1000 } }
  }

  return {
    activate: (key, device, deviceName) =>
      activation('/v1/activate', { key, device, deviceName: deviceName ?? '' }),
    validate: (key, device) => activation('/v1/validate', { key, device }),
    async deactivate(key, device) {
      const reply = await send('/v1/deactivate', { key, device })
      if (!reply) return { ok: false, error: 'network' }
      if (reply.status === 200) return { ok: true, value: undefined }
      // 다른 엔드포인트에서와 뜻이 다른 유일한 상태 코드다.
      if (reply.status === 429) return { ok: false, error: 'deactivationLimit' }
      return { ok: false, error: classify(reply.status, reply.text) }
    }
  }
}

/**
 * 200이 아닌 응답이 무엇을 뜻하는가 — 한 곳에서만 정한다.
 *
 * 엔드포인트마다 따로 쓰면 어긋난다. 무엇보다 **거부는 거부처럼 생겨야 한다.**
 * Cloudflare의 HTML 404, 이름이 바뀐 워커 라우트, 캡티브 포털의 400, 엣지 WAF —
 * 어느 것도 라이선스 서버가 "아니오"라고 말한 것이 아니고, 상태 코드만으로는
 * 진짜와 구별되지 않는다. 그래서 4xx는 **JSON 봉투가 디코드될 때만** 판정이 된다.
 */
function classify(status: number, text: string): ClientError {
  const named = decode(text)?.error
  const name = typeof named === 'string' ? named : null

  switch (status) {
    case 400:
      return name === null ? 'network' : 'malformedKey'
    case 404:
      if (name === null) return 'network'
      if (name === 'revoked') return 'revoked'
      if (name === 'device_not_active') return 'deviceNotActive'
      return 'unknownKey'
    // 409는 봉투가 필요 없다. 어떤 프록시도 마음에 안 드는 POST에 충돌을
    // 지어내지 않고, 기기 한도 판정만이 이걸 만든다.
    case 409:
      return 'deviceLimit'
    default:
      return 'network'
  }
}

function decode(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}
