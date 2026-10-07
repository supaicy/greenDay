import { describe, it, expect } from 'vitest'
import { parseXml, findAll, findFirst, textOf, parseMultistatus } from './dav-xml'

describe('parseXml', () => {
  it('중첩 구조를 트리로 만든다', () => {
    const root = parseXml('<a><b><c>hi</c></b></a>')
    expect(root.children[0].name).toBe('a')
    expect(textOf(root, 'c')).toBe('hi')
  })

  it('네임스페이스 접두사를 무시한다 (서버마다 D:/d:/없음이 제각각)', () => {
    for (const xml of ['<D:href>/x/</D:href>', '<d:href>/x/</d:href>', '<href>/x/</href>']) {
      expect(textOf(parseXml(xml), 'href')).toBe('/x/')
    }
  })

  it('self-closing 태그를 연 상태로 두지 않는다', () => {
    const root = parseXml('<prop><calendar/><displayname>Work</displayname></prop>')
    expect(findFirst(root, 'calendar')).not.toBeNull()
    expect(textOf(root, 'displayname')).toBe('Work')
  })

  it('XML 선언·주석·DOCTYPE을 건너뛴다', () => {
    const root = parseXml('<?xml version="1.0"?><!-- note --><a>ok</a>')
    expect(textOf(root, 'a')).toBe('ok')
  })

  it('엔티티를 해석한다', () => {
    expect(textOf(parseXml('<a>Tom &amp; Jerry &lt;3</a>'), 'a')).toBe('Tom & Jerry <3')
    expect(textOf(parseXml('<a>&#54620;&#44397;</a>'), 'a')).toBe('한국')
    expect(textOf(parseXml('<a>&#xAC00;</a>'), 'a')).toBe('가')
  })

  it('CDATA 내용을 그대로 싣는다', () => {
    expect(textOf(parseXml('<a><![CDATA[<not-a-tag> & raw]]></a>'), 'a')).toBe('<not-a-tag> & raw')
  })

  it('닫는 태그가 빠져도 나머지를 계속 읽는다', () => {
    const root = parseXml('<multistatus><response><href>/a/</href></multistatus>')
    expect(textOf(root, 'href')).toBe('/a/')
  })

  it('같은 이름의 노드를 모두 찾는다', () => {
    const root = parseXml('<r><href>/a/</href><href>/b/</href></r>')
    expect(findAll(root, 'href').map((n) => n.text)).toEqual(['/a/', '/b/'])
  })
})

describe('parseMultistatus', () => {
  // iCloud가 principal 조회에 실제로 돌려주는 형태
  const PRINCIPAL = `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:">
  <response>
    <href>/</href>
    <propstat>
      <prop>
        <current-user-principal><href>/123456/principal/</href></current-user-principal>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`

  it('principal href를 뽑아낸다', () => {
    const [response] = parseMultistatus(PRINCIPAL)
    expect(response.href).toBe('/')
    expect(textOf(response.props.get('current-user-principal') ?? null, 'href')).toBe('/123456/principal/')
  })

  it('404 propstat의 속성은 버린다', () => {
    const xml = `<multistatus xmlns="DAV:">
      <response>
        <href>/cal/</href>
        <propstat>
          <prop><displayname>Work</displayname></prop>
          <status>HTTP/1.1 200 OK</status>
        </propstat>
        <propstat>
          <prop><calendar-color/></prop>
          <status>HTTP/1.1 404 Not Found</status>
        </propstat>
      </response>
    </multistatus>`
    const [response] = parseMultistatus(xml)
    expect(textOf(response.props.get('displayname') ?? null)).toBe('Work')
    expect(response.props.has('calendar-color')).toBe(false)
  })

  it('propstat 없이 prop만 보내는 서버도 받아들인다', () => {
    const xml = `<multistatus xmlns="DAV:">
      <response><href>/cal/</href><prop><displayname>Home</displayname></prop></response>
    </multistatus>`
    const [response] = parseMultistatus(xml)
    expect(textOf(response.props.get('displayname') ?? null)).toBe('Home')
  })

  it('캘린더 목록에서 VEVENT를 지원하는 컬렉션만 골라낼 수 있다', () => {
    const xml = `<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
      <response>
        <href>/123/calendars/work/</href>
        <propstat>
          <prop>
            <displayname>Work</displayname>
            <resourcetype><collection/><C:calendar/></resourcetype>
            <C:supported-calendar-component-set>
              <C:comp name="VEVENT"/>
            </C:supported-calendar-component-set>
          </prop>
          <status>HTTP/1.1 200 OK</status>
        </propstat>
      </response>
      <response>
        <href>/123/calendars/reminders/</href>
        <propstat>
          <prop>
            <displayname>Reminders</displayname>
            <resourcetype><collection/><C:calendar/></resourcetype>
            <C:supported-calendar-component-set>
              <C:comp name="VTODO"/>
            </C:supported-calendar-component-set>
          </prop>
          <status>HTTP/1.1 200 OK</status>
        </propstat>
      </response>
      <response>
        <href>/123/calendars/</href>
        <propstat>
          <prop><resourcetype><collection/></resourcetype></prop>
          <status>HTTP/1.1 200 OK</status>
        </propstat>
      </response>
    </multistatus>`
    const responses = parseMultistatus(xml)
    expect(responses).toHaveLength(3)
    const calendars = responses.filter((r) => {
      const type = r.props.get('resourcetype')
      return type ? findAll(type, 'calendar').length > 0 : false
    })
    expect(calendars.map((c) => textOf(c.props.get('displayname') ?? null))).toEqual(['Work', 'Reminders'])
  })
})
