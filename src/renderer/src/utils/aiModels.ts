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

// 기존 할일 조작(완료/리스케줄/삭제) 자동 감지를 노출할 만큼 신뢰 가능한 모델인가?
// 3B급 소형 모델은 대상 태스크 식별이 부정확해(실측) 제외한다. 확인 카드가 안전을
// 보장하지만, 자동 감지 자체를 큰 모델에서만 켜서 오탐 빈도를 낮춘다.
// 액션 자동 감지를 허용하는 최소 파라미터 크기(B). 사용자 안내 문구는 "8B 권장"이지만,
// EXAONE 3.5(7.8B)를 포함하려고 자동 감지 하한은 의도적으로 7로 둔다(권장 ≠ 하한).
const MIN_CAPABLE_PARAMS_B = 7

export function isCapableModel(model: string): boolean {
  const n = model.toLowerCase()
  if (/mini|tiny|small/.test(n)) return false
  // 태그의 파라미터 크기: ':3b', '-1.5b', '/8b', '_7b' 등 → 하한 미만이면 소형
  const m = n.match(/[:\-_/](\d+(?:\.\d+)?)b\b/)
  if (m) return Number.parseFloat(m[1]) >= MIN_CAPABLE_PARAMS_B
  // llama3.2는 기본 3B → 이름만으로 소형 취급
  if (n.includes('llama3.2')) return false
  // 크기 불명이면 사용자의 선택을 신뢰(예: gpt-4o-mini는 위 mini에서 걸림)
  return true
}
