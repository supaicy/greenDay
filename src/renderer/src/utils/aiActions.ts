import type { Task } from '../types'

export type ActionOp = 'complete' | 'reschedule' | 'delete' | 'none'

// 사용자 메시지가 '기존 할일 조작' 의도로 보이는가? — LLM 호출 전 가벼운 게이트.
// 매칭될 때만 액션 해석(비스트리밍 LLM 1콜)으로 라우팅해, 일반 질문의 지연을 늘리지 않는다.
// 명령형 표현 위주로 둔다 — 바로 '완료'는 "오늘 완료한 거 알려줘" 같은 질문에서
// 오탐하므로 '완료해/완료 처리'처럼 명령 형태만 매칭한다.
const ACTION_HINTS = [
  '완료해',
  '완료 처리',
  '완료처리',
  '끝냈',
  '끝났어',
  '다 했',
  '체크해',
  '미뤄',
  '미루',
  '내일로',
  '모레로',
  '다음주로',
  '다음 주로',
  '리스케줄',
  '연기해',
  '삭제',
  '지워',
  '없애',
  '제거'
]

export function looksLikeTaskAction(message: string): boolean {
  const m = message.toLowerCase()
  return ACTION_HINTS.some((h) => m.includes(h))
}

// 모델이 고른 taskTitle을 실제 태스크로 해석. 정확 일치(공백/대소문자 무시) 우선,
// 없으면 부분 포함(양방향) 매칭. 미완료·최상위·미삭제 태스크만 대상. 없으면 null.
export function resolveActionTarget(taskTitle: string, tasks: Task[]): Task | null {
  const needle = taskTitle.trim().toLowerCase()
  if (!needle) return null
  const candidates = tasks.filter((t) => !t.completed && !t.parentId && !t.deletedAt)
  const exact = candidates.find((t) => t.title.trim().toLowerCase() === needle)
  if (exact) return exact
  return (
    candidates.find((t) => {
      const title = t.title.trim().toLowerCase()
      return title.includes(needle) || needle.includes(title)
    }) ?? null
  )
}

// 확인 카드에 쓸 사람이 읽는 동작 설명.
export function actionOpLabel(op: ActionOp, dueDate: string | null): string {
  switch (op) {
    case 'complete':
      return '완료 처리'
    case 'delete':
      return '삭제(휴지통으로)'
    case 'reschedule':
      return dueDate ? `마감일을 ${dueDate}(으)로 변경` : '마감일 변경'
    default:
      return ''
  }
}
