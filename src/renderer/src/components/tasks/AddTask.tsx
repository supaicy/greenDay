import { useState, useRef, useEffect } from 'react'
import { Calendar, Flag, X, Sparkles, Loader2 } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { parseNaturalDateTime } from '../../utils/naturalDate'
import { formatDueDate } from '../../utils/date'
import type { Priority } from '../../types'
import { useTranslation } from 'react-i18next'
import { PRIORITY_OPTIONS } from '../../utils/priority'
import { isVirtualSmartList } from '../../utils/smartLists'

export function AddTask({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const { addTask, selectedListId, theme, aiCreateTaskFromNL, aiConnected } = useStore()
  const isDark = theme === 'dark'
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState<Priority>('none')
  const [showPriority, setShowPriority] = useState(false)
  const [naturalDateHint, setNaturalDateHint] = useState<string | null>(null)
  const [naturalTimeHint, setNaturalTimeHint] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 자연어 날짜+시간 감지
  useEffect(() => {
    if (!title.trim()) {
      setNaturalDateHint(null)
      setNaturalTimeHint(null)
      return
    }
    const parsed = parseNaturalDateTime(title.trim())
    if (parsed) {
      const words = title.trim().split(/\s+/)
      // 날짜+시간 토큰을 제외한 나머지가 제목이 되어야 함
      if (words.length > parsed.consumed) {
        setNaturalDateHint(parsed.date)
        setNaturalTimeHint(parsed.time)
      } else {
        setNaturalDateHint(null)
        setNaturalTimeHint(null)
      }
    } else {
      setNaturalDateHint(null)
      setNaturalTimeHint(null)
    }
  }, [title])

  const handleAiCreate = async () => {
    if (!title.trim() || aiLoading) return
    setAiLoading(true)
    try {
      const result = await aiCreateTaskFromNL(title.trim())
      if (result) {
        const listId = isVirtualSmartList(selectedListId as string) ? undefined : (selectedListId as string)
        // 메인 태스크 생성
        await addTask(result.title, {
          listId,
          dueDate: result.dueDate,
          dueTime: result.dueTime,
          priority: result.priority
        })
        // 서브태스크 생성
        if (result.subtasks?.length > 0) {
          const parentTask = useStore.getState().tasks.find((t) => t.title === result.title)
          if (parentTask) {
            for (const sub of result.subtasks) {
              await addTask(sub.title, { listId, parentId: parentTask.id, dueDate: sub.dueDate })
            }
          }
        }
        setTitle('')
        setDueDate('')
        setPriority('none')
        setNaturalDateHint(null)
        setNaturalTimeHint(null)
        setAiLoading(false)
        inputRef.current?.focus()
        return
      }
    } catch {
      /* AI 실패 시 아래 일반 생성으로 폴백 */
    }
    setAiLoading(false)
  }

  const handleSubmit = async () => {
    if (!title.trim()) return
    let finalTitle = title.trim()
    let finalDueDate = dueDate || null

    // 자연어 날짜+시간이 감지되면 적용
    let finalDueTime: string | null = null
    if (naturalDateHint && !dueDate) {
      const parsed = parseNaturalDateTime(finalTitle)
      if (parsed) {
        const words = finalTitle.split(/\s+/)
        finalTitle = words.slice(parsed.consumed).join(' ')
        finalDueDate = parsed.date
        finalDueTime = parsed.time
      }
    }

    if (!finalTitle) return

    const listId = isVirtualSmartList(selectedListId as string) ? undefined : (selectedListId as string)
    await addTask(finalTitle, { listId, dueDate: finalDueDate, dueTime: finalDueTime, priority })
    setTitle('')
    setDueDate('')
    setPriority('none')
    setNaturalDateHint(null)
    setNaturalTimeHint(null)
    inputRef.current?.focus()
  }

  return (
    <div
      className={`border rounded-lg mx-4 mb-3 ${isDark ? 'border-primary-500/50 bg-gray-800/50' : 'border-primary-300 bg-gray-50'}`}
    >
      <div className="flex items-center px-3 py-2">
        <input
          ref={inputRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter') handleSubmit()
            if (e.key === 'Escape') onClose()
          }}
          placeholder={t('task.placeholder')}
          className={`flex-1 bg-transparent text-sm outline-none ${isDark ? 'text-gray-100 placeholder-gray-500' : 'text-gray-800 placeholder-gray-400'}`}
        />
        <button
          type="button"
          onClick={onClose}
          className={`ml-2 ${isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'}`}
        >
          <X size={16} />
        </button>
      </div>

      {/* 자연어 날짜 힌트 */}
      {naturalDateHint && (
        <div className={`px-3 py-1 text-xs ${isDark ? 'text-primary-400' : 'text-primary-600'}`}>
          📅 {formatDueDate(naturalDateHint)}
          {naturalTimeHint ? ` ${naturalTimeHint}` : ''}{' '}
          {t('task.dueSetTo', { date: naturalDateHint, time: naturalTimeHint ? ` ${naturalTimeHint}` : '' })}
        </div>
      )}

      <div className={`flex items-center gap-2 px-3 py-2 border-t ${isDark ? 'border-gray-700' : 'border-gray-300'}`}>
        <div className="relative">
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer w-full"
          />
          <span
            className={`flex items-center gap-1 text-xs px-2 py-1 rounded cursor-pointer transition-colors ${
              dueDate
                ? 'text-primary-400 bg-primary-900/30'
                : isDark
                  ? 'text-gray-500 hover:bg-gray-700'
                  : 'text-gray-400 hover:bg-gray-200'
            }`}
          >
            <Calendar size={14} />
            {dueDate || t('task.dueDate')}
          </span>
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setShowPriority(!showPriority)}
            className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${
              priority !== 'none'
                ? PRIORITY_OPTIONS.find((p) => p.value === priority)?.color + (isDark ? ' bg-gray-700' : ' bg-gray-200')
                : isDark
                  ? 'text-gray-500 hover:bg-gray-700'
                  : 'text-gray-400 hover:bg-gray-200'
            }`}
          >
            <Flag size={14} />
            {t(PRIORITY_OPTIONS.find((p) => p.value === priority)?.labelKey ?? 'priority.none')}
          </button>
          {showPriority && (
            <div
              className={`absolute left-0 top-full mt-1 rounded-lg shadow-xl py-1 z-50 min-w-[100px] ${isDark ? 'bg-gray-700' : 'bg-white border border-gray-200'}`}
            >
              {PRIORITY_OPTIONS.map((opt) => (
                <button
                  type="button"
                  key={opt.value}
                  onClick={() => {
                    setPriority(opt.value)
                    setShowPriority(false)
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs ${isDark ? 'hover:bg-gray-600' : 'hover:bg-gray-100'} ${opt.color}`}
                >
                  {t(opt.labelKey)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1" />
        {aiConnected && (
          <button
            type="button"
            onClick={handleAiCreate}
            disabled={!title.trim() || aiLoading}
            className="text-xs px-3 py-1 rounded bg-blue-600 text-white disabled:opacity-30 hover:bg-blue-700 transition-colors flex items-center gap-1"
            title={t('task.aiAutofill')}
          >
            {aiLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            AI
          </button>
        )}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!title.trim()}
          className="text-xs px-3 py-1 rounded bg-primary-500 text-white disabled:opacity-30 hover:bg-primary-600 transition-colors"
        >
          {t('task.add')}
        </button>
      </div>
    </div>
  )
}
