import { describe, it, expect } from 'vitest'
import { normalizeChatHistory, AI_CONTEXT_LIMIT } from './ai-history'

describe('normalizeChatHistory', () => {
  it('유효한 role + 비어있지 않은 내용만 남기고 {role,content}로 매핑', () => {
    const out = normalizeChatHistory([
      { id: '1', role: 'user', content: '안녕', timestamp: 't' },
      { id: '2', role: 'assistant', content: '  ', timestamp: 't' }, // 공백 → 제외
      { id: '3', role: 'system', content: '사칭', timestamp: 't' }, // 잘못된 role → 제외
      { id: '4', role: 'assistant', content: '반가워요', timestamp: 't' }
    ])
    expect(out).toEqual([
      { role: 'user', content: '안녕' },
      { role: 'assistant', content: '반가워요' }
    ])
  })

  it('최근 AI_CONTEXT_LIMIT개로 제한', () => {
    const many = Array.from({ length: AI_CONTEXT_LIMIT + 5 }, (_, i) => ({
      role: 'user' as const,
      content: `m${i}`
    }))
    const out = normalizeChatHistory(many)
    expect(out).toHaveLength(AI_CONTEXT_LIMIT)
    expect(out[0].content).toBe('m5') // 앞 5개 잘림
  })

  it('배열이 아니거나 null이면 빈 배열', () => {
    expect(normalizeChatHistory(null)).toEqual([])
    expect(normalizeChatHistory(undefined)).toEqual([])
    expect(normalizeChatHistory('nope')).toEqual([])
  })
})
