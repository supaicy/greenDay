import type { Task } from '../types'

export type ActionOp = 'complete' | 'reschedule' | 'delete' | 'none'

// main interpretTaskAction(ActionResult)의 렌더러 측 형상 — IPC 응답 캐스트와
// 대기 액션이 같은 계약을 공유하도록 한곳에 둔다.
export interface TaskActionInterpretation {
  op: ActionOp
  taskTitle: string
  dueDate: string | null
}

// 사용자 메시지가 '기존 할일 조작' 의도로 보이는가? — LLM 호출 전 가벼운 게이트.
// 매칭될 때만 액션 해석(비스트리밍 LLM 1콜)으로 라우팅해, 일반 질문의 지연을 늘리지 않는다.
// 명령형 표현 위주로 둔다 — 바로 '완료'는 "오늘 완료한 거 알려줘" 같은 질문에서
// 오탐하므로 '완료해/완료 처리'처럼 명령 형태만 매칭한다.
//
// 주의: 이건 '지연 최적화'용 사전 게이트일 뿐 정확성 경계가 아니다. 최종 판정은
// main의 interpretTaskAction(LLM)이 하며 op="none"으로 무효화할 수 있다. 따라서 이
// 키워드 목록과 main 프롬프트의 액션 단서(완료/미뤄/삭제 등)는 느슨하게 동기화돼야
// 한다 — 여기에 없는 표현은 액션 해석까지 못 가고 일반 채팅으로 빠진다(안전한 폴백).
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
  // 부분 일치 중 가장 '구체적인'(제목이 긴) 후보를 고른다 — "회의 준비"에 대해 짧고
  // 일반적인 제목("준비")이 needle.includes(title)로 잘못 잡히는 것을 방지.
  const partials = candidates.filter((t) => {
    const title = t.title.trim().toLowerCase()
    return title.includes(needle) || needle.includes(title)
  })
  if (partials.length === 0) return null
  return partials.reduce((best, t) => (t.title.trim().length > best.title.trim().length ? t : best))
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
