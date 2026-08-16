import { useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

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

export function ReminderPicker({
  dueDate,
  value,
  onChange,
  trigger
}: {
  dueDate: string | null
  value: string | null
  onChange: (reminderAt: string | null) => void
  trigger: ReactNode
}) {
  const { t } = useTranslation()
  const theme = useStore((s) => s.theme)
  const isDark = theme === 'dark'
  const [open, setOpen] = useState(false)
  const [customDate, setCustomDate] = useState('')
  const [customTime, setCustomTime] = useState('09:00')

  const handleQuickOption = (option: QuickOption) => {
    if (!dueDate) {
      // 마감일이 없으면 오늘 날짜 기준으로 설정
      const today = new Date()
      today.setHours(9, 0, 0, 0)
      onChange(option.getDate(today.toISOString()))
    } else {
      // 마감일 + 시간이 있으면 그것을 기준으로
      const dueDateObj = new Date(dueDate)
      if (dueDateObj.getHours() === 0 && dueDateObj.getMinutes() === 0) {
        dueDateObj.setHours(9, 0, 0, 0)
      }
      onChange(option.getDate(dueDateObj.toISOString()))
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

  // Popover는 TaskDetail 수명 내내 마운트돼 있고 TaskDetail은 task id로 키가
  // 걸려 있지 않다. 닫을 때 비우지 않으면 A에서 입력하다 만 값이 B의 픽커에
  // 그대로 채워진 채 열린다(예전에는 열릴 때만 마운트돼 저절로 초기화됐다).
  const handleOpenChange = (next: boolean): void => {
    setOpen(next)
    if (!next) {
      setCustomDate('')
      setCustomTime('09:00')
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      {/* 트리거는 호출처가 준다. 예전에는 호출처 버튼이 이 픽커를 mount하고
          픽커가 자기 버튼을 또 그려서, 첫 클릭은 두 번째 버튼을 나타나게 할
          뿐이었다 — 열려면 두 번 눌러야 했다. */}
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>

      {/* 바깥 클릭·Escape·포커스 관리는 Radix가 한다. 이 픽커는 원래
          바깥을 눌러도 닫히지 않았다 — 백드롭이 아예 없었다. */}
      <PopoverContent align="start" className="min-w-[220px] p-0">
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
      </PopoverContent>
    </Popover>
  )
}
