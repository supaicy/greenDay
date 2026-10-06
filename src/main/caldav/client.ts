/**
 * CalDAV(RFC 4791) 클라이언트.
 *
 * fetch를 주입받아 네트워크 없이도 테스트할 수 있게 한다. 여기서는 프로토콜만
 * 다루고, 할일 ↔ 일정 변환은 sync.ts가 맡는다.
 */

import { parseMultistatus, findAll, textOf, type DavResponse } from './dav-xml'
import { parseEvents, type CalendarEvent } from './ical'
import { NETWORK_TIMEOUT_MS } from '../net-timeout'

export interface CalDavCredentials {
  /** 예: https://caldav.icloud.com */
  serverUrl: string
  /** iCloud는 Apple ID 이메일 */
  username: string
  /** iCloud는 앱 암호(일반 계정 암호로는 로그인되지 않는다) */
  password: string
}

export interface CalendarCollection {
  url: string
  displayName: string
  /** VEVENT를 담을 수 있는 컬렉션인가. 미리알림(VTODO 전용)은 false. */
  supportsEvents: boolean
  color: string | null
  /** 컬렉션 변경 감지용 태그. 값이 그대로면 내용도 그대로다. */
  ctag: string | null
}

export interface RemoteEvent {
  /** 서버 상의 리소스 경로 */
  href: string
  etag: string | null
  event: CalendarEvent
}

export type CalDavErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'network'
  | 'protocol'
  | 'server'
  /**
   * 설정된 서버 주소가 https가 아니다. 서버에 닿기도 전에 **우리가** 거절한 것이라
   * `protocol`("응답을 이해할 수 없다")로 접으면 사용자는 서버 탓으로 읽는다.
   * 화면 문장은 code로만 고르므로(ipc-handlers) 따로 있어야 이 말이 나간다.
   */
  | 'insecure_url'

export class CalDavError extends Error {
  readonly code: CalDavErrorCode
  readonly status: number | null

  constructor(code: CalDavErrorCode, message: string, status: number | null = null) {
    super(message)
    this.name = 'CalDavError'
    this.code = code
    this.status = status
  }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

const PROP_PRINCIPAL = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`

const PROP_HOME = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><c:calendar-home-set/></d:prop>
</d:propfind>`

const PROP_CALENDARS = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <c:supported-calendar-component-set/>
    <cs:getctag/>
    <x:calendar-color xmlns:x="http://apple.com/ns/ical/"/>
  </d:prop>
</d:propfind>`

function statusToError(status: number, context: string): CalDavError {
  if (status === 401) {
    return new CalDavError(
      'unauthorized',
      `${context}: 인증 실패 (401). iCloud는 계정 암호가 아니라 앱 암호가 필요합니다.`,
      status
    )
  }
  if (status === 403) return new CalDavError('forbidden', `${context}: 권한 없음 (403)`, status)
  if (status === 404) return new CalDavError('not_found', `${context}: 대상을 찾을 수 없음 (404)`, status)
  if (status === 409 || status === 412) {
    return new CalDavError('conflict', `${context}: 서버의 항목이 먼저 바뀌었습니다 (${status})`, status)
  }
  return new CalDavError('server', `${context}: 서버 오류 (${status})`, status)
}

/**
 * 리다이렉트를 몇 번까지 따라가는가.
 *
 * 같은 출처로만 따라가므로 자격증명이 새지는 않지만, 자기 자신을 가리키는 301은
 * `request()`의 재귀를 무한히 돌려 메인 프로세스를 세운다. 실제로 필요한 것은
 * `.well-known` → 실제 경로 한 번뿐이라 3이면 넉넉하다.
 */
const MAX_REDIRECTS = 3

/**
 * 요청 하나의 상한.
 *
 * 없으면 **연결은 받아 주고 응답만 하지 않는 서버**(캡티브 포털, 패킷을 삼키는
 * 방화벽, 과부하된 자체 호스팅 서버)에서 이 await가 끝나지 않는다. undici의
 * 기본값(headersTimeout 5분)이 마지막 안전망이지만 본문을 찔끔씩 흘리는 서버는
 * 그 타이머를 계속 되살려 사실상 무한이다. 그동안 설정 패널의 "연결"·"지금 동기화"는
 * `busy`로 잠긴 채 남고(해제가 await 뒤 finally에 있다) 취소할 방법이 없다.
 * `runSync`는 바뀐 할일마다 한 번씩 부르므로 그 곱만큼 늘어난다.
 *
 * 값은 `net-timeout.ts`의 공용 상수(30초)다 — 구글 토큰·구글 캘린더와 같다. 같은 화면의
 * 연동들이 서로 다른 상한을 가질 이유가 없다. 상한에 걸린 요청은 아래 catch가 `network`로
 * 접는다: 응답하지 않는 것은 **불통**이지 서버의 거부가 아니다.
 *
 * 리다이렉트를 따라갈 때는 홉마다 새로 걸린다(최대 MAX_REDIRECTS + 1회). 한 번의
 * 호출이 무한히 매달리지 않는다는 보장은 그대로고, 신호를 재귀에 꿰는 것보다
 * `google/calendar.ts`와 모양을 맞추는 쪽을 골랐다.
 */
const REQUEST_TIMEOUT_MS = NETWORK_TIMEOUT_MS

export class CalDavClient {
  private readonly credentials: CalDavCredentials
  private readonly fetchImpl: FetchLike
  /**
   * 설정된 서버 주소 **전체**(경로 포함). 상대 href의 해석 기준이자 discovery 시작점이다.
   *
   * origin만 들고 있으면 `https://cloud.example/remote.php/dav` 같은 경로 기반
   * endpoint에서 discovery가 `/`부터 시작해 principal을 못 찾는다.
   */
  private readonly base: URL
  private readonly origin: string

