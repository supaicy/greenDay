/**
 * Google Calendar API v3 클라이언트.
 *
 * CalDAV 쪽과 같은 CalendarEvent 모델을 쓰고, 여기서 구글의 JSON 형태로만 옮긴다.
 * 그래야 동기화 계획(caldav/sync.ts)을 두 제공자가 함께 쓸 수 있다.
 */

import type { CalendarEvent } from '../caldav/ical'
import type { FetchLike } from './oauth'

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

export interface GoogleCalendarSummary {
  id: string
  summary: string
  primary: boolean
  /** 쓰기 가능한가. reader/freeBusyReader 캘린더에는 일정을 만들 수 없다. */
  writable: boolean
  color: string | null
}

function classify(status: number): GoogleApiError['code'] {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 409 || status === 412) return 'conflict'
  if (status === 429) return 'rate_limit'
  return 'server'
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

export function eventToGoogle(event: CalendarEvent): Record<string, unknown> {
  return {
    id: toGoogleEventId(event.uid),
    summary: event.summary,
    description: event.description || undefined,
    start: toGoogleTime(event.start, event.allDay),
    end: toGoogleTime(event.end, event.allDay),
    // 완료 여부는 구글 일정에 대응 필드가 없다. 우리만 읽는 확장 속성에 싣는다.
    extendedProperties: { private: { haruUid: event.uid, haruCompleted: String(event.completed) } }
  }
}

export function googleToEvent(raw: Record<string, unknown>): CalendarEvent | null {
  const start = fromGoogleTime(raw.start as { date?: string; dateTime?: string })
  if (!start) return null
  const end = fromGoogleTime(raw.end as { date?: string; dateTime?: string })
  const extended = (raw.extendedProperties as { private?: Record<string, string> } | undefined)?.private
  return {
    uid: extended?.haruUid ?? String(raw.id ?? ''),
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    description: typeof raw.description === 'string' ? raw.description : '',
    start: start.value,
    end: end?.value ?? start.value,
    allDay: start.allDay,
    rrule: Array.isArray(raw.recurrence) ? String(raw.recurrence[0] ?? '') || null : null,
    lastModified: typeof raw.updated === 'string' ? raw.updated : null,
    sequence: typeof raw.sequence === 'number' ? raw.sequence : 0,
    completed: extended?.haruCompleted === 'true'
  }
}

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
        }
      })
    } catch (cause) {
      const error = new GoogleApiError(0, '구글 서버에 연결하지 못했습니다.', 'network')
      error.cause = cause
      throw error
    }
    if (!response.ok) {
      const code = classify(response.status)
      throw new GoogleApiError(response.status, messageFor(code, response.status), code)
    }
    return response
  }

  async listCalendars(): Promise<GoogleCalendarSummary[]> {
    const response = await this.request('/users/me/calendarList', { method: 'GET' })
    const payload = (await response.json()) as { items?: Record<string, unknown>[] }
    return (payload.items ?? []).map((item) => ({
      id: String(item.id ?? ''),
      summary: String(item.summary ?? ''),
      primary: item.primary === true,
      // owner/writer만 일정을 만들 수 있다.
      writable: item.accessRole === 'owner' || item.accessRole === 'writer',
      color: typeof item.backgroundColor === 'string' ? item.backgroundColor : null
    }))
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
        return
      }
      throw error
    }
  }

  async deleteEvent(calendarId: string, uid: string): Promise<void> {
    await this.request(
      `/calendars/${encodeURIComponent(calendarId)}/events/${toGoogleEventId(uid)}`,
      { method: 'DELETE' }
    )
  }
}
