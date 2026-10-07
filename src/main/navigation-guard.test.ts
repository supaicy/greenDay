/**
 * C2 회귀 — 창이 앱 문서 밖으로 넘어가면 그 페이지가 `window.api`를 물려받는다.
 *
 * 감사 당시에는 GUI로 재현되지 않은 항목이었다. 이 브랜치에서 실제 Electron 40으로
 * 재현했다: 앱 문서에서 렌더러 발원 네비게이션으로 임의의 `file://` 문서에 넘어간 뒤
 * `Object.keys(window.api).length === 79`. 같은 하네스에 아래 판정을 건 `will-navigate` /
 * `will-frame-navigate`를 붙이면 창이 앱 문서에 그대로 남는다.
 *
 * (드래그 제스처 자체는 재현하지 못했다 — CDP `Input.dispatchDragEvent`는 리스너가 하나도
 * 없는 빈 페이지에서도 네비게이션을 일으키지 않는다. 막는 대상은 "앱 문서 밖으로 나가는
 * 네비게이션"이고, 그 경로가 드롭 하나만 있는 것도 아니다.)
 */

import { describe, it, expect } from 'vitest'
import { appDocumentUrl, isAppDocumentUrl } from './navigation-guard'

const INDEX = '/Applications/Greenday.app/Contents/Resources/app.asar/out/renderer/index.html'
const SHIPPED = appDocumentUrl(undefined, INDEX)
const DEV = 'http://localhost:5173'

describe('appDocumentUrl', () => {
  it('개발 서버 URL이 있으면 그것이 기준이다', () => {
    expect(appDocumentUrl(DEV, INDEX)).toBe(DEV)
  })

  it('없으면 번들 index.html의 file: URL', () => {
    expect(SHIPPED).toBe(`file://${INDEX}`)
  })

  // 빈 문자열이 들어와도 파일 경로로 떨어져야 한다. `??`로 적으면 ''가 통과해
  // 기준 URL이 빈 문자열이 되고, 그러면 아래 판정이 **모든 것을 막아** 앱이 안 뜬다.
  it('개발 URL이 빈 문자열이면 파일 경로를 쓴다', () => {
    expect(appDocumentUrl('', INDEX)).toBe(SHIPPED)
  })
})

describe('isAppDocumentUrl — 출하 빌드(file:)', () => {
  it('앱 문서 자신은 통과한다', () => {
    expect(isAppDocumentUrl(SHIPPED, SHIPPED)).toBe(true)
  })

  it('퍼센트 인코딩이 달라도 같은 파일이면 통과한다', () => {
    const spaced = appDocumentUrl(undefined, '/Users/me/My Apps/out/renderer/index.html')
    expect(spaced).toContain('%20')
    expect(isAppDocumentUrl(spaced.replace(/%20/g, ' '), spaced)).toBe(true)
  })

  // 여기가 C2다. 사용자가 창에 떨어뜨린 파일은 대개 같은 file: 스킴으로 온다.
  it('떨어뜨린 파일로는 넘어가지 못한다', () => {
    expect(isAppDocumentUrl('file:///Users/me/Downloads/evil.html', SHIPPED)).toBe(false)
  })

  it('같은 폴더의 다른 파일도 막는다', () => {
    expect(isAppDocumentUrl(SHIPPED.replace('index.html', 'evil.html'), SHIPPED)).toBe(false)
  })

  // `new URL`이 `..`를 먼저 정규화하므로 문자열 접두사 검사와 달리 여기서 걸린다.
  it('경로 탈출(..)로 되돌아오는 척해도 막는다', () => {
    expect(isAppDocumentUrl(`${SHIPPED}/../evil.html`, SHIPPED)).toBe(false)
  })

  /**
   * `file:` URL의 `origin`은 WHATWG 규칙상 전부 `'null'`이다. 판정을 origin으로 적었다면
   * 이 줄이 통과한다 — 원격 호스트를 가리키는 file: URL이 "앱 문서"가 된다.
   */
  it('호스트가 붙은 file: URL을 막는다', () => {
    expect(isAppDocumentUrl(`file://evil.example${new URL(SHIPPED).pathname}`, SHIPPED)).toBe(false)
  })

  it('개발 서버 주소로도 넘어가지 못한다', () => {
    expect(isAppDocumentUrl('http://localhost:5173/', SHIPPED)).toBe(false)
    expect(isAppDocumentUrl('https://evil.example/', SHIPPED)).toBe(false)
  })

  it.each(['about:blank', 'javascript:alert(1)', 'data:text/html,<h1>x', '', 'not a url'])(
    '앱 문서가 아닌 %s 은 막는다',
    (candidate) => {
      expect(isAppDocumentUrl(candidate, SHIPPED)).toBe(false)
    }
  )
})

