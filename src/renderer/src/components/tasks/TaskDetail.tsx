import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { X, CalendarDays, Flag, Inbox, MoreHorizontal, Circle, CheckCircle2 } from 'lucide-react'
import { EditorView, placeholder as cmPlaceholder } from '@codemirror/view'
import { AtomicCodeMirrorEditor } from '@atomic-editor/editor'
import '@atomic-editor/editor/styles.css'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import { SubtaskList } from './SubtaskList'
import { DueDatePicker } from './DueDatePicker'
import { PriorityMenu } from './PriorityMenu'
import { TagPicker } from './TagPicker'
import { TaskMoreMenu } from './TaskMoreMenu'
import { AttachmentList } from './AttachmentList'
import { PRIORITY_COLOR } from '../../utils/priority'
import { formatDateRange } from '../../utils/date'
import { clampDetailWidth } from '../../store/detailWidth'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import type { Priority } from '../../types'

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
  const { t } = useTranslation()
  // 개별 셀렉터로 구독 — 무선택자 useStore()는 아무 store 쓰기에도 리렌더된다.
  // (액션은 안정 참조라 리렌더를 유발하지 않음)
  const tasks = useStore((s) => s.tasks)
  const lists = useStore((s) => s.lists)
  const selectedTaskId = useStore((s) => s.selectedTaskId)
  const selectTask = useStore((s) => s.selectTask)
  const updateTask = useStore((s) => s.updateTask)
  const toggleTask = useStore((s) => s.toggleTask)
  const theme = useStore((s) => s.theme)
  const detailWidth = useStore((s) => s.detailPanelWidthPx)
  const setDetailPanelWidthPx = useStore((s) => s.setDetailPanelWidthPx)
  const showAiChat = useStore((s) => s.showAiChat)
  const pickAttachment = useStore((s) => s.pickAttachment)
  // 하위작업이 하나라도 있으면 섹션은 늘 보인다.
  const subtaskCount = useStore((s) => s.tasks.filter((x) => x.parentId === s.selectedTaskId).length)
  const task = tasks.find((t) => t.id === selectedTaskId)
  const isDark = theme === 'dark'

  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [dueTime, setDueTime] = useState('')
  const [priority, setPriority] = useState<Priority>('none')
  const [listId, setListId] = useState('inbox')
  // ⋯ 메뉴의 '하위 할일 추가'로 섹션을 꺼낸다. 하위작업이 0개면 평소엔 숨어 있어
  // 빈 태스크에서 메모가 최대 공간을 갖는다.
  const [showSubtasks, setShowSubtasks] = useState(false)
  // '태그' 항목을 누르면 TagPicker 팝오버를 연다(값이 바뀌는 것만으로 신호).
  const [tagSignal, setTagSignal] = useState(0)
  // '기간 설정'도 같은 방식으로 기한 팝오버를 기간 모드로 연다.
  const [rangeSignal, setRangeSignal] = useState(0)
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

  const labelCls = isDark ? 'text-gray-400' : 'text-gray-500'
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
  const priorityColor = PRIORITY_COLOR[task.priority]

  // 목록 행과 같은 헬퍼를 쓴다 — 같은 할일이 화면마다 다르게 읽히면 안 된다.
  const dueLabel =
    formatDateRange(task.startDate, dueDate || null, dueTime || null) || t('detail.noDueDate')

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

      {/* 상단바: 완료 · 기한 … 우선순위 깃발. '언제'와 '얼마나 급한가'만 상시 노출한다. */}
      <div
        className={`flex items-center gap-2 px-3 py-2 border-b ${isDark ? 'border-surface-line' : 'border-gray-200'}`}
      >
        <button
          type="button"
          onClick={() => toggleTask(task.id)}
          aria-label={task.completed ? t('detail.uncomplete') : t('detail.complete')}
          className={`shrink-0 rounded p-1 transition-colors ${focusRingCls} ${
            task.completed ? 'text-primary-500' : priorityColor
          }`}
        >
          {task.completed ? <CheckCircle2 size={18} /> : <Circle size={18} />}
        </button>
        <span className={`h-4 w-px ${isDark ? 'bg-surface-line' : 'bg-gray-300'}`} />

        <DueDatePicker
          dueDate={dueDate || null}
          dueTime={dueTime || null}
          startDate={task.startDate}
          reminderAt={task.reminderAt}
          recurringPattern={task.recurringPattern}
          isRecurring={task.isRecurring}
          onChange={(next) => {
            setDueDate(next.dueDate ?? '')
            setDueTime(next.dueTime ?? '')
            save({
              dueDate: next.dueDate,
              dueTime: next.dueTime,
              // 픽커가 시작일을 실어 보냈다면 '끝만 고친다'는 뜻이다.
              ...('startDate' in next ? { startDate: next.startDate } : {})
            })
          }}
          onStartDateChange={(v) => save({ startDate: v })}
          onReminderChange={(v) => save({ reminderAt: v })}
          onRecurringChange={(v) => save({ isRecurring: !!v, recurringPattern: v })}
          autoOpenRangeSignal={rangeSignal}
          trigger={
            <button type="button" className={ctlCls(!!dueDate || !!dueTime)}>
              <CalendarDays size={14} />
              {dueLabel}
            </button>
          }
        />

        <div className="flex-1" />

        <PriorityMenu
          value={priority}
          onChange={(p) => {
            setPriority(p)
            save({ priority: p })
          }}
          trigger={
            <button
              type="button"
              aria-label={t('priority.label')}
              className={`shrink-0 rounded p-1.5 transition-colors ${focusRingCls} ${PRIORITY_COLOR[priority]} ${
                isDark ? 'hover:bg-surface-sunken' : 'hover:bg-gray-100'
              }`}
            >
              <Flag size={16} />
            </button>
          }
        />
      </div>

      {/* 본문: 제목 · 태그 · 메모(주인공) · 하위작업/첨부는 있을 때만 */}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col px-4 py-3 gap-2">
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
          className={`w-full resize-none bg-transparent px-1 -mx-1 rounded text-xl font-semibold leading-snug
            [field-sizing:content] max-h-[6rem] overflow-y-auto ${focusRingCls} ${
              isDark ? 'text-gray-100 hover:bg-surface-sunken/50' : 'text-gray-800 hover:bg-gray-100'
            }`}
        />

        <TagPicker tags={task.tags} onChange={(tags) => save({ tags })} autoOpenSignal={tagSignal} />

        {/* 메모 — 남는 세로를 전부 가진다. 메타를 상단바·하단바·⋯로 옮긴 이유가 이것이다. */}
        <div className="flex-1 min-h-[240px] pt-1">
          <AtomicCodeMirrorEditor
            documentId={task.id}
            markdownSource={task.description}
            onMarkdownChange={onNotesChange}
            onLinkClick={(url) => window.api.openExternal(url)}
            extensions={editorExtensions}
          />
        </div>

        {(showSubtasks || subtaskCount > 0) && (
          <div className={`border-t pt-3 ${isDark ? 'border-surface-line' : 'border-gray-100'}`}>
            <SubtaskList taskId={task.id} />
          </div>
        )}
        {task.attachments.length > 0 && (
          <div className={`border-t pt-3 ${isDark ? 'border-surface-line' : 'border-gray-100'}`}>
            <AttachmentList
              taskId={task.id}
              attachments={task.attachments}
              onUpdate={(attachments) => save({ attachments })}
            />
          </div>
        )}
      </div>

      {/* 하단바: 목록 … ⋯ */}
      <div
        className={`flex items-center justify-between gap-2 px-3 py-2 border-t ${
          isDark ? 'border-surface-line' : 'border-gray-200'
        }`}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={ctlCls(false)}>
              <Inbox size={14} />
              {lists.find((l) => l.id === listId)?.name ?? ''}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="min-w-[160px]">
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

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => selectTask(null)}
            aria-label={t('common.close')}
            className={`rounded p-1.5 transition-colors ${labelCls} ${focusRingCls} ${
              isDark ? 'hover:text-gray-200 hover:bg-surface-sunken' : 'hover:text-gray-800 hover:bg-gray-100'
            }`}
          >
            <X size={16} />
          </button>
          <TaskMoreMenu
            task={task}
            onAddSubtask={() => setShowSubtasks(true)}
            onAddTag={() => setTagSignal((n) => n + 1)}
            onSetDateRange={() => setRangeSignal((n) => n + 1)}
            onAddAttachment={async () => {
              const files = await pickAttachment()
              if (files?.length) save({ attachments: [...task.attachments, ...files.map((f) => `${f.name}|${f.path}`)] })
            }}
            trigger={
              <button
                type="button"
                aria-label={t('common.more')}
                className={`rounded p-1.5 transition-colors ${labelCls} ${focusRingCls} ${
                  isDark ? 'hover:text-gray-200 hover:bg-surface-sunken' : 'hover:text-gray-800 hover:bg-gray-100'
                }`}
              >
                <MoreHorizontal size={16} />
              </button>
            }
          />
        </div>
      </div>
    </div>
  )
}
