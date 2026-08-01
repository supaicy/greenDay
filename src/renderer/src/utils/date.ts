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
import i18n from '../i18n'

// date-fns 로케일은 요일·월 이름을 담당하고, 포맷 문자열('M월 d일' vs 'MMM d')은
// 언어마다 어순이 달라 번역 리소스에서 가져온다.
function dfLocale(): typeof ko {
  return i18n.language?.startsWith('en') ? enUS : ko
}

export function formatDueDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  if (isToday(date)) return i18n.t('date.today')
  if (isTomorrow(date)) return i18n.t('date.tomorrow')
  if (isYesterday(date)) return i18n.t('date.yesterday')
  if (isThisWeek(date)) return format(date, 'EEEE', { locale: dfLocale() })
  return format(date, i18n.t('date.monthDay'), { locale: dfLocale() })
}

export function isOverdue(dateStr: string | null): boolean {
  if (!dateStr) return false
  return isBefore(new Date(dateStr), startOfDay(new Date()))
}

export function isDueToday(dateStr: string | null): boolean {
  if (!dateStr) return false
  return isToday(new Date(dateStr))
}

export function isDueTomorrow(dateStr: string | null): boolean {
  if (!dateStr) return false
  return isTomorrow(new Date(dateStr))
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
  const date = new Date(dateStr)
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

export function toDateString(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}