describe('isAppDocumentUrl — 개발 서버(http:)', () => {
  it('진입 문서는 통과한다 — `/`와 `/index.html`은 같은 것이다', () => {
    expect(isAppDocumentUrl(DEV, DEV)).toBe(true)
    expect(isAppDocumentUrl(`${DEV}/`, DEV)).toBe(true)
    expect(isAppDocumentUrl(`${DEV}/index.html`, DEV)).toBe(true)
  })

  it('기준이 /index.html로 와도 같게 본다 — 도구 버전에 따라 갈린다', () => {
    const base = `${DEV}/index.html`
    expect(isAppDocumentUrl(DEV, base)).toBe(true)
    expect(isAppDocumentUrl(`${DEV}/`, base)).toBe(true)
    expect(isAppDocumentUrl(base, base)).toBe(true)
  })

  /**
   * 예전에는 개발 오리진 안이면 **아무 경로나** 통과시켰다. 개발 서버는 프로젝트
   * 트리를 서빙하므로, 그 안의 아무 HTML로나 넘어가면 그 문서가 preload를 물려받는다.
   */
  it('같은 오리진이어도 다른 경로는 막는다', () => {
    expect(isAppDocumentUrl(`${DEV}/evil.html`, DEV)).toBe(false)
    expect(isAppDocumentUrl(`${DEV}/src/anything.html`, DEV)).toBe(false)
    expect(isAppDocumentUrl(`${DEV}/@vite/client`, DEV)).toBe(false)
    expect(isAppDocumentUrl(`${DEV}/index.html/../evil.html`, DEV)).toBe(false)
  })

  it('쿼리와 해시는 문서를 바꾸지 않는다', () => {
    expect(isAppDocumentUrl(`${DEV}/?t=1`, DEV)).toBe(true)
    expect(isAppDocumentUrl(`${DEV}/index.html#/today`, DEV)).toBe(true)
  })

  it('포트만 달라도 다른 오리진이다', () => {
    expect(isAppDocumentUrl('http://localhost:5174/', DEV)).toBe(false)
  })

  it('개발 중에도 떨어뜨린 파일은 막는다', () => {
    expect(isAppDocumentUrl('file:///Users/me/Downloads/evil.html', DEV)).toBe(false)
  })

  it('다른 호스트는 막는다', () => {
    expect(isAppDocumentUrl('http://evil.example/', DEV)).toBe(false)
  })

  /**
   * 302 우회의 착륙 지점이 정확히 이 모양이다 — 허용된 진입 경로에서 출발해
   * 다른 오리진(포트만 달라도 된다)으로 리다이렉트된다. `main-window.ts`가 이 판정을
   * `will-redirect`에도 걸어야 실제로 막힌다(배선은 `mainWindow.test.ts`가 본다).
   */
  it('리다이렉트가 데려가려는 다른 오리진도 같은 판정에서 걸린다', () => {
    expect(isAppDocumentUrl('http://127.0.0.1:52665/pwned', DEV)).toBe(false)
  })
})
