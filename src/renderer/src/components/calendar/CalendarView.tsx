import { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { getCalendarDays, formatDate, toDateString } from '../../utils/date'
import { isToday, isSameMonth } from 'date-fns'

export function CalendarView() {
  const { tasks, selectTask, theme } = useStore()
  const isDark = theme === 'dark'
  const [currentDate, setCurrentDate] = useState(new Date())
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  const days = useMemo(() => getCalendarDays(year, month), [year, month])

  const tasksByDate = useMemo(() => {
    const map: Record<string, typeof tasks> = {}
    tasks
      .filter((t) => t.dueDate && !t.completed && !t.deletedAt)
      .forEach((t) => {
        const key = t.dueDate
        if (!key) return
        if (!map[key]) map[key] = []
        map[key].push(t)
      })
    return map
  }, [tasks])

  const prevMonth = () => setCurrentDate(new Date(year, month - 1))
  const nextMonth = () => setCurrentDate(new Date(year, month + 1))
  const goToday = () => setCurrentDate(new Date())

  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

  return (
    <div className={`flex-1 flex flex-col min-h-0 ${isDark ? 'bg-[#1C1C1E]' : 'bg-white'}`}>
      <div
        className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? 'border-gray-800' : 'border-gray-200'}`}
      >
        <div className="flex items-center gap-4">
          <h1 className={`text-xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-800'}`}>
            {formatDate(currentDate, 'yyyy년 M월')}
          </h1>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={prevMonth}
              className={`p-1 rounded transition-colors ${isDark ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-200 text-gray-500'}`}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              onClick={goToday}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${isDark ? 'text-gray-400 hover:bg-gray-800' : 'text-gray-500 hover:bg-gray-200'}`}
            >
              오늘
            </button>
            <button
              type="button"
              onClick={nextMonth}
              className={`p-1 rounded transition-colors ${isDark ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-200 text-gray-500'}`}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-7 mb-2">
          {WEEKDAYS.map((day, i) => (
            <div
              key={day}
              className={`text-center text-xs font-medium py-2 ${
                i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : isDark ? 'text-gray-500' : 'text-gray-400'
              }`}
            >
              {day}
            </div>
          ))}
        </div>

        <div
          className={`grid grid-cols-7 gap-px rounded-lg overflow-hidden ${isDark ? 'bg-gray-800/30' : 'bg-gray-200'}`}
        >
          {days.map((day) => {
            const dateStr = toDateString(day)
            const dayTasks = tasksByDate[dateStr] || []
            const today = isToday(day)
            const sameMonth = isSameMonth(day, currentDate)

            return (
              <div
                key={dateStr}
                className={`min-h-[100px] p-1.5 ${isDark ? 'bg-[#1C1C1E]' : 'bg-white'} ${!sameMonth ? 'opacity-30' : ''}`}
              >
                <div
                  className={`text-xs mb-1 w-6 h-6 flex items-center justify-center rounded-full ${
                    today ? 'bg-primary-500 text-white font-bold' : isDark ? 'text-gray-400' : 'text-gray-600'
                  }`}
                >
                  {day.getDate()}
                </div>
                <div className="space-y-0.5">
                  {dayTasks.slice(0, 3).map((task) => (
                    <button
                      type="button"
                      key={task.id}
                      onClick={() => selectTask(task.id)}
                      className={`w-full text-left text-[10px] px-1 py-0.5 rounded truncate transition-colors ${
                        isDark
                          ? 'bg-primary-900/40 text-primary-300 hover:bg-primary-900/60'
                          : 'bg-primary-100 text-primary-700 hover:bg-primary-200'
                      }`}
                    >
                      {task.title}
                    </button>
                  ))}
                  {dayTasks.length > 3 && (
                    <span className={`text-[10px] px-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      +{dayTasks.length - 3}개
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
