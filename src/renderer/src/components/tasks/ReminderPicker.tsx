import { useState } from 'react'
import { Bell, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import i18n from '../../i18n'

interface QuickOption {
  labelKey: string
  getDate: (dueDate: string) => string
}

const QUICK_OPTIONS: QuickOption[] = [
  {
    labelKey: 'reminder.atDue',
    getDate: (dueDate) => dueDate
  },
  {
    labelKey: 'reminder.min5',
    getDate: (dueDate) => {
      const d = new Date(dueDate)
      d.setMinutes(d.getMinutes() - 5)
      return d.toISOString()
    }
  },
  {
    labelKey: 'reminder.min30',
    getDate: (dueDate) => {
      const d = new Date(dueDate)
      d.setMinutes(d.getMinutes() - 30)
      return d.toISOString()
    }
  },
  {
    labelKey: 'reminder.hour1',
    getDate: (dueDate) => {
      const d = new Date(dueDate)
      d.setHours(d.getHours() - 1)
      return d.toISOString()
    }
  },
  {
    labelKey: 'reminder.day1',
    getDate: (dueDate) => {
      const d = new Date(dueDate)
      d.setDate(d.getDate() - 1)
      return d.toISOString()
    }
  }
]

function formatReminderDisplay(value: string | null): string {
  if (!value) return i18n.t('reminder.label')
  try {
    const d = new Date(value)
    const month = d.getMonth() + 1
    const day = d.getDate()
    const hours = d.getHours().toString().padStart(2, '0')
    const minutes = d.getMinutes().toString().padStart(2, '0')
    return `${month}/${day} ${hours}:${minutes}`
  } catch {
    return i18n.t('reminder.label')
  }
}

export function ReminderPicker({
  dueDate,
  value,
  onChange
}: {
  dueDate: string | null
  value: string | null
  onChange: (reminderAt: string | null) => void
}) {
  const { t } = useTranslation()
  const { theme } = useStore()
  const isDark = theme === 'dark'
  const [open, setOpen] = useState(false)
  const [customDate, setCustomDate] = useState('')
  const [customTime, setCustomTime] = useState('09:00')

  const handleQuickOption = (option: QuickOption) => {
    if (!dueDate) {
      // 마감일이 없으면 오늘 날짜 기준으로 설정
      const today = new Date()
      today.setHours(9, 0, 0, 0)
      const result = option.getDate(today.toISOString())
      onChange(result)
    } else {
      // 마감일 + 시간이 있으면 그것을 기준으로
      const dueDateObj = new Date(dueDate)
      if (dueDateObj.getHours() === 0 && dueDateObj.getMinutes() === 0) {
        dueDateObj.setHours(9, 0, 0, 0)
      }
      const result = option.getDate(dueDateObj.toISOString())
      onChange(result)
    }
    setOpen(false)
  }

  const handleCustomApply = () => {
    if (!customDate) return
    const dateTime = new Date(`${customDate}T${customTime}:00`)
    onChange(dateTime.toISOString())
    setOpen(false)
  }

  const handleClear = () => {
    onChange(null)
    setOpen(false)
  }

  return (
    <div className="relative">
      {/* 트리거 버튼 */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${
          value
            ? 'text-primary-400 bg-primary-900/30'
            : isDark
              ? 'text-gray-500 hover:bg-gray-700'
              : 'text-gray-400 hover:bg-gray-200'
        }`}
      >
        <Bell size={14} />
        {formatReminderDisplay(value)}
      </button>

      {/* 드롭다운 */}
      {open && (
        <div
          className={`absolute left-0 top-full mt-1 z-50 rounded-lg shadow-2xl border min-w-[220px] ${
            isDark ? 'bg-[#2C2C2E] border-gray-700' : 'bg-white border-gray-200'
          }`}
        >
          {/* 빠른 옵션 */}
          <div className="py-1">
            {QUICK_OPTIONS.map((option) => (
              <button
                type="button"
                key={option.labelKey}
                onClick={() => handleQuickOption(option)}
                className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                  isDark ? 'text-gray-200 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>

          {/* 구분선 */}
          <div className={isDark ? 'border-t border-gray-700' : 'border-t border-gray-200'} />

          {/* 사용자 지정 */}
          <div className="p-3">
            <div className={`text-xs mb-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{t('reminder.custom')}</div>
            <div className="flex gap-2 mb-2">
              <input
                type="date"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                className={`flex-1 text-sm px-2 py-1 rounded border outline-none ${
                  isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-white border-gray-300 text-gray-700'
                }`}
              />
              <input
                type="time"
                value={customTime}
                onChange={(e) => setCustomTime(e.target.value)}
                className={`w-24 text-sm px-2 py-1 rounded border outline-none ${
                  isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-white border-gray-300 text-gray-700'
                }`}
              />
            </div>
            <button
              type="button"
              onClick={handleCustomApply}
              disabled={!customDate}
              className="w-full text-xs px-3 py-1.5 rounded bg-primary-500 text-white disabled:opacity-30 hover:bg-primary-600 transition-colors"
            >
              {t('reminder.set')}
            </button>
          </div>

          {/* 해제 */}
          {value && (
            <>
              <div className={isDark ? 'border-t border-gray-700' : 'border-t border-gray-200'} />
              <button
                type="button"
                onClick={handleClear}
                className={`w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
                  isDark ? 'text-gray-400 hover:bg-gray-700' : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                <X size={14} />
                {t('reminder.clear')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
