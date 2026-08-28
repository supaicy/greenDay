/**
 * 브라우저를 열어 구글 로그인을 받고, **루프백 리스너**로 돌아온 인가 코드를 토큰으로
 * 바꾸는 흐름. Electron·node 의존(shell, http)이 있는 부분만 여기 모아 둔다.
 *
 * ## 왜 루프백인가 (C6)
 *
 * 예전에는 커스텀 스킴(`com.supaicy.haru:/oauth2redirect`)으로 콜백을 받았다. MAS
 * 샌드박스에서 `network.server` 권한이 필요 없다는 것이 이유였는데, **구글이 그
 * 방식을 받지 않는다** — 현행 native-app 계약은 설치형 앱에 루프백 IP를 요구하고
 * custom URI scheme은 지원 대상이 아니다. 저장소는 그것을 "iOS 번들 ID로 등록"해
 * 우회하려 했지만, Electron macOS 앱을 iOS 클라이언트로 등록하는 것은 지원되는
 * 구성이 아니라 새 production 클라이언트에서는 동의 뒤 콜백 전에 막힐 수 있다.
 *
 * 즉 클라이언트 ID를 넣어도 로그인이 끝까지 가지 못하는 상태였다.
 *
 * ## 리스너가 지키는 것
 *
 * - **`127.0.0.1`에만 바인드한다.** 호스트를 빼면 모든 인터페이스에 열리고, 그 포트는
 *   인가 코드를 받는 자리다.
 * - **포트를 고정하지 않는다.** 고정하면 다른 앱이 먼저 잡았을 때 로그인이 통째로
 *   막히고, 선점한 프로세스가 코드를 받게 된다. OS가 준 포트로 redirect_uri를 만든다.
 * - **한 번 쓰고 닫는다.** 성공이든 실패든 리스너는 그 자리에서 내려간다 — 로그인하지
 *   않는 동안 열린 포트를 들고 있을 이유가 없다.
 * - **정해진 경로만 처리한다.** 브라우저는 `/favicon.ico` 같은 것도 함께 요청한다.
 * - `state` 대조와 PKCE 검증은 `google/oauth.ts`가 한다.
 */

import { shell } from 'electron'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { loopbackRedirectUri, OAUTH_LOOPBACK_HOST, OAUTH_LOOPBACK_PATH } from '../shared/app-id'
import {
  buildAuthUrl,
  createPkcePair,
  createState,
  exchangeCode,
  parseCallbackUrl,
  OAuthError,
  type TokenSet
} from './google/oauth'

/** 사용자가 브라우저에서 로그인을 끝내지 않으면 여기서 끊는다. */
const FLOW_TIMEOUT_MS = 5 * 60 * 1000

