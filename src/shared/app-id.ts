/**
 * 앱 번들 식별자 — 단일 출처.
 *
 * 이 값은 아래 자리에서 정확히 일치해야 한다:
 *   1. electron-builder.yml 의 `appId` (Info.plist의 CFBundleIdentifier가 된다)
 *   2. electron-builder.yml 의 `mac.protocols[].schemes` (콜백을 받을 URL 스킴)
 *   3. Google OAuth 클라이언트의 iOS 번들 ID
 *   4. (Windows를 내면) electron-builder.yml 의 `win.protocols[].schemes` —
 *      NSIS가 설치 시 레지스트리에 등록한다. scripts/mas-preflight.sh 는 아직
 *      1~3만 대조하므로, win: 블록을 만들 때 검사도 같이 넓혀야 한다.
 *
 * 어긋나면 조용히 깨진다 — 구글 로그인은 브라우저에서 정상적으로 끝나고,
 * 그 콜백을 받을 앱이 없어 앱은 5분 뒤 타임아웃으로 끝난다. 그래서 코드 쪽은 여기
 * 한 곳에서만 정의하고, scripts/mas-preflight.sh 가 이 값과 electron-builder.yml 을 대조한다.
 *
 * 앱 이름은 Greenday지만 번들 ID는 com.supaicy.haru 다. 일부러 그렇게 뒀다 —
 * 번들 ID는 사용자에게 보이지 않는 내부 식별자이고, 이미 등록해 둔 App ID와
 * 프로비저닝 프로파일을 그대로 쓰기 위해서다. 이름과 다르다고 문제될 것은 없다
 * (Slack의 번들 ID가 com.tinyspeck.slackmacgap 인 것과 같은 이유).
 *
 * 애초에 쓰려던 `com.haru.app` 은 Apple 전역에서 이미 선점돼 있어 쓸 수 없었다 —
 * App ID는 모든 개발자를 통틀어 고유하다.
 */
export const APP_BUNDLE_ID = 'com.supaicy.haru'

/**
 * 구글 OAuth 콜백 주소. 루프백 서버(http://127.0.0.1:포트)가 아니라 커스텀 스킴을
 * 쓰기 때문에 Mac App Store 샌드박스에서 network.server 권한이 필요 없다.
 */
export const OAUTH_REDIRECT_URI = `${APP_BUNDLE_ID}:/oauth2redirect`

const SCHEME_PREFIX = `${APP_BUNDLE_ID}:`

/**
 * 이 URL이 우리 앱으로 온 콜백인가.
 *
 * 스킴 비교는 대소문자를 무시한다 — RFC 3986에서 스킴은 대소문자 구분이 없고,
 * Windows 레지스트리는 등록된 스킴을 자기 방식대로 정규화해서 넘긴다.
 * 뒤쪽(경로·쿼리)은 그대로 두는 게 맞아서 접두사만 접어서 비교한다.
 */
export function isAppScheme(url: string): boolean {
  if (typeof url !== 'string') return false
  return url.slice(0, SCHEME_PREFIX.length).toLowerCase() === SCHEME_PREFIX
}

/**
 * 프로세스 인자에서 우리 스킴 콜백 URL을 찾는다.
 *
 * macOS는 이미 실행 중인 앱에 `open-url` 이벤트로 콜백을 준다. Windows는 그 이벤트를
 * 영원히 발화하지 않는다 — 대신 앱을 한 번 더 실행하면서 URL을 **명령줄 인자로** 넘기고,
 * 그걸 받는 자리가 `app.on('second-instance', (_e, argv) => ...)` 이다.
 *
 * argv의 위치는 고정이 아니다. 패키징본은 `[exe, url]` 이지만 개발 중에는
 * `[electron, ., --flag, url]` 처럼 앞에 인자가 더 붙는다. 그래서 인덱스로 집지 않고
 * 전체를 훑어 첫 번째 유효한 것을 쓴다.
 *
 * Electron 없이 테스트할 수 있도록 순수 함수로 둔다 — Windows에서만 살아나는 버그가
 * 사는 자리가 정확히 여기다.
 */
export function findAppSchemeArg(argv: readonly string[]): string | null {
  if (!Array.isArray(argv)) return null
  for (const raw of argv) {
    if (typeof raw !== 'string') continue
    const arg = raw.trim()
    if (isAppScheme(arg)) return arg
  }
  return null
}
