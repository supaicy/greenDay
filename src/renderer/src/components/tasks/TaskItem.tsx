import { useState, useRef, useEffect, memo } from 'react'
import { Circle, CheckCircle2, Flag, Calendar, Trash2, Copy, ArrowRight, Square, CheckSquare2 } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { formatDueDate, isOverdue } from '../../utils/date'
import { DND_MIME } from '../../utils/dnd'
import type { Task } from '../../types'

const PRIORITY_COLORS = {
  none: 'text-gray-500',
  low: 'text-blue-400',
  medium: 'text-yellow-400',
  high: 'text-red-400'
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
  const toggleTask = useStore((s) => s.toggleTask)
  const selectTask = useStore((s) => s.selectTask)
  const selectedTaskId = useStore((s) => s.selectedTaskId)
  const removeTask = useStore((s) => s.removeTask)
  const lists = useStore((s) => s.lists)
  const updateTask = useStore((s) => s.updateTask)
  const theme = useStore((s) => s.theme)
  const batchMode = useStore((s) => s.batchMode)
  const batchSelectedIds = useStore((s) => s.batchSelectedIds)
  const toggleBatchSelect = useStore((s) => s.toggleBatchSelect)
  const dragTaskId = useStore((s) => s.dragTaskId)
  const setDragTaskId = useStore((s) => s.setDragTaskId)

  const overdue = isOverdue(task.dueDate) && !task.completed
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [showMoveMenu, setShowMoveMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const isDark = theme === 'dark'
  const isBatchSelected = batchSelectedIds.includes(task.id)

  useEffect(() => {
    const handleClick = () => {
      setContextMenu(null)
      setShowMoveMenu(false)
    }
    if (contextMenu) {
      document.addEventListener('click', handleClick)
      return () => document.removeEventListener('click', handleClick)
    }
  }, [contextMenu])

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  const { total: subtaskCount, completed: completedSubtasks } = useSubtaskCount(task.id)

  return (
    <>
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
        onContextMenu={handleContextMenu}
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
        className={`group flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors ${
          isDark ? 'border-b border-gray-800/50' : 'border-b border-gray-200'
        } ${dragTaskId === task.id ? 'opacity-40' : ''} ${
          isBatchSelected
            ? isDark
              ? 'bg-primary-900/20'
              : 'bg-primary-50'
            : selectedTaskId === task.id
              ? isDark
                ? 'bg-primary-900/30'
                : 'bg-primary-50'
              : isDark
                ? 'hover:bg-gray-800/30'
                : 'hover:bg-gray-50'
        }`}
      >
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
                {formatDueDate(task.dueDate)}
                {task.dueTime ? ` ${task.dueTime}` : ''}
              </span>
            )}
            {task.priority !== 'none' && (
              <span className={`flex items-center gap-1 text-xs ${PRIORITY_COLORS[task.priority]}`}>
                <Flag size={12} />
                {{ low: '낮음', medium: '중간', high: '높음' }[task.priority]}
              </span>
            )}
            {task.isRecurring && <span className="text-xs text-purple-400">🔄 반복</span>}
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

      {/* 우클릭 컨텍스트 메뉴 */}
      {contextMenu && (
        // biome-ignore lint/a11y/noStaticElementInteractions: 컨텍스트 메뉴 컨테이너 — 중첩 button이 키보드 접근성 제공
        // biome-ignore lint/a11y/useKeyWithClickEvents: 컨텍스트 메뉴 컨테이너 — 중첩 button이 키보드 접근성 제공
        <div
          ref={menuRef}
          className={`fixed z-[100] rounded-lg shadow-2xl py-1 min-w-[180px] border ${isDark ? 'bg-[#2C2C2E] border-gray-700' : 'bg-white border-gray-200'}`}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              toggleTask(task.id)
              setContextMenu(null)
            }}
            className={`w-full flex items-center gap-3 px-4 py-2 text-sm ${isDark ? 'text-gray-200 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-100'}`}
          >
            <CheckCircle2 size={15} />
            {task.completed ? '미완료로 변경' : '완료로 변경'}
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setShowMoveMenu(!showMoveMenu)
              }}
              className={`w-full flex items-center gap-3 px-4 py-2 text-sm ${isDark ? 'text-gray-200 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-100'}`}
            >
              <ArrowRight size={15} />
              다른 리스트로 이동
            </button>
            {showMoveMenu && (
              <div
                className={`absolute left-full top-0 ml-1 rounded-lg shadow-2xl py-1 min-w-[140px] border ${isDark ? 'bg-[#2C2C2E] border-gray-700' : 'bg-white border-gray-200'}`}
              >
                {lists.map((list) => (
                  <button
                    type="button"
                    key={list.id}
                    onClick={() => {
                      updateTask({ id: task.id, listId: list.id })
                      setContextMenu(null)
                    }}
                    className={`w-full flex items-center gap-2 px-4 py-2 text-sm ${
                      task.listId === list.id
                        ? 'text-primary-400 font-medium'
                        : isDark
                          ? 'text-gray-200 hover:bg-gray-700'
                          : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: list.color }} />
                    {list.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(task.title)
              setContextMenu(null)
            }}
            className={`w-full flex items-center gap-3 px-4 py-2 text-sm ${isDark ? 'text-gray-200 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-100'}`}
          >
            <Copy size={15} />
            제목 복사
          </button>
          <div className={`my-1 ${isDark ? 'border-t border-gray-700' : 'border-t border-gray-200'}`} />
          <button
            type="button"
            onClick={() => {
              removeTask(task.id)
              setContextMenu(null)
            }}
            className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10"
          >
            <Trash2 size={15} />
            삭제
          </button>
        </div>
      )}
    </>
  )
})
