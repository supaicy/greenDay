import { describe, it, expect } from 'vitest'
import { isKoreanRecommendedModel, hasKoreanRecommendedModel } from './aiModels'

describe('isKoreanRecommendedModel', () => {
  it('EXAONE / EEVE 계열은 추천(대소문자·태그 무관)', () => {
    expect(isKoreanRecommendedModel('exaone3.5:7.8b')).toBe(true)
    expect(isKoreanRecommendedModel('EEVE-Korean-10.8B')).toBe(true)
  })
  it('일반 모델은 추천 아님', () => {
    expect(isKoreanRecommendedModel('llama3.2:latest')).toBe(false)
    expect(isKoreanRecommendedModel('gpt-4o-mini')).toBe(false)
  })
})

describe('hasKoreanRecommendedModel', () => {
  it('목록에 추천 모델이 하나라도 있으면 true', () => {
    expect(hasKoreanRecommendedModel(['llama3.2:latest', 'exaone3.5'])).toBe(true)
  })
  it('추천 모델이 없으면 false', () => {
    expect(hasKoreanRecommendedModel(['llama3.2:latest', 'qwen2.5'])).toBe(false)
    expect(hasKoreanRecommendedModel([])).toBe(false)
  })
})
