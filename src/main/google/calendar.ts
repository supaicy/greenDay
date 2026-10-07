/**
 * Google Calendar API v3 클라이언트.
 *
 * CalDAV 쪽과 같은 CalendarEvent 모델을 쓰고, 여기서 구글의 JSON 형태로만 옮긴다.
 * 그래야 동기화 계획(caldav/sync.ts)을 두 제공자가 함께 쓸 수 있다.
 */

import { stampList, type CalendarEvent } from '../caldav/ical'
import type { FetchLike } from './oauth'
import { NETWORK_TIMEOUT_MS } from '../net-timeout'

const API_BASE = 'https://www.googleapis.com/calendar/v3'

export class GoogleApiError extends Error {
  readonly status: number
  readonly code: 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'rate_limit' | 'server' | 'network'

  constructor(status: number, message: string, code: GoogleApiError['code']) {
    super(message)
    this.name = 'GoogleApiError'
    this.status = status
    this.code = code
  }
}

/** 앱이 만든 보조 캘린더 — `calendar.app.created` 범위가 닿는 유일한 종류의 캘린더다. */
export interface GoogleCalendar {
  id: string
  summary: string
}

/**
 * 구글은 **할당량 초과도 403으로 알린다** — `usageLimits` 도메인의
 * rateLimitExceeded·userRateLimitExceeded·dailyLimitExceeded·quotaExceeded.
 *
 * 상태 코드만 보면 "이 캘린더는 우리 범위 밖이다"(거부)와 "잠깐 너무 자주 불렀다"
 * (불통)가 같은 값이 된다. 그러면 `getCalendar`가 둘 다 null로 접고,
 * `ensureAppCalendar`가 그것을 "캘린더가 사라졌다"로 읽어 **`Greenday` 캘린더를
 * 하나 더 만들고 syncState를 비운다.** 목록 API는 `calendar.app.created` 범위에
 * 없으므로 버려진 캘린더는 앱이 다시 찾지도 못한다.
 *
 * OAuth 클라이언트가 빌드에 박혀 있어 할당량은 모든 사용자가 한 프로젝트에서
 * 나눠 쓴다 — 한도에 한 번 걸리면 그 순간 동기화하던 사람 전부가 같은 일을 당한다.
 *
 * 그래서 403은 **본문의 reason으로 갈라야** 한다. CLAUDE.md가 라이선스에 대해
 * 이미 적어 둔 규칙과 같다: "거부와 불통을 뭉치지 말 것 — 상태 코드만으로는
 * 절대 닫지 않는다."
 */
const RATE_LIMIT_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'dailyLimitExceeded',
  'quotaExceeded'
])

function classify(status: number, reasons: string[] = []): GoogleApiError['code'] {
  if (status === 401) return 'unauthorized'
  if (status === 403) return reasons.some((r) => RATE_LIMIT_REASONS.has(r)) ? 'rate_limit' : 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 409 || status === 412) return 'conflict'
  if (status === 429) return 'rate_limit'
  return 'server'
}

/**
 * 오류 본문의 `error.errors[].reason`만 꺼낸다. 본문이 JSON이 아니거나(프록시·CDN이
 * 가로챈 응답) 형태가 다르면 빈 배열 — 그때는 지금까지처럼 상태 코드로만 판단한다.
 * 본문 자체는 절대 메시지에 싣지 않는다(토큰이 섞여 나갈 수 있다).
 */
async function reasonsOf(response: Response): Promise<string[]> {
  try {
    const payload = (await response.json()) as { error?: { errors?: { reason?: unknown }[] } }
    const errors = payload?.error?.errors
    if (!Array.isArray(errors)) return []
    return errors.map((entry) => (typeof entry?.reason === 'string' ? entry.reason : '')).filter(Boolean)
  } catch {
    return []
  }
}

