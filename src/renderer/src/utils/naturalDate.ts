import {
  addDays,
  addWeeks,
  addMonths,
  nextMonday,
  nextTuesday,
  nextWednesday,
  nextThursday,
  nextFriday,
  nextSaturday,
  nextSunday,
  startOfDay,
  format
} from 'date-fns'
import i18n from '../i18n'

/**
 * **사용자 입력으로 조회하는 표는 프로토타입이 없어야 한다.**
 *
 * 객체 리터럴은 `Object.prototype`을 상속하므로 `MAP['constructor']`가
 * `undefined`가 아니라 **함수**를 돌려준다. 아래 조회들은 전부
 * `!== undefined`로 가드한 뒤 그 값을 `NEXT_DAY_FN`의 인덱스로 쓰는데,
 * 함수를 인덱스로 넣으면 `undefined(today)`가 되어 TypeError가 난다.
 *
 * 그 예외는 AddTask·QuickAdd의 `useEffect` 안에서 **글자를 칠 때마다** 터지고,
 * 렌더러에 ErrorBoundary가 생기기 전까지는 앱 전체를 언마운트시켰다.
 * 즉 "constructor"로 시작하는 할일을 적으려던 사용자는 빈 창을 보게 됐다.
 * (`toString`·`valueOf`·`__proto__` 등 12개 키가 모두 같았다.)
 *
 * 호출처마다 `Object.hasOwn`을 붙이는 대신 표를 한 번 막는다 — 나중에 조회를
 * 한 줄 더 추가하는 사람이 가드를 잊어도 안전하다.
 */
function lookupTable(entries: Record<string, number>): Record<string, number> {
  return Object.assign(Object.create(null) as Record<string, number>, entries)
}

const DAY_MAP = lookupTable({
  일요일: 0,
  일: 0,
  월요일: 1,
  월: 1,
  화요일: 2,
  화: 2,
  수요일: 3,
  수: 3,
  목요일: 4,
  목: 4,
  금요일: 5,
  금: 5,
  토요일: 6,
  토: 6
})

// 영어 요일. 한국어 표와 나란히 두고 두 언어를 항상 같이 인식한다 — UI 언어를
// 영어로 두고도 "내일"이라 적는 사용자가 있고, 그 반대도 있다.
const EN_DAY_MAP = lookupTable({
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6
})

const EN_MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec'
]

const NEXT_DAY_FN = [nextSunday, nextMonday, nextTuesday, nextWednesday, nextThursday, nextFriday, nextSaturday]

export interface ParsedDateTime {
  date: string // "YYYY-MM-DD"
  time: string | null // "HH:MM" 또는 null
  consumed: number // 소비된 단어 수
}

/**
 * 시간 표현을 파싱하여 "HH:MM" 형식으로 반환
 * 지원 패턴:
 *   "14시50분", "14시 50분", "14시", "3시30분"
 *   "오전9시", "오후3시30분", "오전 11시 30분"
 *   "14:50", "9:30"
 */
