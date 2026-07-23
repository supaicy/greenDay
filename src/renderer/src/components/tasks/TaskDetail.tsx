import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { X, Trash2, Tag, List, Eye, Edit3, Clock, Bell, Repeat, Calendar, Circle, CheckCircle2 } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import markdown from 'highlight.js/lib/languages/markdown'
import sql from 'highlight.js/lib/languages/sql'
import java from 'highlight.js/lib/languages/java'
import { useStore } from '../../store/useStore'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('json', json)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('css', css)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('java', java)
import { SubtaskList } from './SubtaskList'
import { RecurringPicker } from './RecurringPicker'
import { ReminderPicker } from './ReminderPicker'
import { AttachmentList } from './AttachmentList'
import { PRIORITY_OPTIONS } from '../../utils/priority'
import { clampDetailHeight } from '../../store/detailHeight'
import type { Priority } from '../../types'

// react-markdown 설정은 렌더마다 새 참조가 되지 않도록 모듈 스코프에 고정
const REMARK_PLUGINS = [remarkGfm]

// 코드 블록 syntax highlighting (모듈 스코프 컴포넌트)
const CodeBlock = memo(function CodeBlock({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) {
  const codeRef = useRef<HTMLElement>(null)
  const match = /language-(\w+)/.exec(className || '')
  const lang = match ? match[1] : null
  const isInline = !lang && !String(children).includes('\n')

  useEffect(() => {
    if (codeRef.current && lang) {
      codeRef.current.removeAttribute('data-highlighted')
      hljs.highlightElement(codeRef.current)
    }
  }, [lang])

  if (isInline) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    )
  }
  return (
    <code ref={codeRef} className={className} {...props}>
      {children}
    </code>
  )
})

