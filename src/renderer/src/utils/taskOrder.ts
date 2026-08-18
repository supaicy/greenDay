import type { SortBy, SortDir, Task } from '../types'

const PRIORITY_RANK = { high: 3, medium: 2, low: 1, none: 0 } as const

/**
 * 목록에 보일 순서를 정한다. 뷰 컴포넌트 안에 있던 정렬을 여기로 옮겼다 —
 * '고정'이 붙으면서 정렬이 두 단계(고정 → 기준)가 됐고, 그 규칙은 화면 배치가
 * 아니라 검증 가능한 자리에 있어야 한다.
 *
 * 고정은 정렬 기준보다 항상 앞선다. 고정을 정렬에 맡기면 '높음' 하나만 생겨도
 * 고정한 것이 아래로 밀려, 고정이라는 말이 무의미해진다.
 */
export function orderTasks(tasks: Task[], sortBy: SortBy, sortDir: SortDir): Task[] {
  const sorted = sortBy === 'default' ? tasks : sortByKey(tasks, sortBy, sortDir)
  if (!sorted.some((t) => t.pinned)) return sorted
  // 안정 분할 — 고정끼리의 상대 순서는 위 단계가 정한 그대로 둔다.
  return [...sorted.filter((t) => t.pinned), ...sorted.filter((t) => !t.pinned)]
}

function sortByKey(tasks: Task[], sortBy: SortBy, sortDir: SortDir): Task[] {
  const dir = sortDir === 'asc' ? 1 : -1
  return [...tasks].sort((a, b) => {
    switch (sortBy) {
      case 'dueDate': {
        // 빈 값은 방향과 무관하게 뒤로. 내림차순에서 날짜 없는 것이 맨 위에
        // 올라오면 '가장 급한 것부터'라는 읽기가 깨진다.
        if (!a.dueDate && !b.dueDate) return 0
        if (!a.dueDate) return 1
        if (!b.dueDate) return -1
        return a.dueDate.localeCompare(b.dueDate) * dir
      }
      case 'priority':
        return (PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]) * dir
      case 'title':
        return a.title.localeCompare(b.title, 'ko') * dir
      case 'createdAt':
        return (new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) * dir
      default:
        return 0
    }
  })
}
