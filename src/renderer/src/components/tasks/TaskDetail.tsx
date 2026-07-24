import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { X, Trash2, Tag, List, Clock, Bell, Repeat, Calendar, Circle, CheckCircle2 } from 'lucide-react'
import { EditorView } from '@codemirror/view'
import { AtomicCodeMirrorEditor } from '@atomic-editor/editor'
import '@atomic-editor/editor/styles.css'
import { useStore } from '../../store/useStore'
import { SubtaskList } from './SubtaskList'
import { RecurringPicker } from './RecurringPicker'
import { ReminderPicker } from './ReminderPicker'
import { AttachmentList } from './AttachmentList'
import { PRIORITY_OPTIONS } from '../../utils/priority'
import { clampDetailHeight } from '../../store/detailHeight'
import type { Priority } from '../../types'

function formatScheduledRange(startIso: string, endIso: string): string {
  const start = new Date(startIso)
  const end = new Date(endIso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const date = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`
  const s = `${pad(start.getHours())}:${pad(start.getMinutes())}`
  const e = `${pad(end.getHours())}:${pad(end.getMinutes())}`
  return `${date} ${s}–${e}`
}

// CM6 테마 (Atomic엔 theme prop이 없어 extensions로 전달). 배경은 투명 —
// 부모 컬럼 배경을 그대로 쓰고, 본문 색만 앱 테마에 맞춰 대비를 확보한다.
// Atomic 기본 테마는 다크 지향(본문색 변수 --atomic-editor-fg: #dcddde)이라
// 라이트 배경에서 흐리다. 테마별로 이 변수를 덮어 대비를 맞춘다.
const DARK_EDITOR_THEME = EditorView.theme(
  {
    '&': { '--atomic-editor-fg': '#e5e5ea', backgroundColor: 'transparent' },
    '.cm-content': { caretColor: '#e5e5ea' },
    // 빈 줄에도 커서가 보이도록 최소 높이 확보
    '.cm-line': { minHeight: '1.4em' },
    '.cm-gutters': { backgroundColor: 'transparent', color: '#8e8e93', border: 'none' }
  },
  { dark: true }
)
const LIGHT_EDITOR_THEME = EditorView.theme(
  {
    '&': { '--atomic-editor-fg': '#1f2937', backgroundColor: 'transparent' },
    '.cm-content': { caretColor: '#1f2937' },
    '.cm-line': { minHeight: '1.4em' },
    '.cm-gutters': { backgroundColor: 'transparent', color: '#9ca3af', border: 'none' }
  },
  { dark: false }
)

export function TaskDetail() {
  const { tasks, lists, selectedTaskId, selectTask, updateTask, removeTask, toggleTask, theme } = useStore()
  const detailHeight = useStore((s) => s.detailPanelHeightPx)
  const setDetailPanelHeightPx = useStore((s) => s.setDetailPanelHeightPx)
  const task = tasks.find((t) => t.id === selectedTaskId)
  const isDark = theme === 'dark'

  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [dueTime, setDueTime] = useState('')
  const [priority, setPriority] = useState<Priority>('none')
  const [listId, setListId] = useState('inbox')
  const [tagInput, setTagInput] = useState('')
  const [showRecurring, setShowRecurring] = useState(false)
  const [showReminder, setShowReminder] = useState(false)
  // 드래그 중 라이브 높이(px). null이면 저장값 사용. mouseup에서만 persist.
  const [dragHeight, setDragHeight] = useState<number | null>(null)
  // 열릴 때 아래에서 슬라이드업
  const [shown, setShown] = useState(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: form state resets only when a different task is selected; watching other fields would overwrite in-progress edits
  useEffect(() => {
    if (task) {
      setTitle(task.title)
      setDueDate(task.dueDate || '')
      setDueTime(task.dueTime || '')
      setPriority(task.priority)
      setListId(task.listId)
    }
  }, [task?.id])

  const panelRef = useRef<HTMLDivElement>(null)

  // 메모 저장: 편집 중엔 ref에 모으고 400ms 디바운스로 저장. 태스크 전환/언마운트 시 flush.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingNotes = useRef<string | null>(null)
  const flushNotes = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (pendingNotes.current != null && selectedTaskId) {
      updateTask({ id: selectedTaskId, description: pendingNotes.current })
      pendingNotes.current = null
    }
  }, [selectedTaskId, updateTask])
  const onNotesChange = useCallback(
    (md: string) => {
      pendingNotes.current = md
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(flushNotes, 400)
    },
    [flushNotes]
  )
  // 태스크 전환(flushNotes 재생성) / 언마운트 시 대기 중인 메모를 이전 태스크에 저장
  useEffect(() => flushNotes, [flushNotes])
  // 창 닫힘/종료 시 디바운스 대기 중인 메모 유실 방지
  useEffect(() => {
    window.addEventListener('beforeunload', flushNotes)
    return () => window.removeEventListener('beforeunload', flushNotes)
  }, [flushNotes])

  const editorExtensions = useMemo(() => (isDark ? [DARK_EDITOR_THEME] : [LIGHT_EDITOR_THEME]), [isDark])

  // 창 리사이즈 시 저장된 높이를 새 콘텐츠 높이 기준으로 다시 clamp
  useEffect(() => {
    if (detailHeight == null) return
    const onResize = () => {
      const parent = panelRef.current?.parentElement
      if (parent) setDetailPanelHeightPx(detailHeight, parent.getBoundingClientRect().height)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [detailHeight, setDetailPanelHeightPx])

  // 마운트 직후 translateY(100%)→0 슬라이드업
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [])

  if (!task) return null

  const save = (updates: Record<string, unknown>) => updateTask({ id: task.id, ...updates })
  const addTag = () => {
    if (!tagInput.trim()) return
    save({ tags: [...new Set([...task.tags, tagInput.trim()])] })
    setTagInput('')
  }
  const removeTag = (tag: string) => save({ tags: task.tags.filter((t) => t !== tag) })

  const inputCls = isDark ? 'bg-gray-800 text-gray-300 border-gray-700' : 'bg-gray-100 text-gray-700 border-gray-300'
  const labelCls = isDark ? 'text-gray-500' : 'text-gray-400'

  // 하단 패널 높이: 드래그 중이면 라이브값, 아니면 저장값(없으면 창의 72%).
  // read 시점에도 clamp해서 큰 저장값이 작은 창에서 위 뷰를 0으로 짓누르지 않게 한다.
  const height = dragHeight ?? clampDetailHeight(detailHeight ?? Math.round(window.innerHeight * 0.72), window.innerHeight)
  const priorityColor = PRIORITY_OPTIONS.find((p) => p.value === task.priority)?.color || 'text-gray-400'

  // 그립 드래그로 높이 조절: 이동 중엔 로컬 state, 놓을 때 store에 persist
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const parent = panelRef.current?.parentElement
    if (!parent) return
    const rect = parent.getBoundingClientRect()
    const onMove = (ev: MouseEvent) => setDragHeight(clampDetailHeight(rect.bottom - ev.clientY, rect.height))
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setDetailPanelHeightPx(rect.bottom - ev.clientY, rect.height)
      setDragHeight(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div
      ref={panelRef}
      className={`w-full flex-shrink-0 border-t flex flex-col transition-transform duration-300 ease-[cubic-bezier(.32,.72,0,1)] ${isDark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}
      style={{ height, transform: shown ? 'translateY(0)' : 'translateY(100%)' }}
    >
      {/* 드래그 핸들: 높이 조절 */}
      <button
        type="button"
        aria-label="상세 패널 높이 조절"
        onMouseDown={startResize}
        className="w-full h-3 flex items-center justify-center cursor-ns-resize flex-shrink-0"
      >
        <div className={`w-9 h-1 rounded-full ${isDark ? 'bg-gray-700' : 'bg-gray-300'}`} />
      </button>

      {/* 헤더: 완료 + 제목 + 마감일/시간 + 우선순위 + 삭제/닫기 */}
      <div className={`flex items-center gap-3 px-4 pb-3 border-b ${isDark ? 'border-gray-800' : 'border-gray-200'}`}>
        <button
          type="button"
          onClick={() => toggleTask(task.id)}
          aria-label={task.completed ? '완료 취소' : '완료'}
          className={`shrink-0 transition-colors ${task.completed ? 'text-primary-500' : priorityColor}`}
        >
          {task.completed ? <CheckCircle2 size={22} /> : <Circle size={22} />}
        </button>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && save({ title: title.trim() })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className={`flex-1 min-w-0 bg-transparent text-lg font-semibold outline-none ${isDark ? 'text-gray-100' : 'text-gray-800'}`}
        />
        {/* 마감일 + 시간 */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Calendar size={15} className={labelCls} />
          <input
            type="date"
            value={dueDate}
            onChange={(e) => {
              setDueDate(e.target.value)
              save({ dueDate: e.target.value || null })
            }}
            className={`text-sm rounded px-2 py-1 outline-none border ${inputCls}`}
          />
          <input
            type="time"
            value={dueTime}
            onChange={(e) => {
              setDueTime(e.target.value)
              save({ dueTime: e.target.value || null })
            }}
            className={`w-20 text-sm rounded px-2 py-1 outline-none border ${inputCls}`}
          />
          {(dueDate || dueTime) && (
            <button
              type="button"
              onClick={() => {
                setDueDate('')
                setDueTime('')
                save({ dueDate: null, dueTime: null })
              }}
              className={labelCls}
              aria-label="마감일 지우기"
            >
              <X size={14} />
            </button>
          )}
        </div>
        {/* 우선순위 */}
        <div className="flex gap-1 shrink-0">
          {PRIORITY_OPTIONS.map((opt) => (
            <button
              type="button"
              key={opt.value}
              onClick={() => {
                setPriority(opt.value)
                save({ priority: opt.value })
              }}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                priority === opt.value
                  ? `${opt.color} ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`
                  : isDark
                    ? 'text-gray-500 hover:bg-gray-800'
                    : 'text-gray-400 hover:bg-gray-100'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {/* 삭제 / 닫기 */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => removeTask(task.id)}
            className="text-gray-500 hover:text-red-400 transition-colors"
            aria-label="삭제"
          >
            <Trash2 size={16} />
          </button>
          <button
            type="button"
            onClick={() => selectTask(null)}
            className={`transition-colors ${labelCls}`}
            aria-label="닫기"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* 본문: 상단 메타 띠 + 아래 하위작업/첨부 + 메모 */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* 메타 띠: 리스트 · 알림 · 반복 · 태그 (가로 컴팩트) */}
        <div className={`flex flex-wrap items-center gap-2 px-4 py-2 border-b ${isDark ? 'border-gray-800' : 'border-gray-100'}`}>
          {task.scheduledStart && task.scheduledEnd && (
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <Clock size={13} /> 예정 {formatScheduledRange(task.scheduledStart, task.scheduledEnd)}
            </span>
          )}
          {/* 리스트 */}
          <div className="flex items-center gap-1">
            <List size={14} className={labelCls} />
            <select
              value={listId}
              onChange={(e) => {
                setListId(e.target.value)
                save({ listId: e.target.value })
              }}
              className={`text-xs rounded px-2 py-1 outline-none border ${inputCls}`}
            >
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          {/* 알림 */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowReminder(!showReminder)}
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded border ${
                task.reminderAt
                  ? 'text-primary-400 border-primary-500/30'
                  : `${labelCls} ${isDark ? 'border-gray-700' : 'border-gray-300'}`
              }`}
            >
              <Bell size={13} /> {task.reminderAt ? new Date(task.reminderAt).toLocaleString('ko') : '알림'}
            </button>
            {showReminder && (
              <ReminderPicker
                dueDate={task.dueDate}
                value={task.reminderAt}
                onChange={(v) => {
                  save({ reminderAt: v })
                  setShowReminder(false)
                }}
              />
            )}
          </div>
          {/* 반복 */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowRecurring(!showRecurring)}
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded border ${
                task.isRecurring
                  ? 'text-purple-400 border-purple-500/30'
                  : `${labelCls} ${isDark ? 'border-gray-700' : 'border-gray-300'}`
              }`}
            >
              <Repeat size={13} /> {task.isRecurring ? task.recurringPattern || '반복' : '반복'}
            </button>
            {showRecurring && (
              <RecurringPicker
                value={task.recurringPattern}
                onChange={(v) => {
                  save({ isRecurring: !!v, recurringPattern: v })
                  setShowRecurring(false)
                }}
              />
            )}
          </div>
          {/* 태그 */}
          <div className="flex items-center gap-1 flex-1 min-w-[160px]">
            <Tag size={14} className={labelCls} />
            {task.tags.map((tag) => (
              <span
                key={tag}
                className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded ${isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'}`}
              >
                {tag}
                <button type="button" onClick={() => removeTag(tag)} className="hover:text-red-400">
                  <X size={10} />
                </button>
              </span>
            ))}
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return
                if (e.key === 'Enter') addTag()
              }}
              placeholder="태그..."
              className={`flex-1 min-w-[60px] text-xs bg-transparent outline-none ${isDark ? 'placeholder-gray-600' : 'placeholder-gray-400'}`}
            />
          </div>
        </div>

        {/* 본문: 메모(좌, 히어로) + 하위작업·첨부(우, 사이드 레일) */}
        <div className="flex-1 min-h-0 flex px-4 py-3 gap-4">
          {/* 메모 (라이브프리뷰) */}
          <div className="flex-1 min-w-0 flex flex-col">
            <AtomicCodeMirrorEditor
              documentId={task.id}
              markdownSource={task.description}
              onMarkdownChange={onNotesChange}
              onLinkClick={(url) => window.api.openExternal(url)}
              extensions={editorExtensions}
            />
          </div>
          {/* 하위작업 · 첨부 (사이드 레일) */}
          <div className={`w-[280px] flex-shrink-0 overflow-y-auto border-l pl-4 space-y-3 ${isDark ? 'border-gray-800' : 'border-gray-100'}`}>
            <SubtaskList taskId={task.id} />
            <AttachmentList
              taskId={task.id}
              attachments={task.attachments}
              onUpdate={(attachments) => save({ attachments })}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