function messageFor(code: GoogleApiError['code'], status: number): string {
  switch (code) {
    case 'unauthorized':
      return '구글 인증이 만료되었습니다. 다시 연결해 주세요.'
    case 'forbidden':
      return '이 캘린더에 접근할 권한이 없습니다.'
    case 'not_found':
      return '대상을 찾을 수 없습니다.'
    case 'conflict':
      return '캘린더 쪽에서 먼저 변경되었습니다.'
    case 'rate_limit':
      return '요청이 너무 잦습니다. 잠시 후 다시 시도하세요.'
    default:
      return `구글 캘린더 오류 (${status})`
  }
}

/** 종일 일정은 date, 시간 일정은 dateTime — 구글은 둘 중 하나만 받는다. */
function toGoogleTime(value: string, allDay: boolean): Record<string, string> {
  return allDay ? { date: value } : { dateTime: new Date(value).toISOString() }
}

function fromGoogleTime(slot: { date?: string; dateTime?: string } | undefined): {
  value: string
  allDay: boolean
} | null {
  if (!slot) return null
  if (slot.date) return { value: slot.date, allDay: true }
  if (slot.dateTime) return { value: new Date(slot.dateTime).toISOString(), allDay: false }
  return null
}

/**
 * 구글의 이벤트 id 규칙: 소문자 a-v와 0-9만, 5~1024자.
 * UID를 그대로 쓸 수 없으므로 base32(소문자)로 인코딩한다. 결정적이라 같은 할일은
 * 항상 같은 id를 갖고, 동기화 상태를 잃어도 중복 생성되지 않는다.
 */
export function toGoogleEventId(uid: string): string {
  const alphabet = 'abcdefghijklmnopqrstuv0123456789'
  const bytes = Buffer.from(uid, 'utf-8')
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31]
  return out
}

/**
 * 구글의 `recurrence[]` — RRULE·RDATE·EXDATE를 **RFC 5545 문자열 그대로** 담는 배열이다.
 *
 * CalDAV와 같은 헬퍼로 만든다. 두 곳에서 따로 조립하면 한쪽만 종일 형식(`;VALUE=DATE`)을
 * 틀리는 종류의 어긋남이 생기고, 그 증상은 "회차가 하루씩 밀린다"로만 보인다.
 */
function toGoogleRecurrence(event: CalendarEvent): string[] | undefined {
  const lines: string[] = []
  if (event.rrule) lines.push(`RRULE:${event.rrule}`)
  if (event.rdates.length > 0) lines.push(stampList('RDATE', event.rdates, event.allDay))
  if (event.exdates.length > 0) lines.push(stampList('EXDATE', event.exdates, event.allDay))
  return lines.length > 0 ? lines : undefined
}

export function eventToGoogle(event: CalendarEvent): Record<string, unknown> {
  return {
    id: toGoogleEventId(event.uid),
    summary: event.summary,
    description: event.description || undefined,
    start: toGoogleTime(event.start, event.allDay),
    end: toGoogleTime(event.end, event.allDay),
    recurrence: toGoogleRecurrence(event),
    // 완료 여부는 구글 일정에 대응 필드가 없다. 우리만 읽는 확장 속성에 싣는다.
    // UID와 마찬가지로 사용자 캘린더에 남는 값이라 키 이름은 함부로 바꾸면 안 된다.
    extendedProperties: { private: { greendayUid: event.uid, greendayCompleted: String(event.completed) } }
  }
}

/** `recurrence[]`에서 접두사를 떼어 우리 내부 표현으로. 없으면 빈 값. */
function fromGoogleRecurrence(raw: unknown): Pick<CalendarEvent, 'rrule' | 'rdates' | 'exdates'> {
  const out: Pick<CalendarEvent, 'rrule' | 'rdates' | 'exdates'> = { rrule: null, rdates: [], exdates: [] }
  if (!Array.isArray(raw)) return out
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    // 접두사 뒤에 파라미터가 붙을 수 있다: `EXDATE;VALUE=DATE:20260803`
    const colon = entry.indexOf(':')
    if (colon < 0) continue
    const name = entry.slice(0, colon).split(';')[0].toUpperCase()
    const value = entry.slice(colon + 1)
    // **내부 표현의 rrule에는 접두사가 없다.** 예전에는 `recurrence[0]`을 통째로
    // 넣어서, 되읽은 값이 우리가 만든 값과 형태부터 달랐다.
    if (name === 'RRULE') out.rrule = value || null
    else if (name === 'RDATE') out.rdates.push(...splitStamps(value))
    else if (name === 'EXDATE') out.exdates.push(...splitStamps(value))
  }
  return out
}

