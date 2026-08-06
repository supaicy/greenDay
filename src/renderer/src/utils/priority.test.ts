import { describe, it, expect } from 'vitest'
import { byPriority, PRIORITY_OPTIONS } from './priority'
import type { Priority } from '../types'

const at = (priority: Priority) => ({ priority })

describe('byPriority', () => {
  it('sorts high → medium → low → none', () => {
    const shuffled = [at('none'), at('high'), at('low'), at('medium')]
    expect([...shuffled].sort(byPriority).map((x) => x.priority)).toEqual(['high', 'medium', 'low', 'none'])
  })

  // 칸반·타임라인은 같은 우선순위 안의 순서를 sort의 안정성에 맡긴다.
  it('returns 0 for equal priorities so callers keep their secondary order', () => {
    expect(byPriority(at('low'), at('low'))).toBe(0)
  })

  it('covers every priority the options table exposes', () => {
    const sorted = PRIORITY_OPTIONS.map((o) => at(o.value)).sort(byPriority)
    expect(sorted.map((x) => x.priority)).toEqual(['high', 'medium', 'low', 'none'])
  })
})
