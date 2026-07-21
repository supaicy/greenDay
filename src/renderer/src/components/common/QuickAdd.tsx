import { useState, useRef, useEffect } from 'react'
import { Command, CornerDownLeft, Calendar } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { parseNaturalDateTime } from '../../utils/naturalDate'

export function QuickAdd() {
  const { showQuickAdd, setShowQuickAdd, addTask, theme } = useStore()
  const isDark = theme === 'dark'
  const [input, setInput] = useState('')
  const [parsedDate, setParsedDate] = useState<string | null>(null)
  const [parsedTime, setParsedTime] = useState<string | null>(null)
  const [parsedTitle, setParsedTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (showQuickAdd) {
      setInput('')
      setParsedDate(null)
      setParsedTime(null)
      setParsedTitle('')
      // auto-focus 지연 (모달 렌더링 후)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [showQuickAdd])

  useEffect(() => {
    if (!input.trim()) {
      setParsedDate(null)
      setParsedTime(null)
      setParsedTitle('')
      return
    }

    const parsed = parseNaturalDateTime(input.trim())
    const words = input.trim().split(/\s+/)

    if (parsed && words.length > parsed.consumed) {
      setParsedDate(parsed.date)
      setParsedTime(parsed.time)
      setParsedTitle(words.slice(parsed.consumed).join(' '))
    } else {
      setParsedDate(null)
      setParsedTime(null)
      setParsedTitle(input.trim())
    }
  }, [input])

  const handleSubmit = async () => {
    const title = parsedDate ? parsedTitle : input.trim()
    if (!title) return

    await addTask(title, { dueDate: parsedDate, dueTime: parsedTime })
    setShowQuickAdd(false)
  }

  if (!showQuickAdd) return null

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 모달 배경 — 클릭/키보드 모두 지원
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh] bg-black/60 backdrop-blur-sm"
      onClick={() => setShowQuickAdd(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          setShowQuickAdd(false)
        }
      }}
    >
      {/* 모달 콘텐츠: 클릭/키보드 전파 차단 (role=dialog) */}
      <div
        className={`w-[540px] rounded-2xl shadow-2xl overflow-hidden transition-all animate-in fade-in slide-in-from-top-4 duration-200 ${
          isDark ? 'bg-[#2C2C2E] border border-gray-700' : 'bg-white border border-gray-200'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="빠른 할 일 추가"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {/* 입력 영역 */}
        <div className="p-5">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter') handleSubmit()
              if (e.key === 'Escape') setShowQuickAdd(false)
            }}
            placeholder="할 일을 입력하세요... (예: 내일 장보기)"
            className={`w-full text-lg bg-transparent outline-none ${
              isDark ? 'text-gray-100 placeholder-gray-500' : 'text-gray-800 placeholder-gray-400'
            }`}
          />

          {/* 파싱된 날짜 표시 */}
          {parsedDate && (
            <div className={`flex items-center gap-2 mt-3 text-sm ${isDark ? 'text-primary-400' : 'text-primary-600'}`}>
              <Calendar size={14} />
              <span>
                마감일: {parsedDate}
                {parsedTime ? ` ${parsedTime}` : ''}
              </span>
              <span className={`${isDark ? 'text-gray-500' : 'text-gray-400'}`}>|</span>
              <span className={`${isDark ? 'text-gray-400' : 'text-gray-500'}`}>제목: {parsedTitle}</span>
            </div>
          )}
        </div>

        {/* 하단 안내 */}
        <div
          className={`flex items-center justify-between px-5 py-3 border-t ${
            isDark ? 'border-gray-700 bg-[#1C1C1E]' : 'border-gray-200 bg-gray-50'
          }`}
        >
          <div className={`flex items-center gap-3 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            <span className="flex items-center gap-1">
              <CornerDownLeft size={12} />
              추가
            </span>
            <span>Esc 닫기</span>
          </div>
          <div className={`flex items-center gap-1 text-xs ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
            <Command size={11} />
            <span>Shift + A</span>
          </div>
        </div>
      </div>
    </div>
  )
}
