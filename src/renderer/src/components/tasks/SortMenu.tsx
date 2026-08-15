import { ArrowUp, ArrowDown, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import type { SortBy } from '../../types'

interface SortOption {
  value: SortBy
  labelKey: string
}

const SORT_OPTIONS: SortOption[] = [
  { value: 'default', labelKey: 'sort.default' },
  { value: 'dueDate', labelKey: 'sort.dueDate' },
  { value: 'priority', labelKey: 'sort.priority' },
  { value: 'title', labelKey: 'sort.title' },
  { value: 'createdAt', labelKey: 'sort.createdAt' }
]

interface SortMenuProps {
  /** 배경 클릭으로 메뉴를 닫는다. 선택 사항이면 배경이 조용히 죽으므로 필수로 둔다. */
  onClose: () => void
}

export function SortMenu({ onClose }: SortMenuProps) {
  const { t } = useTranslation()
  const sortBy = useStore((s) => s.sortBy)
  const sortDir = useStore((s) => s.sortDir)
  const setSortBy = useStore((s) => s.setSortBy)
  const setSortDir = useStore((s) => s.setSortDir)
  const theme = useStore((s) => s.theme)
  const isDark = theme === 'dark'

  const handleSelect = (value: SortBy) => {
    if (sortBy === value) {
      // 같은 항목 클릭 시 방향 토글
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(value)
      setSortDir('asc')
    }
  }

  // 트리거 버튼은 호출부(TaskList 헤더의 정렬 아이콘)가 갖는다. 여기에 또 두면
  // 아이콘을 눌러도 메뉴 대신 버튼이 하나 더 뜬다(2026-08-05 검증).
  return (
    <>
      {/* 배경 클릭으로 닫기 (Pattern A: 순수 클릭 → button) */}
      <button type="button" aria-label={t('common.close')} className="fixed inset-0 z-40" onClick={onClose} />

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
                {t(option.labelKey)}
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
  )
}
