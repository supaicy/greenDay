import type React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import { toDateString } from '../../utils/date'
import type { Task } from '../../types'
import { CheckCircle2, Circle, Flag, Clock, AlertTriangle } from 'lucide-react'
import { PRIORITY_COLOR, PRIORITY_ORDER } from '../../utils/priority'

interface TimelineGroup {
  id: string
  labelKey: string
  icon: React.ReactNode
  tasks: Task[]
  color: string // 타임라인 원 색상
}

export function TimelineView(): React.ReactElement {
  const { t } = useTranslation()
  const { theme, tasks, selectTask, selectedTaskId, toggleTask } = useStore()
  const isDark = theme === 'dark'

  const groups = useMemo(() => {
    const now = new Date()
    const todayStr = toDateString(now)

    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = toDateString(tomorrow)

    // 이번 주 끝 (토요일)
    const endOfWeek = new Date(now)
    const dayOfWeek = endOfWeek.getDay()
    endOfWeek.setDate(endOfWeek.getDate() + (6 - dayOfWeek))
    const endOfWeekStr = toDateString(endOfWeek)

    const activeTasks = tasks.filter((t) => !t.completed && !t.deletedAt)

    const overdue: Task[] = []
    const today: Task[] = []
    const tomorrowTasks: Task[] = []
    const thisWeek: Task[] = []
    const later: Task[] = []
    const noDueDate: Task[] = []

    for (const task of activeTasks) {
      if (!task.dueDate) {
        noDueDate.push(task)
      } else if (task.dueDate < todayStr) {
        overdue.push(task)
      } else if (task.dueDate === todayStr) {
        today.push(task)
      } else if (task.dueDate === tomorrowStr) {
        tomorrowTasks.push(task)
      } else if (task.dueDate <= endOfWeekStr) {
        thisWeek.push(task)
      } else {
        later.push(task)
      }
    }

    // 각 그룹 우선순위 순 정렬
    const sortFn = (a: Task, b: Task) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
    overdue.sort(sortFn)
    today.sort(sortFn)
    tomorrowTasks.sort(sortFn)
    thisWeek.sort(sortFn)
    later.sort(sortFn)
    noDueDate.sort(sortFn)

    const result: TimelineGroup[] = []

    if (overdue.length > 0) {
      result.push({
        id: 'overdue',
        labelKey: 'timeline.overdue',
        icon: <AlertTriangle size={14} />,
        tasks: overdue,
        color: 'bg-red-500'
      })
    }
    if (today.length > 0) {
      result.push({
        id: 'today',
        labelKey: 'timeline.today',
        icon: <Clock size={14} />,
        tasks: today,
        color: 'bg-blue-500'
      })
    }
    if (tomorrowTasks.length > 0) {
      result.push({
        id: 'tomorrow',
        labelKey: 'timeline.tomorrow',
        icon: <Clock size={14} />,
        tasks: tomorrowTasks,
        color: 'bg-amber-500'
      })
    }
    if (thisWeek.length > 0) {
      result.push({
        id: 'thisWeek',
        labelKey: 'timeline.thisWeek',
        icon: <Clock size={14} />,
        tasks: thisWeek,
        color: 'bg-green-500'
      })
    }
    if (later.length > 0) {
      result.push({
        id: 'later',
        labelKey: 'timeline.later',
        icon: <Clock size={14} />,
        tasks: later,
        color: 'bg-gray-500'
      })
    }
    if (noDueDate.length > 0) {
      result.push({
        id: 'noDue',
        labelKey: 'timeline.noDueDate',
        icon: <Clock size={14} />,
        tasks: noDueDate,
        color: isDark ? 'bg-gray-600' : 'bg-gray-400'
      })
    }

    return result
  }, [tasks, isDark])

  const totalTasks = groups.reduce((sum, g) => sum + g.tasks.length, 0)

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* 헤더 */}
      <div className={`px-6 py-4 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
        <h2 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('timeline.title')}</h2>
        <p className={`text-sm mt-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{t('timeline.taskCount', { count: totalTasks })}</p>
      </div>

      {/* 타임라인 본문 */}
      <div className="flex-1 overflow-y-auto p-6">
        {groups.length === 0 ? (
          <div className={`text-center py-16 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            <Clock size={40} className="mx-auto mb-3 opacity-50" />
            <p>{t('task.empty')}</p>
          </div>
        ) : (
          <div className="relative">
            {groups.map((group, groupIdx) => (
              <div key={group.id} className="relative pl-8 pb-8">
                {/* 세로 타임라인 선 */}
                {groupIdx < groups.length - 1 && (
                  <div
                    className={`absolute left-[11px] top-6 bottom-0 w-0.5 ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`}
                  />
                )}

                {/* 타임라인 원 */}
                <div
                  className={`absolute left-0 top-1 w-6 h-6 rounded-full ${group.color} flex items-center justify-center`}
                >
                  <div className="text-white">{group.icon}</div>
                </div>

                {/* 그룹 라벨 */}
                <div className="mb-3">
                  <h3 className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
                    {t(group.labelKey)}
                  </h3>
                  <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    {t('task.count', { count: group.tasks.length })}
                  </span>
                </div>

                {/* 태스크 목록 */}
                <div className="space-y-1.5">
                  {group.tasks.map((task) => {
                    // 태스크 항목: 중첩 button(체크박스) 포함으로 <button> 전환 불가 → Pattern B
                    return (
                      // biome-ignore lint/a11y/useSemanticElements: 중첩 button 포함으로 <button> 전환 불가
                      <div
                        key={task.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => selectTask(task.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            selectTask(task.id)
                          }
                        }}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                          selectedTaskId === task.id
                            ? isDark
                              ? 'bg-blue-900/30 border border-blue-500/50'
                              : 'bg-blue-50 border border-blue-300'
                            : isDark
                              ? 'hover:bg-gray-800 border border-transparent'
                              : 'hover:bg-gray-100 border border-transparent'
                        }`}
                      >
                      {/* 체크박스 */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleTask(task.id)
                        }}
                        className="flex-shrink-0"
                      >
                        {task.completed ? (
                          <CheckCircle2 size={16} className="text-green-500" />
                        ) : (
                          <Circle size={16} className={isDark ? 'text-gray-500' : 'text-gray-400'} />
                        )}
                      </button>

                      {/* 제목 */}
                      <span className={`flex-1 text-sm truncate ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                        {task.title}
                      </span>

                      {/* 우선순위 */}
                      {task.priority !== 'none' && <Flag size={12} className={PRIORITY_COLOR[task.priority]} />}

                      {/* 시간 */}
                      {task.dueTime && (
                        <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{task.dueTime}</span>
                      )}

                      {/* 날짜 */}
                      {task.dueDate && (
                        <span
                          className={`text-xs ${
                            group.id === 'overdue' ? 'text-red-500' : isDark ? 'text-gray-500' : 'text-gray-400'
                          }`}
                        >
                          {task.dueDate}
                        </span>
                      )}
                    </div>
                  )})}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
