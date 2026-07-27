import { describe, it, expect } from 'vitest'
import { looksLikeTaskAction, resolveActionTarget, actionOpLabel } from './aiActions'
import type { Task } from '../types'

function task(over: Partial<Task>): Task {
  return { id: 'id', title: 't', completed: false, parentId: null, deletedAt: null, ...over } as Task
}

describe('looksLikeTaskAction', () => {
  it('완료/미뤄/삭제 키워드는 감지', () => {
    expect(looksLikeTaskAction('보고서 완료 처리해줘')).toBe(true)
    expect(looksLikeTaskAction('그거 내일로 미뤄줘')).toBe(true)
    expect(looksLikeTaskAction('장보기 삭제해')).toBe(true)
  })
  it('일반 질문은 감지 안 함 (완료/했 등이 명령형이 아닐 때)', () => {
    expect(looksLikeTaskAction('오늘 뭐 해야 하지?')).toBe(false)
    expect(looksLikeTaskAction('가장 급한 거 알려줘')).toBe(false)
    expect(looksLikeTaskAction('오늘 완료한 거 알려줘')).toBe(false)
    expect(looksLikeTaskAction('이번 주에 완료된 작업 요약해줘')).toBe(false)
  })
})

describe('resolveActionTarget', () => {
  const tasks = [
    task({ id: 'a', title: '보고서 작성' }),
    task({ id: 'b', title: '장보기' }),
    task({ id: 'c', title: '완료된 것', completed: true }),
    task({ id: 'd', title: '하위작업', parentId: 'a' })
  ]
  it('정확 일치(공백/대소문자 무시)', () => {
    expect(resolveActionTarget('  장보기 ', tasks)?.id).toBe('b')
  })
  it('부분 포함 매칭', () => {
    expect(resolveActionTarget('보고서', tasks)?.id).toBe('a')
  })
  it('완료/하위작업/빈 제목은 대상 아님', () => {
    expect(resolveActionTarget('완료된 것', tasks)).toBeNull()
    expect(resolveActionTarget('하위작업', tasks)).toBeNull()
    expect(resolveActionTarget('  ', tasks)).toBeNull()
  })
})

describe('actionOpLabel', () => {
  it('op별 라벨', () => {
    expect(actionOpLabel('complete', null)).toBe('완료 처리')
    expect(actionOpLabel('delete', null)).toContain('삭제')
    expect(actionOpLabel('reschedule', '2026-07-28')).toContain('2026-07-28')
    expect(actionOpLabel('reschedule', null)).toBe('마감일 변경')
  })
})
