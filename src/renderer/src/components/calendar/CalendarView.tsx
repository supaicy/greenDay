import { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import { tList } from '../../i18n'
import { getCalendarDays, formatDate, toDateString } from '../../utils/date'
import { DND_MIME } from '../../utils/dnd'
import { isTopLevel } from '../../utils/smartLists'
import { isToday, isSameMonth } from 'date-fns'

// 월간 캘린더의 날짜 간 이동은 DND_MIME.CAL_DATE 사용 — 주/일 뷰의 시간블록
// 드래그(DND_MIME.TASK_BLOCK)와 MIME을 분리해 서로 오탐되지 않게 한다.

export function CalendarView() {
  const { t } = useTranslation()
  const tasks = useStore((s) => s.tasks)
  const selectTask = useStore((s) => s.selectTask)
  const updateTask = useStore((s) => s.updateTask)
  const theme = useStore((s) => s.theme)
  const isDark = theme === 'dark'
  const [currentDate, setCurrentDate] = useState(new Date())
  const [dragOverDate, setDragOverDate] = useState<string | null>(null)
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  const days = useMemo(() => getCalendarDays(year, month), [year, month])

  const tasksByDate = useMemo(() => {
    const map: Record<string, typeof tasks> = {}
    tasks
      // 하위작업 제외 — 월간 셀은 앞의 3개만 그리고 나머지를 '+n개'로 접으므로,
      // 새어 나온 하위작업이 진짜 최상위 할일을 밀어내 그날 할 일이 아예 안 보인다.
      // 게다가 이 카드는 draggable이라, 드롭하면 목록에 없는 하위작업의 마감일이
      // 바뀐다(updateTask({ id, dueDate })).
      .filter((t) => t.dueDate && !t.completed && !t.deletedAt && isTopLevel(t))
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

  const WEEKDAYS = tList('date.weekdaysShort')

  return (
    <div className={`flex-1 flex flex-col min-h-0 ${isDark ? 'bg-[#1C1C1E]' : 'bg-white'}`}>
      <div
        className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? 'border-gray-800' : 'border-gray-200'}`}
      >
        <div className="flex items-center gap-4">
          <h1 className={`text-xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-800'}`}>
            {formatDate(currentDate, t('date.yearMonth'))}
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
              {t('common.today')}
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

            // 드롭 대상 강조. onDragLeave 는 자식(날짜숫자/태스크 버튼) 진입 시에도 발생해
            // 깜빡이므로 쓰지 않는다 — 다른 셀의 onDragOver 가 덮어쓰고, 드래그 종료 시
            // 소스 버튼의 onDragEnd 가 정리한다.
            const dropRing =
              dragOverDate !== dateStr
                ? ''
                : isDark
                  ? 'ring-2 ring-inset ring-primary-500 bg-primary-900/20'
                  : 'ring-2 ring-inset ring-primary-500 bg-primary-50'

            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: 날짜 셀은 태스크 드래그의 드롭 영역
              <div
                key={dateStr}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes(DND_MIME.CAL_DATE)) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (dragOverDate !== dateStr) setDragOverDate(dateStr)
                }}
                onDrop={(e) => {
                  const id = e.dataTransfer.getData(DND_MIME.CAL_DATE)
                  setDragOverDate(null)
                  if (id) updateTask({ id, dueDate: dateStr })
                }}
                className={`min-h-[100px] p-1.5 transition-colors ${isDark ? 'bg-[#1C1C1E]' : 'bg-white'} ${!sameMonth ? 'opacity-30' : ''} ${dropRing}`}
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
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DND_MIME.CAL_DATE, task.id)
                        e.dataTransfer.effectAllowed = 'move'
                      }}
                      onDragEnd={() => setDragOverDate(null)}
                      onClick={() => selectTask(task.id)}
                      title={t('calendar.dragHint')}
                      className={`w-full text-left text-[10px] px-1 py-0.5 rounded truncate transition-colors cursor-grab active:cursor-grabbing ${
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
                      {t('calendar.moreTasks', { n: dayTasks.length - 3 })}
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
