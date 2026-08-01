// 우선순위 관련 상수 — 여러 컴포넌트에서 공유하는 단일 정의
import type { Priority } from '../types'

/** 드롭다운·버튼에 사용하는 옵션 목록. label은 렌더 시점에 t(labelKey)로 번역한다. */
export const PRIORITY_OPTIONS: { value: Priority; labelKey: string; color: string }[] = [
  { value: 'none', labelKey: 'priority.none', color: 'text-gray-500' },
  { value: 'low', labelKey: 'priority.low', color: 'text-blue-400' },
  { value: 'medium', labelKey: 'priority.medium', color: 'text-yellow-400' },
  { value: 'high', labelKey: 'priority.high', color: 'text-red-400' }
]

/** 아이콘 색상 맵 (KanbanView, TimelineView, EisenhowerMatrix 공용) */
export const PRIORITY_COLOR: Record<Priority, string> = {
  high: 'text-red-500',
  medium: 'text-amber-500',
  low: 'text-blue-500',
  none: 'text-gray-400'
}

/** 정렬 순서 맵 (높은 우선순위 = 낮은 숫자) */
export const PRIORITY_ORDER: Record<Priority, number> = {
  high: 0,
  medium: 1,
  low: 2,
  none: 3
}