function splitStamps(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
}

export function googleToEvent(raw: Record<string, unknown>): CalendarEvent | null {
  const start = fromGoogleTime(raw.start as { date?: string; dateTime?: string })
  if (!start) return null
  const end = fromGoogleTime(raw.end as { date?: string; dateTime?: string })
  const extended = (raw.extendedProperties as { private?: Record<string, string> } | undefined)?.private
  return {
    uid: extended?.greendayUid ?? String(raw.id ?? ''),
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    description: typeof raw.description === 'string' ? raw.description : '',
    start: start.value,
    end: end?.value ?? start.value,
    allDay: start.allDay,
    ...fromGoogleRecurrence(raw.recurrence),
    // 구글은 예외 회차를 부모가 아니라 **별도 인스턴스 리소스**로 들고 있다.
    // 이벤트 하나를 읽는 것만으로는 알 수 없으므로 여기서는 비운다.
    overrides: [],
    lastModified: typeof raw.updated === 'string' ? raw.updated : null,
    sequence: typeof raw.sequence === 'number' ? raw.sequence : 0,
    completed: extended?.greendayCompleted === 'true'
  }
}

/** 요청 하나의 상한 — 공용 값(`net-timeout.ts`). 이유는 `caldav/client.ts`의 같은 자리에 적어 두었다. */
const REQUEST_TIMEOUT_MS = NETWORK_TIMEOUT_MS

export class GoogleCalendarClient {
  private readonly accessToken: string
  private readonly fetchImpl: FetchLike

  constructor(accessToken: string, fetchImpl?: FetchLike) {
    this.accessToken = accessToken
    this.fetchImpl = fetchImpl ?? ((url, init) => fetch(url, init))
  }

