import { byPinned, byPriority } from './priority'
import type { SortBy, SortDir, Task } from '../types'

/**
 * 목록에 보일 순서를 정한다. 뷰 컴포넌트 안에 있던 정렬을 여기로 옮겼다 —
 * '고정'이 붙으면서 정렬이 두 단계(고정 → 기준)가 됐고, 그 규칙은 화면 배치가
 * 아니라 검증 가능한 자리에 있어야 한다.
 *
 * 고정은 정렬 기준보다 항상 앞선다(규칙의 출처는 utils/priority.ts byPinned).
 */
export function orderTasks(tasks: Task[], sortBy: SortBy, sortDir: SortDir): Task[] {
  return pinnedFirst(sortBy === 'default' ? tasks : sortByKey(tasks, sortBy, sortDir))
}

/**
 * 고정을 앞으로 끌어내되, 각 묶음 안의 상대 순서는 그대로 둔다.
 * Array.sort는 안정 정렬이라 byPinned 하나로 분할과 순서 보존이 동시에 된다.
 */
function pinnedFirst(tasks: Task[]): Task[] {
  return tasks.some((t) => t.pinned) ? [...tasks].sort(byPinned) : tasks
}

/**
 * 드래그로 옮길 수 있는 id 목록. 고정 경계는 넘지 않는다.
 *
 * 화면 순서를 그대로 넘기면 applyReorder가 그 순서대로 sortOrder를 다시 매겨,
 * 고정이 만든 배치가 영구히 구워진다 — 고정을 풀어도 그 항목이 맨 위에 남는다.
 * 드래그하지도 않은 항목의 순서가 조용히 바뀌는 것이라, 같은 묶음 안에서만
 * 자리를 바꾸게 한다. 넘을 수 없는 드롭이면 null.
 */
export function reorderWithinPinGroup(visible: Task[], dragId: string, targetId: string): string[] | null {
  const from = visible.find((t) => t.id === dragId)
  const to = visible.find((t) => t.id === targetId)
  if (!from || !to || dragId === targetId) return null
  if (!!from.pinned !== !!to.pinned) return null

  const ids = visible.filter((t) => !!t.pinned === !!from.pinned).map((t) => t.id)
  const fromIdx = ids.indexOf(dragId)
  const toIdx = ids.indexOf(targetId)
  if (fromIdx < 0 || toIdx < 0) return null
  ids.splice(fromIdx, 1)
  ids.splice(toIdx, 0, dragId)
  return ids
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
        return byPriority(a, b) * dir
      case 'title':
        return a.title.localeCompare(b.title, 'ko') * dir
      case 'createdAt':
        return (new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) * dir
      default:
        return 0
    }
  })
}
