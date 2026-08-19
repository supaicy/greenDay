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
  validate(key: string, device: string, deviceName: string | null): Promise<ClientResult<Activation>>
  deactivate(key: string, device: string): Promise<ClientResult<void>>
}

const TIMEOUT_MS = 15_000

/**
 * **서버가 문서로 약속한 코드만** 판정으로 친다.
 *
 * 봉투가 있다는 것만으로는 부족했다 — CDN이나 API 게이트웨이가
 * `404 {"error":"route_not_found"}`를 돌려주면 그게 `unknownKey`가 되어,
 * 재검증이 돈 낸 사람의 토큰을 지우고 그 뒤로는 토큰이 없어 재검증조차 멈춘다.
 * 모르는 코드는 서버가 아니다.
 *
 * 여기 없는 코드로 **떨어지는 방향은 안전하다** — `network`가 되고, 그건
 * "못 닿았다"라서 라이선스가 그대로 산다. 위험한 방향은 반대다: 서버가
 * `revoked`·`unknown_key`·`device_limit` 중 하나의 **이름을 바꾸면**
 * `isServerRefusal`이 발화하지 않고 취소된 라이선스가 유예 끝까지 산다.
 * 그래서 그 셋은 테스트가 따로 못 박는다.
 *
 * 모듈 상수인 이유는 호출마다 다시 짓지 않으려는 것보다도, 서버 계약이
 * 함수 몸통이 아니라 파일 맨 위에서 읽혀야 하기 때문이다.
 */
export const KNOWN_REFUSALS: Record<string, ClientError> = {
  '400:malformed_key': 'malformedKey',
  '400:missing_fields': 'malformedKey',
  '400:malformed_device': 'malformedKey',
  '404:unknown_key': 'unknownKey',
  '404:revoked': 'revoked',
  '404:device_not_active': 'deviceNotActive',
  '409:device_limit': 'deviceLimit',
  '429:deactivation_limit': 'deactivationLimit'
}

export function createLicenseClient(options: LicenseClientOptions): LicenseClient {
  const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init))

  async function send(path: string, body: Record<string, unknown>): Promise<{ status: number; text: string } | null> {
    try {
      const response = await fetchImpl(`${options.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        // 리다이렉트를 따라가지 않는다. 307/308은 POST 본문을 그대로 다시
        // 보내는데, 그 본문에 **원본 라이선스 키**와 기기 해시가 들어 있다.
        // 잘못 설정되거나 탈취된 오리진 하나가 키를 다른 호스트로 흘린다.
        redirect: 'error',
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
    activate: (key, device, deviceName) => activation('/v1/activate', { key, device, deviceName: deviceName ?? '' }),
    // **기기 이름을 같이 보낸다.** 서버의 `/v1/validate`는 `handleActivate`로 가서
    // 활성 슬롯이 없으면 다시 INSERT한다(관리자 해제나 오래된 활성화 회수 뒤가
    // 그렇다). 이름을 빼면 그 재등록이 `device_name`을 NULL로 남기고, 기기 목록
    // 화면에는 이름 없는 행이 뜬다 — 하필 들여다볼 이유가 있는 라이선스에서.
    validate: (key, device, deviceName) => activation('/v1/validate', { key, device, deviceName: deviceName ?? '' }),
    async deactivate(key, device) {
      const reply = await send('/v1/deactivate', { key, device })
      if (!reply) return { ok: false, error: 'network' }
      // 200이라고 서버가 답한 것은 아니다 — 캡티브 포털이 로그인 페이지를 200으로
      // 실어 보낸다. 그걸 성공으로 읽으면 슬롯은 서버에 잡힌 채 로컬 자격증명만
      // 지워져, 지원 메일 말고는 빠져나올 길이 없는 상태가 된다. 활성화 쪽은
      // 이미 본문을 보는데 여기만 안 보고 있었다.
      if (reply.status === 200) {
        return decode(reply.text)?.ok === true ? { ok: true, value: undefined } : { ok: false, error: 'network' }
      }
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
 * 진짜와 구별되지 않는다. 그래서 4xx는 **`KNOWN_REFUSALS`에 이름이 있을 때만**
 * 판정이 된다.
 */
function classify(status: number, text: string): ClientError {
  const named = decode(text)?.error
  if (typeof named !== 'string') return 'network'
  return KNOWN_REFUSALS[`${status}:${named}`] ?? 'network'
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
