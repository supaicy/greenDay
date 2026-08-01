import type React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import { toDateString } from '../../utils/date'
import type { Task } from '../../types'
import { CheckCircle2, Circle, Flag, Zap, Target, Clock, Coffee } from 'lucide-react'
import { PRIORITY_COLOR, PRIORITY_ORDER } from '../../utils/priority'

interface Quadrant {
  id: 'do' | 'schedule' | 'delegate' | 'eliminate'
  titleKey: string
  subtitleKey: string
  icon: React.ReactNode
  borderColor: string
  headerBg: string
  tasks: Task[]
}

export function EisenhowerMatrix(): React.ReactElement {
  const { t } = useTranslation()
  const { theme, tasks, selectTask, selectedTaskId, toggleTask } = useStore()
  const isDark = theme === 'dark'

  const quadrants = useMemo(() => {
    const now = new Date()
    const _todayStr = toDateString(now)

    // "곧" = 3일 이내
    const soonDate = new Date(now)
    soonDate.setDate(soonDate.getDate() + 3)
    const soonStr = toDateString(soonDate)

    const activeTasks = tasks.filter((t) => !t.completed && !t.deletedAt)

    const doNow: Task[] = [] // 긴급 + 중요
    const schedule: Task[] = [] // 중요 + 긴급하지 않음
    const delegate: Task[] = [] // 긴급 + 중요하지 않음
    const eliminate: Task[] = [] // 둘 다 아님

    for (const task of activeTasks) {
      const isHighPriority = task.priority === 'high' || task.priority === 'medium'
      const isDueSoon = task.dueDate !== null && task.dueDate <= soonStr

      if (isHighPriority && isDueSoon) {
        doNow.push(task)
      } else if (isHighPriority && !isDueSoon) {
        schedule.push(task)
      } else if (!isHighPriority && isDueSoon) {
        delegate.push(task)
      } else {
        eliminate.push(task)
      }
    }

    // 우선순위 + 마감일 순 정렬
    const sortFn = (a: Task, b: Task) => {
      const pDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
      if (pDiff !== 0) return pDiff
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate)
      if (a.dueDate) return -1
      if (b.dueDate) return 1
      return 0
    }

    doNow.sort(sortFn)
    schedule.sort(sortFn)
    delegate.sort(sortFn)
    eliminate.sort(sortFn)

    const result: Quadrant[] = [
      {
        id: 'do',
        titleKey: 'eisenhower.doTitle',
        subtitleKey: 'eisenhower.doSubtitle',
        icon: <Zap size={16} />,
        borderColor: isDark ? 'border-red-500/50' : 'border-red-300',
        headerBg: isDark ? 'bg-red-500/10' : 'bg-red-50',
        tasks: doNow
      },
      {
        id: 'schedule',
        titleKey: 'eisenhower.scheduleTitle',
        subtitleKey: 'eisenhower.scheduleSubtitle',
        icon: <Target size={16} />,
        borderColor: isDark ? 'border-blue-500/50' : 'border-blue-300',
        headerBg: isDark ? 'bg-blue-500/10' : 'bg-blue-50',
        tasks: schedule
      },
      {
        id: 'delegate',
        titleKey: 'eisenhower.delegateTitle',
        subtitleKey: 'eisenhower.delegateSubtitle',
        icon: <Clock size={16} />,
        borderColor: isDark ? 'border-amber-500/50' : 'border-amber-300',
        headerBg: isDark ? 'bg-amber-500/10' : 'bg-amber-50',
        tasks: delegate
      },
      {
        id: 'eliminate',
        titleKey: 'eisenhower.eliminateTitle',
        subtitleKey: 'eisenhower.eliminateSubtitle',
        icon: <Coffee size={16} />,
        borderColor: isDark ? 'border-gray-600' : 'border-gray-300',
        headerBg: isDark ? 'bg-gray-800' : 'bg-gray-50',
        tasks: eliminate
      }
    ]

    return result
  }, [tasks, isDark])

  // 태스크 항목: 중첩된 button(체크박스) 포함으로 <button> 전환 불가 → Pattern B
  const renderTaskItem = (task: Task) => (
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
      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer transition-colors ${
        selectedTaskId === task.id
          ? isDark
            ? 'bg-blue-900/30'
            : 'bg-blue-100'
          : isDark
            ? 'hover:bg-gray-700/50'
            : 'hover:bg-gray-100'
      }`}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          toggleTask(task.id)
        }}
        className="flex-shrink-0"
      >
        {task.completed ? (
          <CheckCircle2 size={14} className="text-green-500" />
        ) : (
          <Circle size={14} className={isDark ? 'text-gray-500' : 'text-gray-400'} />
        )}
      </button>

      <span className={`flex-1 text-xs truncate ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{task.title}</span>

      {task.priority !== 'none' && <Flag size={10} className={`flex-shrink-0 ${PRIORITY_COLOR[task.priority]}`} />}

      {task.dueDate && (
        <span
          className={`text-[10px] flex-shrink-0 ${
            task.dueDate < new Date().toISOString().split('T')[0]
              ? 'text-red-500'
              : isDark
                ? 'text-gray-500'
                : 'text-gray-400'
          }`}
        >
          {task.dueDate.slice(5)}
        </span>
      )}
    </div>
  )

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* 헤더 */}
      <div className={`px-6 py-4 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
        <h2 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('eisenhower.title')}</h2>
        <p className={`text-sm mt-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          {t('eisenhower.subtitle')}
        </p>
      </div>

      {/* 축 라벨 */}
      <div className="flex-1 flex flex-col overflow-hidden p-4">
        {/* 상단 라벨 */}
        <div className="flex mb-2">
          <div className="w-12" />
          <div className="flex-1 flex">
            <div className={`flex-1 text-center text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              {t('eisenhower.urgent')}
            </div>
            <div className={`flex-1 text-center text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              {t('eisenhower.notUrgent')}
            </div>
          </div>
        </div>

        {/* 매트릭스 그리드 */}
        <div className="flex-1 flex overflow-hidden">
          {/* 왼쪽 라벨 */}
          <div className="w-12 flex flex-col justify-around">
            <div
              className={`text-xs font-medium writing-mode-vertical transform -rotate-180 text-center ${
                isDark ? 'text-gray-400' : 'text-gray-500'
              }`}
              style={{ writingMode: 'vertical-rl' }}
            >
              {t('eisenhower.important')}
            </div>
            <div
              className={`text-xs font-medium transform -rotate-180 text-center ${
                isDark ? 'text-gray-400' : 'text-gray-500'
              }`}
              style={{ writingMode: 'vertical-rl' }}
            >
              {t('eisenhower.notImportant')}
            </div>
          </div>

          {/* 2x2 그리드 */}
          <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-3 overflow-hidden">
            {quadrants.map((q) => (
              <div key={q.id} className={`flex flex-col rounded-xl border ${q.borderColor} overflow-hidden`}>
                {/* 사분면 헤더 */}
                <div className={`px-3 py-2 ${q.headerBg} flex items-center gap-2`}>
                  <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>{q.icon}</span>
                  <div>
                    <h3 className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>{t(q.titleKey)}</h3>
                    <p className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{t(q.subtitleKey)}</p>
                  </div>
                  <span
                    className={`ml-auto text-xs px-1.5 py-0.5 rounded-full ${
                      isDark ? 'bg-gray-700 text-gray-400' : 'bg-white text-gray-500'
                    }`}
                  >
                    {q.tasks.length}
                  </span>
                </div>

                {/* 태스크 목록 */}
                <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                  {q.tasks.length === 0 ? (
                    <div className={`text-center py-4 text-xs ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>{t('common.none')}</div>
                  ) : (
                    q.tasks.map(renderTaskItem)
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
