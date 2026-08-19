import { isMainLanguage, mainStrings, type MainLanguage } from '../shared/main-strings'

// 렌더러가 알려 주는 UI 언어. 메인이 직접 띄우는 문구(리마인더 알림, 앱 메뉴)에만 쓴다.
// index.ts의 모듈 지역 변수였을 때는 ipc-handlers가 읽을 수 없어 문구가 갈렸다.
let uiLanguage: MainLanguage = 'ko'

/**
 * 값이 **바뀌었으면** true.
 *
 * 알림처럼 매번 새로 그리는 문구는 이 답이 필요 없지만, 앱 메뉴는 한 번 짓고
 * 그대로 서 있는다 — 언어가 바뀐 순간 다시 짓지 않으면 영영 처음 언어로 남는다.
 * 실제로 그랬다: `applyAppMenu`가 부팅 때 한 번만 불렸고 그때는 항상 기본값
 * 'ko'라, 영어 사용자에게 메뉴만 한국어로 굳어 있었다.
 */
export function setUiLanguage(value: unknown): boolean {
  if (!isMainLanguage(value) || value === uiLanguage) return false
  uiLanguage = value
  return true
}

export function uiStrings(): ReturnType<typeof mainStrings> {
  return mainStrings(uiLanguage)
}
