// 우선순위 관련 상수 — 여러 컴포넌트에서 공유하는 단일 정의
import type { Priority } from '../types'

/** 드롭다운·버튼에 사용하는 옵션 목록. label은 렌더 시점에 t(labelKey)로 번역한다. */
export const PRIORITY_OPTIONS: { value: Priority; labelKey: string; color: string }[] = [
  { value: 'none', labelKey: 'priority.none', color: 'text-gray-500' },
  { value: 'low', labelKey: 'priority.low', color: 'text-blue-400' },
  { value: 'medium', labelKey: 'priority.medium', color: 'text-amber-400' },
  { value: 'high', labelKey: 'priority.high', color: 'text-red-400' }
]

/**
 * 우선순위 배경 스타일 — 선택됐을 때 그 자체로 무엇인지 읽히도록 면색을 쓴다.
 * 앱 표면이 중립 회색이라 채도를 낮춘 반투명 면 + 같은 계열 테두리로 얹는다.
 */
export const PRIORITY_SURFACE: Record<Priority, string> = {
  // 채운 면은 실제로 중요한 두 단계에만 준다. 넷 다 채우면 선택 칩이 패널에서
  // 가장 채도 높은 물체가 되어, '낮음'이 18px 제목보다 먼저 눈에 들어왔다.
  high: 'bg-red-500/20 text-red-200 border-red-500/50',
  medium: 'bg-amber-500/20 text-amber-200 border-amber-500/50',
  low: 'bg-transparent text-blue-300 border-blue-500/60',
  none: 'bg-transparent text-gray-200 border-gray-500/60'
}

/** 라이트 모드용. 배경은 옅게, 글자는 진하게 — 흰 바탕에서 대비를 확보한다. */
export const PRIORITY_SURFACE_LIGHT: Record<Priority, string> = {
  high: 'bg-red-100 text-red-700 border-red-300',
  medium: 'bg-amber-100 text-amber-700 border-amber-300',
  low: 'bg-white text-blue-700 border-blue-400',
  none: 'bg-white text-gray-700 border-gray-400'
}

/** 아이콘 색상 맵 (KanbanView, TimelineView, EisenhowerMatrix 공용) */
export const PRIORITY_COLOR: Record<Priority, string> = {
  high: 'text-red-500',
  medium: 'text-amber-500',
  low: 'text-blue-500',
  none: 'text-gray-400'
}

/** 정렬 순서 맵 (높은 우선순위 = 낮은 숫자). 바깥에서는 byPriority만 쓴다. */
const PRIORITY_ORDER: Record<Priority, number> = {
  high: 0,
  medium: 1,
  low: 2,
  none: 3
}

/** 우선순위 내림차순 비교자. 네 화면이 같은 화살표 함수를 각자 적어 두고 있었다. */
export function byPriority(a: { priority: Priority }, b: { priority: Priority }): number {
  return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
}