  constructor(credentials: CalDavCredentials, fetchImpl?: FetchLike) {
    const url = new URL(credentials.serverUrl)
    if (url.protocol !== 'https:') {
      // 자격증명을 Basic 헤더로 매 요청 보낸다. 평문 전송은 허용하지 않는다.
      throw new CalDavError('insecure_url', 'CalDAV 서버 주소는 https여야 합니다.')
    }
    this.credentials = credentials
    this.fetchImpl = fetchImpl ?? ((u, init) => fetch(u, init))
    this.base = url
    this.origin = url.origin
  }

  /**
   * href를 절대 URL로 바꾸면서 **출처를 강제한다.**
   *
   * 여기 들어오는 문자열은 신뢰할 수 없고, 두 갈래로 들어온다:
   *   1. **서버 응답 본문의 href** — `discoverCalendars`가 principal·home-set·
   *      컬렉션 경로를 전부 서버가 준 XML에서 읽는다. 침해된 CalDAV 서버는 첫
   *      PROPFIND 응답 한 번으로 다음 요청지를 자기가 정할 수 있다. 그 href는
   *      설정 파일에 저장되므로 오염이 지속된다.
   *   2. **렌더러가 준 `calendarUrl`** — `calendar:select`가 문자열을 그대로 저장하고
   *      `listEvents`가 그대로 요청 URL로 쓴다.
   *
   * 그리고 그 URL로 나가는 모든 요청에는 `Authorization: Basic`으로 **iCloud 앱
   * 암호**가 실린다 — 사용자의 캘린더·연락처 전체에 대한 자격증명이다.
   *
   * 예전 구현은 `href.startsWith('http') ? href : new URL(href, origin)`이었고
   * **두 갈래가 둘 다 출처를 벗어났다**(감사 실측):
   *
   *   "https://evil.example/steal" -> https://evil.example/steal  (절대 URL 그대로)
   *   "http://evil.example/steal"  -> http://evil.example/steal   (평문 HTTP까지)
   *   "//evil.example/x"           -> https://evil.example/x      (프로토콜 상대)
   *
   * 생성자의 https 검사는 최초 `serverUrl`에만, 3xx 방어는 리다이렉트 헤더에만
   * 걸려서 본문 안의 href는 어느 쪽도 지나지 않았다.
   *
   * 그래서 **분기를 없앤다.** 절대든 상대든 항상 `new URL(href, base)`로 해석하고
   * origin이 다르면 던진다. 같은 출처의 절대 URL은 정상적인 서버 응답이므로
   * 그대로 통과한다.
   */
  private absolute(href: string, context: string): string {
    let url: URL
    try {
      url = new URL(href, this.base)
    } catch {
      throw new CalDavError('protocol', `${context}: 서버가 해석할 수 없는 주소를 돌려줬습니다.`)
    }
    if (url.origin !== this.origin) {
      // 출처 자체는 비밀이 아니라 메시지에 담는다 — 없으면 침해된 서버를 만난
      // 사용자가 무엇이 잘못됐는지 알 방법이 없다. 자격증명은 담지 않는다.
      throw new CalDavError(
        'protocol',
        `${context}: 서버가 연동 대상이 아닌 주소(${url.origin})를 가리켰습니다.`
      )
    }
    return url.toString()
  }