function formatScheduledRange(startIso: string, endIso: string): string {
  const start = new Date(startIso)
  const end = new Date(endIso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const date = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`
  const s = `${pad(start.getHours())}:${pad(start.getMinutes())}`
  const e = `${pad(end.getHours())}:${pad(end.getMinutes())}`
  return `${date} ${s}–${e}`
}

export function TaskDetail() {
  const { tasks, lists, selectedTaskId, selectTask, updateTask, removeTask, toggleTask, theme } = useStore()
  const detailHeight = useStore((s) => s.detailPanelHeightPx)
  const task = tasks.find((t) => t.id === selectedTaskId)
  const isDark = theme === 'dark'

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [dueTime, setDueTime] = useState('')
  const [priority, setPriority] = useState<Priority>('none')
  const [listId, setListId] = useState('inbox')
  const [tagInput, setTagInput] = useState('')
  const [mdPreview, setMdPreview] = useState(true)
  const [showRecurring, setShowRecurring] = useState(false)
  const [showReminder, setShowReminder] = useState(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: form state resets only when a different task is selected; watching other fields would overwrite in-progress edits
  useEffect(() => {
    if (task) {
      setTitle(task.title)
      setDescription(task.description)
      setDueDate(task.dueDate || '')
      setDueTime(task.dueTime || '')
      setPriority(task.priority)
      setListId(task.listId)
    }
  }, [task?.id])

  // 체크박스 토글: description 내 n번째 체크박스의 상태를 변경
  const toggleCheckbox = useCallback(
    (index: number) => {
      if (!task) return
      let count = 0
      const newDesc = description.replace(/^(\s*[-*]\s*)\[([ xX])\]/gm, (match, prefix, check) => {
        if (count++ === index) {
          const newCheck = check === ' ' ? 'x' : ' '
          return `${prefix}[${newCheck}]`
        }
        return match
      })
      setDescription(newDesc)
      updateTask({ id: task.id, description: newDesc })
    },
    [description, task, updateTask]
  )

  const checkboxIndex = useRef(0)

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

  // 하단 패널 높이: 저장값(px) 없으면 콘텐츠 높이의 72%. read 시점에도 clamp해서
  // (큰 창에서 저장한 큰 값이) 작은 창에서 위 뷰를 0으로 짓누르지 않게 한다.
  // (정밀한 콘텐츠 높이 측정 + 창 리사이즈 재-clamp는 Stage 3)
  const height = clampDetailHeight(detailHeight ?? Math.round(window.innerHeight * 0.72), window.innerHeight)
  const priorityColor = PRIORITY_OPTIONS.find((p) => p.value === task.priority)?.color || 'text-gray-400'

  return (
    <div
      className={`w-full flex-shrink-0 border-t flex flex-col ${isDark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}
      style={{ height }}
    >
      {/* 드래그 핸들 (높이 조절 배선은 Stage 3) */}
      <button
        type="button"
        aria-label="상세 패널 높이 조절"
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

      {/* 본문: 왼쪽 하위작업+첨부+메타 / 오른쪽 메모 */}
      <div className="flex-1 min-h-0 grid grid-cols-[1fr_1.35fr]">
        {/* 왼쪽: 하위작업 · 첨부 · 리스트/알림/반복/태그 */}
        <div className={`min-h-0 overflow-y-auto p-4 space-y-4 border-r ${isDark ? 'border-gray-800' : 'border-gray-100'}`}>
          {/* 예정된 블록 (읽기 전용) */}
          {task.scheduledStart && task.scheduledEnd && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Clock size={14} />
              <span>예정: {formatScheduledRange(task.scheduledStart, task.scheduledEnd)}</span>
            </div>
          )}

          {/* 하위 작업 */}
          <SubtaskList taskId={task.id} />

          {/* 첨부파일 */}
          <AttachmentList
            taskId={task.id}
            attachments={task.attachments}
            onUpdate={(attachments) => save({ attachments })}
          />

          {/* 리스트 */}
          <div className="flex items-center gap-3">
            <List size={16} className={labelCls} />
            <select
              value={listId}
              onChange={(e) => {
                setListId(e.target.value)
                save({ listId: e.target.value })
              }}
              className={`flex-1 text-sm rounded px-2 py-1.5 outline-none border ${inputCls}`}
            >
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          {/* 알림 */}
          <div className="flex items-center gap-3">
            <Bell size={16} className={labelCls} />
            <div className="relative flex-1">
              <button
                type="button"
                onClick={() => setShowReminder(!showReminder)}
                className={`text-sm px-2 py-1 rounded border w-full text-left ${
                  task.reminderAt
                    ? 'text-primary-400 border-primary-500/30'
                    : `${labelCls} ${isDark ? 'border-gray-700' : 'border-gray-300'}`
                }`}
              >
                {task.reminderAt ? new Date(task.reminderAt).toLocaleString('ko') : '알림 설정'}
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
          </div>

          {/* 반복 */}
          <div className="flex items-center gap-3">
            <Repeat size={16} className={labelCls} />
            <div className="relative flex-1">
              <button
                type="button"
                onClick={() => setShowRecurring(!showRecurring)}
                className={`text-sm px-2 py-1 rounded border w-full text-left ${
                  task.isRecurring
                    ? 'text-purple-400 border-purple-500/30'
                    : `${labelCls} ${isDark ? 'border-gray-700' : 'border-gray-300'}`
                }`}
              >
                {task.isRecurring ? task.recurringPattern || '반복' : '반복 설정'}
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
          </div>

          {/* 태그 */}
          <div className="flex items-start gap-3">
            <Tag size={16} className={`${labelCls} mt-1`} />
            <div className="flex-1">
              <div className="flex flex-wrap gap-1 mb-2">
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
              </div>
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return
                  if (e.key === 'Enter') addTag()
                }}
                placeholder="태그 추가..."
                className={`w-full text-xs rounded px-2 py-1.5 outline-none border ${inputCls} ${isDark ? 'placeholder-gray-600' : 'placeholder-gray-400'}`}
              />
            </div>
          </div>
        </div>

        {/* 오른쪽: 메모 (히어로) */}
        <div className="min-h-0 overflow-y-auto p-4 flex flex-col">
          <div className="flex items-center gap-1 mb-2 shrink-0">
            <button
              type="button"
              onClick={() => setMdPreview(false)}
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${!mdPreview ? 'text-primary-400 bg-primary-900/30' : isDark ? 'text-gray-500 hover:bg-gray-800' : 'text-gray-400 hover:bg-gray-100'}`}
            >
              <Edit3 size={12} /> 편집
            </button>
            <button
              type="button"
              onClick={() => setMdPreview(true)}
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${mdPreview ? 'text-primary-400 bg-primary-900/30' : isDark ? 'text-gray-500 hover:bg-gray-800' : 'text-gray-400 hover:bg-gray-100'}`}
            >
              <Eye size={12} /> 미리보기
            </button>
          </div>
          {mdPreview ? (
            // biome-ignore lint/a11y/noStaticElementInteractions: 마크다운 프리뷰 — 렌더링된 콘텐츠 포함으로 button 전환 불가; onKeyDown으로 편집 모드 전환 지원
            <div
              className={`prose prose-sm max-w-none flex-1 min-h-[200px] rounded-lg px-3 py-2.5 border cursor-text overflow-y-auto ${isDark ? 'prose-invert bg-gray-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}
              onClick={(e) => {
                const target = e.target as HTMLElement
                if (target.tagName !== 'INPUT' && target.tagName !== 'A') {
                  setMdPreview(false)
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  setMdPreview(false)
                }
              }}
            >
              {description ? (
                (() => {
                  checkboxIndex.current = 0
                  return (
                    <Markdown
                      remarkPlugins={REMARK_PLUGINS}
                      components={{
                        code: CodeBlock,
                        input: (props) => {
                          if (props.type === 'checkbox') {
                            const idx = checkboxIndex.current++
                            return (
                              <input type="checkbox" checked={props.checked} onChange={() => toggleCheckbox(idx)} />
                            )
                          }
                          return <input {...props} />
                        }
                      }}
                    >
                      {description}
                    </Markdown>
                  )
                })()
              ) : (
                <p className={`text-sm ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>클릭하여 메모 작성...</p>
              )}
            </div>
          ) : (
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => {
                save({ description })
                if (description.trim()) setMdPreview(true)
              }}
              placeholder="마크다운으로 메모를 작성하세요..."
              className={`w-full flex-1 min-h-[200px] text-sm rounded-lg px-3 py-2.5 outline-none border resize-none font-mono leading-relaxed ${inputCls} ${isDark ? 'placeholder-gray-600' : 'placeholder-gray-400'}`}
            />
          )}
        </div>
      </div>
    </div>
  )
}
