import { useMemo, useState, useRef, useEffect } from 'react'
import { Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/**
 * 태그 칩 + (+). 전에는 라벨 옆에 맨 input이 있어 placeholder가 유일한 라벨이었고
 * 이미 쓰던 태그를 다시 타이핑해야 했다. (+)를 누르면 입력과 함께 기존 태그가
 * 목록으로 뜬다 — 오타로 태그가 갈라지는 것을 막는 게 자동완성의 요점이다.
 */
export function TagPicker({
  tags,
  onChange,
  autoOpenSignal
}: {
  tags: string[]
  onChange: (tags: string[]) => void
  /** ⋯ 메뉴의 '태그'에서 값이 바뀌면 팝오버를 연다. */
  autoOpenSignal?: number
}) {
  const { t } = useTranslation()
  const isDark = useStore((s) => s.theme) === 'dark'
  const allTasks = useStore((s) => s.tasks)
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoOpenSignal) setOpen(true)
  }, [autoOpenSignal])

  // 저장소 전체에서 쓰인 태그. 이 태스크에 이미 붙은 것과 입력어로 거른다.
  const suggestions = useMemo(() => {
    const seen = new Set<string>()
    for (const task of allTasks) for (const tag of task.tags) seen.add(tag)
    const q = input.trim().toLowerCase()
    return [...seen]
      .filter((tag) => !tags.includes(tag) && (!q || tag.toLowerCase().includes(q)))
      .sort((a, b) => a.localeCompare(b, 'ko'))
      .slice(0, 8)
  }, [allTasks, tags, input])

  const add = (tag: string): void => {
    const next = tag.trim()
    if (!next || tags.includes(next)) return
    onChange([...tags, next])
    setInput('')
    inputRef.current?.focus()
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className={`group flex h-6 items-center gap-1 rounded-md px-2 text-xs ${
            isDark ? 'bg-amber-500/15 text-amber-200' : 'bg-amber-100 text-amber-800'
          }`}
        >
          {tag}
          <button
            type="button"
            onClick={() => onChange(tags.filter((x) => x !== tag))}
            aria-label={t('common.delete')}
            className="opacity-60 transition-opacity hover:opacity-100"
          >
            <X size={10} />
          </button>
        </span>
      ))}

      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setInput('')
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t('detail.tagsLabel')}
            className={`flex h-6 w-6 items-center justify-center rounded-full border transition-colors ${
              isDark
                ? 'border-surface-line text-gray-400 hover:border-primary-500 hover:text-primary-400'
                : 'border-gray-300 text-gray-500 hover:border-primary-500 hover:text-primary-500'
            }`}
          >
            <Plus size={12} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[240px] p-2">
          <input
            ref={inputRef}
            // biome-ignore lint/a11y/noAutofocus: 팝오버는 이 입력을 쓰려고 여는 것이라 포커스가 목적이다
            autoFocus
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter') add(input)
            }}
            placeholder={t('detail.tagsPlaceholder')}
            className={`h-8 w-full rounded-md border px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60 ${
              isDark
                ? 'border-surface-line bg-surface-sunken text-gray-100 placeholder-gray-400'
                : 'border-gray-300 bg-white text-gray-700 placeholder-gray-500'
            }`}
          />
          {suggestions.length > 0 && (
            <div className="mt-1.5 max-h-[180px] overflow-y-auto">
              {suggestions.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => add(tag)}
                  className={`block w-full rounded px-2 py-1.5 text-left text-sm transition-colors ${
                    isDark ? 'text-gray-200 hover:bg-surface-sunken' : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
