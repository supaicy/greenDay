// 드래그 앤 드롭 MIME 타입 상수 — 파일별 인라인 문자열을 한곳에 모아
// 오타로 인한 계약 불일치를 방지한다. (예: setData/getData/types.includes 간)
//
// - TASK_ID:    할일 목록/배정 안 됨 레일 → 주·일 캘린더로 드래그(시간 배정). effectAllowed: move
// - TASK_BLOCK: 주/일 시간블록 드래그(시간 이동). effectAllowed: move
// - CAL_DATE:   월간 캘린더에서 날짜 간 태스크 이동(마감일 변경). TASK_BLOCK과 분리.
// - BLOCK_DATE: TASK_BLOCK과 함께 실리는 출발 발생일(YYYY-MM-DD) — 반복 할일의
//               회차 오버라이드 이동을 판정하는 데 필요하다.
export const DND_MIME = {
  TASK_ID: 'application/haru-task-id',
  TASK_BLOCK: 'application/haru-task-block',
  CAL_DATE: 'application/haru-cal-date',
  BLOCK_DATE: 'application/haru-block-date'
} as const

export type DndMime = (typeof DND_MIME)[keyof typeof DND_MIME]
