import type { SmartList, Task } from '../types'
import { isDueToday, isDueTomorrow, isDueInNext7Days, isOverdue } from './date'

// selectedListId 값 중 '실제 리스트 컨테이너가 아닌' 스마트 리스트 집합.
// 태스크의 listId 는 이 중 어떤 값도 되지 않는다 → 이 뷰에서 새 태스크를 만들면
// 리스트를 상속하지 않고 기본함('inbox')으로 보낸다. ('inbox' 는 실제 컨테이너라 제외.)
export const VIRTUAL_SMART_LISTS: SmartList[] = [
  'today',
  'tomorrow',
  'next7days',
  'all',
  'summary',
  'completed',
  'trash'
]

export function isVirtualSmartList(id: string): boolean {
  return (VIRTUAL_SMART_LISTS as string[]).includes(id)
}

// 마감일 기반 스마트 리스트의 '미완료 태스크' 판별식 단일 출처.
// 뷰 필터(TaskList)와 사이드바 뱃지 카운트가 반드시 같은 식을 쓰도록 공유한다.
type DateSmartList = 'today' | 'tomorrow' | 'next7days' | 'summary'
export const SMART_LIST_PREDICATES: Record<DateSmartList, (t: Task) => boolean> = {
  today: (t) => !t.completed && (isDueToday(t.dueDate) || isOverdue(t.dueDate)),
  tomorrow: (t) => !t.completed && isDueTomorrow(t.dueDate),
  next7days: (t) => !t.completed && isDueInNext7Days(t.dueDate),
  summary: (t) => !t.completed && (isOverdue(t.dueDate) || isDueInNext7Days(t.dueDate))
}

// listId 로 마감일 기반 판별식을 조회 (없으면 undefined). 뷰/뱃지/일괄선택이
// 모두 같은 로컬-시간 판별식을 쓰도록 하는 단일 진입점.
export function smartListPredicate(id: string): ((t: Task) => boolean) | undefined {
  return (SMART_LIST_PREDICATES as Record<string, (t: Task) => boolean>)[id]
}