  private authHeader(): string {
    const raw = `${this.credentials.username}:${this.credentials.password}`
    return `Basic ${Buffer.from(raw, 'utf-8').toString('base64')}`
  }

  private async request(
    url: string,
    method: string,
    init: { body?: string; headers?: Record<string, string>; context: string },
    redirectsLeft = MAX_REDIRECTS
  ): Promise<Response> {
    // **여기가 유일한 관문이다.** 호출처마다 `absolute()`를 부르게 하면 하나만
    // 빠져도 조용히 뚫린다 — 실제로 `listEvents`가 렌더러가 준 `calendarUrl`을
    // 검사 없이 그대로 넘기고 있었다. 자격증명이 붙는 자리에서 한 번 더 본다.
    const target = this.absolute(url, init.context)

    let response: Response
    try {
      response = await this.fetchImpl(target, {
        method,
        headers: {
          Authorization: this.authHeader(),
          'User-Agent': 'haru/1.0',
          ...init.headers
        },
        body: init.body,
        // 자격증명이 다른 출처로 새지 않도록 리다이렉트를 자동으로 따르지 않는다.
        redirect: 'manual',
        // 상한이 없으면 응답하지 않는 서버에서 이 await가 끝나지 않는다 — 위 상수 참고.
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
    } catch (cause) {
      // 사용자에게는 네트워크 문제로 보이지만, 여기 걸리는 건 전송 실패만이 아니다
      // (요청 구성 오류도 여기로 온다). 원인을 붙여 두지 않으면 진단이 불가능해진다.
      const error = new CalDavError(
        'network',
        `${init.context}: 서버에 연결하지 못했습니다. 네트워크를 확인하세요.`,
        null
      )
      error.cause = cause
      throw error
    }

    // 같은 출처 안에서의 리다이렉트만 따라간다 (.well-known → 실제 경로).
    // 다른 출처를 가리키면 아래 `request()`의 `absolute()`가 던진다 — 그 던짐이 방어다.
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (location && redirectsLeft > 0) {
        // **Location은 `base`가 아니라 방금 요청한 URL 기준으로 푼다**(RFC 9110 §10.2.2).
        // `base` 기준으로 풀면 상대 Location(`sub/`)이 엉뚱한 경로가 되고, 경로 기반
        // 서버에서 그 오차가 조용한 404로만 나타난다.
        let resolved: string
        try {
          resolved = new URL(location, target).toString()
        } catch {
          throw new CalDavError('protocol', `${init.context}: 예기치 않은 리다이렉트`, response.status)
        }
        return this.request(resolved, method, init, redirectsLeft - 1)
      }
      throw new CalDavError('protocol', `${init.context}: 예기치 않은 리다이렉트`, response.status)
    }

    if (!response.ok && response.status !== 207) throw statusToError(response.status, init.context)
    return response
  }

  private async propfind(url: string, depth: '0' | '1', body: string, context: string): Promise<DavResponse[]> {
    const response = await this.request(url, 'PROPFIND', {
      body,
      headers: { Depth: depth, 'Content-Type': 'application/xml; charset=utf-8' },
      context
    })
    return parseMultistatus(await response.text())
  }

  /**
   * 로그인 → principal → calendar-home → 캘린더 목록.
   *
   * **설정된 주소에서 시작한다 — origin의 `/`가 아니다.** 예전에는 `absolute('/')`로
   * 시작해서 `serverUrl`의 경로를 통째로 버렸다. iCloud(`https://caldav.icloud.com`)는
   * 경로가 없어 우연히 같았지만, Nextcloud처럼 `https://cloud.example/remote.php/dav`를
   * 쓰는 서버에서는 principal 조회가 `/`로 나가 아무것도 못 찾았다. "직접 입력(CalDAV)"을
   * 화면에 내놓는 이상, 넣은 주소를 그대로 쓰는 것이 최소 계약이다.
   */
  async discoverCalendars(): Promise<CalendarCollection[]> {
    const rootResponses = await this.propfind(this.base.toString(), '0', PROP_PRINCIPAL, '사용자 확인')
    const principalHref = textOf(rootResponses[0]?.props.get('current-user-principal') ?? null, 'href')
    if (!principalHref) {
      throw new CalDavError('protocol', '사용자 정보를 찾지 못했습니다. 서버 주소를 확인하세요.')
    }

    const homeResponses = await this.propfind(principalHref, '0', PROP_HOME, '캘린더 위치 확인')
    const homeHref = textOf(homeResponses[0]?.props.get('calendar-home-set') ?? null, 'href')
    if (!homeHref) {
      throw new CalDavError('protocol', '캘린더 위치를 찾지 못했습니다.')
    }

    const calendarResponses = await this.propfind(homeHref, '1', PROP_CALENDARS, '캘린더 목록')

    const calendars: CalendarCollection[] = []
    for (const response of calendarResponses) {
      const resourceType = response.props.get('resourcetype')
      if (!resourceType || findAll(resourceType, 'calendar').length === 0) continue

      // 미리알림 컬렉션은 VTODO만 받는다. 거기에 VEVENT를 PUT하면 서버가 거절하므로
      // 여기서 걸러 사용자에게 고를 수 없게 한다.
      // 속성 자체를 안 주는 서버도 있는데, 그때는 일정 저장이 된다고 보고 진행한다.
      const componentSet = response.props.get('supported-calendar-component-set')
      const supportsEvents = componentSet
        ? findAll(componentSet, 'comp').some((comp) => comp.attrs.name?.toUpperCase() === 'VEVENT')
        : true

      calendars.push({
        url: this.absolute(response.href, '캘린더 목록'),
        displayName: textOf(response.props.get('displayname') ?? null) || '(이름 없음)',
        supportsEvents,
        color: textOf(response.props.get('calendar-color') ?? null) || null,
        ctag: textOf(response.props.get('getctag') ?? null) || null
      })
    }
    return calendars
  }

  /** 자격증명이 유효한지만 확인한다. 목록이 비어 있어도 로그인 자체는 성공일 수 있다. */
  async testConnection(): Promise<{ ok: true; calendars: CalendarCollection[] }> {
    return { ok: true, calendars: await this.discoverCalendars() }
  }

  /** 기간이 겹치는 VEVENT를 가져온다. from/to는 UTC ISO. */
  async listEvents(calendarUrl: string, from: string, to: string): Promise<RemoteEvent[]> {
    const body = `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${compactUtc(from)}" end="${compactUtc(to)}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`

    const response = await this.request(calendarUrl, 'REPORT', {
      body,
      headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
      context: '일정 조회'
    })

    const results: RemoteEvent[] = []
    for (const item of parseMultistatus(await response.text())) {
      const calendarData = textOf(item.props.get('calendar-data') ?? null)
      if (!calendarData) continue
      for (const event of parseEvents(calendarData)) {
        results.push({
          href: this.absolute(item.href, '일정 조회'),
          etag: textOf(item.props.get('getetag') ?? null) || null,
          event
        })
      }
    }
    return results
  }

  /**
   * **새** 일정. 그 경로에 이미 뭔가 있으면 실패한다(`If-None-Match: *`).
   *
   * 예전에는 생성과 갱신이 `putEvent(href, ics, etag)` 하나였고 `etag === null`이
   * "새로 만든다"를 뜻했다. 그런데 갱신 경로에도 etag가 null이 되는 자리가 있다 —
   * 충돌을 만난 `runSync`가 "다음엔 If-Match 없이 덮어쓰자"며 etag를 비웠다.
   * 그 null이 여기서 `If-None-Match: *`로 번역돼, **이미 있는 리소스에 대고 계속
   * 412를 받는 영구 실패 상태**가 됐다. 뜻이 둘인 인자 하나를 두 연산으로 나눈다.
   */
  async createEvent(href: string, ics: string): Promise<string | null> {
    const response = await this.request(href, 'PUT', {
      body: ics,
      headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'If-None-Match': '*' },
      context: '일정 저장'
    })
    return response.headers.get('etag')
  }

