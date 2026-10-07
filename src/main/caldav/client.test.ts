import { describe, it, expect, afterEach, vi } from 'vitest'
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

  it('https 거부는 전용 code(insecure_url)로 던진다 — protocol로 접으면 화면 문장이 "응답을 이해할 수 없다"가 된다', () => {
    // ipc-handlers는 `caldavErrors[error.code]`로 문장을 고른다. message는 화면에 나가지 않는다.
    expect(() => new CalDavClient({ ...CREDS, serverUrl: 'http://caldav.icloud.com' })).toThrow(
      expect.objectContaining({ name: 'CalDavError', code: 'insecure_url' })
    )
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

  it('리다이렉트가 자기 자신을 가리켜도 무한히 따라가지 않는다', async () => {
    // 같은 출처라 자격증명은 안 새지만, 상한이 없으면 request()의 재귀가
    // 메인 프로세스를 그대로 세운다.
    const { fetchImpl, calls } = scriptedFetch(
      Array.from({ length: 20 }, () => ({ status: 301, headers: { location: '/loop/' } }))
    )
    await expect(new CalDavClient(CREDS, fetchImpl).discoverCalendars()).rejects.toMatchObject({
      code: 'protocol'
    })
    expect(calls.length).toBeLessThanOrEqual(4) // 최초 1회 + MAX_REDIRECTS(3)
  })

  it('상대 Location은 base가 아니라 방금 요청한 URL 기준으로 푼다', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { status: 301, headers: { location: 'principal/' } },
      { body: PRINCIPAL_XML },
      { body: HOME_XML },
      { body: CALENDARS_XML }
    ])
    await new CalDavClient(
      { ...CREDS, serverUrl: 'https://cloud.example/remote.php/dav/' },
      fetchImpl
    ).discoverCalendars()
    expect(calls[1].url).toBe('https://cloud.example/remote.php/dav/principal/')
  })
})

/**
 * C1 — 응답 본문 안의 href가 그대로 요청 URL이 되던 구멍.
 *
 * 이 요청들에는 iCloud 앱 암호가 Basic 헤더로 실린다. 감사에서 실측한 우회 세 가지를
 * 여기서 통째로 못 박는다. `absolute()`의 분기 하나만 되살려도 셋 중 하나는 반드시 빨개진다.
 */
