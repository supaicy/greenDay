import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { X, Trash2, Tag, List, Clock, Bell, Repeat, Calendar, Circle, CheckCircle2 } from 'lucide-react'
import { EditorView } from '@codemirror/view'
import { AtomicCodeMirrorEditor } from '@atomic-editor/editor'
import '@atomic-editor/editor/styles.css'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import { SubtaskList } from './SubtaskList'
import { RecurringPicker } from './RecurringPicker'
import { ReminderPicker } from './ReminderPicker'
import { AttachmentList } from './AttachmentList'
import { PRIORITY_OPTIONS } from '../../utils/priority'
import { formatRecurringPattern } from '../../utils/recurrence'
import { clampDetailWidth } from '../../store/detailWidth'
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

const DEFAULT_DETAIL_WIDTH = 400

// 메타 스트립의 알림/반복 토글은 트리거 버튼 + 조건부 드롭다운 구조가 동일하다.
export function TaskDetail() {
  const { t, i18n } = useTranslation()
  // 날짜·시간 표시는 브라우저 로케일이 아니라 앱에서 고른 언어를 따른다.
  const i18nLocale = i18n.language?.startsWith('en') ? 'en-US' : 'ko-KR'
  // 개별 셀렉터로 구독 — 무선택자 useStore()는 아무 store 쓰기에도 리렌더된다.
  // (액션은 안정 참조라 리렌더를 유발하지 않음)
  const tasks = useStore((s) => s.tasks)
  const lists = useStore((s) => s.lists)
  const selectedTaskId = useStore((s) => s.selectedTaskId)
  const selectTask = useStore((s) => s.selectTask)
  const updateTask = useStore((s) => s.updateTask)
  const removeTask = useStore((s) => s.removeTask)
  const toggleTask = useStore((s) => s.toggleTask)
  const theme = useStore((s) => s.theme)
  const detailWidth = useStore((s) => s.detailPanelWidthPx)
  const setDetailPanelWidthPx = useStore((s) => s.setDetailPanelWidthPx)
  const showAiChat = useStore((s) => s.showAiChat)
  const task = tasks.find((t) => t.id === selectedTaskId)
  const isDark = theme === 'dark'

  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [dueTime, setDueTime] = useState('')
  const [priority, setPriority] = useState<Priority>('none')
  const [listId, setListId] = useState('inbox')
  const [tagInput, setTagInput] = useState('')
  // 드래그 중 라이브 폭(px). null이면 저장값 사용. mouseup에서만 persist.
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  // 창 너비 추적 — 변할 때 clamp가 재계산되도록. persist는 하지 않는다.
  const [windowWidth, setWindowWidth] = useState(window.innerWidth)
  // 열릴 때 오른쪽에서 슬라이드인
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
  // 진행 중인 폭 드래그의 리스너 정리 함수. 드래그 도중 언마운트되면 누수 방지용.
  const dragCleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => dragCleanup.current?.(), [])

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

  // 창 너비 변화를 추적 → 렌더 시 clamp가 새 너비 기준으로 다시 계산된다.
  // 저장값을 덮어쓰지 않으므로(persist 안 함), 창을 좁혔다 다시 넓히면
  // 사용자가 지정한 폭이 그대로 복원된다. 저장값이 없어도(기본 400) 동작한다.
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 마운트 직후 translateX(100%)→0 슬라이드인
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

  const inputCls = isDark
    ? 'bg-surface-sunken text-gray-100 border-surface-line'
    : 'bg-gray-100 text-gray-700 border-gray-300'
  const labelCls = isDark ? 'text-gray-400' : 'text-gray-500'
  // 알림/반복 픽커 트리거 버튼 공통 클래스 (구 PickerRow의 트리거 부분)
  const pickerBtnCls = (active: boolean, activeCls: string): string =>
    `flex items-center gap-1 text-xs px-2 py-1 rounded border ${
      active ? activeCls : `${labelCls} ${isDark ? 'border-surface-line' : 'border-gray-300'}`
    }`

  // 우측 패널 폭: 드래그 중이면 라이브값, 아니면 저장값(없으면 기본 400).
  // read 시점에도 clamp해서 큰 저장값이 좁은 창에서 목록을 0으로 짓누르지 않게 한다.
  const width = dragWidth ?? clampDetailWidth(detailWidth ?? DEFAULT_DETAIL_WIDTH, windowWidth, showAiChat)
  const priorityColor = PRIORITY_OPTIONS.find((p) => p.value === task.priority)?.color || 'text-gray-400'

  // 좌측 경계선 드래그로 폭 조절: 이동 중엔 로컬 state, 놓을 때 store에 persist.
  // 패널 우측 경계는 고정(창 우측에 핀)이므로 mousedown 시점 값을 그대로 사용.
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const panel = panelRef.current
    if (!panel) return
    const right = panel.getBoundingClientRect().right
    const controller = new AbortController()
    const { signal } = controller
    const onMove = (ev: MouseEvent) => setDragWidth(clampDetailWidth(right - ev.clientX, window.innerWidth, showAiChat))
    const onUp = (ev: MouseEvent) => {
      controller.abort()
      dragCleanup.current = null
      setDetailPanelWidthPx(right - ev.clientX, window.innerWidth)
      setDragWidth(null)
    }
    window.addEventListener('mousemove', onMove, { signal })
    window.addEventListener('mouseup', onUp, { signal })
    dragCleanup.current = () => controller.abort()
  }

  return (
    <div
      ref={panelRef}
      className={`relative flex-shrink-0 border-l flex flex-col transition-transform duration-300 ease-[cubic-bezier(.32,.72,0,1)] ${isDark ? 'bg-surface-raised border-surface-line' : 'bg-white border-gray-200'}`}
      style={{ width, transform: shown ? 'translateX(0)' : 'translateX(100%)' }}
    >
      {/* 좌측 경계 드래그 핸들: 폭 조절 */}
      <button
        type="button"
        aria-label={t('detail.resizePanel')}
        onMouseDown={startResize}
        className="absolute left-0 top-0 h-full w-2 -ml-1 cursor-col-resize z-10 hover:bg-primary-500/40 transition-colors"
      />

      {/* 헤더: 완료 + 제목 + 삭제/닫기 */}
      <div className={`flex items-center gap-2 px-4 pt-4 pb-3 border-b ${isDark ? 'border-surface-divider' : 'border-gray-200'}`}>
        <button
          type="button"
          onClick={() => toggleTask(task.id)}
          aria-label={task.completed ? t('detail.uncomplete') : t('detail.complete')}
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
        <button
          type="button"
          onClick={() => removeTask(task.id)}
          className="shrink-0 text-gray-400 hover:text-red-400 transition-colors"
          aria-label={t('common.delete')}
        >
          <Trash2 size={16} />
        </button>
        <button
          type="button"
          onClick={() => selectTask(null)}
          className={`shrink-0 transition-colors ${labelCls} hover:text-gray-300`}
          aria-label={t('common.close')}
        >
          <X size={18} />
        </button>
      </div>

      {/* 메타: 마감일/시간 · 우선순위 · 리스트 · 알림 · 반복 · 태그 (좁은 폭에서 줄바꿈) */}
      <div className={`flex flex-wrap items-center gap-2 px-4 py-3 border-b ${isDark ? 'border-surface-divider' : 'border-gray-100'}`}>
        {task.scheduledStart && task.scheduledEnd && (
          <span className="flex items-center gap-1 text-xs text-gray-400 w-full">
            <Clock size={13} />{' '}
            {t('detail.scheduled', { range: formatScheduledRange(task.scheduledStart, task.scheduledEnd) })}
          </span>
        )}
        {/* 마감일 + 시간 */}
        <div className="flex items-center gap-1.5">
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
            className={`w-[74px] text-sm rounded px-2 py-1 outline-none border ${inputCls}`}
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
              aria-label={t('detail.clearDueDate')}
            >
              <X size={14} />
            </button>
          )}
        </div>
        {/* 우선순위 */}
        <div className="flex gap-1">
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
                  ? `${opt.color} ${isDark ? 'bg-surface-sunken' : 'bg-gray-200'}`
                  : isDark
                    ? 'text-gray-400 hover:bg-surface-sunken'
                    : 'text-gray-400 hover:bg-gray-100'
              }`}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
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
        {/* 알림 — 트리거는 여기서 주고, 열림/닫힘·포커스는 Radix Popover가 관리 */}
        <ReminderPicker
          dueDate={task.dueDate}
          value={task.reminderAt}
          onChange={(v) => save({ reminderAt: v })}
          trigger={
            <button type="button" className={pickerBtnCls(!!task.reminderAt, 'text-primary-400 border-primary-500/30')}>
              <Bell size={13} />{' '}
              {task.reminderAt ? new Date(task.reminderAt).toLocaleString(i18nLocale) : t('reminder.label')}
            </button>
          }
        />
        {/* 반복 */}
        <RecurringPicker
          value={task.recurringPattern}
          onChange={(v) => save({ isRecurring: !!v, recurringPattern: v })}
          trigger={
            <button type="button" className={pickerBtnCls(task.isRecurring, 'text-purple-400 border-purple-500/30')}>
              <Repeat size={13} />{' '}
              {(task.isRecurring && formatRecurringPattern(task.recurringPattern)) || t('recurring.label')}
            </button>
          }
        />
        {/* 태그 */}
        <div className="flex items-center gap-1 flex-1 min-w-[160px]">
          <Tag size={14} className={labelCls} />
          {task.tags.map((tag) => (
            <span
              key={tag}
              className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded ${isDark ? 'bg-surface-sunken text-gray-200' : 'bg-gray-200 text-gray-600'}`}
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
            placeholder={t('detail.tagsPlaceholder')}
            className={`flex-1 min-w-[60px] text-xs bg-transparent outline-none ${isDark ? 'placeholder-gray-600' : 'placeholder-gray-400'}`}
          />
        </div>
      </div>

      {/* 본문: 메모(히어로, 세로로 채움) + 하위작업·첨부(아래 바운드 스크롤 영역) */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* 메모 (라이브프리뷰) */}
        <div className="flex-1 min-h-0 flex flex-col px-4 py-3">
          <AtomicCodeMirrorEditor
            documentId={task.id}
            markdownSource={task.description}
            onMarkdownChange={onNotesChange}
            onLinkClick={(url) => window.api.openExternal(url)}
            extensions={editorExtensions}
          />
        </div>
        {/* 하위작업 · 첨부 */}
        <div className={`flex-shrink-0 max-h-[38%] overflow-y-auto border-t px-4 py-3 space-y-3 ${isDark ? 'border-surface-divider' : 'border-gray-100'}`}>
          <SubtaskList taskId={task.id} />
          <AttachmentList
            taskId={task.id}
            attachments={task.attachments}
            onUpdate={(attachments) => save({ attachments })}
          />
        </div>
      </div>
    </div>
  )
}