interface PendingFlow {
  verifier: string
  state: string
  clientId: string
  redirectUri: string
  server: Server
  resolve: (tokens: TokenSet) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let pending: PendingFlow | null = null

/**
 * 흐름 하나를 끝낸다 — 타이머를 지우고, **리스너를 내리고**, 그게 현재 대기 중인
 * 것이면 자리를 비운 뒤 결말을 낸다.
 *
 * `action`은 모듈 변수 `pending`이 아니라 **인자로 받은 flow**를 붙잡아야 한다.
 * 여기서 `pending = null`이 먼저 일어나기 때문에, `() => pending?.reject(...)` 처럼 쓰면
 * 옵셔널 체이닝이 조용히 삼켜서 그 Promise가 영원히 안 끝난다(타이머도 이미 지워진 뒤라
 * 5분 타임아웃으로도 구제되지 않는다). 2026-08-06에 실제로 그 상태였다.
 */
function settle(flow: PendingFlow, action: () => void): void {
  clearTimeout(flow.timer)
  flow.server.close()
  if (pending === flow) pending = null
  action()
}

/** 브라우저 탭에 남는 안내. 사용자가 여기서 앱으로 돌아가야 한다는 것을 알려 준다. */
function replyPage(response: ServerResponse, title: string, body: string): void {
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>${title}</title><style>
body{font:16px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:grid;
place-items:center;height:100vh;margin:0;color:#1C1C1E;background:#fff}
@media (prefers-color-scheme:dark){body{color:#E5E5EA;background:#1C1C1E}}
div{text-align:center;max-width:28rem;padding:0 1.5rem}p{color:#8E8E93}
</style></head><body><div><h1>${title}</h1><p>${body}</p></div></body></html>`
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end(html)
}

/**
 * 로그인 창을 열고 토큰을 기다린다. 진행 중인 흐름이 있으면 그것을 취소하고 새로
 * 시작한다 — 사용자가 버튼을 두 번 누르면 콜백이 어느 쪽 것인지 알 수 없다.
 */
export async function startGoogleAuth(clientId: string): Promise<TokenSet> {
  const previous = pending
  if (previous) settle(previous, () => previous.reject(new OAuthError('cancelled', '이전 인증 요청이 취소되었습니다.')))

  const { verifier, challenge } = createPkcePair()
  const state = createState()

  const server = createServer()
  const port = await listenOnLoopback(server)
  const redirectUri = loopbackRedirectUri(port)

  return new Promise<TokenSet>((resolve, reject) => {
    const flow: PendingFlow = {
      verifier,
      state,
      clientId,
      redirectUri,
      server,
      resolve,
      reject,
      timer: setTimeout(() => {
        settle(flow, () => reject(new OAuthError('timeout', '로그인 시간이 초과되었습니다. 다시 시도하세요.')))
      }, FLOW_TIMEOUT_MS)
    }
    pending = flow

    server.on('request', (request: IncomingMessage, response: ServerResponse) => {
      // 브라우저는 `/favicon.ico` 같은 것도 함께 요청한다. 우리 경로가 아니면
      // 흐름을 건드리지 않고 조용히 닫는다.
      const url = new URL(request.url ?? '/', redirectUri)
      if (url.pathname !== OAUTH_LOOPBACK_PATH) {
        response.writeHead(404).end()
        return
      }
      void completeWithCallback(flow, url.toString(), response)
    })

    // 앱 안의 웹뷰가 아니라 기본 브라우저로 연다. 구글은 임베디드 웹뷰에서의 로그인을
    // 차단하고, 사용자도 주소창에서 accounts.google.com을 직접 확인할 수 있어야 한다.
    void shell.openExternal(buildAuthUrl({ clientId, redirectUri, challenge, state })).catch((cause) => {
      const error = new OAuthError('open_failed', '브라우저를 열지 못했습니다.')
      error.cause = cause
      settle(flow, () => reject(error))
    })
  })
}

/** OS가 준 빈 포트로 루프백에 바인드한다. */
function listenOnLoopback(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const fail = (cause?: Error): void => {
      server.close()
      const error = new OAuthError('listen_failed', '로그인 응답을 받을 자리를 열지 못했습니다. 다시 시도하세요.')
      if (cause) error.cause = cause
      reject(error)
    }
    server.once('error', fail)
    // 포트 0 = OS가 고른다. 호스트를 빼면 모든 인터페이스에 열린다 — 반드시 붙인다.
    server.listen(0, OAUTH_LOOPBACK_HOST, () => {
      server.removeListener('error', fail)
      const address = server.address() as AddressInfo | null
      if (!address) {
        fail()
        return
      }
      resolve(address.port)
    })
  })
}

/**
 * 콜백 URL을 토큰으로 바꾸고, 브라우저에는 결과를 그린 뒤 흐름을 끝낸다.
 *
 * **응답을 `settle`보다 먼저 보낸다.** `settle`이 리스너를 닫으므로, 순서가 뒤바뀌면
 * 사용자는 로그인을 마치고 빈 화면을 본다.
 */
async function completeWithCallback(flow: PendingFlow, callbackUrl: string, response: ServerResponse): Promise<void> {
  try {
    const { code } = parseCallbackUrl(callbackUrl, flow.state)
    const tokens = await exchangeCode(
      {
        clientId: flow.clientId,
        redirectUri: flow.redirectUri,
        code,
        verifier: flow.verifier,
        now: new Date().toISOString()
      },
      (u, init) => fetch(u, init)
    )
    replyPage(response, '연결됐습니다', 'Greenday로 돌아가세요. 이 창은 닫아도 됩니다.')
    settle(flow, () => flow.resolve(tokens))
  } catch (error) {
    replyPage(response, '연결하지 못했습니다', 'Greenday로 돌아가 다시 시도해 주세요.')
    settle(flow, () => flow.reject(error instanceof Error ? error : new Error(String(error))))
  }
}

/**
 * 앱 커스텀 스킴으로 들어온 URL 처리 — **더 이상 OAuth 경로가 아니다.**
 *
 * 콜백은 루프백 리스너가 받는다(파일 맨 위 주석). 이 함수는 `index.ts`의 `open-url`·
 * `second-instance` 배선이 그대로 컴파일되도록 남겨 둔 자리이고 언제나 false를
 * 돌려준다 — 오래된 링크나 다른 앱이 이 스킴을 열어도 진행 중인 로그인을 건드리지
 * 못하게 하는 것이 여기서 할 일의 전부다.
 *
 * (그 배선은 이제 죽은 코드다. `index.ts`는 다른 워크트리 소유라 정리하지 않고 보고했다.)
 */
export async function handleGoogleCallback(_url: string): Promise<boolean> {
  return false
}

/** 테스트·연결 해제 시 대기 중인 흐름을 정리한다. */
export function cancelGoogleAuth(): void {
  const flow = pending
  if (flow) settle(flow, () => flow.reject(new OAuthError('cancelled', '인증이 취소되었습니다.')))
}
