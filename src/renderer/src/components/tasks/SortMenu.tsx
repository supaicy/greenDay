import { useState } from 'react'
import { ArrowUpDown, ArrowUp, ArrowDown, Check } from 'lucide-react'
import { useStore } from '../../store/useStore'
import type { SortBy } from '../../types'

interface SortOption {
  value: SortBy
  label: string
}

const SORT_OPTIONS: SortOption[] = [
  { value: 'default', label: '기본' },
  { value: 'dueDate', label: '마감일' },
  { value: 'priority', label: '우선순위' },
  { value: 'title', label: '제목' },
  { value: 'createdAt', label: '생성일' }
]

interface SortMenuProps {
  onClose?: () => void
}

export function SortMenu({ onClose }: SortMenuProps = {}) {
  const { sortBy, sortDir, setSortBy, setSortDir, theme } = useStore()
  const isDark = theme === 'dark'
  const [open, setOpen] = useState(false)

  const close = (): void => {
    setOpen(false)
    onClose?.()
  }

  const handleSelect = (value: SortBy) => {
    if (sortBy === value) {
      // 같은 항목 클릭 시 방향 토글
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(value)
      setSortDir('asc')
    }
  }

  const currentLabel = SORT_OPTIONS.find((o) => o.value === sortBy)?.label || '기본'

  return (
    <div className="relative">
      {/* 트리거 버튼 */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${
          sortBy !== 'default'
            ? 'text-primary-400 bg-primary-900/30'
            : isDark
              ? 'text-gray-500 hover:bg-gray-700'
              : 'text-gray-400 hover:bg-gray-200'
        }`}
      >
        <ArrowUpDown size={14} />
        {currentLabel}
        {sortBy !== 'default' && (sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>

      {/* 드롭다운 */}
      {open && (
        <>
          {/* 배경 클릭으로 닫기 (Pattern A: 순수 클릭 → button) */}
          <button
            type="button"
            aria-label="닫기"
            className="fixed inset-0 z-40"
            onClick={close}
          />

          <div
            className={`absolute right-0 top-full mt-1 z-50 rounded-lg shadow-2xl border py-1 min-w-[160px] ${
              isDark ? 'bg-[#2C2C2E] border-gray-700' : 'bg-white border-gray-200'
            }`}
          >
            {SORT_OPTIONS.map((option) => {
              const isSelected = sortBy === option.value
              return (
                <button
                  type="button"
                  key={option.value}
                  onClick={() => handleSelect(option.value)}
                  className={`w-full flex items-center justify-between px-4 py-2 text-sm transition-colors ${
                    isSelected
                      ? 'text-primary-400'
                      : isDark
                        ? 'text-gray-200 hover:bg-gray-700'
                        : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {isSelected && <Check size={14} />}
                    {!isSelected && <span className="w-[14px]" />}
                    {option.label}
                  </span>
                  {isSelected && option.value !== 'default' && (
                    <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>
                      {sortDir === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
