import { describe, it, expect } from 'vitest'
import { CalDavClient, CalDavError, type FetchLike } from './client'

const CREDS = {
  serverUrl: 'https://caldav.icloud.com',
  username: 'user@icloud.com',
  password: 'abcd-efgh-ijkl-mnop'
}

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: string | undefined
}

/** 요청을 기록하면서 미리 정해 둔 응답을 순서대로 돌려주는 fetch 대역. */
function scriptedFetch(responses: { status?: number; body?: string; headers?: Record<string, string> }[]): {
  fetchImpl: FetchLike
  calls: Call[]
} {
  const calls: Call[] = []
  let index = 0
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({
      url,
      method: String(init.method),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body as string | undefined
    })
    const spec = responses[index++] ?? { status: 500 }
    const status = spec.status ?? 207
    // 204/205/304는 본문을 가질 수 없다 — 빈 문자열도 Response 생성자가 거부한다.
    const body = status === 204 || status === 205 || status === 304 ? null : (spec.body ?? '')
    return new Response(body, { status, headers: spec.headers ?? {} })
  }
  return { fetchImpl, calls }
}

const PRINCIPAL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:"><response><href>/</href><propstat>
  <prop><current-user-principal><href>/998877/principal/</href></current-user-principal></prop>
  <status>HTTP/1.1 200 OK</status>
</propstat></response></multistatus>`

const HOME_XML = `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
<response><href>/998877/principal/</href><propstat>
  <prop><C:calendar-home-set><href>/998877/calendars/</href></C:calendar-home-set></prop>
  <status>HTTP/1.1 200 OK</status>
</propstat></response></multistatus>`

const CALENDARS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"
             xmlns:CS="http://calendarserver.org/ns/" xmlns:IC="http://apple.com/ns/ical/">
<response><href>/998877/calendars/</href><propstat>
  <prop><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status>
</propstat></response>
<response><href>/998877/calendars/home/</href><propstat>
  <prop>
    <displayname>집</displayname>
    <resourcetype><collection/><C:calendar/></resourcetype>
    <C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>
    <CS:getctag>ctag-1</CS:getctag>
    <IC:calendar-color>#FF2968</IC:calendar-color>
  </prop><status>HTTP/1.1 200 OK</status>
</propstat></response>
<response><href>/998877/calendars/tasks/</href><propstat>
  <prop>
    <displayname>미리알림</displayname>
    <resourcetype><collection/><C:calendar/></resourcetype>
    <C:supported-calendar-component-set><C:comp name="VTODO"/></C:supported-calendar-component-set>
  </prop><status>HTTP/1.1 200 OK</status>
</propstat></response>
</multistatus>`

describe('CalDavClient 생성', () => {
  it('https가 아니면 만들지 않는다 (자격증명이 평문으로 나간다)', () => {
    expect(() => new CalDavClient({ ...CREDS, serverUrl: 'http://caldav.icloud.com' })).toThrow(CalDavError)
  })
})

