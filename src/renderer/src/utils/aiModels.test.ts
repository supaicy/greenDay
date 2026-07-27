import { describe, it, expect } from 'vitest'
import { isKoreanRecommendedModel, hasKoreanRecommendedModel, isCapableModel } from './aiModels'

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

describe('isCapableModel', () => {
  it('7B 이상 태그는 capable', () => {
    expect(isCapableModel('exaone3.5:7.8b')).toBe(true)
    expect(isCapableModel('llama3.1:8b')).toBe(true)
    expect(isCapableModel('gpt-oss:20b')).toBe(true)
  })
  it('3B급 이하 / mini 는 부적합', () => {
    expect(isCapableModel('llama3.2:3b')).toBe(false)
    expect(isCapableModel('llama3.2:latest')).toBe(false)
    expect(isCapableModel('qwen2.5:1.5b')).toBe(false)
    expect(isCapableModel('gpt-4o-mini')).toBe(false)
  })
  it('크기 불명이면 신뢰(capable)', () => {
    expect(isCapableModel('gpt-4o')).toBe(true)
    expect(isCapableModel('some-custom-model')).toBe(true)
  })
  it('크기 태그 뒤 접미사가 붙어도 파싱(:\\d+b\\b 경계)', () => {
    expect(isCapableModel('exaone3.5:7.8b-instruct')).toBe(true)
    expect(isCapableModel('qwen2.5:0.5b-chat')).toBe(false)
  })
  it('mini/tiny/small은 큰 크기 태그보다 우선해 부적합', () => {
    expect(isCapableModel('foo-mini:70b')).toBe(false)
  })
})
