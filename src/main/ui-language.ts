import { isMainLanguage, mainStrings, type MainLanguage } from '../shared/main-strings'

// 렌더러가 알려 주는 UI 언어. 메인이 사용자에게 직접 보이거나 렌더러로 돌려주는 문구 전부
// (리마인더 알림, 앱 메뉴, 시작·종료 대화상자, 파일 선택 필터 이름, 동기화·OAuth 오류)가 이걸 따른다.
// index.ts의 모듈 지역 변수였을 때는 ipc-handlers가 읽을 수 없어 문구가 갈렸다.
//
// **렌더러가 말하기 전의 기본값은 `seedUiLanguage()`가 OS 로케일로 정한다.** 창보다
// 먼저 뜨는 대화상자가 둘 있고, 그 둘이 여기 적힌 기본값에 묶여 있었다.
let uiLanguage: MainLanguage = 'ko'

/** 렌더러가 한 번이라도 언어를 말했는가. 뒤늦은 씨앗이 사용자의 선택을 덮지 않게 한다. */
let rendererSpoke = false

/**
 * OS 로케일로 초기값을 심는다. **렌더러가 말하기 전에 나가는 문구가 이 함수의 전부다.**
 *
 * 기본값이 'ko'였고 그 값을 바꾸는 유일한 길이 렌더러의 `set-language` IPC였다. 그
 * IPC는 창이 뜨고 페이지가 로드된 뒤에야 도착하는데, 메인이 스스로 띄우는 대화상자
 * 둘은 `createWindow()` **앞**에 뜬다 — 번들 ID 이전 설치의 Keychain 안내
 * (`migration/boot.ts`의 `notifyKeychain`)와 데이터 손상 알림(`index.ts`의
 * initDatabase catch). 그래서 한국어가 아닌 OS의 사용자는 "항상 허용"을 누를지
 * 정하는 바로 그 순간에 한국어 모달을 봤고, 거부하면 AI 키·캘린더 앱 암호·Google
 * 연결이 함께 끊겼다. `main-strings.ts`의 영어 문구 다섯(`keychainNotice*` 셋 ·
 * `dbFailed*` 둘)은 아무도 못 보는 죽은 번역이었다.
 *
 * **로케일은 주입받는다.** 이 모듈은 electron을 import하지 않는다 —
 * `app-menu.test.ts`가 electron 없이 이 표를 읽는다. 호출처가 `app.getLocale()`을
 * 넘긴다(그 값이 서는 것은 `app.whenReady()` 뒤다).
 *
 * 매핑은 렌더러의 `detectLanguage()`와 같다: 한국어면 'ko', 나머지는 전부 'en'.
 * 여기서 'ko'를 유지하면 일본어 OS 사용자에게 메인만 한국어가 된다 — 렌더러는 그
 * 경우 'en'을 고르므로 한 앱 안에서 언어가 갈린다.
 *
 * 렌더러가 이미 말했으면 심지 않는다. 설정에서 고른 언어는 localStorage에 있어
 * 메인이 읽을 수 없고, OS 로케일이 그 선택을 덮으면 재시작마다 되돌아간다.
 */
export function seedUiLanguage(locale: unknown): void {
  if (rendererSpoke) return
  uiLanguage = typeof locale === 'string' && locale.toLowerCase().startsWith('ko') ? 'ko' : 'en'
}

/**
 * 값이 **바뀌었으면** true.
 *
 * 알림처럼 매번 새로 그리는 문구는 이 답이 필요 없지만, 앱 메뉴는 한 번 짓고
 * 그대로 서 있는다 — 언어가 바뀐 순간 다시 짓지 않으면 영영 처음 언어로 남는다.
 * 실제로 그랬다: `applyAppMenu`가 부팅 때 한 번만 불렸고 그때는 항상 기본값
 * 'ko'라, 영어 사용자에게 메뉴만 한국어로 굳어 있었다.
 */
export function setUiLanguage(value: unknown): boolean {
  if (!isMainLanguage(value)) return false
  // 값이 같아도 "렌더러가 말했다"는 사실은 남긴다 — 뒤늦게 불린 `seedUiLanguage`가
  // 사용자가 설정에서 고른 언어를 OS 로케일로 되돌리지 않게.
  rendererSpoke = true
  if (value === uiLanguage) return false
  uiLanguage = value
  return true
}

export function uiStrings(): ReturnType<typeof mainStrings> {
  return mainStrings(uiLanguage)
}
