import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { X, Trash2, List, Clock, Bell, Repeat, Circle, CheckCircle2 } from 'lucide-react'
import { EditorView, placeholder as cmPlaceholder } from '@codemirror/view'
import { AtomicCodeMirrorEditor } from '@atomic-editor/editor'
import '@atomic-editor/editor/styles.css'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import { SubtaskList } from './SubtaskList'
import { RecurringPicker } from './RecurringPicker'
import { ReminderPicker } from './ReminderPicker'
import { DueDatePicker } from './DueDatePicker'
import { AttachmentList } from './AttachmentList'
import { PRIORITY_OPTIONS, PRIORITY_SURFACE, PRIORITY_SURFACE_LIGHT } from '../../utils/priority'
import { formatRecurringPattern } from '../../utils/recurrence'
import { clampDetailWidth } from '../../store/detailWidth'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
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

  // placeholder가 없으면 빈 메모 영역이 그냥 회색 면이라, 여기가 입력란인지
  // 클릭해서 캐럿이 뜨기 전까지 알 수 없었다.
  const editorExtensions = useMemo(
    () => [isDark ? DARK_EDITOR_THEME : LIGHT_EDITOR_THEME, cmPlaceholder(t('detail.notesPlaceholder'))],
    [isDark, t]
  )

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

  const labelCls = isDark ? 'text-gray-400' : 'text-gray-500'
  const metaLabelCls = `text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`
  // outline-none만 걸고 대체 표시가 없으면 키보드 사용자가 초점을 잃는다.
  const focusRingCls = 'outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60'
  /**
   * 속성 컨트롤 공통 셸. 전에는 한 줄 안에 높이가 30/26/26/20px로 네 가지,
   * 타입 크기도 text-sm과 text-xs가 섞이고 모서리도 4px/6px/8px 세 가지였다.
   * 값이 없는 컨트롤은 테두리를 지워 조용히 물러난다(빈 칸이 가장 시끄러웠다).
   */
  const ctlCls = (filled: boolean): string =>
    `inline-flex h-8 w-fit max-w-full items-center gap-1.5 truncate rounded-md px-2.5 text-[13px] transition-colors ${focusRingCls} ${
      filled
        ? isDark
          ? 'border border-surface-line bg-surface-sunken text-gray-100 hover:bg-surface-line/60'
          : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
        : isDark
          ? 'border border-transparent text-gray-400 hover:bg-surface-sunken'
          : 'border border-transparent text-gray-500 hover:bg-gray-100'
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
    // 드래그 중에는 커서와 선택을 문서 전체에 고정한다. 안 하면 포인터가 메모
    // 편집기 위를 지날 때 I-beam으로 바뀌고 본문이 파랗게 선택된다.
    const prevCursor = document.body.style.cursor
    const prevSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const restoreBody = (): void => {
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevSelect
    }
    const onMove = (ev: MouseEvent) => setDragWidth(clampDetailWidth(right - ev.clientX, window.innerWidth, showAiChat))
    const onUp = (ev: MouseEvent) => {
      controller.abort()
      restoreBody()
      dragCleanup.current = null
      setDetailPanelWidthPx(right - ev.clientX, window.innerWidth)
      setDragWidth(null)
    }
    window.addEventListener('mousemove', onMove, { signal })
    window.addEventListener('mouseup', onUp, { signal })
    dragCleanup.current = () => {
      controller.abort()
      restoreBody()
    }
  }

  return (
    <div
      ref={panelRef}
      className={`relative flex-shrink-0 border-l flex flex-col transition-transform duration-300 ease-[cubic-bezier(.32,.72,0,1)] ${isDark ? 'bg-surface-raised border-surface-line' : 'bg-white border-gray-200'}`}
      style={{ width, transform: shown ? 'translateX(0)' : 'translateX(100%)' }}
    >
      {/* 좌측 경계 드래그 핸들: 폭 조절. DOM 순서상 패널의 첫 포커스 요소라
          키보드로도 동작해야 한다 — 전에는 onMouseDown만 있어 죽은 탭 스톱이었다.
          더블클릭하면 기본 폭으로 되돌린다(전에는 되돌릴 방법이 없었다). */}
      {/* biome-ignore lint/a11y/useSemanticElements: WAI-ARIA window splitter 패턴 — <hr>은 포커스도 드래그도 받지 못한다 */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('detail.resizePanel')}
        aria-valuenow={Math.round(width)}
        aria-valuemin={320}
        tabIndex={0}
        onMouseDown={startResize}
        onDoubleClick={() => setDetailPanelWidthPx(DEFAULT_DETAIL_WIDTH, window.innerWidth)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 64 : 16
          if (e.key === 'ArrowLeft') setDetailPanelWidthPx(width + step, window.innerWidth)
          else if (e.key === 'ArrowRight') setDetailPanelWidthPx(width - step, window.innerWidth)
          else return
          e.preventDefault()
        }}
        title={t('detail.resizeHint')}
        className={`absolute left-0 top-0 h-full w-3 -ml-1.5 cursor-col-resize z-10 transition-colors hover:bg-primary-500/40 ${focusRingCls}`}
      />

      {/* 헤더: 완료 + 제목 + 삭제/닫기. 제목이 두 줄까지 자라므로 items-start. */}
      <div className={`flex items-start gap-2 px-4 py-3 border-b ${isDark ? 'border-surface-line' : 'border-gray-200'}`}>
        <button
          type="button"
          onClick={() => toggleTask(task.id)}
          aria-label={task.completed ? t('detail.uncomplete') : t('detail.complete')}
          className={`shrink-0 mt-1 transition-colors ${task.completed ? 'text-primary-500' : priorityColor}`}
        >
          {task.completed ? <CheckCircle2 size={20} /> : <Circle size={20} />}
        </button>
        {/* input은 넘치는 글자를 캐럿 기준으로 스크롤할 뿐이라 제목이 그냥 잘렸다 —
            가운데 목록은 같은 제목을 두 줄로 온전히 보여주는데 상세가 더 적게 보여줬다.
            두 줄까지 자라는 textarea로 바꾸고 전체 제목은 title 속성에 남긴다. */}
        <textarea
          rows={1}
          value={title}
          title={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && save({ title: title.trim() })}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter') {
              e.preventDefault()
              ;(e.target as HTMLTextAreaElement).blur()
            }
          }}
          className={`flex-1 min-w-0 resize-none bg-transparent px-1 -mx-1 rounded text-lg font-semibold leading-snug
            [field-sizing:content] max-h-[3.5rem] overflow-y-auto ${focusRingCls} ${
              isDark ? 'text-gray-100 hover:bg-surface-sunken/50' : 'text-gray-800 hover:bg-gray-100'
            }`}
        />
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => removeTask(task.id)}
            className={`p-1.5 rounded transition-colors text-gray-400 hover:text-red-400 ${focusRingCls} ${
              isDark ? 'hover:bg-surface-sunken' : 'hover:bg-gray-100'
            }`}
            aria-label={t('common.delete')}
          >
            <Trash2 size={16} />
          </button>
          <button
            type="button"
            onClick={() => selectTask(null)}
            className={`p-1.5 rounded transition-colors ${labelCls} ${focusRingCls} ${
              isDark ? 'hover:text-gray-200 hover:bg-surface-sunken' : 'hover:text-gray-800 hover:bg-gray-100'
            }`}
            aria-label={t('common.close')}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* 메타: 의미 단위로 고정한 라벨 2열 그리드. 전에는 flex-wrap 자루라
          폭·번역 길이·값 유무에 따라 줄바꿈 위치가 계속 바뀌어(기본 폭 400px에선
          3줄) 속성 위치를 학습할 수 없었고, 어느 컨트롤이 무엇인지 알려주는
          라벨도 하나 없었다. 일정(마감일·알림·반복) → 분류(우선순위·목록·태그) 순. */}
      <div
        className={`grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-4 py-3 border-b ${
          isDark ? 'border-surface-line' : 'border-gray-100'
        }`}
      >
        {task.scheduledStart && task.scheduledEnd && (
          <>
            <span className={metaLabelCls}>
              <Clock size={12} className="inline mr-1 -mt-0.5" />
              {t('detail.scheduled', { range: '' }).replace(/[:：].*$/, '')}
            </span>
            <span className="text-xs text-gray-400">
              {formatScheduledRange(task.scheduledStart, task.scheduledEnd)}
            </span>
          </>
        )}

        <span className={metaLabelCls}>{t('task.dueDate')}</span>
        <DueDatePicker
          dueDate={dueDate || null}
          dueTime={dueTime || null}
          onChange={(next) => {
            setDueDate(next.dueDate ?? '')
            setDueTime(next.dueTime ?? '')
            save({ dueDate: next.dueDate, dueTime: next.dueTime })
          }}
          trigger={
            <button type="button" className={ctlCls(!!dueDate || !!dueTime)}>
              {dueDate || dueTime
                ? `${dueDate || ''}${dueTime ? ` ${dueTime}` : ''}`.trim()
                : t('detail.noDueDate')}
            </button>
          }
        />

        <span className={metaLabelCls}>{t('reminder.label')}</span>
        <ReminderPicker
          dueDate={task.dueDate}
          value={task.reminderAt}
          onChange={(v) => save({ reminderAt: v })}
          trigger={
            <button type="button" className={ctlCls(!!task.reminderAt)}>
              <Bell size={13} />
              {task.reminderAt ? new Date(task.reminderAt).toLocaleString(i18nLocale) : t('common.none')}
            </button>
          }
        />

        <span className={metaLabelCls}>{t('recurring.label')}</span>
        <RecurringPicker
          value={task.recurringPattern}
          onChange={(v) => save({ isRecurring: !!v, recurringPattern: v })}
          trigger={
            <button type="button" className={ctlCls(task.isRecurring)}>
              <Repeat size={13} />
              {(task.isRecurring && formatRecurringPattern(task.recurringPattern)) || t('common.none')}
            </button>
          }
        />

        {/* 우선순위 — 진짜 세그먼티드 컨트롤. 네 버튼이 서로 무관하게 노출되던 것을
            radiogroup으로 묶는다. 채운 면은 medium/high만(utils/priority.ts 참고). */}
        <span className={metaLabelCls}>{t('priority.label')}</span>
        <div
          role="radiogroup"
          aria-label={t('priority.label')}
          className={`inline-flex w-fit rounded-md p-0.5 ${isDark ? 'bg-surface-sunken' : 'bg-gray-100'}`}
        >
          {PRIORITY_OPTIONS.map((opt) => (
            // biome-ignore lint/a11y/useSemanticElements: 세그먼티드 컨트롤 — input[type=radio]는 이 형태로 스타일링할 수 없다
            <button
              type="button"
              role="radio"
              aria-checked={priority === opt.value}
              key={opt.value}
              onClick={() => {
                setPriority(opt.value)
                save({ priority: opt.value })
              }}
              className={`h-7 px-2.5 rounded text-xs transition-colors border ${focusRingCls} ${
                priority === opt.value
                  ? isDark
                    ? PRIORITY_SURFACE[opt.value]
                    : PRIORITY_SURFACE_LIGHT[opt.value]
                  : `border-transparent ${isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-800'}`
              }`}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>

        {/* 목록 — 네이티브 select만 macOS 크롬을 그려 유일하게 이질적이었다.
            알림·반복과 같은 일(목록에서 하나 고르기)이므로 같은 프리미티브를 쓴다. */}
        <span className={metaLabelCls}>{t('detail.listLabel')}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={ctlCls(true)}>
              <List size={13} />
              {lists.find((l) => l.id === listId)?.name ?? ''}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[160px]">
            {lists.map((l) => (
              <DropdownMenuItem
                key={l.id}
                onSelect={() => {
                  setListId(l.id)
                  save({ listId: l.id })
                }}
                className="gap-2 text-sm"
              >
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: l.color }} />
                {l.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <span className={metaLabelCls}>{t('detail.tagsLabel')}</span>
        <div className="flex flex-wrap items-center gap-1">
          {task.tags.map((tag) => (
            <span
              key={tag}
              className={`flex items-center gap-1 h-7 text-xs px-2 rounded-md ${
                isDark ? 'bg-surface-sunken text-gray-200' : 'bg-gray-200 text-gray-600'
              }`}
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
            className={`h-7 min-w-[80px] flex-1 rounded-md px-1 text-xs bg-transparent outline-none ${focusRingCls} ${
              isDark ? 'placeholder-gray-400' : 'placeholder-gray-500'
            }`}
          />
        </div>
      </div>

      {/* 본문: 스크롤 컨테이너 하나. 전에는 메모가 flex-1이라 빈 메모가 패널의
          67%(534px)를 먹고 하위작업·첨부를 바닥 15%로 밀어냈고, 스크롤 영역이
          둘이라 휠이 커서 위치에 따라 다르게 동작했다. 메모는 최소 높이만
          보장하고 내용만큼 자란다. */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="min-h-[7.5rem] px-4 py-3">
          <AtomicCodeMirrorEditor
            documentId={task.id}
            markdownSource={task.description}
            onMarkdownChange={onNotesChange}
            onLinkClick={(url) => window.api.openExternal(url)}
            extensions={editorExtensions}
          />
        </div>
        <div className={`border-t px-4 py-3 space-y-4 ${isDark ? 'border-surface-line' : 'border-gray-100'}`}>
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