describe('discoverCalendars', () => {
  it('principal → home → 목록 순서로 조회한다', async () => {
    const { fetchImpl, calls } = scriptedFetch([{ body: PRINCIPAL_XML }, { body: HOME_XML }, { body: CALENDARS_XML }])
    const calendars = await new CalDavClient(CREDS, fetchImpl).discoverCalendars()

    expect(calls.map((c) => c.url)).toEqual([
      'https://caldav.icloud.com/',
      'https://caldav.icloud.com/998877/principal/',
      'https://caldav.icloud.com/998877/calendars/'
    ])
    expect(calls.every((c) => c.method === 'PROPFIND')).toBe(true)
    expect(calls[0].headers.Depth).toBe('0')
    expect(calls[2].headers.Depth).toBe('1')
    expect(calendars.map((c) => c.displayName)).toEqual(['집', '미리알림'])
  })

  it('캘린더가 아닌 컬렉션은 제외한다', async () => {
    const { fetchImpl } = scriptedFetch([{ body: PRINCIPAL_XML }, { body: HOME_XML }, { body: CALENDARS_XML }])
    const calendars = await new CalDavClient(CREDS, fetchImpl).discoverCalendars()
    expect(calendars).toHaveLength(2) // /calendars/ 자신은 빠진다
  })

  it('VTODO 전용 컬렉션은 일정을 담을 수 없다고 표시한다', async () => {
    const { fetchImpl } = scriptedFetch([{ body: PRINCIPAL_XML }, { body: HOME_XML }, { body: CALENDARS_XML }])
    const calendars = await new CalDavClient(CREDS, fetchImpl).discoverCalendars()
    expect(calendars.find((c) => c.displayName === '집')?.supportsEvents).toBe(true)
    expect(calendars.find((c) => c.displayName === '미리알림')?.supportsEvents).toBe(false)
  })

  it('색상과 ctag를 읽는다', async () => {
    const { fetchImpl } = scriptedFetch([{ body: PRINCIPAL_XML }, { body: HOME_XML }, { body: CALENDARS_XML }])
    const [home] = await new CalDavClient(CREDS, fetchImpl).discoverCalendars()
    expect(home.color).toBe('#FF2968')
    expect(home.ctag).toBe('ctag-1')
    expect(home.url).toBe('https://caldav.icloud.com/998877/calendars/home/')
  })

  it('Basic 인증 헤더를 붙인다', async () => {
    const { fetchImpl, calls } = scriptedFetch([{ body: PRINCIPAL_XML }, { body: HOME_XML }, { body: CALENDARS_XML }])
    await new CalDavClient(CREDS, fetchImpl).discoverCalendars()
    const expected = `Basic ${Buffer.from(`${CREDS.username}:${CREDS.password}`).toString('base64')}`
    expect(calls[0].headers.Authorization).toBe(expected)
  })

  it('401이면 앱 암호를 안내하는 오류를 던진다', async () => {
    const { fetchImpl } = scriptedFetch([{ status: 401 }])
    await expect(new CalDavClient(CREDS, fetchImpl).discoverCalendars()).rejects.toMatchObject({
      code: 'unauthorized'
    })
  })

  it('principal을 못 찾으면 프로토콜 오류로 끝낸다 (빈 목록으로 성공시키지 않는다)', async () => {
    const { fetchImpl } = scriptedFetch([{ body: '<multistatus xmlns="DAV:"></multistatus>' }])
    await expect(new CalDavClient(CREDS, fetchImpl).discoverCalendars()).rejects.toMatchObject({
      code: 'protocol'
    })
  })

  it('네트워크 실패는 network 코드로 감싼다', async () => {
    const fetchImpl: FetchLike = () => Promise.reject(new Error('ENOTFOUND'))
    await expect(new CalDavClient(CREDS, fetchImpl).discoverCalendars()).rejects.toMatchObject({
      code: 'network'
    })
  })
})

describe('리다이렉트 처리', () => {
  it('같은 출처면 한 번 따라간다', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { status: 301, headers: { location: '/998877/principal/' } },
      { body: PRINCIPAL_XML },
      { body: HOME_XML },
      { body: CALENDARS_XML }
    ])
    await new CalDavClient(CREDS, fetchImpl).discoverCalendars()
    expect(calls[1].url).toBe('https://caldav.icloud.com/998877/principal/')
    expect(calls[1].headers.Authorization).toBeTruthy()
  })

  it('다른 출처로의 리다이렉트는 따라가지 않는다 (자격증명 유출 방지)', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { status: 302, headers: { location: 'https://evil.example.com/steal' } }
    ])
    await expect(new CalDavClient(CREDS, fetchImpl).discoverCalendars()).rejects.toMatchObject({
      code: 'protocol'
    })
    expect(calls).toHaveLength(1)
    expect(calls.some((c) => c.url.includes('evil.example.com'))).toBe(false)
  })
})