function parseNaturalTime(tokens: string[]): { time: string; consumed: number } | null {
  if (tokens.length === 0) return null
  const joined = tokens.slice(0, 3).join(' ')

  // "오전/오후 N시 M분" or "오전/오후 N시M분" or "오전N시M분"
  const ampmFull = joined.match(/^(오전|오후)\s*(\d{1,2})시\s*(\d{1,2})분?/)
  if (ampmFull) {
    let h = parseInt(ampmFull[2], 10)
    const m = parseInt(ampmFull[3], 10)
    if (h > 12 || m > 59) return null
    if (ampmFull[1] === '오후' && h < 12) h += 12
    if (ampmFull[1] === '오전' && h === 12) h = 0
    const consumed = countConsumed(tokens, ampmFull[0])
    return { time: fmtTime(h, m), consumed }
  }

  // "오전/오후 N시"
  const ampmHour = joined.match(/^(오전|오후)\s*(\d{1,2})시/)
  if (ampmHour) {
    let h = parseInt(ampmHour[2], 10)
    if (h > 12) return null
    if (ampmHour[1] === '오후' && h < 12) h += 12
    if (ampmHour[1] === '오전' && h === 12) h = 0
    const consumed = countConsumed(tokens, ampmHour[0])
    return { time: fmtTime(h, 0), consumed }
  }

  // "N시M분" or "N시 M분"
  const hourMin = joined.match(/^(\d{1,2})시\s*(\d{1,2})분?/)
  if (hourMin) {
    const h = parseInt(hourMin[1], 10)
    const m = parseInt(hourMin[2], 10)
    if (h > 23 || m > 59) return null
    const consumed = countConsumed(tokens, hourMin[0])
    return { time: fmtTime(h, m), consumed }
  }

  // "N시"
  const hourOnly = joined.match(/^(\d{1,2})시/)
  if (hourOnly) {
    const h = parseInt(hourOnly[1], 10)
    if (h > 23) return null
    const consumed = countConsumed(tokens, hourOnly[0])
    return { time: fmtTime(h, 0), consumed }
  }

  // 영어: "3pm", "3 pm", "3:30 pm", "at 5pm".
  // 아래 "14:50" 분기보다 먼저 봐야 한다 — "3:30 pm"이 24시간제로 03:30이 되면 안 된다.
  const hasAt = /^at\s+/i.test(joined)
  const en = joined.toLowerCase().replace(/^at\s+/, '')
  const ampmEn = en.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/)
  if (ampmEn) {
    let h = parseInt(ampmEn[1], 10)
    const m = ampmEn[2] ? parseInt(ampmEn[2], 10) : 0
    if (h >= 1 && h <= 12 && m <= 59) {
      if (ampmEn[3] === 'pm' && h < 12) h += 12
      if (ampmEn[3] === 'am' && h === 12) h = 0
      return { time: fmtTime(h, m), consumed: countConsumed(tokens, (hasAt ? 'at' : '') + ampmEn[0]) }
    }
  }

  // "14:50", "9:30" — 앞에 "at"이 붙어도 받는다.
  const colonTime = (hasAt ? tokens[1] : tokens[0])?.match(/^(\d{1,2}):(\d{2})$/)
  if (colonTime) {
    const h = parseInt(colonTime[1], 10)
    const m = parseInt(colonTime[2], 10)
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return { time: fmtTime(h, m), consumed: hasAt ? 2 : 1 }
    }
  }

  return null
}

/** 매칭된 텍스트가 tokens에서 몇 개의 단어를 소비하는지 계산 */
function countConsumed(tokens: string[], matched: string): number {
  let count = 0
  let len = 0
  for (const tok of tokens) {
    if (len >= matched.replace(/\s+/g, '').length) break
    len += tok.replace(/\s+/g, '').length
    count++
  }
  return Math.max(1, count)
}

