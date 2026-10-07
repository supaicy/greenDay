import { describe, it, expect } from 'vitest'
import { getFilteredTaskIds } from './filteredTaskIds'
import { tagListId } from './smartLists'
import type { Task } from '../types'

// getFilteredTaskIds가 읽는 필드(id/parentId/completed/listId/tags)만 채운 최소 팩토리.
function task(over: Partial<Task>): Task {
  return {
    id: 'id',
    completed: false,
    listId: 'inbox',
    tags: [],
    parentId: null,
    ...over
  } as Task
}

describe('getFilteredTaskIds — 하위작업 제외 일원화', () => {
  it("'all'에서 하위작업을 제외한다 (뷰와 일치)", () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b-sub', parentId: 'a' }), task({ id: 'c' })]
    expect(getFilteredTaskIds(tasks, 'all')).toEqual(['a', 'c'])
  })

  it('실제 리스트에서도 하위작업을 제외한다', () => {
    const tasks = [
      task({ id: 'a', listId: 'work' }),
      task({ id: 'a-sub', listId: 'work', parentId: 'a' }),
      task({ id: 'other', listId: 'home' })
    ]
    expect(getFilteredTaskIds(tasks, 'work')).toEqual(['a'])
  })

  it("'completed'에서도 최상위 완료 태스크만 (하위작업 제외)", () => {
    const tasks = [
      task({ id: 'a', completed: true }),
      task({ id: 'a-sub', completed: true, parentId: 'a' }),
      task({ id: 'b', completed: false })
    ]
    expect(getFilteredTaskIds(tasks, 'completed')).toEqual(['a'])
  })

  it('태그 뷰는 기존대로 최상위 미완료 태스크만', () => {
    const tasks = [
      task({ id: 'a', tags: ['x'] }),
      task({ id: 'a-sub', tags: ['x'], parentId: 'a' }),
      task({ id: 'done', tags: ['x'], completed: true })
    ]
    expect(getFilteredTaskIds(tasks, tagListId('x'))).toEqual(['a'])
  })
})
