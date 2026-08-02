import { describe, it, expect } from 'vitest'
import {
  GoogleCalendarClient,
  GoogleApiError,
  toGoogleEventId,
  eventToGoogle,
  googleToEvent
} from './calendar'
import type { CalendarEvent } from '../caldav/ical'
import type { FetchLike } from './oauth'

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    uid: 'greenday-t1@supaicy.github.io',
    summary: '장보기',
    description: '',
    start: '2026-08-03T06:00:00.000Z',
    end: '2026-08-03T07:00:00.000Z',
    allDay: false,
    rrule: null,
    lastModified: null,
    sequence: 0,
    completed: false,
    ...overrides
  }
}

interface Recorded {
  url: string
  method: string
  headers: Record<string, string>
  body: string | undefined
}

function fakeApi(statusFor: (method: string, url: string) => number = () => 200, payload: unknown = {}) {
  const requests: Recorded[] = []
  const fetchImpl: FetchLike = async (url, init) => {
    requests.push({
      url,
      method: String(init.method),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body as string | undefined
    })
    const status = statusFor(String(init.method), url)
    const hasBody = status !== 204
    return new Response(hasBody ? JSON.stringify(payload) : null, {
      status,
      headers: { 'Content-Type': 'application/json' }
    })
  }
  return { requests, fetchImpl }
}

describe('toGoogleEventId', () => {
  it('구글이 허용하는 문자만 쓴다 (소문자 a-v와 0-9)', () => {
    expect(toGoogleEventId('greenday-t1@supaicy.github.io')).toMatch(/^[a-v0-9]+$/)
  })

  it('같은 UID는 항상 같은 id다 (상태를 잃어도 중복 생성되지 않는다)', () => {
    expect(toGoogleEventId('greenday-x@supaicy.github.io')).toBe(toGoogleEventId('greenday-x@supaicy.github.io'))
  })

  it('다른 UID는 다른 id다', () => {
    expect(toGoogleEventId('greenday-a@supaicy.github.io')).not.toBe(toGoogleEventId('greenday-b@supaicy.github.io'))
  })

  it('구글의 최소 길이(5자)를 넘는다', () => {
    expect(toGoogleEventId('greenday-1@supaicy.github.io').length).toBeGreaterThanOrEqual(5)
  })
})

describe('eventToGoogle', () => {
  it('시간 일정은 dateTime으로 낸다', () => {
    const body = eventToGoogle(event())
    expect(body.start).toEqual({ dateTime: '2026-08-03T06:00:00.000Z' })
    expect(body.end).toEqual({ dateTime: '2026-08-03T07:00:00.000Z' })
  })

  it('종일 일정은 date로 낸다 (구글은 둘을 섞으면 거부한다)', () => {
    const body = eventToGoogle(event({ allDay: true, start: '2026-08-03', end: '2026-08-04' }))
    expect(body.start).toEqual({ date: '2026-08-03' })
    expect(body.end).toEqual({ date: '2026-08-04' })
  })

  it('빈 설명은 필드 자체를 빼서 보낸다', () => {
    expect(eventToGoogle(event({ description: '' })).description).toBeUndefined()
    expect(eventToGoogle(event({ description: '메모' })).description).toBe('메모')
  })

  it('완료 여부와 원래 UID를 확장 속성에 싣는다', () => {
    const body = eventToGoogle(event({ completed: true })) as {
      extendedProperties: { private: Record<string, string> }
    }
    expect(body.extendedProperties.private.greendayCompleted).toBe('true')
    expect(body.extendedProperties.private.greendayUid).toBe('greenday-t1@supaicy.github.io')
  })
})

describe('googleToEvent', () => {
  it('내보낸 것을 되읽으면 핵심 필드가 보존된다', () => {
    const original = event({ completed: true, description: '메모' })
    const restored = googleToEvent(eventToGoogle(original) as Record<string, unknown>)
    expect(restored?.uid).toBe(original.uid)
    expect(restored?.summary).toBe(original.summary)
    expect(restored?.description).toBe(original.description)
    expect(restored?.start).toBe(original.start)
    expect(restored?.completed).toBe(true)
  })

  it('종일 일정을 왕복해도 날짜가 유지된다', () => {
    const original = event({ allDay: true, start: '2026-08-03', end: '2026-08-04' })
    const restored = googleToEvent(eventToGoogle(original) as Record<string, unknown>)
    expect(restored?.allDay).toBe(true)
    expect(restored?.start).toBe('2026-08-03')
  })

  it('시작 시각이 없는 항목은 버린다', () => {
    expect(googleToEvent({ id: 'x', summary: 'no start' })).toBeNull()
  })
})

