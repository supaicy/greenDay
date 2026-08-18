import type React from 'react'
import { useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import { useToday } from '../../hooks/useToday'
import type { Task } from '../../types'
import { CheckCircle2, Circle, Flag, GripVertical, Calendar } from 'lucide-react'
import { PRIORITY_COLOR, byPinned, byPinnedThenPriority } from '../../utils/priority'
import { isTopLevel } from '../../utils/smartLists'

interface ColumnDef {
  id: 'todo' | 'inProgress' | 'done'
  titleKey: string
  emptyKey: string
}

const columns: ColumnDef[] = [
  { id: 'todo', titleKey: 'kanban.todo', emptyKey: 'kanban.todoEmpty' },
  { id: 'inProgress', titleKey: 'kanban.inProgress', emptyKey: 'kanban.inProgressEmpty' },
  { id: 'done', titleKey: 'kanban.done', emptyKey: 'kanban.doneEmpty' }
]

export function KanbanView(): React.ReactElement {
  const { t } = useTranslation()
  const theme = useStore((s) => s.theme)
  const tasks = useStore((s) => s.tasks)
  const selectTask = useStore((s) => s.selectTask)
  const selectedTaskId = useStore((s) => s.selectedTaskId)
  const toggleTask = useStore((s) => s.toggleTask)
  const updateTask = useStore((s) => s.updateTask)
  const isDark = theme === 'dark'

  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null)
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null)

  const todayStr = useToday()

  // 칸반 칼럼별 태스크 분류
  const columnTasks = useMemo(() => {
    // 완료된 것도 '완료' 칼럼에 서야 하므로 isActiveTopLevel이 아니라 isTopLevel을 쓴다.
    const boardTasks = tasks.filter((t) => !t.deletedAt && isTopLevel(t))

    const todo: Task[] = []
    const inProgress: Task[] = []
    const done: Task[] = []

    for (const task of boardTasks) {
      if (task.completed) {
        done.push(task)
      } else if ((task.dueDate && task.dueDate <= todayStr) || (task.startDate && task.startDate <= todayStr)) {
        // 오늘 또는 과거 마감일 = 진행 중. 기간이 이미 시작됐다면 마감이 아직
        // 남았어도 진행 중이다 — 그게 기간을 지정한 이유다.
        inProgress.push(task)
      } else {
        todo.push(task)
      }
    }

    todo.sort(byPinnedThenPriority)
    inProgress.sort(byPinnedThenPriority)
    // 완료 열만 빠지면 고정한 할일이 완료되는 순간 아무 데나 떨어진다 —
    // '고정은 어떤 정렬 기준보다 앞선다'는 규칙은 여기에도 적용된다.
    done.sort((a, b) => {
      const pin = byPinned(a, b)
      if (pin !== 0) return pin
      // 완료된 것은 최근 완료 순
      if (a.completedAt && b.completedAt) return b.completedAt.localeCompare(a.completedAt)
      return 0
    })

    return { todo, inProgress, done }
  }, [tasks, todayStr])

  // 드래그 앤 드롭 핸들러
  const handleDragStart = useCallback((e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData('text/plain', taskId)
    e.dataTransfer.effectAllowed = 'move'
    setDraggingTaskId(taskId)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, columnId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverColumn(columnId)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOverColumn(null)
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent, columnId: string) => {
      e.preventDefault()
      setDragOverColumn(null)
      setDraggingTaskId(null)

      const taskId = e.dataTransfer.getData('text/plain')
      if (!taskId) return

      const task = tasks.find((t) => t.id === taskId)
      if (!task) return

      if (columnId === 'done') {
        // 완료 처리
        if (!task.completed) {
          await toggleTask(taskId)
        }
      } else if (columnId === 'inProgress') {
        // 진행 중: 오늘 날짜 설정 + 미완료
        const updates: Partial<Task> & { id: string } = { id: taskId, dueDate: todayStr }
        if (task.completed) {
          updates.completed = false
          updates.completedAt = null
        }
        await updateTask(updates)
      } else if (columnId === 'todo') {
        // 할 일: 마감일 제거 (오늘 이후거나 없음) + 미완료
        const updates: Partial<Task> & { id: string } = { id: taskId }
        if (task.completed) {
          updates.completed = false
          updates.completedAt = null
        }
        // 오늘 이하 마감일이면 제거
        if (task.dueDate && task.dueDate <= todayStr) {
          updates.dueDate = null
        }
        await updateTask(updates)
      }
    },
    [tasks, toggleTask, updateTask, todayStr]
  )

  const handleDragEnd = useCallback(() => {
    setDraggingTaskId(null)
    setDragOverColumn(null)
  }, [])

  // 칼럼 배경색
  const getColumnBg = (columnId: string) => {
    if (dragOverColumn === columnId) {
      return isDark ? 'bg-gray-700/50' : 'bg-blue-50'
    }
    return isDark ? 'bg-gray-800/50' : 'bg-gray-50'
  }

  // 칼럼 헤더 색상
  const getHeaderColor = (columnId: string) => {
    switch (columnId) {
      case 'todo':
        return isDark ? 'border-blue-500' : 'border-blue-400'
      case 'inProgress':
        return isDark ? 'border-amber-500' : 'border-amber-400'
      case 'done':
        return isDark ? 'border-green-500' : 'border-green-400'
      default:
        return ''
    }
  }

  const getTasksForColumn = (columnId: string): Task[] => {
    switch (columnId) {
      case 'todo':
        return columnTasks.todo
      case 'inProgress':
        return columnTasks.inProgress
      case 'done':
        return columnTasks.done
      default:
        return []
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* 헤더 */}
      <div className={`px-6 py-4 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
        <h2 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('kanban.title')}</h2>
      </div>

      {/* 칸반 보드 */}
      <div className="flex-1 flex gap-4 p-4 overflow-x-auto">
        {columns.map((col) => {
          const colTasks = getTasksForColumn(col.id)
          // 칸반 칼럼: 드래그 드롭 대상 (<section>으로 의미론적 표현)
          return (
            <section
              key={col.id}
              aria-label={t(col.titleKey)}
              className={`flex-1 min-w-[280px] flex flex-col rounded-xl border-t-2 ${getHeaderColor(col.id)} ${getColumnBg(col.id)} transition-colors`}
              onDragOver={(e) => handleDragOver(e, col.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, col.id)}
            >
              {/* 칼럼 헤더 */}
              <div className="px-4 py-3 flex items-center justify-between">
                <h3 className={`font-medium ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>{t(col.titleKey)}</h3>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    isDark ? 'bg-gray-700 text-gray-400' : 'bg-gray-200 text-gray-500'
                  }`}
                >
                  {colTasks.length}
                </span>
              </div>

              {/* 태스크 카드 목록 */}
              <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2">
                {colTasks.length === 0 ? (
                  <div className={`text-center py-8 text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    {t(col.emptyKey)}
                  </div>
                ) : (
                  colTasks.map((task) => {
                    // 태스크 카드: 드래그 + 클릭 + 중첩 button(체크박스) → Pattern B
                    return (
                      // biome-ignore lint/a11y/useSemanticElements: 중첩 button 포함으로 <button> 전환 불가
                      <div
                        key={task.id}
                        role="button"
                        tabIndex={0}
                        draggable
                        onDragStart={(e) => handleDragStart(e, task.id)}
                        onDragEnd={handleDragEnd}
                        onClick={() => selectTask(task.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            selectTask(task.id)
                          }
                        }}
                        className={`group rounded-lg p-3 cursor-pointer border transition-all ${
                          draggingTaskId === task.id ? 'opacity-40' : 'opacity-100'
                        } ${
                          selectedTaskId === task.id
                            ? isDark
                              ? 'border-blue-500 bg-gray-700'
                              : 'border-blue-400 bg-blue-50'
                            : isDark
                              ? 'border-gray-700 bg-gray-800 hover:border-gray-600'
                              : 'border-gray-200 bg-white hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          {/* 드래그 핸들 */}
                          <GripVertical
                            size={14}
                            className={`mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ${
                              isDark ? 'text-gray-500' : 'text-gray-400'
                            }`}
                          />

                          {/* 체크박스 */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleTask(task.id)
                            }}
                            className="flex-shrink-0 mt-0.5"
                          >
                            {task.completed ? (
                              <CheckCircle2 size={16} className="text-green-500" />
                            ) : (
                              <Circle size={16} className={isDark ? 'text-gray-500' : 'text-gray-400'} />
                            )}
                          </button>

                          {/* 내용 */}
                          <div className="flex-1 min-w-0">
                            <p
                              className={`text-sm leading-snug ${
                                task.completed
                                  ? 'line-through text-gray-500'
                                  : isDark
                                    ? 'text-gray-200'
                                    : 'text-gray-800'
                              }`}
                            >
                              {task.title}
                            </p>
                            <div className="flex items-center gap-2 mt-1.5">
                              {/* 우선순위 */}
                              {task.priority !== 'none' && <Flag size={12} className={PRIORITY_COLOR[task.priority]} />}
                              {/* 마감일 */}
                              {task.dueDate && (
                                <span
                                  className={`text-xs flex items-center gap-1 ${
                                    task.dueDate < todayStr && !task.completed
                                      ? 'text-red-500'
                                      : task.dueDate === todayStr
                                        ? 'text-amber-500'
                                        : isDark
                                          ? 'text-gray-400'
                                          : 'text-gray-500'
                                  }`}
                                >
                                  <Calendar size={10} />
                                  {task.dueDate}
                                </span>
                              )}
                              {/* 태그 */}
                              {task.tags.length > 0 && (
                                <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                                  #{task.tags[0]}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
