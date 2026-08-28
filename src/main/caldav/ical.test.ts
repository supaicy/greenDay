import { describe, it, expect } from 'vitest'
import {
  escapeText,
  unescapeText,
  foldLine,
  unfoldLines,
  toUtcStamp,
  serializeEvent,
  parseEvents,
  type CalendarEvent
} from './ical'

const NOW = '2026-08-02T01:00:00.000Z'

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    uid: 'greenday-1@supaicy.github.io',
    summary: '장보기',
    description: '',
    start: '2026-08-03T15:00:00.000Z',
    end: '2026-08-03T16:00:00.000Z',
    allDay: false,
    rrule: null,
    lastModified: null,
    sequence: 0,
    completed: false,
    ...overrides
  }
}

describe('escapeText', () => {
  it('백슬래시를 먼저 이스케이프한다 (순서가 뒤바뀌면 이중 이스케이프된다)', () => {
    expect(escapeText('a\\b')).toBe('a\\\\b')
    expect(escapeText('a;b,c')).toBe('a\\;b\\,c')
    expect(escapeText('a\nb')).toBe('a\\nb')
    expect(escapeText('a\r\nb')).toBe('a\\nb')
  })

  it('왕복 변환이 원문을 보존한다', () => {
    for (const s of ['a\\b', 'a;b,c', 'line1\nline2', '회의; 준비, 자료\\정리']) {
      expect(unescapeText(escapeText(s))).toBe(s)
    }
  })
})

describe('foldLine', () => {
  it('75옥텟 이하는 그대로 둔다', () => {
    expect(foldLine('SUMMARY:short')).toBe('SUMMARY:short')
  })

  it('긴 줄을 CRLF+공백으로 접는다', () => {
    const folded = foldLine('SUMMARY:' + 'a'.repeat(200))
    expect(folded).toContain('\r\n ')
    for (const part of folded.split('\r\n ')) {
      expect(Buffer.from(part, 'utf-8').length).toBeLessThanOrEqual(75)
    }
  })

  it('한글이 코드포인트 중간에서 잘리지 않는다', () => {
    const folded = foldLine('SUMMARY:' + '가'.repeat(100))
    // 잘린 조각이 유효한 UTF-8이면 대체 문자(U+FFFD)가 생기지 않는다.
    expect(folded).not.toContain('�')
    expect(unfoldLines(folded).join('')).toBe('SUMMARY:' + '가'.repeat(100))
  })

  it('접은 줄은 다시 펼치면 원문과 같다', () => {
    const original = 'DESCRIPTION:' + '내일 회의 준비 자료 정리하기 '.repeat(10)
    expect(unfoldLines(foldLine(original)).join('')).toBe(original)
  })
})

describe('toUtcStamp', () => {
  it('UTC 기준으로 포맷한다', () => {
    expect(toUtcStamp('2026-08-03T15:00:00.000Z')).toBe('20260803T150000Z')
    expect(toUtcStamp('2026-01-01T00:00:00.000Z')).toBe('20260101T000000Z')
  })
})

describe('serializeEvent', () => {
  it('필수 속성을 모두 낸다', () => {
    const ics = serializeEvent(makeEvent(), NOW)
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('UID:greenday-1@supaicy.github.io')
    expect(ics).toContain('DTSTAMP:20260802T010000Z')
    expect(ics).toContain('DTSTART:20260803T150000Z')
    expect(ics).toContain('DTEND:20260803T160000Z')
    expect(ics).toContain('SUMMARY:장보기')
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })

  it('줄 구분자는 CRLF다', () => {
    const ics = serializeEvent(makeEvent(), NOW)
    expect(ics.split('\r\n').length).toBeGreaterThan(5)
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n')
  })

  it('종일 일정은 VALUE=DATE로 낸다', () => {
    const ics = serializeEvent(makeEvent({ allDay: true, start: '2026-08-03', end: '2026-08-04' }), NOW)
    expect(ics).toContain('DTSTART;VALUE=DATE:20260803')
    expect(ics).toContain('DTEND;VALUE=DATE:20260804')
  })

  it('빈 설명은 아예 내보내지 않는다', () => {
    expect(serializeEvent(makeEvent({ description: '' }), NOW)).not.toContain('DESCRIPTION')
    expect(serializeEvent(makeEvent({ description: '메모' }), NOW)).toContain('DESCRIPTION:메모')
  })

  /**
   * M4 — UID는 task id에서 만들어지고, 그 id가 어디까지 검증되는지는 이 파일이
   * 알 수 없다. 이스케이프하지 않으면 여기가 사용자의 캘린더에 임의 속성을
   * 심는 유일한 통로가 된다.
   */
  describe('UID 이스케이프', () => {
    it('개행이 든 UID가 새 속성 줄을 만들지 않는다', () => {
      const ics = serializeEvent(
        makeEvent({ uid: 'greenday-x\r\nATTENDEE;CN=Mallory:mailto:m@evil.example' }),
        NOW
      )
      expect(ics).not.toContain('\r\nATTENDEE')
      expect(ics).toContain('ATTENDEE')  // 값 안에 문자열로는 남는다
      expect(ics).toContain('\\n')       // 개행이 escapeText로 접혔다
      // VEVENT의 속성 이름만 뽑았을 때 우리가 쓴 것만 있어야 한다.
      const names = ics
        .split('\r\n')
        .filter((l) => l && !l.startsWith(' '))
        .map((l) => l.split(/[;:]/)[0])
      expect(names).not.toContain('ATTENDEE')
    })

    it('세미콜론·쉼표가 든 UID도 파라미터로 새지 않는다', () => {
      const ics = serializeEvent(makeEvent({ uid: 'a;TZID=X,b' }), NOW)
      expect(ics).toContain('UID:a\\;TZID=X\\,b')
    })

    it('이스케이프한 UID는 그대로 되읽힌다 (충돌 복구의 UID 대조가 여기 기댄다)', () => {
      const uid = 'greenday-a;b,c\nd'
      const [parsed] = parseEvents(serializeEvent(makeEvent({ uid }), NOW))
      expect(parsed.uid).toBe(uid)
    })
  })
})

