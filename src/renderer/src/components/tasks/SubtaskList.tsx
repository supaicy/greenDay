import { useState, useRef, useMemo } from 'react'
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
  const inputRef = useRef<HTMLInputElement>(null)

  const { subtasks, completedCount } = useMemo(() => {
    const subs = tasks.filter((t) => t.parentId === taskId)
    return { subtasks: subs, completedCount: subs.filter((t) => t.completed).length }
  }, [tasks, taskId])

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
    // mt-3을 두면 부모의 space-y와 겹쳐 블록 사이가 두 배로 벌어진다 — 간격은 부모가 소유.
    <div>
      {/* 헤더는 항목이 0개여도 그린다. 없으면 빈 상태에 회색 링크 두 줄만 남아
          그것이 무슨 섹션인지 알 수 없었다. */}
      <div className={`text-xs font-medium mb-1.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
        {t('detail.subtasks', { done: completedCount, total: subtasks.length })}
      </div>

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

      {/* 하위 작업 추가 — 입력을 항상 열어 둔다. 토글 링크는 높이가 입력칸과
          같아서 공간 이득이 0인데 클릭만 한 번 더 들었다(가운데 목록의
          '+ 할 일 추가'는 이미 항상 열린 입력이다). */}
      <div
        className={`flex items-center gap-2 px-2 py-1.5 mt-1 rounded border ${
          isDark ? 'border-surface-line bg-surface-sunken/40' : 'border-gray-200 bg-gray-50'
        }`}
      >
        <Plus size={16} className={isDark ? 'text-gray-400' : 'text-gray-400'} />
        <input
          ref={inputRef}
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter') handleAdd()
            if (e.key === 'Escape') {
              // 이 Escape는 여기서 쓴다 — 전역 단축키(useKeyboardShortcuts)가 선택까지
              // 해제해 상세 패널을 닫지 않도록 알린다.
              e.preventDefault()
              setNewTitle('')
            }
          }}
          placeholder={t('detail.addSubtask')}
          className={`flex-1 bg-transparent text-sm outline-none ${
            isDark ? 'text-gray-200 placeholder-gray-400' : 'text-gray-700 placeholder-gray-500'
          }`}
        />
      </div>
    </div>
  )
}