describe('listEvents', () => {
  const REPORT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
<response>
  <href>/998877/calendars/home/abc.ics</href>
  <propstat><prop>
    <getetag>"etag-abc"</getetag>
    <C:calendar-data>BEGIN:VCALENDAR&#13;
BEGIN:VEVENT&#13;
UID:abc&#13;
SUMMARY:점심 약속&#13;
DTSTART:20260803T030000Z&#13;
DTEND:20260803T040000Z&#13;
END:VEVENT&#13;
END:VCALENDAR</C:calendar-data>
  </prop><status>HTTP/1.1 200 OK</status></propstat>
</response>
</multistatus>`

  it('REPORT로 기간을 지정해 조회한다', async () => {
    const { fetchImpl, calls } = scriptedFetch([{ body: REPORT_XML }])
    const events = await new CalDavClient(CREDS, fetchImpl).listEvents(
      'https://caldav.icloud.com/998877/calendars/home/',
      '2026-08-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z'
    )
    expect(calls[0].method).toBe('REPORT')
    expect(calls[0].headers.Depth).toBe('1')
    expect(calls[0].body).toContain('start="20260801T000000Z"')
    expect(calls[0].body).toContain('end="20260901T000000Z"')
    expect(events).toHaveLength(1)
    expect(events[0].event.summary).toBe('점심 약속')
    expect(events[0].etag).toBe('"etag-abc"')
    expect(events[0].href).toBe('https://caldav.icloud.com/998877/calendars/home/abc.ics')
  })

  it('calendar-data가 없는 응답은 건너뛴다', async () => {
    const { fetchImpl } = scriptedFetch([
      {
        body: `<multistatus xmlns="DAV:"><response><href>/x.ics</href>
          <propstat><prop><getetag>"e"</getetag></prop><status>HTTP/1.1 200 OK</status></propstat>
        </response></multistatus>`
      }
    ])
    const events = await new CalDavClient(CREDS, fetchImpl)
      .listEvents('https://caldav.icloud.com/c/', 'a', 'b')
      .catch(() => [])
    expect(events).toEqual([])
  })
})

describe('putEvent / deleteEvent', () => {
  it('새 일정은 If-None-Match로 덮어쓰기를 막는다', async () => {
    const { fetchImpl, calls } = scriptedFetch([{ status: 201, headers: { etag: '"new"' } }])
    const etag = await new CalDavClient(CREDS, fetchImpl).putEvent(
      '/998877/calendars/home/haru-1.ics',
      'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
      null
    )
    expect(calls[0].method).toBe('PUT')
    expect(calls[0].headers['If-None-Match']).toBe('*')
    expect(calls[0].headers['If-Match']).toBeUndefined()
    expect(calls[0].headers['Content-Type']).toContain('text/calendar')
    expect(etag).toBe('"new"')
  })

  it('갱신은 If-Match로 낙관적 잠금을 건다', async () => {
    const { fetchImpl, calls } = scriptedFetch([{ status: 204, headers: { etag: '"v2"' } }])
    await new CalDavClient(CREDS, fetchImpl).putEvent('/c/haru-1.ics', 'ICS', '"v1"')
    expect(calls[0].headers['If-Match']).toBe('"v1"')
    expect(calls[0].headers['If-None-Match']).toBeUndefined()
  })

  it('412(선점됨)는 conflict로 구분해 던진다', async () => {
    const { fetchImpl } = scriptedFetch([{ status: 412 }])
    await expect(new CalDavClient(CREDS, fetchImpl).putEvent('/c/haru-1.ics', 'ICS', '"stale"')).rejects.toMatchObject({
      code: 'conflict'
    })
  })

  it('삭제도 etag가 있으면 If-Match를 붙인다', async () => {
    const { fetchImpl, calls } = scriptedFetch([{ status: 204 }])
    await new CalDavClient(CREDS, fetchImpl).deleteEvent('/c/haru-1.ics', '"v1"')
    expect(calls[0].method).toBe('DELETE')
    expect(calls[0].headers['If-Match']).toBe('"v1"')
  })
})

describe('자격증명 취급', () => {
  it('오류 메시지에 비밀번호를 담지 않는다', async () => {
    const { fetchImpl } = scriptedFetch([{ status: 401 }])
    const error = await new CalDavClient(CREDS, fetchImpl).discoverCalendars().catch((e) => e)
    expect(String(error.message)).not.toContain(CREDS.password)
    expect(String(error.stack)).not.toContain(CREDS.password)
  })
})
