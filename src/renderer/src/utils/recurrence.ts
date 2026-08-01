/**
 * 반복 task 다음 발생일 계산 유틸
 *
 * 패턴 형식 (RecurringPicker.tsx 기준):
 *   daily            → fromISODate + 1일
 *   weekly:1,3,5     → from 이후 가장 가까운 해당 요일 (0=일 ~ 6=토)
 *   monthly:15       → 다음 달 15일
 *   yearly:MM-DD     → 내년 해당 월일
 *
 * TZ 드리프트 방지를 위해 Date(y, m, d) 로컬 생성, Date.now()/new Date() 비인수 호출 금지.
 */
import i18n, { tList } from '../i18n'

/** 'YYYY-MM-DD' → [year, month(0-based), day] */
function parseDate(iso: string): [number, number, number] {
  const parts = iso.split('-')
  return [Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])]
}

/** [year, month(0-based), day] → 'YYYY-MM-DD' */
function formatDate(y: number, m: number, d: number): string {
  const date = new Date(y, m, d) // 로컬 날짜로 정규화
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * 반복 패턴과 기준일로부터 다음 발생일(YYYY-MM-DD)을 반환한다.
 * 인식 불가 패턴은 null.
 */
export function nextRecurringDate(pattern: string, fromISODate: string): string | null {
  if (!pattern) return null

  const [y, m, d] = parseDate(fromISODate)

  // ── daily ──────────────────────────────────────────────
  if (pattern === 'daily') {
    return formatDate(y, m, d + 1)
  }

  // ── weekly:d[,d,...] ───────────────────────────────────
  if (pattern.startsWith('weekly:')) {
    const dayParts = pattern.slice('weekly:'.length).split(',')
    const targetDays = dayParts.map(Number).filter((n) => !Number.isNaN(n))
    if (targetDays.length === 0) return null

    // from 날짜의 요일 (0=일)
    const fromDate = new Date(y, m, d)
    const fromDow = fromDate.getDay()

    // from 이후(strictly after) 가장 가까운 요일 탐색 (최대 7일)
    for (let offset = 1; offset <= 7; offset++) {
      const candidate = new Date(y, m, d + offset)
      const dow = candidate.getDay()
      if (targetDays.includes(dow)) {
        return formatDate(candidate.getFullYear(), candidate.getMonth(), candidate.getDate())
      }
    }
    // 이론상 도달 불가 (7일 내에 반드시 매칭)
    void fromDow
    return null
  }

  // ── monthly:N ─────────────────────────────────────────
  if (pattern.startsWith('monthly:')) {
    const day = Number(pattern.slice('monthly:'.length))
    if (Number.isNaN(day)) return null
    // 다음 달 (12월 → 1월 / 연도 +1)
    const nextMonth = m + 1
    const nextYear = nextMonth > 11 ? y + 1 : y
    const normalizedMonth = nextMonth > 11 ? 0 : nextMonth
    return formatDate(nextYear, normalizedMonth, day)
  }

  // ── yearly:MM-DD ──────────────────────────────────────
  if (pattern.startsWith('yearly:')) {
    const mmdd = pattern.slice('yearly:'.length) // 예: '07-21'
    const parts = mmdd.split('-')
    if (parts.length !== 2) return null
    const targetMonth = Number(parts[0]) - 1 // 0-based
    const targetDay = Number(parts[1])
    if (Number.isNaN(targetMonth) || Number.isNaN(targetDay)) return null
    return formatDate(y + 1, targetMonth, targetDay)
  }

  return null
}

/**
 * ISO 날짜시간 문자열을 wholeDays일만큼 이동한 새 ISO 문자열 반환.
 * 시간대 드리프트 방지: 날짜 부분은 로컬 생성, 시간 부분은 원본 그대로.
 * @param iso  'YYYY-MM-DDTHH:MM:SS.sssZ' 또는 'YYYY-MM-DD' 형식
 * @param days 이동할 일 수 (음수 허용)
 */
export function shiftIsoByDays(iso: string, days: number): string {
  // 날짜 부분과 시간 부분 분리
  const tIdx = iso.indexOf('T')
  const datePart = tIdx >= 0 ? iso.slice(0, tIdx) : iso
  const timePart = tIdx >= 0 ? iso.slice(tIdx) : ''     // 'T...' or ''
  const [y, m, d] = parseDate(datePart)
  const shifted = new Date(y, m, d + days)
  const yyyy = shifted.getFullYear()
  const mm = String(shifted.getMonth() + 1).padStart(2, '0')
  const dd = String(shifted.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}${timePart}`
}

/**
 * 두 YYYY-MM-DD 날짜 사이의 정수 일 차이를 반환 (to - from).
 */
export function daysBetween(fromISODate: string, toISODate: string): number {
  const [fy, fm, fd] = parseDate(fromISODate)
  const [ty, tm, td] = parseDate(toISODate)
  const fromMs = new Date(fy, fm, fd).getTime()
  const toMs = new Date(ty, tm, td).getTime()
  return Math.round((toMs - fromMs) / 86400000)
}

/**
 * 반복 패턴을 사람이 읽는 문구로. RecurringPicker의 트리거 버튼과 TaskDetail의
 * 칩이 같은 문구를 쓰도록 한곳에 둔다.
 */
export function formatRecurringPattern(pattern: string | null): string | null {
  if (!pattern) return null

  if (pattern === 'daily') return i18n.t('recurring.daily')

  if (pattern.startsWith('weekly:')) {
    const names = tList('date.weekdaysShort')
    const days = pattern
      .replace('weekly:', '')
      .split(',')
      .map((d) => names[Number(d)])
      .filter(Boolean)
      .join(', ')
    return i18n.t('recurring.weeklyOn', { days })
  }

  if (pattern.startsWith('monthly:')) {
    return i18n.t('recurring.monthlyOn', { day: pattern.replace('monthly:', '') })
  }

  if (pattern.startsWith('yearly:')) {
    const [month, day] = pattern.replace('yearly:', '').split('-')
    return i18n.t('recurring.yearlyOn', { month, day })
  }

  return i18n.t('recurring.label')
}
