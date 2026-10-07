import { useEffect, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import { tList } from '../../i18n'
import { parseWeeklyDays } from '../../utils/recurrence'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

type RecurringType = 'daily' | 'weekly' | 'monthly' | 'yearly'

/** 픽커가 편집 중인 초안. 다섯 값이 한 패턴에서 나오므로 한 덩어리로 다룬다. */
interface RecurrenceDraft {
  type: RecurringType
  weekDays: number[]
  monthDay: number
  yearMonth: number
  yearDay: number
}

function parsePattern(pattern: string | null): RecurrenceDraft {
  if (!pattern) return { type: 'daily', weekDays: [], monthDay: 1, yearMonth: 1, yearDay: 1 }

  if (pattern === 'daily') return { type: 'daily', weekDays: [], monthDay: 1, yearMonth: 1, yearDay: 1 }

  if (pattern.startsWith('weekly:')) {
    // 빈 세그먼트를 요일 0으로 읽지 않도록 공용 파서를 쓴다(유령 일요일 방지).
    return { type: 'weekly', weekDays: parseWeeklyDays(pattern), monthDay: 1, yearMonth: 1, yearDay: 1 }
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

function buildPattern({ type, weekDays, monthDay, yearMonth, yearDay }: RecurrenceDraft): string {
  switch (type) {
    case 'daily':
      return 'daily'
    case 'weekly':
      return `weekly:${[...weekDays].sort((a, b) => a - b).join(',')}`
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
  // 다섯 값이 한 패턴에서 나오므로 한 덩어리로 둔다 — 따로 두면 같은 문자열을
  // 다섯 번 파싱하고 동기화도 setter 다섯 개가 된다.
  const [draft, setDraft] = useState<RecurrenceDraft>(() => parsePattern(value))
  const { type, weekDays, monthDay, yearMonth, yearDay } = draft

  // 예전에는 열릴 때만 마운트돼 초기값 파싱으로 충분했지만, Popover는 계속
  // 마운트돼 있으므로 외부에서 value가 바뀌면 동기화해야 재오픈 시 최신이다.
  useEffect(() => {
    setDraft(parsePattern(value))
  }, [value])

  const toggleWeekDay = (day: number) => {
    setDraft((d) => ({
      ...d,
      weekDays: d.weekDays.includes(day) ? d.weekDays.filter((x) => x !== day) : [...d.weekDays, day]
    }))
  }

  const handleApply = () => {
    onChange(buildPattern(draft))
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

  // 닫을 때 초안을 원래 값으로 되돌린다. Popover는 TaskDetail 수명 내내 마운트돼
  // 있어서, 고치다 Escape로 버린 값이 그대로 남았다가 다음에 열어 '적용'을 누르면
  // 그때 커밋됐다(외부 value가 안 바뀌었으니 동기화 effect도 안 돈다).
  // 같은 이유로 현재 반복이 같은 두 할일 사이에서도 초안이 샜다.
  const handleOpenChange = (next: boolean): void => {
    setOpen(next)
    if (!next) setDraft(parsePattern(value))
  }

  return (
    // 트리거는 호출처가 준다. 예전에는 호출처 버튼이 이 픽커를 mount하고
    // 픽커가 자기 버튼을 또 그려서, 열려면 두 번 눌러야 했다(2026-08-05 검증).
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="min-w-[260px] p-3">
      {/* 반복 유형 선택 */}
      <div className="flex gap-1 mb-3">
        {(Object.keys(typeLabels) as RecurringType[]).map((t) => (
          <button
            type="button"
            key={t}
            onClick={() => setDraft((d) => ({ ...d, type: t }))}
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
            onChange={(e) => setDraft((d) => ({ ...d, monthDay: Math.max(1, Math.min(31, parseInt(e.target.value, 10) || 1)) }))}
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
              onChange={(e) => setDraft((d) => ({ ...d, yearMonth: parseInt(e.target.value, 10) }))}
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
              onChange={(e) => setDraft((d) => ({ ...d, yearDay: Math.max(1, Math.min(31, parseInt(e.target.value, 10) || 1)) }))}
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
          // 요일 0개로 적용하면 'weekly:'가 만들어져, 표시는 고른 적 없는 일요일
          // 반복을 주장하고 다음 회차는 영영 생기지 않는다(빈 요일 목록 → 다음
          // 발생일 계산 불가). 애초에 못 만들게 막는다.
          disabled={type === 'weekly' && weekDays.length === 0}
          className="text-xs px-3 py-1 rounded bg-primary-500 text-white hover:bg-primary-600 transition-colors disabled:opacity-30 disabled:hover:bg-primary-500"
        >
          {t('common.apply')}
        </button>
      </div>
      </PopoverContent>
    </Popover>
  )
}
