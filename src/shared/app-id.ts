/**
 * 앱 번들 식별자 — 단일 출처.
 *
 * 이 값은 아래 자리에서 정확히 일치해야 한다:
 *   1. electron-builder.yml 의 `appId` (Info.plist의 CFBundleIdentifier가 된다)
 *   2. electron-builder.yml 의 `mac.protocols[].schemes` (앱의 URL 스킴)
 *   3. (Windows를 내면) electron-builder.yml 의 `win.protocols[].schemes` —
 *      NSIS가 설치 시 레지스트리에 등록한다. scripts/mas-preflight.sh 는 아직
 *      1~2만 대조하므로, win: 블록을 만들 때 검사도 같이 넓혀야 한다.
 *
 * **구글 OAuth는 더 이상 이 스킴을 쓰지 않는다** — 아래 `loopbackRedirectUri` 참고.
 * 스킴 정의 자체는 남긴다. 지우면 `index.ts`의 `open-url`·`second-instance` 배선이
 * 함께 무너지고, 앱을 URL로 여는 다른 용도가 생길 수 있다.
 *
 * 번들 ID의 역사 (2026-09-07 정리):
 *   - v1.4.1까지 실제로 배포된 것은 `com.haru.app` 이다(실제 dmg 를 열어 확인 —
 *     docs/reports/2026-09-07-v1.4.1-shipped-build.md). Apple 전역에서 선점돼 있어
 *     App ID 로 등록할 수 없었다.
 *   - `com.supaicy.haru` 는 그 뒤 저장소에만 있었고 한 번도 배포되지 않았다.
 *   - 그래서 어느 ID 로 가든 옛 사용자와의 자동 업데이트 연속성은 끊기며, 이왕이면
 *     브랜드에 맞는 `com.begreen.greenday` 로 간다(사용자 결정).
 *
 * **번들 ID만 바꾼다.** package.json 의 name/productName(Electron 내부 앱 이름
 * `ticktick`)은 그대로다 — macOS Keychain 의 `ticktick Safe Storage` 항목과 userData
 * 경로가 그 이름으로 정해지므로, 같이 바꾸면 기존 암호문을 프롬프트도 없이 조용히
 * 못 읽게 된다. 번들 ID 변경은 Keychain ACL 에만 영향을 줘서 "깨지는 게 아니라 묻는다".
 * 앱 이름과 번들 ID가 다른 것은 흔하다(Slack 이 com.tinyspeck.slackmacgap 인 것처럼).
 */
export const APP_BUNDLE_ID = 'com.begreen.greenday'

/**
 * v1.4.1까지 실제로 배포된 번들 ID. **브리지 릴리스(v1.5.0)만** 이 ID로 나간다 —
 * 옛 사용자에게 새 앱을 안내할 마지막 릴리스다(docs/2026-09-07-브리지-릴리스.md).
 * `electron-builder.bridge.cjs`의 appId와 정확히 같아야 한다.
 */
export const LEGACY_BUNDLE_ID = 'com.haru.app'

/** 브리지 릴리스의 버전. `electron-builder.bridge.cjs`의 extraMetadata.version과 같아야 한다. */
export const BRIDGE_VERSION = '1.5.0'

/** 이 빌드가 실제로 쓰는 번들 ID — 브리지 빌드면 옛 것, 아니면 새 것. */
export function bundleIdFor(isBridgeBuild: boolean): string {
  return isBridgeBuild ? LEGACY_BUNDLE_ID : APP_BUNDLE_ID
}

/**
 * 구글 OAuth 콜백을 받는 **루프백 주소**.
 *
 * 예전에는 커스텀 스킴(`<번들 ID>:/oauth2redirect`)을 썼다. MAS 샌드박스에서
 * `network.server` 권한이 필요 없다는 것이 이유였는데, **구글이 그 방식을 받지 않는다.**
 * 현행 native-app 계약은 설치형 앱에 루프백 IP를 요구하고 custom URI scheme은
 * 지원 대상이 아니다. 저장소는 이를 "iOS 번들 ID로 등록"해 우회하려 했지만,
 * Electron macOS 앱을 iOS 클라이언트로 등록하는 것은 지원되는 구성이 아니라
 * 새로 만든 production 클라이언트에서는 동의 뒤 콜백 전에 막힐 수 있다.
 *
 * **포트는 고정하지 않는다.** 고정하면 다른 앱이 먼저 잡고 있을 때 로그인이 통째로
 * 막히고, 그 포트를 선점한 프로세스가 인가 코드를 받게 된다. OS가 빈 포트를 주고
 * 그 값으로 redirect_uri를 만든다 — 구글은 루프백에 한해 포트를 대조하지 않는다.
 *
 * 호스트는 `localhost`가 아니라 **`127.0.0.1`**이다. `localhost`는 IPv6(::1)로 먼저
 * 풀릴 수 있고, 그러면 IPv4로 바인드한 서버에 콜백이 닿지 않는다.
 *
 * MAS 빌드에는 `com.apple.security.network.server` entitlement가 필요하다
 * (`resources/entitlements.mas.plist` — 2026-09-07 추가. `scripts/mas-preflight.sh` 3/6 이 확인한다).
 * Hardened Runtime(직접 배포)에는 그런 제약이 없다.
 */
export const OAUTH_LOOPBACK_HOST = '127.0.0.1'
export const OAUTH_LOOPBACK_PATH = '/oauth2redirect'

export function loopbackRedirectUri(port: number): string {
  return `http://${OAUTH_LOOPBACK_HOST}:${port}${OAUTH_LOOPBACK_PATH}`
}

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