function fmtTime(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function parseNaturalDate(input: string): string | null {
  const result = parseNaturalDateTime(input)
  return result ? result.date : null
}

/**
 * 자연어 입력에서 날짜와 시간을 모두 파싱
 * "내일 14시50분" → { date: "2026-03-17", time: "14:50", consumed: 2 }
 * "오늘 오후3시" → { date: "2026-03-16", time: "15:00", consumed: 2 }
 * "내일" → { date: "2026-03-17", time: null, consumed: 1 }
 */
export function parseNaturalDateTime(input: string): ParsedDateTime | null {
  const tokens = input.trim().split(/\s+/)
  if (tokens.length === 0) return null

  const today = startOfDay(new Date())

  // 먼저 날짜 부분을 파싱 (1~N개 토큰 시도)
  let dateStr: string | null = null
  let dateConsumed = 0

  // 여러 토큰으로 된 날짜 표현 시도 (예: "다음주 월요일", "이번 주 금요일")
  for (let i = Math.min(tokens.length, 3); i >= 1; i--) {
    const candidate = tokens.slice(0, i).join(' ')
    const parsed = parseDateExpression(candidate, today)
    if (parsed) {
      dateStr = parsed
      dateConsumed = i
      break
    }
  }

  // 붙여쓰기 처리: "내일14시50분" → 첫 토큰에서 날짜+시간을 분리.
  // (영어는 단어를 붙여 쓰지 않으므로 한국어 키워드만 본다.)
  if (!dateStr && tokens.length > 0) {
    const first = tokens[0]
    const dateKeywords = ['오늘', '내일', '모레', '글피']
    for (const kw of dateKeywords) {
      if (first.startsWith(kw) && first.length > kw.length) {
        const parsed = parseDateExpression(kw, today)
        if (parsed) {
          dateStr = parsed
          dateConsumed = 0 // 토큰 자체는 소비하지 않고 아래서 시간 파싱
          // 첫 토큰에서 날짜 키워드를 제거하고 나머지를 시간으로 시도
          const rest = first.slice(kw.length)
          const timeParsed = parseNaturalTime([rest, ...tokens.slice(1)])
          if (timeParsed) {
            // 시간 부분이 첫 토큰 안에 있으므로 consumed 계산
            const _restLen = rest.replace(/\s+/g, '').length
            let timeTokens = 0
            let consumed = 0
            // rest가 첫 토큰의 나머지이므로 첫 토큰 = 1개 소비
            const restTokens = [rest, ...tokens.slice(1)]
            for (const _tok of restTokens) {
              if (consumed >= timeParsed.consumed) break
              consumed++
              timeTokens++
            }
            // 첫 토큰(날짜+시간)은 1개로 카운트, 추가 토큰은 시간이 소비한 만큼
            const totalConsumed = 1 + (timeTokens > 1 ? timeTokens - 1 : 0)
            return { date: dateStr, time: timeParsed.time, consumed: totalConsumed }
          }
          // 시간 파싱 안 되면 날짜만 (첫 토큰 전체를 소비)
          return { date: dateStr, time: null, consumed: 1 }
        }
      }
    }
  }

  if (!dateStr) return null

  // 날짜 뒤 남은 토큰에서 시간 파싱 시도
  const remaining = tokens.slice(dateConsumed)
  const timeParsed = parseNaturalTime(remaining)

  return {
    date: dateStr,
    time: timeParsed ? timeParsed.time : null,
    consumed: dateConsumed + (timeParsed ? timeParsed.consumed : 0)
  }
}

/** 날짜 표현만 파싱 (기존 parseNaturalDate 로직) */
function parseDateExpression(text: string, today: Date): string | null {
  if (/^오늘$/.test(text)) return fmt(today)
  if (/^내일$/.test(text)) return fmt(addDays(today, 1))
  if (/^모레$/.test(text)) return fmt(addDays(today, 2))
  if (/^글피$/.test(text)) return fmt(addDays(today, 3))

  // "N일 후", "N일후", "N일 뒤"
  const daysLater = text.match(/^(\d+)\s*일\s*(후|뒤)$/)
  if (daysLater) return fmt(addDays(today, parseInt(daysLater[1], 10)))

  // "N주 후"
  const weeksLater = text.match(/^(\d+)\s*주\s*(후|뒤)$/)
  if (weeksLater) return fmt(addWeeks(today, parseInt(weeksLater[1], 10)))

  // "N개월 후"
  const monthsLater = text.match(/^(\d+)\s*개?월\s*(후|뒤)$/)
  if (monthsLater) return fmt(addMonths(today, parseInt(monthsLater[1], 10)))

  // "다음주", "다음 주"
  if (/^다음\s*주$/.test(text)) return fmt(nextMonday(today))

  // "다음주 월요일", "다음 주 금요일"
  const nextWeekDay = text.match(/^다음\s*주\s*(.+)$/)
  if (nextWeekDay) {
    const dayNum = DAY_MAP[nextWeekDay[1]]
    if (dayNum !== undefined) return fmt(NEXT_DAY_FN[dayNum](addDays(today, 6)))
  }

  // "이번 금요일", "이번주 월요일"
  const thisWeekDay = text.match(/^이번\s*주?\s*(.+)$/)
  if (thisWeekDay) {
    const dayNum = DAY_MAP[thisWeekDay[1]]
    if (dayNum !== undefined) {
      const target = NEXT_DAY_FN[dayNum](addDays(today, -1))
      if (target >= today) return fmt(target)
    }
  }

  // "월요일", "금요일" 등 요일만
  if (DAY_MAP[text] !== undefined) {
    const dayNum = DAY_MAP[text]
    return fmt(NEXT_DAY_FN[dayNum](today))
  }

  // "1월 15일", "3월 5일"
  const monthDay = text.match(/^(\d{1,2})월\s*(\d{1,2})일$/)
  if (monthDay) {
    const m = parseInt(monthDay[1], 10) - 1
    const d = parseInt(monthDay[2], 10)
    const year = today.getFullYear()
    let date = new Date(year, m, d)
    if (date < today) date = new Date(year + 1, m, d)
    return fmt(date)
  }

  // "2026-03-15" 또는 "2026/03/15" 형식
  const isoDate = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (isoDate) {
    return fmt(new Date(parseInt(isoDate[1], 10), parseInt(isoDate[2], 10) - 1, parseInt(isoDate[3], 10)))
  }

  return parseEnglishDateExpression(text.toLowerCase(), today)
}

/** 영어 날짜 표현. 한국어 패턴이 모두 실패한 뒤에만 시도한다. */
function parseEnglishDateExpression(text: string, today: Date): string | null {
  if (text === 'today') return fmt(today)
  if (text === 'tomorrow' || text === 'tmr' || text === 'tmrw') return fmt(addDays(today, 1))
  if (text === 'day after tomorrow' || text === 'overmorrow') return fmt(addDays(today, 2))

  // "in 3 days", "3 days later", "in 2 weeks", "in 1 month"
  const relative = text.match(/^(?:in\s+)?(\d+)\s*(day|week|month)s?(?:\s+later|\s+from\s+now)?$/)
  if (relative) {
    const n = parseInt(relative[1], 10)
    if (relative[2] === 'day') return fmt(addDays(today, n))
    if (relative[2] === 'week') return fmt(addWeeks(today, n))
    return fmt(addMonths(today, n))
  }

  if (/^next\s+week$/.test(text)) return fmt(nextMonday(today))

  // "next monday", "next fri"
  const nextWeekDay = text.match(/^next\s+(.+)$/)
  if (nextWeekDay) {
    const dayNum = EN_DAY_MAP[nextWeekDay[1].trim()]
    if (dayNum !== undefined) return fmt(NEXT_DAY_FN[dayNum](addDays(today, 6)))
  }

  // "this friday" — 이번 주 안에 남아 있을 때만.
  const thisWeekDay = text.match(/^this\s+(.+)$/)
  if (thisWeekDay) {
    const dayNum = EN_DAY_MAP[thisWeekDay[1].trim()]
    if (dayNum !== undefined) {
      const target = NEXT_DAY_FN[dayNum](addDays(today, -1))
      if (target >= today) return fmt(target)
    }
  }

  // 요일만: "monday", "fri"
  if (EN_DAY_MAP[text] !== undefined) return fmt(NEXT_DAY_FN[EN_DAY_MAP[text]](today))

  // "mar 5", "march 5th", "5 mar"
  const monthDay = text.match(/^([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?$/) || null
  const dayMonth = text.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})$/) || null
  const monthName = monthDay?.[1] ?? dayMonth?.[2]
  const dayOfMonth = monthDay?.[2] ?? dayMonth?.[1]
  if (monthName && dayOfMonth) {
    const m = EN_MONTHS.indexOf(monthName.slice(0, 3))
    const d = parseInt(dayOfMonth, 10)
    if (m >= 0 && d >= 1 && d <= 31) {
      const year = today.getFullYear()
      let date = new Date(year, m, d)
      if (date < today) date = new Date(year + 1, m, d)
      return fmt(date)
    }
  }

  return null
}

