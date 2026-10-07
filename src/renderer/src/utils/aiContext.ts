import type { Task } from '../types'

// AI 채팅에 넘기는 태스크 컨텍스트. dueTime/tags까지 포함해 답변 품질을 높인다.
export interface AiTaskContext {
  title: string
  dueDate: string | null
  dueTime: string | null
  /** 기간의 시작일. 없으면 dueDate 하루짜리다. */
  startDate: string | null
  priority: string
  completed: boolean
  tags: string[]
}

const PRIORITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1, none: 0 }

function toContext(t: Task): AiTaskContext {
  return {
    title: t.title,
    dueDate: t.dueDate,
    dueTime: t.dueTime,
    startDate: t.startDate,
    priority: t.priority,
    completed: t.completed,
    tags: t.tags
  }
}

// 채팅 컨텍스트 선정: 미완료 최상위 태스크를 '마감 임박 → 우선순위 높음' 순으로 먼저,
// 이어서 최근 완료 몇 개를 붙인다. 배열 순서대로 앞 50개만 자르던 방식보다 훨씬 유용.
export function buildAiTaskContext(tasks: Task[], maxIncomplete = 40, maxCompleted = 8): AiTaskContext[] {
  const incomplete = tasks
    .filter((t) => !t.completed && !t.parentId)
    .sort((a, b) => {
      // 마감일 있는 것 먼저(빠른 날짜 순), 없는 것은 뒤로. 같으면 우선순위 높은 순.
      if (a.dueDate && b.dueDate) {
        if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate)
      } else if (a.dueDate) return -1
      else if (b.dueDate) return 1
      return (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0)
    })
    .slice(0, maxIncomplete)
    .map(toContext)

  const completed = tasks
    .filter((t) => t.completed)
    .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''))
    .slice(0, maxCompleted)
    .map(toContext)

  return [...incomplete, ...completed]
}
