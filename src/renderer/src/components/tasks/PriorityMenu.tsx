import type { ReactNode } from 'react'
import { Flag, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PRIORITY_OPTIONS, PRIORITY_COLOR } from '../../utils/priority'
import type { Priority } from '../../types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

/**
 * 우선순위 = 깃발 하나. 네 칸짜리 세그먼티드는 메타 줄에서 폭을 가장 많이 쓰면서
 * 선택 칩이 패널에서 가장 채도 높은 물체가 됐다. 상단바의 깃발 아이콘이 현재
 * 등급을 색으로 알리고, 누르면 네 항목이 뜬다(높음이 위).
 */
export function PriorityMenu({
  value,
  onChange,
  trigger
}: {
  value: Priority
  onChange: (p: Priority) => void
  trigger: ReactNode
}) {
  const { t } = useTranslation()
  // 목록과 같은 순서로 높음 → 없음. PRIORITY_OPTIONS는 없음부터라 뒤집는다.
  const ordered = [...PRIORITY_OPTIONS].reverse()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[140px]">
        {ordered.map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            onSelect={() => onChange(opt.value)}
            className="justify-between gap-3 text-sm"
          >
            <span className="flex items-center gap-2">
              <Flag size={14} className={PRIORITY_COLOR[opt.value]} />
              <span className={value === opt.value ? 'text-primary-400' : ''}>{t(opt.labelKey)}</span>
            </span>
            {value === opt.value && <Check size={14} className="text-primary-400" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
