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
    rdates: [],
    exdates: [],
    overrides: [],
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

/**
 * H16b — 구글 쪽 반복. `planSync`를 CalDAV와 공유하므로 같은 모델이 여기까지 온다.
 */
describe('H16b — 구글 반복 매핑', () => {
  it('RRULE·RDATE·EXDATE를 recurrence 배열로 낸다', () => {
    const body = eventToGoogle(
      event({
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
        rdates: ['2026-08-12T00:00:00.000Z'],
        exdates: ['2026-08-10T06:00:00.000Z']
      })
    )
    expect(body.recurrence).toEqual([
      'RRULE:FREQ=WEEKLY;BYDAY=MO',
      'RDATE:20260812T000000Z',
      'EXDATE:20260810T060000Z'
    ])
  })

  it('종일 일정은 VALUE=DATE 형식을 쓴다 (CalDAV와 같은 헬퍼)', () => {
    const body = eventToGoogle(
      event({ allDay: true, start: '2026-08-03', end: '2026-08-04', rrule: 'FREQ=DAILY', exdates: ['2026-08-10'] })
    )
    expect(body.recurrence).toEqual(['RRULE:FREQ=DAILY', 'EXDATE;VALUE=DATE:20260810'])
  })

  it('반복이 없으면 recurrence를 아예 넣지 않는다', () => {
    expect(eventToGoogle(event()).recurrence).toBeUndefined()
  })

  it('되읽을 때 접두사를 뗀다 — 내부 표현에는 RRULE:이 없다', () => {
    const parsed = googleToEvent({
      id: 'x',
      start: { dateTime: '2026-08-03T06:00:00.000Z' },
      end: { dateTime: '2026-08-03T07:00:00.000Z' },
      recurrence: ['RRULE:FREQ=DAILY', 'EXDATE;VALUE=DATE:20260810', 'RDATE:20260812T000000Z']
    })
    expect(parsed?.rrule).toBe('FREQ=DAILY')
    expect(parsed?.exdates).toEqual(['20260810'])
    expect(parsed?.rdates).toEqual(['20260812T000000Z'])
  })

  it('recurrence가 없으면 빈 값으로 읽는다', () => {
    const parsed = googleToEvent({
      id: 'x',
      start: { dateTime: '2026-08-03T06:00:00.000Z' },
      end: { dateTime: '2026-08-03T07:00:00.000Z' }
    })
    expect(parsed?.rrule).toBeNull()
    expect(parsed?.rdates).toEqual([])
    expect(parsed?.exdates).toEqual([])
  })
})

/**
 * 구글에는 RECURRENCE-ID가 없다 — 회차 예외는 별도 인스턴스 리소스를 고쳐야 한다.
 * 부모만 쓰면 옮긴 회차가 반영되지 않는다.
 */
describe('H16b — 옮긴 회차를 인스턴스로 반영한다', () => {
  const MOVED = {
    recurrenceId: '2026-08-10T06:00:00.000Z',
    start: '2026-08-10T09:00:00.000Z',
    end: '2026-08-10T10:30:00.000Z'
  }

  /** 순서대로 응답을 돌려주는 대역. 인스턴스 조회 → PATCH 왕복이 필요하다. */
  function scriptedApi(responses: { status?: number; payload?: unknown }[]) {
    const requests: Recorded[] = []
    let index = 0
    const fetchImpl: FetchLike = async (url, init) => {
      requests.push({
        url,
        method: String(init.method),
        headers: (init.headers ?? {}) as Record<string, string>,
        body: init.body as string | undefined
      })
      const spec = responses[index++] ?? { status: 500 }
      const status = spec.status ?? 200
      return new Response(status === 204 ? null : JSON.stringify(spec.payload ?? {}), { status })
    }
    return { requests, fetchImpl }
  }

  it('부모를 쓴 뒤 인스턴스를 찾아 시각을 고친다', async () => {
    const { requests, fetchImpl } = scriptedApi([
      { status: 200 }, // 부모 PUT
      { status: 200, payload: { items: [{ id: 'parentid_20260810T060000Z' }] } }, // instances
      { status: 200 } // 인스턴스 PATCH
    ])
    await new GoogleCalendarClient('token', fetchImpl).upsertEvent(
      'cal@group.calendar.google.com',
      event({ rrule: 'FREQ=WEEKLY;BYDAY=MO', overrides: [MOVED] })
    )
    expect(requests).toHaveLength(3)
    expect(requests[1].method).toBe('GET')
    expect(requests[1].url).toContain('/instances?')
    expect(requests[1].url).toContain(`originalStart=${encodeURIComponent(MOVED.recurrenceId)}`)
    expect(requests[2].method).toBe('PATCH')
    expect(requests[2].url).toContain('parentid_20260810T060000Z')
    expect(JSON.parse(String(requests[2].body))).toEqual({
      start: { dateTime: MOVED.start },
      end: { dateTime: MOVED.end }
    })
  })

  it('예외가 없으면 추가 왕복이 없다', async () => {
    const { requests, fetchImpl } = scriptedApi([{ status: 200 }])
    await new GoogleCalendarClient('token', fetchImpl).upsertEvent('cal', event({ rrule: 'FREQ=DAILY' }))
    expect(requests).toHaveLength(1)
  })

  it('회차를 못 찾으면 조용히 넘어간다 — 나머지 할일까지 막지 않는다', async () => {
    const { fetchImpl } = scriptedApi([{ status: 200 }, { status: 200, payload: { items: [] } }])
    await expect(
      new GoogleCalendarClient('token', fetchImpl).upsertEvent('cal', event({ overrides: [MOVED] }))
    ).resolves.toBeUndefined()
  })

  it('부모가 없어 새로 만든 경우에도 예외를 반영한다', async () => {
    const { requests, fetchImpl } = scriptedApi([
      { status: 404 }, // PUT — 없다
      { status: 200 }, // POST — 만든다
      { status: 200, payload: { items: [{ id: 'inst-1' }] } },
      { status: 200 }
    ])
    await new GoogleCalendarClient('token', fetchImpl).upsertEvent('cal', event({ overrides: [MOVED] }))
    expect(requests.map((r) => r.method)).toEqual(['PUT', 'POST', 'GET', 'PATCH'])
  })
})