function fmt(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

export function getDateSuggestions(input: string): { label: string; date: string }[] {
  if (!input.trim()) return []

  const suggestions: { label: string; date: string }[] = []
  const parsed = parseNaturalDate(input)
  if (parsed) {
    suggestions.push({ label: input, date: parsed })
  }

  // 기본 칩은 현재 UI 언어의 표현으로 만든다. 라벨만 번역하고 파싱 원문은 그대로
  // 두면 영어 UI에서 "Today"를 눌러도 파서가 못 알아듣는다.
  const isEn = i18n.language?.startsWith('en')
  const defaults = [
    { label: i18n.t('quickDate.today'), text: isEn ? 'today' : '오늘' },
    { label: i18n.t('quickDate.tomorrow'), text: isEn ? 'tomorrow' : '내일' },
    { label: i18n.t('quickDate.nextWeek'), text: isEn ? 'next week' : '다음주' }
  ]

  const needle = input.toLowerCase()
  for (const d of defaults) {
    if (d.label.toLowerCase().includes(needle) || d.text.includes(needle)) {
      const date = parseNaturalDate(d.text)
      if (date && !suggestions.find((s) => s.date === date)) {
        suggestions.push({ label: d.label, date })
      }
    }
  }

  return suggestions.slice(0, 5)
}
