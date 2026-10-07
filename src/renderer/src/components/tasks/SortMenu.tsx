import type { ReactNode } from 'react'
import { ArrowUp, ArrowDown, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import type { SortBy } from '../../types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

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

export function SortMenu({ trigger }: { trigger: ReactNode }) {
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

  return (
    // 트리거는 호출처가 준다. 예전에는 호출처가 자기 버튼으로 이 컴포넌트를
    // mount하고 이 컴포넌트가 버튼을 또 그려서, 메뉴를 열려면 두 번 눌러야
    // 했다 — 첫 클릭은 두 번째 버튼을 나타나게 할 뿐이었다.
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>

      {/* 백드롭 div와 위치 계산은 Radix가 대신한다 — 화살표 키 이동과
          포커스 복귀(닫으면 트리거로 돌아간다)도 함께 온다. */}
      <DropdownMenuContent align="end" className="min-w-[160px]">
        {SORT_OPTIONS.map((option) => {
          const isSelected = sortBy === option.value
          return (
            <DropdownMenuItem
              key={option.value}
              // 정렬 방향 토글이 목적이라 고른 뒤에도 열어둔다.
              onSelect={(e) => {
                e.preventDefault()
                handleSelect(option.value)
              }}
              className={`justify-between text-sm ${isSelected ? 'text-primary-400' : ''}`}
            >
              <span className="flex items-center gap-2">
                {isSelected ? <Check size={14} /> : <span className="w-[14px]" />}
                {t(option.labelKey)}
              </span>
              {isSelected && option.value !== 'default' && (
                <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>
                  {sortDir === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                </span>
              )}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
