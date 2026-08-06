import type { Task } from '../types'

/**
 * 목록 검색 판별식. 뷰(TaskList)와 '전체 선택'(getFilteredTaskIds)이 같은 식을 써야
 * 화면에 보이는 것과 일괄 작업 대상이 어긋나지 않는다.
 */
export function matchesSearch(task: Task, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    task.title.toLowerCase().includes(q) ||
    task.description.toLowerCase().includes(q) ||
    task.tags.some((tag) => tag.toLowerCase().includes(q))
  )
}