describe('C1 — href 출처 강제', () => {
  /** principal href만 갈아끼운 응답. 나머지 흐름은 정상이다. */
  const principalPointingAt = (href: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:"><response><href>/</href><propstat>
  <prop><current-user-principal><href>${href}</href></current-user-principal></prop>
  <status>HTTP/1.1 200 OK</status>
</propstat></response></multistatus>`

  const BYPASSES: [name: string, href: string][] = [
    ['절대 URL을 그대로 요청하던 갈래', 'https://evil.example/steal'],
    ['평문 HTTP까지 통과하던 갈래', 'http://evil.example/steal'],
    ['프로토콜 상대 href가 origin만 갈아끼우던 갈래', '//evil.example/steal']
  ]

  for (const [name, href] of BYPASSES) {
    it(`서버가 준 href가 다른 출처면 요청하지 않는다 — ${name}`, async () => {
      const { fetchImpl, calls } = scriptedFetch([{ body: principalPointingAt(href) }])
      await expect(new CalDavClient(CREDS, fetchImpl).discoverCalendars()).rejects.toMatchObject({
        code: 'protocol'
      })
      // 자격증명이 실린 요청이 단 한 번도 그쪽으로 나가지 않았다.
      expect(calls).toHaveLength(1)
      expect(calls.every((c) => c.url.startsWith('https://caldav.icloud.com/'))).toBe(true)
    })
  }

  it('calendar-home-set의 href도 같은 검사를 받는다', async () => {
    const HOME_EVIL = `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
<response><href>/998877/principal/</href><propstat>
  <prop><C:calendar-home-set><href>https://evil.example/c/</href></C:calendar-home-set></prop>
  <status>HTTP/1.1 200 OK</status>
</propstat></response></multistatus>`
    const { fetchImpl, calls } = scriptedFetch([{ body: PRINCIPAL_XML }, { body: HOME_EVIL }])
    await expect(new CalDavClient(CREDS, fetchImpl).discoverCalendars()).rejects.toMatchObject({
      code: 'protocol'
    })
    expect(calls).toHaveLength(2)
    expect(calls.some((c) => c.url.includes('evil.example'))).toBe(false)
  })

  it('컬렉션 목록의 href도 같은 검사를 받는다 (설정 파일에 저장되는 값이다)', async () => {
    const CAL_EVIL = `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
<response><href>https://evil.example/998877/calendars/home/</href><propstat>
  <prop><displayname>집</displayname><resourcetype><collection/><C:calendar/></resourcetype></prop>
  <status>HTTP/1.1 200 OK</status>
</propstat></response></multistatus>`
    const { fetchImpl } = scriptedFetch([{ body: PRINCIPAL_XML }, { body: HOME_XML }, { body: CAL_EVIL }])
    await expect(new CalDavClient(CREDS, fetchImpl).discoverCalendars()).rejects.toMatchObject({
      code: 'protocol'
    })
  })

  /**
   * 두 번째 도달 경로 — 렌더러가 `calendar:select`로 준 문자열.
   * `listEvents`·`putEvent`·`deleteEvent`는 `absolute()`를 거치지 않고 URL을
   * 그대로 `request()`에 넘겼으므로, 관문은 `request()` 진입부에 있어야 한다.
   */
  describe('바깥에서 들어온 URL은 진입점이 무엇이든 걸린다', () => {
    /**
     * 렌더러가 `calendar:select`로 준 문자열은 설정에 저장돼 `listEvents`·
     * `createEvent`·`updateEvent`·`probeEvent`·`deleteEvent`로 흘러든다. 이 중
     * 하나라도 검사를 건너뛰면 앱 암호가 그 호스트로 나간다.
     *
     * **공개 메서드를 통째로 훑는다.** 하나씩 적으면 다음에 추가되는 메서드가
     * 빠지고, 빠졌다는 사실은 아무것도 알려 주지 않는다.
     */
    const OUTSIDE = 'https://evil.example/998877/calendars/home/'

    const ENTRY_POINTS: [name: string, run: (c: CalDavClient) => Promise<unknown>][] = [
      ['listEvents', (c) => c.listEvents(OUTSIDE, '2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')],
      ['createEvent', (c) => c.createEvent(`${OUTSIDE}x.ics`, 'ICS')],
      ['updateEvent (etag 있음)', (c) => c.updateEvent(`${OUTSIDE}x.ics`, 'ICS', '"v1"')],
      ['updateEvent (etag 없음 — 덮어쓰기)', (c) => c.updateEvent(`${OUTSIDE}x.ics`, 'ICS', null)],
      ['probeEvent', (c) => c.probeEvent(`${OUTSIDE}x.ics`)],
      ['deleteEvent', (c) => c.deleteEvent(`${OUTSIDE}x.ics`, null)]
    ]

    for (const [name, run] of ENTRY_POINTS) {
      it(`${name}`, async () => {
        // 응답을 넉넉히 준비해 둔다 — 요청이 나갔다면 성공했을 상황을 만든다.
        const { fetchImpl, calls } = scriptedFetch([{ status: 200 }, { status: 200 }, { status: 200 }])
        await expect(run(new CalDavClient(CREDS, fetchImpl))).rejects.toMatchObject({ code: 'protocol' })
        // 자격증명이 실린 요청이 단 한 번도 나가지 않았다.
        expect(calls).toHaveLength(0)
      })
    }

    it('프로토콜 상대·평문 http로 준 calendarUrl도 같다', async () => {
      for (const outside of ['//evil.example/c/', 'http://evil.example/c/']) {
        const { fetchImpl, calls } = scriptedFetch([{ status: 200 }])
        await expect(
          new CalDavClient(CREDS, fetchImpl).listEvents(outside, '2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')
        ).rejects.toMatchObject({ code: 'protocol' })
        expect(calls).toHaveLength(0)
      }
    })

    it('사용자 정보로 호스트를 감춘 URL도 걸린다', async () => {
      // `https://caldav.icloud.com@evil.example/`의 호스트는 evil.example이다.
      const { fetchImpl, calls } = scriptedFetch([{ status: 200 }])
      await expect(
        new CalDavClient(CREDS, fetchImpl).createEvent('https://caldav.icloud.com@evil.example/x.ics', 'ICS')
      ).rejects.toMatchObject({ code: 'protocol' })
      expect(calls).toHaveLength(0)
    })

    it('같은 출처의 calendarUrl은 정상 동작한다 (검사가 정상 경로를 막지 않는다)', async () => {
      const { fetchImpl, calls } = scriptedFetch([{ status: 201, headers: { etag: '"v1"' } }])
      await new CalDavClient(CREDS, fetchImpl).createEvent('https://caldav.icloud.com/c/x.ics', 'ICS')
      expect(calls).toHaveLength(1)
    })
  })

  it('같은 출처의 절대 URL은 정상 응답이므로 통과한다', async () => {
    const PRINCIPAL_ABS = principalPointingAt('https://caldav.icloud.com/998877/principal/')
    const { fetchImpl, calls } = scriptedFetch([
      { body: PRINCIPAL_ABS },
      { body: HOME_XML },
      { body: CALENDARS_XML }
    ])
    await new CalDavClient(CREDS, fetchImpl).discoverCalendars()
    expect(calls[1].url).toBe('https://caldav.icloud.com/998877/principal/')
  })

  it('오류 메시지에 자격증명을 담지 않는다', async () => {
    const { fetchImpl } = scriptedFetch([{ body: principalPointingAt('https://evil.example/steal') }])
    const error = await new CalDavClient(CREDS, fetchImpl).discoverCalendars().catch((e) => e)
    expect(String(error.message)).not.toContain(CREDS.password)
    expect(String(error.message)).not.toContain(CREDS.username)
  })
})