  private async request(path: string, init: RequestInit & { method: string }): Promise<Response> {
    let response: Response
    try {
      response = await this.fetchImpl(`${API_BASE}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          ...(init.headers as Record<string, string> | undefined)
        },
        // 상한 없이는 응답하지 않는 네트워크에서 `google:sync-now`가 undici 기본값
        // (5분)까지 매달리고, 설정 패널의 버튼이 그동안 busy로 잠긴 채 남는다.
        // 동기화는 일정 하나마다 한 번씩 부르므로 그 곱만큼 늘어난다.
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
    } catch (cause) {
      const error = new GoogleApiError(0, '구글 서버에 연결하지 못했습니다.', 'network')
      error.cause = cause
      throw error
    }
    if (!response.ok) {
      const code = classify(response.status, await reasonsOf(response))
      throw new GoogleApiError(response.status, messageFor(code, response.status), code)
    }
    return response
  }

  /**
   * 캘린더 하나를 확인한다. 없으면 null — 사용자가 지웠거나, 다른 계정의 것이거나,
   * 이 앱이 만든 것이 아니다(그 셋을 구글은 404 또는 403으로 알린다).
   *
   * `calendarList.list`는 `calendar.app.created` 범위를 **받지 않는다**(403). 그래서
   * 이름으로 찾을 수 없고, 우리가 만든 캘린더의 id를 저장해 두고 이것으로 되묻는다.
   */
  async getCalendar(calendarId: string): Promise<GoogleCalendar | null> {
    let response: Response
    try {
      response = await this.request(`/calendars/${encodeURIComponent(calendarId)}`, { method: 'GET' })
    } catch (error) {
      if (error instanceof GoogleApiError && (error.code === 'not_found' || error.code === 'forbidden')) {
        return null
      }
      throw error
    }
    const payload = (await response.json()) as { id?: unknown; summary?: unknown }
    return {
      id: typeof payload.id === 'string' && payload.id ? payload.id : calendarId,
      summary: typeof payload.summary === 'string' ? payload.summary : ''
    }
  }

  /** 앱 소유 보조 캘린더를 만든다. 이 범위로 일정을 쓸 수 있는 곳은 이렇게 만든 캘린더뿐이다. */
  async createCalendar(summary: string): Promise<GoogleCalendar> {
    const response = await this.request('/calendars', { method: 'POST', body: JSON.stringify({ summary }) })
    const payload = (await response.json()) as { id?: unknown; summary?: unknown }
    if (typeof payload.id !== 'string' || !payload.id) {
      throw new GoogleApiError(response.status, '캘린더를 만들었지만 id를 받지 못했습니다.', 'server')
    }
    return { id: payload.id, summary: typeof payload.summary === 'string' ? payload.summary : summary }
  }

  /**
   * 일정 생성/갱신. 구글은 id를 우리가 정할 수 있어 PUT(update)만으로 멱등하게 쓸 수
   * 있지만, 없는 id에 update하면 404다. 그래서 update → 404면 insert 순으로 시도한다.
   */
  async upsertEvent(calendarId: string, event: CalendarEvent): Promise<void> {
    const id = toGoogleEventId(event.uid)
    const body = JSON.stringify(eventToGoogle(event))
    const encoded = encodeURIComponent(calendarId)
    try {
      await this.request(`/calendars/${encoded}/events/${id}`, { method: 'PUT', body })
    } catch (error) {
      if (error instanceof GoogleApiError && error.code === 'not_found') {
        await this.request(`/calendars/${encoded}/events`, { method: 'POST', body })
      } else {
        throw error
      }
    }
    // 부모를 쓴 **뒤**에 회차 예외를 얹는다. 인스턴스는 부모의 반복 규칙에서
    // 파생되므로 부모가 먼저 서 있어야 존재한다.
    if (event.overrides.length > 0) await this.applyOverrides(encoded, id, event)
  }

  /**
   * 옮기거나 늘린 회차를 반영한다.
   *
   * **구글에는 RECURRENCE-ID가 없다.** iCalendar는 예외를 같은 리소스 안의 두 번째
   * VEVENT로 담지만, 구글은 회차마다 별도 인스턴스 리소스를 두고 그것을 고치게 한다.
   * 그래서 부모를 쓰는 것만으로는 옮긴 회차가 반영되지 않는다 — 이 왕복이 필요하다.
   *
   * 인스턴스 id를 직접 조립하지 않고 `originalStart`로 물어본다. 조립 규칙
   * (`{eventId}_{압축시각}`)은 문서화된 계약이 아니라 관찰된 형태다.
   *
   * 회차를 못 찾으면 조용히 넘어간다. 그 상태는 다음 동기화에서 다시 보이고,
   * 여기서 던지면 나머지 할일까지 못 올린다.
   */
  private async applyOverrides(encodedCalendarId: string, eventId: string, event: CalendarEvent): Promise<void> {
    for (const override of event.overrides) {
      const query = new URLSearchParams({ originalStart: override.recurrenceId, maxResults: '1' })
      let instanceId: string | null = null
      try {
        const response = await this.request(
          `/calendars/${encodedCalendarId}/events/${eventId}/instances?${query.toString()}`,
          { method: 'GET' }
        )
        const payload = (await response.json()) as { items?: { id?: unknown }[] }
        const first = payload.items?.[0]?.id
        instanceId = typeof first === 'string' && first ? first : null
      } catch (error) {
        if (error instanceof GoogleApiError && error.code === 'not_found') continue
        throw error
      }
      if (!instanceId) continue

      // 옮긴 회차는 언제나 시각이 있다 — 시간 블록을 끌어 놓아야 생기는 값이다.
      await this.request(`/calendars/${encodedCalendarId}/events/${encodeURIComponent(instanceId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          start: toGoogleTime(override.start, false),
          end: toGoogleTime(override.end, false)
        })
      })
    }
  }

  async deleteEvent(calendarId: string, uid: string): Promise<void> {
    await this.request(
      `/calendars/${encodeURIComponent(calendarId)}/events/${toGoogleEventId(uid)}`,
      { method: 'DELETE' }
    )
  }
}
