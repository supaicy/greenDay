/**
 * CalDAV(RFC 4791) 클라이언트.
 *
 * fetch를 주입받아 네트워크 없이도 테스트할 수 있게 한다. 여기서는 프로토콜만
 * 다루고, 할일 ↔ 일정 변환은 sync.ts가 맡는다.
 */

import { parseMultistatus, findAll, textOf, type DavResponse } from './dav-xml'
import { parseEvents, type CalendarEvent } from './ical'

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

export class CalDavClient {
  private readonly credentials: CalDavCredentials
  private readonly fetchImpl: FetchLike
  private readonly origin: string

  constructor(credentials: CalDavCredentials, fetchImpl?: FetchLike) {
    const url = new URL(credentials.serverUrl)
    if (url.protocol !== 'https:') {
      // 자격증명을 Basic 헤더로 매 요청 보낸다. 평문 전송은 허용하지 않는다.
      throw new CalDavError('protocol', 'CalDAV 서버 주소는 https여야 합니다.')
    }
    this.credentials = credentials
    this.fetchImpl = fetchImpl ?? ((u, init) => fetch(u, init))
    this.origin = url.origin
  }

  /** 상대 경로(서버가 돌려주는 href)를 절대 URL로. 이미 절대면 그대로. */
  private absolute(href: string): string {
    return href.startsWith('http') ? href : new URL(href, this.origin).toString()
  }

  private authHeader(): string {
    const raw = `${this.credentials.username}:${this.credentials.password}`
    return `Basic ${Buffer.from(raw, 'utf-8').toString('base64')}`
  }

  private async request(
    url: string,
    method: string,
    init: { body?: string; headers?: Record<string, string>; context: string }
  ): Promise<Response> {
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: this.authHeader(),
          'User-Agent': 'haru/1.0',
          ...init.headers
        },
        body: init.body,
        // 자격증명이 다른 출처로 새지 않도록 리다이렉트를 자동으로 따르지 않는다.
        redirect: 'manual'
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

    // 같은 출처 안에서의 리다이렉트만 한 번 따라간다 (.well-known → 실제 경로).
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (location) {
        const target = this.absolute(location)
        if (new URL(target).origin === this.origin) {
          return this.request(target, method, init)
        }
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

  /** 로그인 → principal → calendar-home → 캘린더 목록. */
  async discoverCalendars(): Promise<CalendarCollection[]> {
    const rootResponses = await this.propfind(this.absolute('/'), '0', PROP_PRINCIPAL, '사용자 확인')
    const principalHref = textOf(rootResponses[0]?.props.get('current-user-principal') ?? null, 'href')
    if (!principalHref) {
      throw new CalDavError('protocol', '사용자 정보를 찾지 못했습니다. 서버 주소를 확인하세요.')
    }

    const homeResponses = await this.propfind(this.absolute(principalHref), '0', PROP_HOME, '캘린더 위치 확인')
    const homeHref = textOf(homeResponses[0]?.props.get('calendar-home-set') ?? null, 'href')
    if (!homeHref) {
      throw new CalDavError('protocol', '캘린더 위치를 찾지 못했습니다.')
    }

    const calendarResponses = await this.propfind(this.absolute(homeHref), '1', PROP_CALENDARS, '캘린더 목록')

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
        url: this.absolute(response.href),
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
          href: this.absolute(item.href),
          etag: textOf(item.props.get('getetag') ?? null) || null,
          event
        })
      }
    }
    return results
  }

  /**
   * 일정 생성/갱신. etag를 주면 그 사이 서버가 바뀌지 않은 경우에만 쓴다(If-Match).
   * etag가 null이면 새로 만드는 것으로 보고, 이미 있으면 실패시킨다(If-None-Match).
   */
  async putEvent(href: string, ics: string, etag: string | null): Promise<string | null> {
    const response = await this.request(this.absolute(href), 'PUT', {
      body: ics,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        ...(etag ? { 'If-Match': etag } : { 'If-None-Match': '*' })
      },
      context: '일정 저장'
    })
    return response.headers.get('etag')
  }

  async deleteEvent(href: string, etag: string | null): Promise<void> {
    await this.request(this.absolute(href), 'DELETE', {
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