describe('parseEvents', () => {
  it('직렬화한 것을 그대로 되읽는다', () => {
    const original = makeEvent({ description: '준비물; 목록', sequence: 3, completed: true })
    const [parsed] = parseEvents(serializeEvent(original, NOW))
    expect(parsed.uid).toBe(original.uid)
    expect(parsed.summary).toBe(original.summary)
    expect(parsed.description).toBe(original.description)
    expect(parsed.start).toBe(original.start)
    expect(parsed.end).toBe(original.end)
    expect(parsed.sequence).toBe(3)
    expect(parsed.completed).toBe(true)
  })

  it('종일 일정을 왕복해도 날짜가 유지된다', () => {
    const original = makeEvent({ allDay: true, start: '2026-08-03', end: '2026-08-04' })
    const [parsed] = parseEvents(serializeEvent(original, NOW))
    expect(parsed.allDay).toBe(true)
    expect(parsed.start).toBe('2026-08-03')
    expect(parsed.end).toBe('2026-08-04')
  })

  it('한 응답에 담긴 여러 VEVENT를 모두 읽는다', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:a',
      'SUMMARY:First',
      'DTSTART:20260803T150000Z',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:b',
      'SUMMARY:Second',
      'DTSTART:20260804T150000Z',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')
    const events = parseEvents(ics)
    expect(events.map((e) => e.uid)).toEqual(['a', 'b'])
  })

  it('UID나 DTSTART가 없는 항목은 버린다', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:no uid',
      'DTSTART:20260803T150000Z',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:no-start',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')
    expect(parseEvents(ics)).toEqual([])
  })

  it('모르는 속성은 조용히 무시한다', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:a',
      'DTSTART:20260803T150000Z',
      'ATTENDEE;CN=Someone:mailto:a@b.c',
      'X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')
    expect(parseEvents(ics)).toHaveLength(1)
  })

  it('접힌 줄을 펼쳐서 읽는다', () => {
    const long = '회의 준비 자료 정리 '.repeat(10).trim()
    const [parsed] = parseEvents(serializeEvent(makeEvent({ summary: long }), NOW))
    expect(parsed.summary).toBe(long)
  })

  it('RRULE은 해석하지 않고 문자열로 보존한다', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:a',
      'DTSTART:20260803T150000Z',
      'RRULE:FREQ=WEEKLY;BYDAY=MO,WE',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')
    expect(parseEvents(ics)[0].rrule).toBe('FREQ=WEEKLY;BYDAY=MO,WE')
  })

  it('VEVENT 밖의 속성에 영향을 받지 않는다', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'PRODID:-//Apple Inc.//macOS 15//EN',
      'BEGIN:VTIMEZONE',
      'TZID:Asia/Seoul',
      'END:VTIMEZONE',
      'BEGIN:VEVENT',
      'UID:a',
      'SUMMARY:real',
      'DTSTART:20260803T150000Z',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')
    const events = parseEvents(ics)
    expect(events).toHaveLength(1)
    expect(events[0].summary).toBe('real')
  })
})
