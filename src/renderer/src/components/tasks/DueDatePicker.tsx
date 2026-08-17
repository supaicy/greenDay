import { useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { todayString, tomorrowString } from '../../utils/date'
import { shiftIsoByDays } from '../../utils/recurrence'

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
  onChange,
  trigger
}: {
  dueDate: string | null
  dueTime: string | null
  onChange: (next: { dueDate: string | null; dueTime: string | null }) => void
  trigger: ReactNode
}) {
  const { t } = useTranslation()
  const isDark = useStore((s) => s.theme) === 'dark'
  const [open, setOpen] = useState(false)

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
  const fieldCls = `h-8 text-[13px] rounded-md px-2 outline-none border ${
    isDark ? 'bg-surface-sunken text-gray-100 border-surface-line' : 'bg-white text-gray-700 border-gray-300'
  }`

  return (
    <Popover open={open} onOpenChange={setOpen}>
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

        <div className="flex items-center gap-2">
          <input
            type="date"
            aria-label={t('task.dueDate')}
            value={dueDate ?? ''}
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
