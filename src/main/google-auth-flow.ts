/**
 * 브라우저를 열어 구글 로그인을 받고, 커스텀 URL 스킴으로 돌아온 인가 코드를 토큰으로
 * 바꾸는 흐름. Electron 의존(shell, protocol)이 있는 부분만 여기 모아 둔다.
 */

import { shell } from 'electron'
import { OAUTH_REDIRECT_URI } from '../shared/app-id'
import {
  buildAuthUrl,
  createPkcePair,
  createState,
  exchangeCode,
  parseCallbackUrl,
  OAuthError,
  type TokenSet
} from './google/oauth'

export { OAUTH_REDIRECT_URI as REDIRECT_URI } from '../shared/app-id'

/** 사용자가 브라우저에서 로그인을 끝내지 않으면 여기서 끊는다. */
const FLOW_TIMEOUT_MS = 5 * 60 * 1000

interface PendingFlow {
  verifier: string
  state: string
  clientId: string
  resolve: (tokens: TokenSet) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let pending: PendingFlow | null = null

function settle(flow: PendingFlow, action: () => void): void {
  clearTimeout(flow.timer)
  if (pending === flow) pending = null
  action()
}

/**
 * 로그인 창을 열고 토큰을 기다린다. 진행 중인 흐름이 있으면 그것을 취소하고 새로
 * 시작한다 — 사용자가 버튼을 두 번 누르면 콜백이 어느 쪽 것인지 알 수 없다.
 */
export function startGoogleAuth(clientId: string): Promise<TokenSet> {
  if (pending) settle(pending, () => pending?.reject(new OAuthError('cancelled', '이전 인증 요청이 취소되었습니다.')))

  const { verifier, challenge } = createPkcePair()
  const state = createState()

  return new Promise<TokenSet>((resolve, reject) => {
    const flow: PendingFlow = {
      verifier,
      state,
      clientId,
      resolve,
      reject,
      timer: setTimeout(() => {
        settle(flow, () => reject(new OAuthError('timeout', '로그인 시간이 초과되었습니다. 다시 시도하세요.')))
      }, FLOW_TIMEOUT_MS)
    }
    pending = flow

    // 앱 안의 웹뷰가 아니라 기본 브라우저로 연다. 구글은 임베디드 웹뷰에서의 로그인을
    // 차단하고, 사용자도 주소창에서 accounts.google.com을 직접 확인할 수 있어야 한다.
    void shell
      .openExternal(buildAuthUrl({ clientId, redirectUri: OAUTH_REDIRECT_URI, challenge, state }))
      .catch((cause) => {
        const error = new OAuthError('open_failed', '브라우저를 열지 못했습니다.')
        error.cause = cause
        settle(flow, () => reject(error))
      })
  })
}

/**
 * 앱 커스텀 스킴으로 돌아온 URL 처리. 기다리는 흐름이 없으면 무시한다 —
 * 다른 앱이나 오래된 링크가 이 스킴을 열 수 있다.
 */
export async function handleGoogleCallback(url: string): Promise<boolean> {
  const flow = pending
  if (!flow) return false

  try {
    const { code } = parseCallbackUrl(url, flow.state)
    const tokens = await exchangeCode(
      {
        clientId: flow.clientId,
        redirectUri: OAUTH_REDIRECT_URI,
        code,
        verifier: flow.verifier,
        now: new Date().toISOString()
      },
      (u, init) => fetch(u, init)
    )
    settle(flow, () => flow.resolve(tokens))
  } catch (error) {
    settle(flow, () => flow.reject(error instanceof Error ? error : new Error(String(error))))
  }
  return true
}

/** 테스트·연결 해제 시 대기 중인 흐름을 정리한다. */
export function cancelGoogleAuth(): void {
  if (pending) settle(pending, () => pending?.reject(new OAuthError('cancelled', '인증이 취소되었습니다.')))
}
