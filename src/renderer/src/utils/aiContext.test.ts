import { describe, it, expect } from 'vitest'
import { buildAiTaskContext } from './aiContext'
import type { Task } from '../types'

const task = (p: Partial<Task>): Task =>
  ({
    id: p.id ?? Math.random().toString(),
    title: p.title ?? 't',
    completed: p.completed ?? false,
    dueDate: p.dueDate ?? null,
    dueTime: p.dueTime ?? null,
    priority: p.priority ?? 'none',
    tags: p.tags ?? [],
    parentId: p.parentId ?? null,
    completedAt: p.completedAt ?? null
  }) as unknown as Task

describe('buildAiTaskContext', () => {
  it('미완료를 마감 임박 → 우선순위 순으로 정렬하고, 마감 없는 것은 뒤로', () => {
    const out = buildAiTaskContext([
      task({ title: 'no-date-high', priority: 'high' }),
      task({ title: 'later', dueDate: '2026-08-10' }),
      task({ title: 'soon', dueDate: '2026-07-27' })
    ])
    expect(out.map((t) => t.title)).toEqual(['soon', 'later', 'no-date-high'])
  })

  it('같은 마감(혹은 무마감)끼리는 우선순위 높은 순', () => {
    const out = buildAiTaskContext([
      task({ title: 'low' }),
      task({ title: 'high', priority: 'high' }),
      task({ title: 'med', priority: 'medium' })
    ])
    expect(out.map((t) => t.title)).toEqual(['high', 'med', 'low'])
  })

  it('하위작업(parentId)은 제외', () => {
    const out = buildAiTaskContext([
      task({ title: 'top' }),
      task({ title: 'sub', parentId: 'top-id' })
    ])
    expect(out.map((t) => t.title)).toEqual(['top'])
  })

  it('완료는 최근 완료 순으로 뒤에 붙고 개수 제한', () => {
    const out = buildAiTaskContext(
      [
        task({ title: 'todo' }),
        task({ title: 'done-old', completed: true, completedAt: '2026-07-01T00:00:00Z' }),
        task({ title: 'done-new', completed: true, completedAt: '2026-07-25T00:00:00Z' })
      ],
      40,
      1
    )
    // 미완료 먼저, 완료는 maxCompleted=1개(가장 최근)만
    expect(out.map((t) => t.title)).toEqual(['todo', 'done-new'])
  })

  it('dueTime과 tags를 컨텍스트에 포함', () => {
    const [ctx] = buildAiTaskContext([task({ title: 'x', dueDate: '2026-07-27', dueTime: '14:00', tags: ['work'] })])
    expect(ctx).toMatchObject({ dueDate: '2026-07-27', dueTime: '14:00', tags: ['work'] })
  })
})
