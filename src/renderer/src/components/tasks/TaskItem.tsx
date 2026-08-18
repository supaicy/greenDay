import { memo } from 'react'
import { Circle, CheckCircle2, Flag, Calendar, Pin, Square, CheckSquare2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import { formatDateRange, isOverdue } from '../../utils/date'
import { DND_MIME } from '../../utils/dnd'
import { TaskContextMenu } from './TaskContextMenu'
import type { Task } from '../../types'

const PRIORITY_COLORS = {
  none: 'text-gray-500',
  low: 'text-blue-400',
  medium: 'text-amber-400',
  high: 'text-red-400'
}

/** 선택된 행 왼쪽 액센트 바 색. 위 글자색과 같은 계열의 면색이다. */
const PRIORITY_BAR: Record<keyof typeof PRIORITY_COLORS, string> = {
  none: 'bg-gray-500',
  low: 'bg-blue-400',
  medium: 'bg-amber-400',
  high: 'bg-red-400'
}

// 서브태스크 카운트를 위한 셀렉터 (각 값을 개별 구독하여 불필요한 리렌더 방지)
function useSubtaskCount(taskId: string) {
  const total = useStore((s) => {
    let count = 0
    for (const t of s.tasks) {
      if (t.parentId === taskId) count++
    }
    return count
  })
  const completed = useStore((s) => {
    let count = 0
    for (const t of s.tasks) {
      if (t.parentId === taskId && t.completed) count++
    }
    return count
  })
  return { total, completed }
}

export const TaskItem = memo(function TaskItem({ task, onDrop }: { task: Task; onDrop?: (targetId: string) => void }) {
  const { t } = useTranslation()
  const toggleTask = useStore((s) => s.toggleTask)
  const selectTask = useStore((s) => s.selectTask)
  const selectedTaskId = useStore((s) => s.selectedTaskId)
  const theme = useStore((s) => s.theme)
  const batchMode = useStore((s) => s.batchMode)
  const batchSelectedIds = useStore((s) => s.batchSelectedIds)
  const toggleBatchSelect = useStore((s) => s.toggleBatchSelect)
  const dragTaskId = useStore((s) => s.dragTaskId)
  const setDragTaskId = useStore((s) => s.setDragTaskId)

  const overdue = isOverdue(task.dueDate) && !task.completed
  const isDark = theme === 'dark'
  const isBatchSelected = batchSelectedIds.includes(task.id)

  const { total: subtaskCount, completed: completedSubtasks } = useSubtaskCount(task.id)

  return (
    <TaskContextMenu task={task}>
      {/* biome-ignore lint/a11y/useSemanticElements: 드래그/컨텍스트메뉴/중첩 button 포함으로 <button> 전환 불가 */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => (batchMode ? toggleBatchSelect(task.id) : selectTask(task.id))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            batchMode ? toggleBatchSelect(task.id) : selectTask(task.id)
          }
        }}
        draggable={!batchMode}
        onDragStart={(e) => {
          setDragTaskId(task.id)
          e.dataTransfer.setData(DND_MIME.TASK_ID, task.id)
          e.dataTransfer.effectAllowed = 'copy'
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
        }}
        onDrop={(e) => {
          e.preventDefault()
          onDrop?.(task.id)
        }}
        onDragEnd={() => setDragTaskId(null)}
        // 선택/일괄선택 표시는 왼쪽 액센트 바 + 중립 표면색이다. 예전에는 남색
        // (primary-900/30)을 깔았는데, 옆에 붙는 상세 패널·사이드바가 채도 3%의
        // 중립 회색(#2C2C2E)이라 큰 면이 맞붙으면 선택 행만 색 계열이 달라 붕 떴다.
        className={`group relative flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors ${
          isDark ? 'border-b border-gray-800/50' : 'border-b border-gray-200'
        } ${dragTaskId === task.id ? 'opacity-40' : ''} ${
          isBatchSelected || selectedTaskId === task.id
            ? isDark
              ? 'bg-surface-raised'
              : 'bg-gray-100'
            : isDark
              ? 'hover:bg-gray-800/30'
              : 'hover:bg-gray-50'
        }`}
      >
        {/* 선택 표시: 색이 중립이 된 만큼 왼쪽 액센트 바로 명확히 알린다.
            일괄 선택은 파랑, 단일 선택은 그 할일의 우선순위 색을 쓴다. */}
        {(isBatchSelected || selectedTaskId === task.id) && (
          <span
            aria-hidden
            className={`absolute left-0 top-0 bottom-0 w-[3px] rounded-r ${
              isBatchSelected ? 'bg-primary-500' : PRIORITY_BAR[task.priority]
            }`}
          />
        )}

        {/* 일괄 선택 또는 체크박스 */}
        {batchMode ? (
          <span
            className={`mt-0.5 flex-shrink-0 ${isBatchSelected ? 'text-primary-500' : isDark ? 'text-gray-500' : 'text-gray-400'}`}
          >
            {isBatchSelected ? <CheckSquare2 size={20} /> : <Square size={20} />}
          </span>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              toggleTask(task.id)
            }}
            className={`mt-0.5 flex-shrink-0 transition-colors ${task.completed ? 'text-primary-500' : PRIORITY_COLORS[task.priority]}`}
          >
            {task.completed ? <CheckCircle2 size={20} /> : <Circle size={20} />}
          </button>
        )}

        <div className="flex-1 min-w-0">
          <p
            className={`text-sm leading-snug ${
              task.completed
                ? isDark
                  ? 'text-gray-500 line-through'
                  : 'text-gray-400 line-through'
                : isDark
                  ? 'text-gray-100'
                  : 'text-gray-800'
            }`}
          >
            {task.title}
          </p>

          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {task.dueDate && (
              <span
                className={`flex items-center gap-1 text-xs ${overdue ? 'text-red-400' : isDark ? 'text-gray-500' : 'text-gray-400'}`}
              >
                <Calendar size={12} />
                {formatDateRange(task.startDate, task.dueDate, task.dueTime)}
              </span>
            )}
            {task.priority !== 'none' && (
              <span className={`flex items-center gap-1 text-xs ${PRIORITY_COLORS[task.priority]}`}>
                <Flag size={12} />
                {t(`priority.${task.priority}`)}
              </span>
            )}
            {task.pinned && (
              <span className="flex items-center gap-1 text-xs text-primary-400" title={t('task.pin')}>
                <Pin size={12} />
              </span>
            )}
            {task.isRecurring && <span className="text-xs text-purple-400">🔄 {t('task.recurring')}</span>}
            {subtaskCount > 0 && (
              <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                ✓ {completedSubtasks}/{subtaskCount}
              </span>
            )}
            {task.tags.map((tag) => (
              <span
                key={tag}
                className={`text-xs px-1.5 py-0.5 rounded ${isDark ? 'bg-gray-700 text-gray-400' : 'bg-gray-200 text-gray-500'}`}
              >
                {tag}
              </span>
            ))}
            {task.attachments.length > 0 && (
              <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                📎 {task.attachments.length}
              </span>
            )}
          </div>
        </div>
      </div>
    </TaskContextMenu>
  )
})
