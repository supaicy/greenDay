import { useState, useMemo } from 'react'
import { Plus, Trash2, X, Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import { tList } from '../../i18n'
import { toDateString } from '../../utils/date'
import { addDays, startOfWeek, isToday } from 'date-fns'

const COLORS = ['#4A90D9', '#E74C3C', '#F39C12', '#2ECC71', '#9B59B6', '#1ABC9C', '#E91E63', '#FF5722']

export function HabitTracker() {
  const { t } = useTranslation()
  const habits = useStore((s) => s.habits)
  const habitLogs = useStore((s) => s.habitLogs)
  const addHabit = useStore((s) => s.addHabit)
  const removeHabit = useStore((s) => s.removeHabit)
  const toggleHabitLog = useStore((s) => s.toggleHabitLog)
  const theme = useStore((s) => s.theme)
  const isDark = theme === 'dark'
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState('#4A90D9')
  const [weekOffset, setWeekOffset] = useState(0)

  const weekStart = useMemo(() => {
    const today = new Date()
    const start = startOfWeek(today, { weekStartsOn: 1 })
    return addDays(start, weekOffset * 7)
  }, [weekOffset])

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i))
  }, [weekStart])

  const logSet = useMemo(
    () => new Set(habitLogs.filter((l) => l.completed).map((l) => `${l.habitId}:${l.date}`)),
    [habitLogs]
  )

  const isLoggedOn = (habitId: string, date: string) => logSet.has(`${habitId}:${date}`)

  const streaks = useMemo(() => {
    const today = new Date()
    return Object.fromEntries(
      habits.map((habit) => {
        let streak = 0
        for (let i = 0; i < 365; i++) {
          const d = toDateString(addDays(today, -i))
          if (logSet.has(`${habit.id}:${d}`)) streak++
          else break
        }
        return [habit.id, streak]
      })
    )
  }, [habits, logSet])

  const handleAdd = async () => {
    if (!name.trim()) return
    await addHabit(name.trim(), color, 'daily', [0, 1, 2, 3, 4, 5, 6])
    setName('')
    setColor('#4A90D9')
    setShowAdd(false)
  }

  const WEEKDAY_LABELS = tList('date.weekdaysFromMonday')

  return (
    <div className={`flex-1 flex flex-col min-h-0 ${isDark ? 'bg-[#1C1C1E]' : 'bg-white'}`}>
      {/* 헤더 */}
      <div
        className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? 'border-gray-800' : 'border-gray-200'}`}
      >
        <div className="flex items-center gap-4">
          <h1 className={`text-xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-800'}`}>{t('habits.title')}</h1>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setWeekOffset((w) => w - 1)}
              className={`p-1 rounded ${isDark ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-200 text-gray-500'}`}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              onClick={() => setWeekOffset(0)}
              className={`px-2 py-0.5 rounded text-xs ${isDark ? 'text-gray-400 hover:bg-gray-800' : 'text-gray-500 hover:bg-gray-200'}`}
            >
              {t('habits.thisWeek')}
            </button>
            <button
              type="button"
              onClick={() => setWeekOffset((w) => w + 1)}
              className={`p-1 rounded ${isDark ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-200 text-gray-500'}`}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1 text-sm text-primary-400 hover:text-primary-300"
        >
          <Plus size={16} /> {t('habits.add')}
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {/* 주간 날짜 헤더 */}
        <div className="flex items-center mb-4 pl-48">
          {weekDays.map((day, i) => (
            <div key={day.toISOString()} className="flex-1 text-center">
              <div className="text-xs text-gray-500">{WEEKDAY_LABELS[i]}</div>
              <div
                className={`text-sm mt-1 w-8 h-8 flex items-center justify-center rounded-full mx-auto ${
                  isToday(day) ? 'bg-primary-500 text-white font-bold' : 'text-gray-400'
                }`}
              >
                {day.getDate()}
              </div>
            </div>
          ))}
        </div>

        {/* 습관 목록 */}
        {habits.map((habit) => (
          <div key={habit.id} className="flex items-center mb-3 group">
            <div className="w-48 flex items-center gap-3 pr-4">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: habit.color }} />
              <span className={`text-sm truncate ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>{habit.name}</span>
              <span className="text-xs text-gray-500 flex-shrink-0">{t('habits.streak', { days: streaks[habit.id] || 0 })}</span>
              <button
                type="button"
                onClick={() => removeHabit(habit.id)}
                className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all ml-auto flex-shrink-0"
              >
                <Trash2 size={14} />
              </button>
            </div>
            {weekDays.map((day) => {
              const dateStr = toDateString(day)
              const logged = isLoggedOn(habit.id, dateStr)
              return (
                <div key={dateStr} className="flex-1 flex justify-center">
                  <button
                    type="button"
                    onClick={() => toggleHabitLog(habit.id, dateStr)}
                    className={`w-8 h-8 rounded-lg border-2 flex items-center justify-center transition-all ${
                      logged
                        ? 'border-transparent'
                        : isDark
                          ? 'border-gray-700 hover:border-gray-500'
                          : 'border-gray-300 hover:border-gray-400'
                    }`}
                    style={logged ? { backgroundColor: `${habit.color}33`, borderColor: habit.color } : {}}
                  >
                    {logged && <Check size={16} style={{ color: habit.color }} />}
                  </button>
                </div>
              )
            })}
          </div>
        ))}

        {/* 빈 상태 */}
        {habits.length === 0 && !showAdd && (
          <div
            className={`flex flex-col items-center justify-center py-20 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}
          >
            <p className="text-sm">{t('habits.empty')}</p>
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="mt-2 text-sm text-primary-400 hover:text-primary-300"
            >
              {t('habits.addFirst')}
            </button>
          </div>
        )}

        {/* 추가 폼 */}
        {showAdd && (
          <div
            className={`mt-4 flex items-center gap-3 p-3 border rounded-lg ${isDark ? 'border-gray-700 bg-gray-800/50' : 'border-gray-300 bg-gray-50'}`}
          >
            {/* 색상 변경 버튼 (Pattern A: 순수 클릭 요소 → button) */}
            <button
              type="button"
              aria-label={t('common.changeColor')}
              className="w-6 h-6 rounded-full cursor-pointer flex-shrink-0 appearance-none border-0 p-0"
              style={{ backgroundColor: color }}
              onClick={() => {
                const idx = COLORS.indexOf(color)
                setColor(COLORS[(idx + 1) % COLORS.length])
              }}
            />
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd()
                if (e.key === 'Escape') setShowAdd(false)
              }}
              placeholder={t('habits.namePlaceholder')}
              className={`flex-1 bg-transparent text-sm outline-none ${isDark ? 'text-gray-200 placeholder-gray-600' : 'text-gray-700 placeholder-gray-400'}`}
            />
            <button type="button" onClick={handleAdd} className="text-green-400 hover:text-green-300">
              <Check size={18} />
            </button>
            <button type="button" onClick={() => setShowAdd(false)} className="text-gray-500 hover:text-gray-300">
              <X size={18} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