/** H16c — 경로 기반 CalDAV endpoint(Nextcloud 등)에서 discovery가 경로를 버리지 않는다. */
describe('경로가 있는 serverUrl', () => {
  it('설정된 경로에서 discovery를 시작한다 (origin의 /가 아니다)', async () => {
    const { fetchImpl, calls } = scriptedFetch([{ body: PRINCIPAL_XML }, { body: HOME_XML }, { body: CALENDARS_XML }])
    await new CalDavClient(
      { ...CREDS, serverUrl: 'https://cloud.example/remote.php/dav' },
      fetchImpl
    ).discoverCalendars()
    expect(calls[0].url).toBe('https://cloud.example/remote.php/dav')
  })

  it('상대 href는 설정된 경로를 기준으로 푼다', async () => {
    const RELATIVE_PRINCIPAL = `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:"><response><href>/</href><propstat>
  <prop><current-user-principal><href>principals/users/me/</href></current-user-principal></prop>
  <status>HTTP/1.1 200 OK</status>
</propstat></response></multistatus>`
    const { fetchImpl, calls } = scriptedFetch([{ body: RELATIVE_PRINCIPAL }, { body: HOME_XML }, { body: CALENDARS_XML }])
    await new CalDavClient(
      { ...CREDS, serverUrl: 'https://cloud.example/remote.php/dav/' },
      fetchImpl
    ).discoverCalendars()
    expect(calls[1].url).toBe('https://cloud.example/remote.php/dav/principals/users/me/')
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

describe('createEvent / updateEvent / deleteEvent', () => {
  it('새 일정은 If-None-Match로 덮어쓰기를 막는다', async () => {
    const { fetchImpl, calls } = scriptedFetch([{ status: 201, headers: { etag: '"new"' } }])
    const etag = await new CalDavClient(CREDS, fetchImpl).createEvent(
      '/998877/calendars/home/haru-1.ics',
      'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'
    )
    expect(calls[0].method).toBe('PUT')
    expect(calls[0].headers['If-None-Match']).toBe('*')
    expect(calls[0].headers['If-Match']).toBeUndefined()
    expect(calls[0].headers['Content-Type']).toContain('text/calendar')
    expect(etag).toBe('"new"')
  })

  it('갱신은 If-Match로 낙관적 잠금을 건다', async () => {
    const { fetchImpl, calls } = scriptedFetch([{ status: 204, headers: { etag: '"v2"' } }])
    await new CalDavClient(CREDS, fetchImpl).updateEvent('/c/haru-1.ics', 'ICS', '"v1"')
    expect(calls[0].headers['If-Match']).toBe('"v1"')
    expect(calls[0].headers['If-None-Match']).toBeUndefined()
  })

  /**
   * H16a — etag를 모른 채 갱신하는 것은 **덮어쓰기**이지 새로 만들기가 아니다.
   * 한 함수의 `etag === null`이 두 뜻을 겸하던 시절, 충돌 뒤 비워 둔 etag가
   * `If-None-Match: *`로 번역돼 같은 412를 영원히 다시 받았다.
   */
  it('etag 없는 갱신은 조건 헤더 없이 덮어쓴다 (If-None-Match를 붙이지 않는다)', async () => {
    const { fetchImpl, calls } = scriptedFetch([{ status: 204, headers: { etag: '"v3"' } }])
    await new CalDavClient(CREDS, fetchImpl).updateEvent('/c/haru-1.ics', 'ICS', null)
    expect(calls[0].headers['If-None-Match']).toBeUndefined()
    expect(calls[0].headers['If-Match']).toBeUndefined()
  })

  it('412(선점됨)는 conflict로 구분해 던진다', async () => {
    const { fetchImpl } = scriptedFetch([{ status: 412 }])
    await expect(
      new CalDavClient(CREDS, fetchImpl).updateEvent('/c/haru-1.ics', 'ICS', '"stale"')
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  describe('probeEvent — 충돌에서 빠져나오는 길', () => {
    const PROBE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
<response><href>/c/haru-1.ics</href><propstat><prop>
  <getetag>"server-v9"</getetag>
  <C:calendar-data>BEGIN:VCALENDAR&#13;
BEGIN:VEVENT&#13;
UID:greenday-t1@supaicy.github.io&#13;
DTSTART:20260803T030000Z&#13;
END:VEVENT&#13;
END:VCALENDAR</C:calendar-data>
</prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`

    it('서버의 현재 etag와 UID를 읽어 온다', async () => {
      const { fetchImpl, calls } = scriptedFetch([{ body: PROBE_XML }])
      const probe = await new CalDavClient(CREDS, fetchImpl).probeEvent('/c/haru-1.ics')
      expect(calls[0].method).toBe('PROPFIND')
      expect(calls[0].headers.Depth).toBe('0')
      expect(probe).toEqual({ etag: '"server-v9"', uid: 'greenday-t1@supaicy.github.io' })
    })

    it('그 사이 사라졌으면 null — 충돌이 아니라 다시 만들면 되는 상태다', async () => {
      const { fetchImpl } = scriptedFetch([{ status: 404 }])
      expect(await new CalDavClient(CREDS, fetchImpl).probeEvent('/c/haru-1.ics')).toBeNull()
    })

    it('404가 아닌 오류는 삼키지 않는다', async () => {
      const { fetchImpl } = scriptedFetch([{ status: 401 }])
      await expect(new CalDavClient(CREDS, fetchImpl).probeEvent('/c/haru-1.ics')).rejects.toMatchObject({
        code: 'unauthorized'
      })
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

describe('요청 상한', () => {
  /**
   * 연결은 받아 주고 **응답은 하지 않는** 서버(캡티브 포털, 패킷을 삼키는 방화벽,
   * 과부하된 자체 호스팅). init.signal이 없으면 이 promise는 영영 끝나지 않는다 —
   * 상한이 빠졌을 때 실제 코드가 하던 그대로다.
   */
  const stallingFetch =
    (seen: (AbortSignal | null | undefined)[]): FetchLike =>
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        seen.push(init.signal)
        const signal = init.signal
        if (!signal) return
        if (signal.aborted) return reject(signal.reason)
        signal.addEventListener('abort', () => reject(signal.reason))
      })

  afterEach(() => vi.restoreAllMocks())

  it('응답하지 않는 서버에 매달리지 않는다 — 상한 뒤 network로 접는다', async () => {
    // 30초를 실제로 기다릴 수는 없다. 요청한 값만 확인하고 타이머는 20ms로 줄인다.
    const real = AbortSignal.timeout.bind(AbortSignal)
    const asked: number[] = []
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      asked.push(ms)
      return real(20)
    })
    const seen: (AbortSignal | null | undefined)[] = []
    const client = new CalDavClient(CREDS, stallingFetch(seen))

    const settled = await Promise.race([
      client.discoverCalendars().then(
        () => 'resolved',
        (error: unknown) => error
      ),
      new Promise((resolve) => setTimeout(() => resolve('hung'), 500))
    ])

    // 'hung'이면 설정 패널의 "연결"·"지금 동기화"가 그 시간만큼 잠긴 채 남는다.
    // busy 해제가 await 뒤 finally에 있어서, 끝나지 않는 요청은 끝나지 않는 버튼이다.
    expect(settled, '상한이 없어 요청이 끝나지 않았다').not.toBe('hung')
    expect(settled).toBeInstanceOf(CalDavError)
    // 응답하지 않는 것은 **불통**이지 서버의 거부가 아니다.
    expect((settled as CalDavError).code).toBe('network')
    expect(seen[0], '요청에 AbortSignal이 실리지 않았다').toBeInstanceOf(AbortSignal)
    expect(asked).toEqual([30_000])
  })
})
