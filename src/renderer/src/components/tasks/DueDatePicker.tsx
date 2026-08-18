import { useEffect, useState, type ReactNode } from 'react'
import { X, Bell, Repeat, CalendarRange, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { todayString, tomorrowString } from '../../utils/date'
import { formatRecurringPattern, shiftIsoByDays } from '../../utils/recurrence'
import { ReminderPicker } from './ReminderPicker'
import { RecurringPicker } from './RecurringPicker'

/**
 * 이번 주 토요일. 오늘이 토/일이면 다음 주 토요일을 준다 —
 * "이번 주말"을 눌렀는데 이미 지난 날짜가 잡히면 아무 쓸모가 없다.
 */
export function upcomingWeekend(today: string): string {
  const [y, m, d] = today.split('-').map(Number)
  const dow = new Date(y, m - 1, d).getDay() // 0=일 … 6=토
  const untilSaturday = (6 - dow + 7) % 7
  return shiftIsoByDays(today, untilSaturday === 0 ? 7 : untilSaturday)
}

/** 다음 주 월요일. */
export function nextMonday(today: string): string {
  const [y, m, d] = today.split('-').map(Number)
  const dow = new Date(y, m - 1, d).getDay()
  return shiftIsoByDays(today, ((8 - dow) % 7) || 7)
}

/**
 * 마감일 선택기. 전에는 네이티브 date/time 입력 두 개를 메타 줄에 그대로 놓았는데,
 * 값이 없으면 "연도. 월. 일."과 "-- --"가 그대로 노출돼 빈 상태가 고장 난 칸처럼
 * 보였고, 가장 잦은 조작인데 매번 연·월·일을 타이핑해야 했다. 빠른 선택을 앞에 둔다.
 * 트리거는 호출처가 준다(ReminderPicker·RecurringPicker와 같은 시그니처).
 */
export function DueDatePicker({
  dueDate,
  dueTime,
  startDate,
  reminderAt,
  recurringPattern,
  isRecurring,
  onChange,
  onStartDateChange,
  onReminderChange,
  onRecurringChange,
  autoOpenRangeSignal,
  trigger
}: {
  dueDate: string | null
  dueTime: string | null
  startDate: string | null
  reminderAt: string | null
  recurringPattern: string | null
  isRecurring: boolean
  onChange: (next: { dueDate: string | null; dueTime: string | null }) => void
  onStartDateChange: (startDate: string | null) => void
  onReminderChange: (reminderAt: string | null) => void
  onRecurringChange: (pattern: string | null) => void
  /** ⋯ 메뉴의 '기간 설정'에서 값이 바뀌면 팝오버를 기간 모드로 연다. */
  autoOpenRangeSignal?: number
  trigger: ReactNode
}) {
  const { t } = useTranslation()
  const isDark = useStore((s) => s.theme) === 'dark'
  const [open, setOpen] = useState(false)
  // 시작일이 이미 있으면 기간 모드다. 없을 때 '기간' 행을 눌러 켜는 것이 이 상태.
  const [rangeArmed, setRangeArmed] = useState(false)
  const rangeMode = rangeArmed || startDate != null

  useEffect(() => {
    if (!autoOpenRangeSignal) return
    setRangeArmed(true)
    setOpen(true)
  }, [autoOpenRangeSignal])

  const today = todayString()
  const quick: { labelKey: string; date: string }[] = [
    { labelKey: 'detail.quickToday', date: today },
    { labelKey: 'detail.quickTomorrow', date: tomorrowString() },
    { labelKey: 'detail.quickWeekend', date: upcomingWeekend(today) },
    { labelKey: 'detail.quickNextWeek', date: nextMonday(today) }
  ]

  const chipCls = (active: boolean): string =>
    `h-7 px-2.5 rounded-md text-xs transition-colors ${
      active
        ? 'bg-primary-500/15 text-primary-300 border border-primary-500/50'
        : isDark
          ? 'border border-surface-line text-gray-300 hover:bg-surface-sunken'
          : 'border border-gray-300 text-gray-700 hover:bg-gray-100'
    }`
  const rowCls = `flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[13px] transition-colors ${
    isDark ? 'text-gray-200 hover:bg-surface-sunken' : 'text-gray-700 hover:bg-gray-100'
  }`
  const labelCls = `w-8 shrink-0 text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`
  const fieldCls = `h-8 text-[13px] rounded-md px-2 outline-none border ${
    isDark ? 'bg-surface-sunken text-gray-100 border-surface-line' : 'bg-white text-gray-700 border-gray-300'
  }`

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setRangeArmed(false)
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-[268px] p-3 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {quick.map((q) => (
            <button
              key={q.labelKey}
              type="button"
              onClick={() => {
                onChange({ dueDate: q.date, dueTime })
                setOpen(false)
              }}
              className={chipCls(dueDate === q.date)}
            >
              {t(q.labelKey)}
            </button>
          ))}
        </div>

        {rangeMode && (
          <div className="flex items-center gap-2">
            <span className={labelCls}>{t('detail.startDateLabel')}</span>
            <input
              type="date"
              aria-label={t('detail.startDateLabel')}
              value={startDate ?? ''}
              // 거꾸로 된 기간은 스토어가 거부하지만, 달력에서 아예 고를 수 없는 편이 낫다.
              max={dueDate ?? undefined}
              onChange={(e) => onStartDateChange(e.target.value || null)}
              className={`flex-1 ${fieldCls}`}
            />
          </div>
        )}

        <div className="flex items-center gap-2">
          {rangeMode && (
            <span className={labelCls}>{t('detail.endDateLabel')}</span>
          )}
          <input
            type="date"
            aria-label={t('task.dueDate')}
            value={dueDate ?? ''}
            min={rangeMode ? (startDate ?? undefined) : undefined}
            onChange={(e) => onChange({ dueDate: e.target.value || null, dueTime })}
            className={`flex-1 ${fieldCls}`}
          />
          <input
            type="time"
            aria-label={t('task.dueTime')}
            value={dueTime ?? ''}
            onChange={(e) => onChange({ dueDate, dueTime: e.target.value || null })}
            className={`w-[92px] ${fieldCls}`}
          />
        </div>

        {/* '언제'에 관한 것은 한곳에 모은다 — 알림·반복이 메타 줄에 따로 있으면
            기한과 떨어져 의미 그룹이 깨지고 상단바가 붐빈다. 각 행은 기존
            픽커를 그대로 중첩해 연다(기능 손실 없음). */}
        <div className={`border-t pt-2 ${isDark ? 'border-surface-line' : 'border-gray-200'}`}>
          <button
            type="button"
            onClick={() => {
              // 켜져 있으면 끈다 — 시작일을 지우는 것이 곧 '기간 아님'이다.
              if (rangeMode) {
                // 켜기만 하고 날짜를 안 골랐다면 지울 것이 없다 — 헛저장을 만들지 않는다.
                if (startDate) onStartDateChange(null)
                setRangeArmed(false)
              } else {
                setRangeArmed(true)
              }
            }}
            className={rowCls}
          >
            <span className="flex items-center gap-2">
              <CalendarRange size={13} />
              {t('detail.dateRangeLabel')}
            </span>
            <span className="text-gray-400">{startDate ?? t('common.none')}</span>
          </button>
          <ReminderPicker
            dueDate={dueDate}
            value={reminderAt}
            onChange={onReminderChange}
            trigger={
              <button type="button" className={rowCls}>
                <span className="flex items-center gap-2">
                  <Bell size={13} />
                  {t('reminder.label')}
                </span>
                <span className="flex items-center gap-1 text-gray-400">
                  {reminderAt ? new Date(reminderAt).toLocaleString() : t('common.none')}
                  <ChevronRight size={13} />
                </span>
              </button>
            }
          />
          <RecurringPicker
            value={recurringPattern}
            onChange={onRecurringChange}
            trigger={
              <button type="button" className={rowCls}>
                <span className="flex items-center gap-2">
                  <Repeat size={13} />
                  {t('recurring.label')}
                </span>
                <span className="flex items-center gap-1 text-gray-400">
                  {(isRecurring && formatRecurringPattern(recurringPattern)) || t('common.none')}
                  <ChevronRight size={13} />
                </span>
              </button>
            }
          />
        </div>

        {(dueDate || dueTime) && (
          <button
            type="button"
            onClick={() => {
              onChange({ dueDate: null, dueTime: null })
              setOpen(false)
            }}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${
              isDark ? 'text-gray-400 hover:bg-surface-sunken' : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            <X size={13} />
            {t('detail.clearDueDate')}
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}
