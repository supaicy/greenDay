/**
 * 이 창이 머물러도 되는 문서는 **하나뿐이다.**
 *
 * preload는 그 `webContents`가 *어떤 문서를 로드하든* 다시 실행된다. 창이 한 번이라도
 * 다른 페이지로 넘어가면 그 페이지가 `window.api`를 통째로 물려받는다 — 실측했다:
 * 앱 문서에서 임의의 `file://` 문서로 넘긴 뒤 `Object.keys(window.api).length === 79`.
 * `index.html`의 CSP는 **옛 문서의 메타 태그**라 새 문서에 따라가지 않고, "렌더러에
 * XSS 싱크가 없다"도 방어가 되지 않는다 — 코드 실행 발판이 필요 없기 때문이다.
 * 넘어간 페이지는 `export-data`·`open-attachment`·`open-external`·`license:activate`,
 * 그리고 라이선스가 살아 있는 동안 모든 `paid` 채널을 그냥 부른다.
 *
 * 넘어가는 길이 여럿이다: 창에 **파일을 떨어뜨리기**(Electron 기본 동작), `location.href`,
 * `target=_self` 링크, 폼 제출, `window.open` 뒤의 리다이렉트. `setWindowOpenHandler`는
 * **새 창**만 보므로 이 중 하나도 막지 못한다.
 *
 * 판정을 여기 순수 함수로 두는 이유는 `index.ts`를 테스트에서 import할 수 없기
 * 때문이다 — 그 파일은 import만으로 `app.requestSingleInstanceLock()`부터 돈다.
 * (`app-ipc.ts`가 같은 이유로 `index.ts`에서 갈라져 나왔다.)
 */

import { pathToFileURL } from 'node:url'

/**
 * 이 창이 로드하는 유일한 문서의 URL.
 *
 * **창이 실제로 로드하는 값과 같은 식으로 만든다.** 예전에는 `loadFile(경로)`가 URL을
 * 스스로 만들었는데, 그러면 가드가 비교할 기준을 손으로 한 번 더 조립하게 되고 둘이
 * 갈리는 순간 가드가 정상 문서를 막거나(앱이 안 뜬다) 아무것도 안 막는다.
 */
export function appDocumentUrl(rendererDevUrl: string | undefined, indexHtmlPath: string): string {
  return rendererDevUrl || pathToFileURL(indexHtmlPath).href
}

/**
 * 이 URL로 넘어가도 되는가.
 *
 * **프로토콜과 호스트는 항상 같아야 한다.** `file:`에서 `origin`을 비교하는 것은
 * 의미가 없다 — WHATWG URL은 모든 `file:` URL의 origin을 `'null'`로 만들어서, 그걸로
 * 비교하면 `file://evil.example/x`가 그대로 통과한다. `host`는 그 자리에서 갈린다.
 *
 * 경로 판정은 두 갈래다.
 *   - **출하 빌드(`file:`)**: 문서가 `index.html` 하나뿐이라 경로까지 못 박는다.
 *     같은 폴더에 떨어진 파일도, `..`로 올라가는 경로도 여기서 걸린다(`new URL`이
 *     `..`를 먼저 정규화하므로 문자열 장난이 안 통한다).
 *   - **개발 서버(`http:`)**: 오리진만 본다. HMR과 Vite 오버레이가 같은 오리진 안에서
 *     자유롭게 움직이고, `ELECTRON_RENDERER_URL`이 경로 없이 오는지(`http://host:5173`)
 *     `/index.html`까지 오는지가 도구 버전에 달려 있다. 경로를 못 박으면 그 차이 하나로
 *     개발 환경이 첫 리로드에 죽는다. 개발 서버는 로컬이고 출하되지 않는다.
 */
export function isAppDocumentUrl(candidate: string, appUrl: string): boolean {
  let target: URL
  let base: URL
  try {
    target = new URL(candidate)
    base = new URL(appUrl)
  } catch {
    // `about:blank`·`javascript:`·빈 문자열처럼 파싱되지 않거나 오리진이 없는 것.
    // 앱 문서가 아니면 전부 닫는 쪽으로 떨어진다.
    return false
  }
  if (target.protocol !== base.protocol) return false
  if (target.host !== base.host) return false
  if (target.protocol !== 'file:') return true
  return decodePath(target.pathname) === decodePath(base.pathname)
}

/**
 * 퍼센트 인코딩을 벗겨 비교한다. 창이 로드한 URL과 네비게이션 이벤트가 실어 오는 URL이
 * 같은 파일을 서로 다르게 인코딩해 올 수 있다(공백이 `%20`으로 오는 쪽과 아닌 쪽).
 * 잘못된 인코딩은 그대로 두고 비교한다 — 어차피 같지 않으면 막힌다.
 */
function decodePath(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
