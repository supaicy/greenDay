import {
  format,
  isToday,
  isTomorrow,
  isYesterday,
  isThisWeek,
  isBefore,
  startOfDay,
  addDays,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  getDay,
  startOfWeek,
  endOfWeek
} from 'date-fns'
import { ko, enUS } from 'date-fns/locale'
import { fromLocalDateString, toLocalDateString } from '../../../shared/date'
import i18n from '../i18n'

// date-fns 로케일은 요일·월 이름을 담당하고, 포맷 문자열('M월 d일' vs 'MMM d')은
// 언어마다 어순이 달라 번역 리소스에서 가져온다.
function dfLocale(): typeof ko {
  return i18n.language?.startsWith('en') ? enUS : ko
}

export function formatDueDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const date = fromLocalDateString(dateStr)
  if (isToday(date)) return i18n.t('date.today')
  if (isTomorrow(date)) return i18n.t('date.tomorrow')
  if (isYesterday(date)) return i18n.t('date.yesterday')
  if (isThisWeek(date)) return format(date, 'EEEE', { locale: dfLocale() })
  return format(date, i18n.t('date.monthDay'), { locale: dfLocale() })
}

/**
 * 목록·상세가 함께 쓰는 기한 라벨.
 *
 * 기간이면 양끝을 절대 날짜로 찍는다 — formatDueDate를 두 번 쓰면 '오늘 ~ 오늘',
 * '어제 ~ 내일' 같은 기준점 없는 상대어 쌍이 나와 언제인지 알 수 없다.
 * 기간이 아니면 예전 표기(오늘·내일·요일)를 그대로 쓴다.
 */
export function formatDateRange(startDate: string | null, dueDate: string | null, dueTime: string | null): string {
  if (!dueDate) return ''
  const time = dueTime ? ` ${dueTime}` : ''
  if (!startDate) return `${formatDueDate(dueDate)}${time}`
  const abs = (d: string): string =>
    format(fromLocalDateString(d), i18n.t('date.monthDay'), { locale: dfLocale() })
  return `${abs(startDate)} ~ ${abs(dueDate)}${time}`
}

export function isOverdue(dateStr: string | null): boolean {
  if (!dateStr) return false
  return isBefore(fromLocalDateString(dateStr), startOfDay(new Date()))
}

export function isDueToday(dateStr: string | null): boolean {
  if (!dateStr) return false
  return isToday(fromLocalDateString(dateStr))
}

export function isDueTomorrow(dateStr: string | null): boolean {
  if (!dateStr) return false
  return isTomorrow(fromLocalDateString(dateStr))
}

// 로컬 시간 기준 오늘/내일 날짜 문자열(yyyy-MM-dd). UTC 기반 toISOString 과 달리
// 자정 근처 시간대에서도 뷰의 isDueToday/isDueTomorrow(로컬)와 어긋나지 않는다.
export function todayString(): string {
  return toDateString(new Date())
}

export function tomorrowString(): string {
  return toDateString(addDays(new Date(), 1))
}

export function isDueInNext7Days(dateStr: string | null): boolean {
  if (!dateStr) return false
  const date = fromLocalDateString(dateStr)
  const today = startOfDay(new Date())
  const nextWeek = addDays(today, 7)
  return date >= today && date <= nextWeek
}

export function getCalendarDays(year: number, month: number): Date[] {
  const monthStart = startOfMonth(new Date(year, month))
  const monthEnd = endOfMonth(monthStart)
  const calStart = startOfWeek(monthStart, { weekStartsOn: 0 })
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 })
  return eachDayOfInterval({ start: calStart, end: calEnd })
}

export function getDayOfWeek(date: Date): number {
  return getDay(date)
}

export function formatDate(date: Date, fmt: string): string {
  return format(date, fmt, { locale: dfLocale() })
}

// 메인 프로세스와 같은 구현을 쓴다(shared/date.ts). 두 벌이면 시간대 규칙이 갈린다.
export function toDateString(date: Date): string {
  return toLocalDateString(date)
}

/** now부터 다음 로컬 자정까지 남은 ms. useToday()의 리렌더 타이머용. DST는 로컬 Date 생성이 처리한다. */
export function msUntilNextLocalMidnight(now: Date): number {
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return nextMidnight.getTime() - now.getTime()
}
