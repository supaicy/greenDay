/**
 * iCalendar(RFC 5545) 직렬화/파싱 — 네트워크와 무관한 순수 함수만 둔다.
 *
 * 필요한 범위만 구현한다: haru의 할일 하나를 VEVENT 하나로 내보내고, 서버가 돌려준
 * VEVENT에서 우리가 쓰는 필드만 읽는다. 반복 규칙(RRULE)은 문자열 그대로 보존만 하고
 * 해석하지 않는다 — 해석은 이미 utils/recurrence가 우리 패턴 형식으로 하고 있다.
 */

/**
 * 반복 회차 하나를 시리즈와 다르게 잡은 것 — RFC 5545의 RECURRENCE-ID 예외.
 *
 * 사용자가 이번 주 회차만 다른 시간으로 옮기거나 길이를 바꾸면 여기로 온다.
 * 예전에는 이 개념 자체가 내보내기에 없어서, 옮긴 회차가 캘린더에 반영되지 않고
 * 로컬과 조용히 갈라졌다.
 */
export interface EventOverride {
  /** 원래 회차를 가리키는 값. 종일이면 'YYYY-MM-DD', 아니면 UTC ISO. */
  recurrenceId: string
  start: string
  end: string
}

export interface CalendarEvent {
  uid: string
  summary: string
  description: string
  /** 종일 일정이면 'YYYY-MM-DD', 시간이 있으면 UTC ISO 문자열 */
  start: string
  /** 종료. 종일이면 배타적(exclusive) 다음 날짜다 — RFC 5545 규정. */
  end: string
  allDay: boolean
  /** 반복 규칙(접두사 없는 값). 서버가 준 값도 여기 보존된다. */
  rrule: string | null
  /**
   * 규칙에 없는 추가 발생일. 두 자리에서 온다 —
   * (a) 앱이 말일로 당기는데 RRULE은 건너뛰는 달(`monthly:31`의 2월),
   * (b) 회차를 원래 발생일이 아닌 날짜로 옮긴 경우.
   * 종일이면 'YYYY-MM-DD', 아니면 UTC ISO.
   */
  rdates: string[]
  /** 규칙에는 있지만 사용자가 없앤 회차. 값 형식은 rdates와 같다. */
  exdates: string[]
  /** 시리즈와 다르게 잡은 회차들. */
  overrides: EventOverride[]
  /** 마지막 수정 시각(UTC ISO). 서버 값이 없으면 null. */
  lastModified: string | null
  /** 갱신할 때마다 올린다. 일부 서버는 이 값이 줄면 거부한다. */
  sequence: number
  completed: boolean
}

const CRLF = '\r\n'

/** TEXT 값 이스케이프 (RFC 5545 §3.3.11). 순서 중요 — 백슬래시를 먼저 처리한다. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\n|\r/g, '\\n')
}

export function unescapeText(value: string): string {
  let out = ''
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== '\\') {
      out += value[i]
      continue
    }
    const next = value[++i]
    if (next === 'n' || next === 'N') out += '\n'
    else if (next === undefined) out += '\\'
    else out += next
  }
  return out
}

/**
 * 75 옥텟에서 줄을 접는다(RFC 5545 §3.1). 옥텟 기준이라 한글처럼 멀티바이트 문자가
 * 섞이면 문자 수로 자르면 안 된다 — 코드포인트 중간에서 잘리면 서버가 파싱에 실패한다.
 */
export function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf-8')
  if (bytes.length <= 75) return line

  const parts: string[] = []
  let start = 0
  let limit = 75 // 첫 줄은 75, 이어지는 줄은 앞 공백 1칸을 빼고 74
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length)
    // UTF-8 연속 바이트(10xxxxxx) 중간이면 문자 경계까지 뒤로 물린다.
    while (end > start && end < bytes.length && (bytes[end] & 0b1100_0000) === 0b1000_0000) end--
    parts.push(bytes.subarray(start, end).toString('utf-8'))
    start = end
    limit = 74
  }
  return parts.join(`${CRLF} `)
}

/** 접힌 줄을 되돌린다. CRLF/LF 뒤에 오는 공백 또는 탭 한 칸이 이어짐 표시다. */
export function unfoldLines(text: string): string[] {
  return text.replace(/\r\n[ \t]|\n[ \t]/g, '').split(/\r\n|\n|\r/)
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** UTC 타임스탬프 형식 20260803T150000Z */
export function toUtcStamp(iso: string): string {
  const d = new Date(iso)
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  )
}

/** 종일 날짜 형식 20260803 */
export function toDateStamp(yyyyMmDd: string): string {
  return yyyyMmDd.replace(/-/g, '')
}

