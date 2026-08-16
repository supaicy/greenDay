import { useState, useRef, useEffect } from 'react'
import { Command, CornerDownLeft, Calendar } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import { parseNaturalDateTime } from '../../utils/naturalDate'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

export function QuickAdd() {
  const { t } = useTranslation()
  const showQuickAdd = useStore((s) => s.showQuickAdd)
  const setShowQuickAdd = useStore((s) => s.setShowQuickAdd)
  const addTask = useStore((s) => s.addTask)
  const theme = useStore((s) => s.theme)
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

  return (
    // 배경 클릭·Escape·포커스 트랩은 Radix Dialog가 담당. show 플래그로 mount를
    // 감싸지 않는다 — open은 Dialog가 갖는다(CLAUDE.md 오버레이 규칙).
    <Dialog open={showQuickAdd} onOpenChange={setShowQuickAdd}>
      <DialogContent
        showCloseButton={false}
        aria-label={t('task.quickAdd')}
        className="top-[20vh] w-[540px] translate-y-0 gap-0 overflow-hidden rounded-2xl p-0"
        // 포커스는 Radix가 연다/닫는다. 예전에는 50ms setTimeout으로 넣었는데,
        // 정리되지 않아 그 안에 닫으면 Radix가 트리거로 돌려준 포커스를 도로 뺏었다.
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          inputRef.current?.focus()
        }}
      >
        <DialogTitle className="sr-only">{t('task.quickAdd')}</DialogTitle>
        <DialogDescription className="sr-only">{t('task.quickAddPlaceholder')}</DialogDescription>
        {/* 입력 영역 */}
        <div className="p-5">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              // Escape는 Dialog가 처리한다 — 여기서 중복으로 닫지 않는다.
              if (e.key === 'Enter') handleSubmit()
            }}
            placeholder={t('task.quickAddPlaceholder')}
            className={`w-full text-lg bg-transparent outline-none ${
              isDark ? 'text-gray-100 placeholder-gray-500' : 'text-gray-800 placeholder-gray-400'
            }`}
          />

          {/* 파싱된 날짜 표시 */}
          {parsedDate && (
            <div className={`flex items-center gap-2 mt-3 text-sm ${isDark ? 'text-primary-400' : 'text-primary-600'}`}>
              <Calendar size={14} />
              <span>
                {t('task.parsedDue', { date: parsedDate })}
                {parsedTime ? ` ${parsedTime}` : ''}
              </span>
              <span className={`${isDark ? 'text-gray-500' : 'text-gray-400'}`}>|</span>
              <span className={`${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{t('task.parsedTitle', { title: parsedTitle })}</span>
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
              {t('task.add')}
            </span>
            <span>{t('task.escToClose')}</span>
          </div>
          <div className={`flex items-center gap-1 text-xs ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
            <Command size={11} />
            <span>Shift + A</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
