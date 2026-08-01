/**
 * iCalendar(RFC 5545) 직렬화/파싱 — 네트워크와 무관한 순수 함수만 둔다.
 *
 * 필요한 범위만 구현한다: haru의 할일 하나를 VEVENT 하나로 내보내고, 서버가 돌려준
 * VEVENT에서 우리가 쓰는 필드만 읽는다. 반복 규칙(RRULE)은 문자열 그대로 보존만 하고
 * 해석하지 않는다 — 해석은 이미 utils/recurrence가 우리 패턴 형식으로 하고 있다.
 */

export interface CalendarEvent {
  uid: string
  summary: string
  description: string
  /** 종일 일정이면 'YYYY-MM-DD', 시간이 있으면 UTC ISO 문자열 */
  start: string
  /** 종료. 종일이면 배타적(exclusive) 다음 날짜다 — RFC 5545 규정. */
  end: string
  allDay: boolean
  /** 서버가 준 값을 그대로 보존한다. 우리가 만들지는 않는다. */
  rrule: string | null
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
    `UID:${event.uid}`,
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
  // 완료 여부는 VEVENT에 표준 필드가 없다. Calendar.app이 무시하되 우리는 되읽을 수
  // 있도록 X- 속성으로 싣는다.
  lines.push(`X-HARU-COMPLETED:${event.completed ? 'TRUE' : 'FALSE'}`)
  lines.push('END:VEVENT', 'END:VCALENDAR')

  return lines.map(foldLine).join(CRLF) + CRLF
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
  let current: (Partial<CalendarEvent> & { allDay?: boolean }) | null = null

  for (const raw of unfoldLines(icsText)) {
    const line = parseLine(raw)
    if (!line) continue

    if (line.name === 'BEGIN' && line.value === 'VEVENT') {
      current = { rrule: null, lastModified: null, sequence: 0, completed: false, allDay: false }
      continue
    }
    if (!current) continue
    if (line.name === 'END' && line.value === 'VEVENT') {
      if (current.uid && current.start) {
        events.push({
          uid: current.uid,
          summary: current.summary ?? '',
          description: current.description ?? '',
          start: current.start,
          end: current.end ?? current.start,
          allDay: current.allDay ?? false,
          rrule: current.rrule ?? null,
          lastModified: current.lastModified ?? null,
          sequence: current.sequence ?? 0,
          completed: current.completed ?? false
        })
      }
      current = null
      continue
    }

    switch (line.name) {
      case 'UID':
        current.uid = line.value
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