describe('listCalendars', () => {
  it('쓰기 가능한 캘린더를 구분한다', async () => {
    const { fetchImpl } = fakeApi(() => 200, {
      items: [
        { id: 'primary@gmail.com', summary: '내 캘린더', primary: true, accessRole: 'owner', backgroundColor: '#039be5' },
        { id: 'team@group', summary: '팀', accessRole: 'writer' },
        { id: 'holidays', summary: '공휴일', accessRole: 'reader' },
        { id: 'busy', summary: '바쁨', accessRole: 'freeBusyReader' }
      ]
    })
    const calendars = await new GoogleCalendarClient('token', fetchImpl).listCalendars()
    expect(calendars.filter((c) => c.writable).map((c) => c.id)).toEqual(['primary@gmail.com', 'team@group'])
    expect(calendars[0].primary).toBe(true)
    expect(calendars[0].color).toBe('#039be5')
  })

  it('Bearer 토큰을 붙인다', async () => {
    const { requests, fetchImpl } = fakeApi(() => 200, { items: [] })
    await new GoogleCalendarClient('tok-123', fetchImpl).listCalendars()
    expect(requests[0].headers.Authorization).toBe('Bearer tok-123')
  })

  it('401은 재연결을 안내한다', async () => {
    const { fetchImpl } = fakeApi(() => 401)
    try {
      await new GoogleCalendarClient('bad', fetchImpl).listCalendars()
      expect.unreachable()
    } catch (error) {
      expect((error as GoogleApiError).code).toBe('unauthorized')
      expect((error as GoogleApiError).message).toContain('다시 연결')
    }
  })
})

describe('upsertEvent', () => {
  it('정해진 id로 PUT한다 (같은 할일이 두 번 생기지 않는다)', async () => {
    const { requests, fetchImpl } = fakeApi(() => 200)
    await new GoogleCalendarClient('t', fetchImpl).upsertEvent('cal@x', event())
    expect(requests).toHaveLength(1)
    expect(requests[0].method).toBe('PUT')
    expect(requests[0].url).toContain(`/events/${toGoogleEventId('greenday-t1@supaicy.github.io')}`)
    expect(requests[0].url).toContain(encodeURIComponent('cal@x'))
  })

  it('없는 일정이면 POST로 새로 만든다', async () => {
    const { requests, fetchImpl } = fakeApi((method) => (method === 'PUT' ? 404 : 200))
    await new GoogleCalendarClient('t', fetchImpl).upsertEvent('cal', event())
    expect(requests.map((r) => r.method)).toEqual(['PUT', 'POST'])
  })

  it('404가 아닌 오류는 그대로 올린다', async () => {
    const { fetchImpl } = fakeApi(() => 403)
    await expect(
      new GoogleCalendarClient('t', fetchImpl).upsertEvent('cal', event())
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('캘린더 id를 URL 인코딩한다 (이메일 형식이라 @가 들어간다)', async () => {
    const { requests, fetchImpl } = fakeApi(() => 200)
    await new GoogleCalendarClient('t', fetchImpl).upsertEvent('a b@c.com', event())
    expect(requests[0].url).not.toContain('a b@c.com')
    expect(requests[0].url).toContain(encodeURIComponent('a b@c.com'))
  })
})

describe('deleteEvent', () => {
  it('결정적 id로 지운다', async () => {
    const { requests, fetchImpl } = fakeApi(() => 204)
    await new GoogleCalendarClient('t', fetchImpl).deleteEvent('cal', 'greenday-t1@supaicy.github.io')
    expect(requests[0].method).toBe('DELETE')
    expect(requests[0].url).toContain(toGoogleEventId('greenday-t1@supaicy.github.io'))
  })
})

describe('오류 분류', () => {
  it('429는 재시도 안내로 구분한다', async () => {
    const { fetchImpl } = fakeApi(() => 429)
    await expect(
      new GoogleCalendarClient('t', fetchImpl).listCalendars()
    ).rejects.toMatchObject({ code: 'rate_limit' })
  })

  it('네트워크 실패를 구분한다', async () => {
    const fetchImpl: FetchLike = () => Promise.reject(new Error('offline'))
    await expect(
      new GoogleCalendarClient('t', fetchImpl).listCalendars()
    ).rejects.toMatchObject({ code: 'network' })
  })

  it('오류 메시지에 액세스 토큰을 담지 않는다', async () => {
    const { fetchImpl } = fakeApi(() => 500)
    const error = await new GoogleCalendarClient('super-secret-token', fetchImpl)
      .listCalendars()
      .catch((e) => e)
    expect(String(error.message)).not.toContain('super-secret-token')
  })
})
