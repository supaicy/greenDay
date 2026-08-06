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

// 태그별 보기: selectedListId 를 'tag:<태그명>' 형태로 인코딩해 기존 리스트
// 선택 배관(setSelectedList/필터)을 그대로 재사용한다.
export const TAG_PREFIX = 'tag:'

export function tagListId(tag: string): string {
  return `${TAG_PREFIX}${tag}`
}

export function tagFromListId(id: string): string | null {
  return id.startsWith(TAG_PREFIX) ? id.slice(TAG_PREFIX.length) : null
}

export function isVirtualSmartList(id: string): boolean {
  // 태그 뷰도 실제 컨테이너가 아니다 → 새 태스크는 리스트를 상속하지 않는다.
  return id.startsWith(TAG_PREFIX) || (VIRTUAL_SMART_LISTS as string[]).includes(id)
}

/**
 * 하위작업은 부모 안에서만 보여 준다 — 목록·보드·뱃지 어디서도 독립 항목으로 세지 않는다.
 *
 * 이 규칙이 화면마다 인라인으로 복사돼 있어서 칸반·타임라인·아이젠하워에는 하위작업이
 * 독립 카드로 새어 나왔고(2026-08-05 검증), 사이드바 뱃지는 목록과 개수가 갈렸다.
 * 새 화면이 늘어도 어긋나지 않도록 판별식을 여기서만 정의한다.
 */
export function isTopLevel(t: Task): boolean {
  return !t.parentId
}

/** 화면에 항목으로 설 수 있는 태스크: 살아 있고, 미완료이고, 최상위. */
export function isActiveTopLevel(t: Task): boolean {
  return !t.completed && !t.deletedAt && isTopLevel(t)
}

// 마감일 기반 스마트 리스트의 '미완료 태스크' 판별식 단일 출처.
// 뷰 필터(TaskList)와 사이드바 뱃지 카운트가 반드시 같은 식을 쓰도록 공유한다.
type DateSmartList = 'today' | 'tomorrow' | 'next7days' | 'summary'
export const SMART_LIST_PREDICATES: Record<DateSmartList, (t: Task) => boolean> = {
  today: (t) => isActiveTopLevel(t) && (isDueToday(t.dueDate) || isOverdue(t.dueDate)),
  tomorrow: (t) => isActiveTopLevel(t) && isDueTomorrow(t.dueDate),
  next7days: (t) => isActiveTopLevel(t) && isDueInNext7Days(t.dueDate),
  summary: (t) => isActiveTopLevel(t) && (isOverdue(t.dueDate) || isDueInNext7Days(t.dueDate))
}

// listId 로 마감일 기반 판별식을 조회 (없으면 undefined). 뷰/뱃지/일괄선택이
// 모두 같은 로컬-시간 판별식을 쓰도록 하는 단일 진입점.
export function smartListPredicate(id: string): ((t: Task) => boolean) | undefined {
  return (SMART_LIST_PREDICATES as Record<string, (t: Task) => boolean>)[id]
}
