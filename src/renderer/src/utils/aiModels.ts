// 한국어 답변 품질이 좋은 것으로 알려진 로컬 모델 계열(부분 일치, 대소문자 무시).
// llama3.2(3B)는 한국어에 영어/CJK 혼입이 잦아(실측) 제외 — EXAONE/EEVE 등
// 한국어 특화 모델을 권장한다.
export const KOREAN_RECOMMENDED_MODELS = ['exaone', 'eeve'] as const

// 설치된 모델명이 한국어 추천 계열인가? (예: 'exaone3.5:7.8b', 'EEVE-Korean')
export function isKoreanRecommendedModel(model: string): boolean {
  const n = model.toLowerCase()
  return KOREAN_RECOMMENDED_MODELS.some((k) => n.includes(k))
}

// 설치된 모델 중 한국어 추천 계열이 하나라도 있는가?
export function hasKoreanRecommendedModel(models: string[]): boolean {
  return models.some(isKoreanRecommendedModel)
}
