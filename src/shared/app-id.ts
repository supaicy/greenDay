/**
 * 앱 번들 식별자 — 단일 출처.
 *
 * 이 값은 세 곳에서 정확히 일치해야 한다:
 *   1. electron-builder.yml 의 `appId` (Info.plist의 CFBundleIdentifier가 된다)
 *   2. electron-builder.yml 의 `mac.protocols[].schemes` (콜백을 받을 URL 스킴)
 *   3. Google OAuth 클라이언트의 iOS 번들 ID
 *
 * 어긋나면 조용히 깨진다 — 구글 로그인은 브라우저에서 정상적으로 끝나고,
 * 그 콜백을 받을 앱이 없어 앱은 영원히 기다린다. 그래서 코드 쪽은 여기 한 곳에서만
 * 정의하고, scripts/mas-preflight.sh 가 이 값과 electron-builder.yml 을 대조한다.
 *
 * 앱 이름이 haru → Greenday 로 바뀌면서 번들 ID도 맞췄다.
 * (`com.haru.app` 은 Apple 전역에서 이미 선점돼 있어 애초에 쓸 수 없었다 — App ID는
 * 모든 개발자를 통틀어 고유하다.)
 */
export const APP_BUNDLE_ID = 'com.supaicy.greenday'

/**
 * 구글 OAuth 콜백 주소. 루프백 서버(http://127.0.0.1:포트)가 아니라 커스텀 스킴을
 * 쓰기 때문에 Mac App Store 샌드박스에서 network.server 권한이 필요 없다.
 */
export const OAUTH_REDIRECT_URI = `${APP_BUNDLE_ID}:/oauth2redirect`

/** 이 URL이 우리 앱으로 온 콜백인가. */
export function isAppScheme(url: string): boolean {
  return url.startsWith(`${APP_BUNDLE_ID}:`)
}
