// 드래그 앤 드롭 MIME 타입 상수 — 파일별 인라인 문자열을 한곳에 모아
// 오타로 인한 계약 불일치를 방지한다. (예: setData/getData/types.includes 간)
//
// - TASK_ID:    할일 리스트/아이템 → 캘린더로 드래그(마감일 배정). effectAllowed: copy
// - TASK_BLOCK: 주/일 시간블록 드래그(시간 이동). effectAllowed: move
// - CAL_DATE:   월간 캘린더에서 날짜 간 태스크 이동(마감일 변경). TASK_BLOCK과 분리.
export const DND_MIME = {
  TASK_ID: 'application/haru-task-id',
  TASK_BLOCK: 'application/haru-task-block',
  CAL_DATE: 'application/haru-cal-date'
} as const

export type DndMime = (typeof DND_MIME)[keyof typeof DND_MIME]
