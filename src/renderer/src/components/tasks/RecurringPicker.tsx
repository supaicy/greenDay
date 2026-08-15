import { useEffect, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import { tList } from '../../i18n'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

type RecurringType = 'daily' | 'weekly' | 'monthly' | 'yearly'

function parsePattern(pattern: string | null): {
  type: RecurringType
  weekDays: number[]
  monthDay: number
  yearMonth: number
  yearDay: number
} {
  if (!pattern) return { type: 'daily', weekDays: [], monthDay: 1, yearMonth: 1, yearDay: 1 }

  if (pattern === 'daily') return { type: 'daily', weekDays: [], monthDay: 1, yearMonth: 1, yearDay: 1 }

  if (pattern.startsWith('weekly:')) {
    const days = pattern.replace('weekly:', '').split(',').map(Number)
    return { type: 'weekly', weekDays: days, monthDay: 1, yearMonth: 1, yearDay: 1 }
  }

  if (pattern.startsWith('monthly:')) {
    const day = parseInt(pattern.replace('monthly:', ''), 10)
    return { type: 'monthly', weekDays: [], monthDay: day, yearMonth: 1, yearDay: 1 }
  }

  if (pattern.startsWith('yearly:')) {
    const [month, day] = pattern.replace('yearly:', '').split('-').map(Number)
    return { type: 'yearly', weekDays: [], monthDay: 1, yearMonth: month, yearDay: day }
  }

  return { type: 'daily', weekDays: [], monthDay: 1, yearMonth: 1, yearDay: 1 }
}

function buildPattern(
  type: RecurringType,
  weekDays: number[],
  monthDay: number,
  yearMonth: number,
  yearDay: number
): string {
  switch (type) {
    case 'daily':
      return 'daily'
    case 'weekly':
      return `weekly:${weekDays.sort((a, b) => a - b).join(',')}`
    case 'monthly':
      return `monthly:${monthDay}`
    case 'yearly':
      return `yearly:${yearMonth}-${yearDay}`
  }
}

export function RecurringPicker({
  value,
  onChange,
  trigger
}: {
  value: string | null
  onChange: (pattern: string | null) => void
  trigger: ReactNode
}) {
  const { t } = useTranslation()
  const theme = useStore((s) => s.theme)
  const WEEKDAYS = tList('date.weekdaysShort')
  const MONTHS = tList('date.months')
  const isDark = theme === 'dark'

  const [open, setOpen] = useState(false)
  const [type, setType] = useState<RecurringType>(() => parsePattern(value).type)
  const [weekDays, setWeekDays] = useState<number[]>(() => parsePattern(value).weekDays)
  const [monthDay, setMonthDay] = useState(() => parsePattern(value).monthDay)
  const [yearMonth, setYearMonth] = useState(() => parsePattern(value).yearMonth)
  const [yearDay, setYearDay] = useState(() => parsePattern(value).yearDay)

  // 예전에는 열릴 때만 마운트돼 초기값 파싱으로 충분했지만, Popover는 계속
  // 마운트돼 있으므로 외부에서 value가 바뀌면 동기화해야 재오픈 시 최신이다.
  useEffect(() => {
    const p = parsePattern(value)
    setType(p.type)
    setWeekDays(p.weekDays)
    setMonthDay(p.monthDay)
    setYearMonth(p.yearMonth)
    setYearDay(p.yearDay)
  }, [value])

  const toggleWeekDay = (day: number) => {
    setWeekDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]))
  }

  const handleApply = () => {
    onChange(buildPattern(type, weekDays, monthDay, yearMonth, yearDay))
    setOpen(false)
  }

  const handleClear = () => {
    onChange(null)
    setOpen(false)
  }

  const typeLabels: Record<RecurringType, string> = {
    daily: t('recurring.daily'),
    weekly: t('recurring.weekly'),
    monthly: t('recurring.monthly'),
    yearly: t('recurring.yearly')
  }

  return (
    // 트리거는 호출처가 준다. 예전에는 호출처 버튼이 이 픽커를 mount하고
    // 픽커가 자기 버튼을 또 그려서, 열려면 두 번 눌러야 했다(2026-08-05 검증).
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="min-w-[260px] p-3">
      {/* 반복 유형 선택 */}
      <div className="flex gap-1 mb-3">
        {(Object.keys(typeLabels) as RecurringType[]).map((t) => (
          <button
            type="button"
            key={t}
            onClick={() => setType(t)}
            className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
              type === t
                ? 'bg-primary-500 text-white'
                : isDark
                  ? 'text-gray-400 hover:bg-gray-700'
                  : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            {typeLabels[t]}
          </button>
        ))}
      </div>

      {/* 요일 선택 (매주) */}
      {type === 'weekly' && (
        <div className="mb-3">
          <div className={`text-xs mb-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {t('recurring.pickWeekdays')}
          </div>
          <div className="flex gap-1">
            {WEEKDAYS.map((label, idx) => (
              <button
                type="button"
                key={label}
                onClick={() => toggleWeekDay(idx)}
                className={`w-8 h-8 text-xs rounded-full transition-colors ${
                  weekDays.includes(idx)
                    ? 'bg-primary-500 text-white'
                    : isDark
                      ? 'text-gray-400 bg-gray-700 hover:bg-gray-600'
                      : 'text-gray-500 bg-gray-100 hover:bg-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 날짜 선택 (매월) */}
      {type === 'monthly' && (
        <div className="mb-3">
          <div className={`text-xs mb-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {t('recurring.pickMonthDay')}
          </div>
          <input
            type="number"
            min={1}
            max={31}
            value={monthDay}
            onChange={(e) => setMonthDay(Math.max(1, Math.min(31, parseInt(e.target.value, 10) || 1)))}
            className={`w-20 text-sm px-2 py-1 rounded border outline-none ${
              isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-white border-gray-300 text-gray-700'
            }`}
          />
          <span className={`ml-1 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{t('recurring.dayUnit')}</span>
        </div>
      )}

      {/* 월+일 선택 (매년) */}
      {type === 'yearly' && (
        <div className="mb-3">
          <div className={`text-xs mb-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {t('recurring.pickYearDate')}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={yearMonth}
              onChange={(e) => setYearMonth(parseInt(e.target.value, 10))}
              className={`text-sm px-2 py-1 rounded border outline-none ${
                isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-white border-gray-300 text-gray-700'
              }`}
            >
              {MONTHS.map((label, idx) => (
                <option key={label} value={idx + 1}>
                  {label}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              max={31}
              value={yearDay}
              onChange={(e) => setYearDay(Math.max(1, Math.min(31, parseInt(e.target.value, 10) || 1)))}
              className={`w-16 text-sm px-2 py-1 rounded border outline-none ${
                isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-white border-gray-300 text-gray-700'
              }`}
            />
            <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{t('recurring.dayUnit')}</span>
          </div>
        </div>
      )}

      {/* 하단 버튼 */}
      <div className={`flex justify-between pt-2 border-t ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
        <button
          type="button"
          onClick={handleClear}
          className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${
            isDark ? 'text-gray-400 hover:bg-gray-700' : 'text-gray-500 hover:bg-gray-100'
          }`}
        >
          <X size={12} />
          {t('common.clear')}
        </button>
        <button
          type="button"
          onClick={handleApply}
          className="text-xs px-3 py-1 rounded bg-primary-500 text-white hover:bg-primary-600 transition-colors"
        >
          {t('common.apply')}
        </button>
      </div>
      </PopoverContent>
    </Popover>
  )
}