  /**
   * **기존** 일정 갱신. etag를 주면 그 사이 서버가 바뀌지 않은 경우에만 쓴다(If-Match).
   *
   * etag가 null이면 조건 없이 덮어쓴다 — 여기서만 그 뜻이다. `createEvent`와 갈라
   * 뒀으므로 "덮어쓰기"가 "새로 만들기"로 새지 않는다.
   */
  async updateEvent(href: string, ics: string, etag: string | null): Promise<string | null> {
    const response = await this.request(href, 'PUT', {
      body: ics,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        ...(etag ? { 'If-Match': etag } : {})
      },
      context: '일정 저장'
    })
    return response.headers.get('etag')
  }

  /**
   * 그 경로에 지금 무엇이 있는가 — 충돌에서 빠져나오는 유일한 길.
   *
   * 412를 받았다는 것은 "내가 아는 etag가 낡았다"이지 "무엇이 있는지 안다"가 아니다.
   * 서버의 현재 etag와 UID를 다시 읽어야 (a) 그냥 낡은 것인지 (b) 우리가 만든 적
   * 없는 남의 일정이 그 자리에 있는지 가를 수 있다. 없으면 null.
   */
  async probeEvent(href: string): Promise<{ etag: string | null; uid: string | null } | null> {
    let responses: DavResponse[]
    try {
      responses = await this.propfind(
        href,
        '0',
        `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
</d:propfind>`,
        '일정 확인'
      )
    } catch (error) {
      // 그 사이 사라졌다면 충돌이 아니라 "다시 만들면 된다"이다.
      if (error instanceof CalDavError && error.code === 'not_found') return null
      throw error
    }
    const item = responses[0]
    if (!item) return null
    const calendarData = textOf(item.props.get('calendar-data') ?? null)
    return {
      etag: textOf(item.props.get('getetag') ?? null) || null,
      uid: calendarData ? (parseEvents(calendarData)[0]?.uid ?? null) : null
    }
  }

  async deleteEvent(href: string, etag: string | null): Promise<void> {
    await this.request(href, 'DELETE', {
      headers: etag ? { 'If-Match': etag } : {},
      context: '일정 삭제'
    })
  }
}

/** time-range 필터가 요구하는 압축 UTC 형식 */
function compactUtc(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}
