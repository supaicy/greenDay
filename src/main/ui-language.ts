import { isMainLanguage, mainStrings, type MainLanguage } from '../shared/main-strings'

// 렌더러가 알려 주는 UI 언어. 메인이 직접 띄우는 문구(리마인더 알림 등)에만 쓴다.
// index.ts의 모듈 지역 변수였을 때는 ipc-handlers가 읽을 수 없어 문구가 갈렸다.
let uiLanguage: MainLanguage = 'ko'

export function setUiLanguage(value: unknown): void {
  if (isMainLanguage(value)) uiLanguage = value
}

export function uiStrings(): ReturnType<typeof mainStrings> {
  return mainStrings(uiLanguage)
}
