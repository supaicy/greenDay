import type { SmartList, Task } from '../types'
import { smartListPredicate, tagFromListId } from './smartLists'
import { matchesSearch } from './search'

// '전체 선택'(배치 모드) 대상 태스크 id 목록.
// 뷰(TaskList)는 항상 하위작업(parentId)을 제외하고 최상위만 보여주므로,
// 전체 선택도 화면에 보이는 목록과 정확히 일치하도록 최상위 태스크만 대상으로 한다.
// 마감일 기반 스마트 리스트는 뷰와 동일한 판별식(smartListPredicate)을 재사용해
// 시간대/포맷 불일치를 제거한다.
export function getFilteredTaskIds(tasks: Task[], listId: string | SmartList, searchQuery = ''): string[] {
  // 검색 중이면 화면에 남은 것만 대상이다. 이 필터가 빠져 있어서 '전체 선택' 후
  // 일괄 완료/삭제하면 검색으로 가려진 항목까지 함께 처리됐다.
  const topLevel = tasks.filter((t) => !t.parentId && matchesSearch(t, searchQuery))
  const tag = tagFromListId(listId as string)
  if (tag) return topLevel.filter((t) => !t.completed && t.tags.includes(tag)).map((t) => t.id)
  const pred = smartListPredicate(listId as string)
  if (pred) return topLevel.filter(pred).map((t) => t.id)
  switch (listId) {
    case 'all':
      return topLevel.filter((t) => !t.completed).map((t) => t.id)
    case 'completed':
      return topLevel.filter((t) => t.completed).map((t) => t.id)
    default:
      return topLevel.filter((t) => t.listId === listId && !t.completed).map((t) => t.id)
  }
}
