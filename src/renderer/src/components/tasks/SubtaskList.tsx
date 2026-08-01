import { useState, useRef, useEffect, useMemo } from 'react'
import { Circle, CheckCircle2, Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'

export function SubtaskList({ taskId }: { taskId: string }) {
  const { t } = useTranslation()
  const tasks = useStore((s) => s.tasks)
  const addTask = useStore((s) => s.addTask)
  const toggleTask = useStore((s) => s.toggleTask)
  const removeTask = useStore((s) => s.removeTask)
  const theme = useStore((s) => s.theme)
  const isDark = theme === 'dark'
  const [newTitle, setNewTitle] = useState('')
  const [showInput, setShowInput] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const { subtasks, completedCount } = useMemo(() => {
    const subs = tasks.filter((t) => t.parentId === taskId)
    return { subtasks: subs, completedCount: subs.filter((t) => t.completed).length }
  }, [tasks, taskId])

  useEffect(() => {
    if (showInput) inputRef.current?.focus()
  }, [showInput])

  const handleAdd = async () => {
    if (!newTitle.trim()) return
    const parentTask = tasks.find((t) => t.id === taskId)
    await addTask(newTitle.trim(), {
      parentId: taskId,
      listId: parentTask?.listId
    })
    setNewTitle('')
    inputRef.current?.focus()
  }

  return (
    <div className="mt-3">
      {/* 헤더 */}
      {subtasks.length > 0 && (
        <div className={`text-xs mb-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          {t('detail.subtasks', { done: completedCount, total: subtasks.length })}
        </div>
      )}

      {/* 하위 작업 목록 */}
      <div className="space-y-0.5">
        {subtasks.map((subtask) => (
          <div
            key={subtask.id}
            className={`group flex items-center gap-2 px-2 py-1.5 rounded transition-colors ${
              isDark ? 'hover:bg-gray-700/50' : 'hover:bg-gray-100'
            }`}
          >
            {/* 체크박스 */}
            <button
              type="button"
              onClick={() => toggleTask(subtask.id)}
              className={`flex-shrink-0 transition-colors ${
                subtask.completed
                  ? 'text-primary-500'
                  : isDark
                    ? 'text-gray-500 hover:text-gray-300'
                    : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              {subtask.completed ? <CheckCircle2 size={16} /> : <Circle size={16} />}
            </button>

            {/* 제목 */}
            <span
              className={`flex-1 text-sm ${
                subtask.completed
                  ? isDark
                    ? 'text-gray-500 line-through'
                    : 'text-gray-400 line-through'
                  : isDark
                    ? 'text-gray-200'
                    : 'text-gray-700'
              }`}
            >
              {subtask.title}
            </span>

            {/* 삭제 버튼 */}
            <button
              type="button"
              onClick={() => removeTask(subtask.id)}
              className={`opacity-0 group-hover:opacity-100 flex-shrink-0 transition-opacity ${
                isDark ? 'text-gray-500 hover:text-red-400' : 'text-gray-400 hover:text-red-500'
              }`}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* 하위 작업 추가 */}
      {showInput ? (
        <div
          className={`flex items-center gap-2 px-2 py-1.5 mt-1 rounded border ${
            isDark ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200 bg-gray-50'
          }`}
        >
          <Circle size={16} className={isDark ? 'text-gray-600' : 'text-gray-300'} />
          <input
            ref={inputRef}
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter') handleAdd()
              if (e.key === 'Escape') {
                setShowInput(false)
                setNewTitle('')
              }
            }}
            placeholder={t('detail.addSubtaskPlaceholder')}
            className={`flex-1 bg-transparent text-sm outline-none ${
              isDark ? 'text-gray-200 placeholder-gray-600' : 'text-gray-700 placeholder-gray-400'
            }`}
          />
          <button
            type="button"
            onClick={() => {
              setShowInput(false)
              setNewTitle('')
            }}
            className={isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'}
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowInput(true)}
          className={`flex items-center gap-2 px-2 py-1.5 mt-1 text-sm rounded transition-colors w-full ${
            isDark
              ? 'text-gray-500 hover:text-gray-300 hover:bg-gray-700/50'
              : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
          }`}
        >
          <Plus size={16} />
          {t('detail.addSubtask')}
        </button>
      )}
    </div>
  )
}
