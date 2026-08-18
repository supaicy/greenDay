import { describe, it, expect } from 'vitest'
import { byPriority, byPinnedThenPriority, PRIORITY_OPTIONS } from './priority'
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

describe('byPinnedThenPriority', () => {
  const t = (priority: string, pinned = false) => ({ priority, pinned }) as never

  it('고정이 우선순위보다 앞선다', () => {
    // 고정을 정렬에 맡기면 '높음' 하나만 생겨도 고정한 것이 아래로 밀린다 —
    // 그러면 고정이라는 말이 무의미해진다.
    const sorted = [t('high'), t('none', true), t('medium')].sort(byPinnedThenPriority)
    expect(sorted.map((x: { pinned: boolean }) => x.pinned)).toEqual([true, false, false])
  })

  it('고정끼리는 우선순위로 줄 세운다', () => {
    const sorted = [t('low', true), t('high', true)].sort(byPinnedThenPriority)
    expect(sorted.map((x: { priority: string }) => x.priority)).toEqual(['high', 'low'])
  })

  it('pinned가 없는 옛 레코드도 안전하다', () => {
    const sorted = [{ priority: 'low' }, { priority: 'high' }].sort(byPinnedThenPriority as never)
    expect(sorted.map((x) => x.priority)).toEqual(['high', 'low'])
  })
})