/** 쉼표로 이어진 RDATE/EXDATE 값들. 읽지 못한 항목은 버린다. */
function parseStampList(value: string): string[] {
  const out: string[] = []
  for (const part of value.split(',')) {
    const parsed = parseStamp(part.trim())
    if (parsed) out.push(parsed)
  }
  return out
}

function parseStamp(value: string): string | null {
  const utc = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/)
  if (utc) {
    const [, y, mo, d, h, mi, s] = utc
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)).toISOString()
  }
  // 타임존이 없는 로컬 시각. 서버가 TZID를 붙여 보내는 경우가 있는데, 우리는
  // 실행 중인 기기의 로컬 시간으로 읽는다(대부분 사용자의 캘린더 타임존과 같다).
  const local = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/)
  if (local) {
    const [, y, mo, d, h, mi, s] = local
    return new Date(+y, +mo - 1, +d, +h, +mi, +s).toISOString()
  }
  const dateOnly = value.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (dateOnly) return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`
  return null
}

export function serializeEvent(event: CalendarEvent, now: string): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//haru//haru calendar sync//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    // **UID도 TEXT다(RFC 5545 §3.8.4.7).** 이스케이프하지 않으면 여기가 유일한
    // 속성 주입 자리가 된다: UID는 task id에서 만들어지는데, 그 id에 개행이나
    // 세미콜론이 섞이면 우리가 쓰지 않은 iCalendar 속성이 사용자의 캘린더에
    // 그대로 실린다(`\r\nATTENDEE;CN=...` 한 줄이면 된다). SUMMARY·DESCRIPTION은
    // 처음부터 escapeText를 지났는데 UID만 날것이었다.
    //
    // 읽는 쪽(`parseEvents`)도 같이 `unescapeText`한다 — 한쪽만 바꾸면 특수문자가
    // 든 UID가 왕복하며 달라져, 충돌 복구의 UID 대조가 우리 일정을 남의 것으로 본다.
    `UID:${escapeText(event.uid)}`,
    `DTSTAMP:${toUtcStamp(now)}`,
    `SEQUENCE:${event.sequence}`,
    `SUMMARY:${escapeText(event.summary)}`
  ]

  if (event.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${toDateStamp(event.start)}`)
    lines.push(`DTEND;VALUE=DATE:${toDateStamp(event.end)}`)
  } else {
    lines.push(`DTSTART:${toUtcStamp(event.start)}`)
    lines.push(`DTEND:${toUtcStamp(event.end)}`)
  }

  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`)
  if (event.rrule) lines.push(`RRULE:${event.rrule}`)
  // RDATE/EXDATE의 값 형식은 **DTSTART와 같아야 한다**(RFC 5545 §3.8.5.2/§3.8.5.1).
  // 종일 일정에 UTC 스탬프를 섞으면 서버가 통째로 거부하거나 회차를 엉뚱한 날에 놓는다.
  if (event.rdates.length > 0) lines.push(stampList('RDATE', event.rdates, event.allDay))
  if (event.exdates.length > 0) lines.push(stampList('EXDATE', event.exdates, event.allDay))
  // 완료 여부는 VEVENT에 표준 필드가 없다. Calendar.app이 무시하되 우리는 되읽을 수
  // 있도록 X- 속성으로 싣는다.
  lines.push(`X-HARU-COMPLETED:${event.completed ? 'TRUE' : 'FALSE'}`)
  lines.push('END:VEVENT')

  // 시리즈와 다르게 잡은 회차들. **같은 UID로 같은 리소스 안에 담는다** — 그게
  // RFC 5545가 예외를 표현하는 방식이고, 별도 리소스로 쪼개면 서버가 둘을 다른
  // 일정으로 본다. 회차 예외는 반복하지 않으므로 RRULE을 달지 않는다.
  for (const override of event.overrides) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeText(event.uid)}`,
      `DTSTAMP:${toUtcStamp(now)}`,
      `SEQUENCE:${event.sequence}`,
      `SUMMARY:${escapeText(event.summary)}`,
      event.allDay
        ? `RECURRENCE-ID;VALUE=DATE:${toDateStamp(override.recurrenceId)}`
        : `RECURRENCE-ID:${toUtcStamp(override.recurrenceId)}`,
      // 옮긴 회차는 언제나 시각이 있다 — 시간 블록을 끌어 놓아야 생기는 값이다.
      `DTSTART:${toUtcStamp(override.start)}`,
      `DTEND:${toUtcStamp(override.end)}`
    )
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`)
    lines.push(`X-HARU-COMPLETED:${event.completed ? 'TRUE' : 'FALSE'}`)
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')

  return lines.map(foldLine).join(CRLF) + CRLF
}

/**
 * RDATE/EXDATE 한 줄. 여러 값은 쉼표로 잇는다(RFC 5545가 허용하는 형태다).
 *
 * 구글 쪽 `recurrence[]`도 같은 문자열을 쓰므로 export한다 — 두 곳에서 따로 만들면
 * 한쪽만 종일 형식을 틀리는 종류의 어긋남이 생긴다.
 */
export function stampList(name: 'RDATE' | 'EXDATE', values: string[], allDay: boolean): string {
  return allDay
    ? `${name};VALUE=DATE:${values.map(toDateStamp).join(',')}`
    : `${name}:${values.map(toUtcStamp).join(',')}`
}

interface RawLine {
  name: string
  params: Record<string, string>
  value: string
}

function parseLine(line: string): RawLine | null {
  const colon = line.indexOf(':')
  if (colon < 0) return null
  const head = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const [name, ...paramParts] = head.split(';')
  const params: Record<string, string> = {}
  for (const part of paramParts) {
    const eq = part.indexOf('=')
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1)
  }
  return { name: name.toUpperCase(), params, value }
}

/**
 * VCALENDAR 본문에서 VEVENT를 모두 읽는다. 알 수 없는 속성은 조용히 버린다 —
 * 서버는 우리가 모르는 필드를 얼마든지 붙여 보낼 수 있다.
 */
export function parseEvents(icsText: string): CalendarEvent[] {
  const events: CalendarEvent[] = []
  let current: (Partial<CalendarEvent> & { allDay?: boolean; recurrenceId?: string }) | null = null

  for (const raw of unfoldLines(icsText)) {
    const line = parseLine(raw)
    if (!line) continue

    if (line.name === 'BEGIN' && line.value === 'VEVENT') {
      current = {
        rrule: null,
        rdates: [],
        exdates: [],
        overrides: [],
        lastModified: null,
        sequence: 0,
        completed: false,
        allDay: false
      }
      continue
    }
    if (!current) continue
    if (line.name === 'END' && line.value === 'VEVENT') {
      if (current.uid && current.start) {
        // **RECURRENCE-ID가 있으면 독립된 일정이 아니라 앞선 시리즈의 예외다.**
        // 별개 이벤트로 세면 같은 UID가 둘이 되어, 동기화가 그 둘을 서로
        // 덮어쓰는 두 리소스로 취급한다.
        const parent = current.recurrenceId ? events.find((e) => e.uid === current?.uid) : undefined
        if (parent && current.recurrenceId) {
          parent.overrides.push({
            recurrenceId: current.recurrenceId,
            start: current.start,
            end: current.end ?? current.start
          })
        } else {
          events.push({
            uid: current.uid,
            summary: current.summary ?? '',
            description: current.description ?? '',
            start: current.start,
            end: current.end ?? current.start,
            allDay: current.allDay ?? false,
            rrule: current.rrule ?? null,
            rdates: current.rdates ?? [],
            exdates: current.exdates ?? [],
            overrides: current.overrides ?? [],
            lastModified: current.lastModified ?? null,
            sequence: current.sequence ?? 0,
            completed: current.completed ?? false
          })
        }
      }
      current = null
      continue
    }

    switch (line.name) {
      case 'UID':
        // 쓰는 쪽이 escapeText를 지나므로 여기서 되돌린다 — 대칭이 아니면
        // 왕복한 UID가 원본과 달라진다(위 serializeEvent 주석 참고).
        current.uid = unescapeText(line.value)
        break
      case 'SUMMARY':
        current.summary = unescapeText(line.value)
        break
      case 'DESCRIPTION':
        current.description = unescapeText(line.value)
        break
      case 'DTSTART': {
        const parsed = parseStamp(line.value)
        if (parsed) {
          current.start = parsed
          current.allDay = line.params.VALUE === 'DATE'
        }
        break
      }
      case 'DTEND': {
        const parsed = parseStamp(line.value)
        if (parsed) current.end = parsed
        break
      }
      case 'RRULE':
        current.rrule = line.value
        break
      // RDATE/EXDATE는 한 줄에 쉼표로 여러 값이 올 수 있고, 줄 자체가 여러 번
      // 나올 수도 있다(RFC 5545). 둘 다 받아 이어 붙인다.
      case 'RDATE':
        current.rdates = [...(current.rdates ?? []), ...parseStampList(line.value)]
        break
      case 'EXDATE':
        current.exdates = [...(current.exdates ?? []), ...parseStampList(line.value)]
        break
      case 'RECURRENCE-ID': {
        const parsed = parseStamp(line.value)
        if (parsed) current.recurrenceId = parsed
        break
      }
      case 'LAST-MODIFIED':
        current.lastModified = parseStamp(line.value)
        break
      case 'SEQUENCE':
        current.sequence = Number.parseInt(line.value, 10) || 0
        break
      case 'X-HARU-COMPLETED':
        current.completed = line.value.toUpperCase() === 'TRUE'
        break
    }
  }

  return events
}
