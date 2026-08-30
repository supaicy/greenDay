/**
 * IPC 등록의 **유일한 통로**. 등록하면서 등급을 함께 고른다.
 *
 * 잠금 화면만으로는 게이트가 아니다. 렌더러 다이얼로그는 지울 수 있고, DevTools도
 * 열 수 있고, `window.api.*`는 그대로 호출된다 — "앱의 JS를 고친다"보다 **싼**
 * 우회다. 신뢰 경계 안쪽에서 한 번 더 물어야 다이얼로그를 지우는 것이 아무 이득도
 * 못 준다.
 *
 * **등급이 필수 인자인 이유.** 처음에는 무료 채널 이름을 모아 둔 허용 목록으로
 * 만들었다. 두 가지가 잘못됐다.
 *
 *   1. "이 채널이 게이트를 지나는가"를 *어느 파일에 등록했는가*가 결정했다.
 *      `index.ts`가 raw `ipcMain.handle`로 등록하는 채널들은 그 목록과 무관하게
 *      항상 열려 있었고, 목록을 지키는 테스트는 `ipc-handlers.ts`만 훑어서
 *      그 사실을 볼 수조차 없었다.
 *   2. 목록이 채널 이름의 평행 복사본이라, 이름을 바꾸면 조용히 어긋났다.
 *
 * 인자로 만들면 **고르지 않으면 컴파일이 안 된다.** 목록도, 목록을 지키는
 * 소스 스크레이퍼도 필요 없어진다.
 */

import { ipcMain } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { licensing } from './licensing/service'
// 렌더러도 이 문구를 본다(`useStore`의 `report`) — 그래서 shared에 있다.
// 한 번 여기로 옮겼다가 되돌렸다: 소비자가 없다는 이유였는데, 바로 그 소비자를
// 만들면서 문자열을 렌더러에 다시 선언하고 있었다.
export { LICENSE_REQUIRED } from '../shared/license'
import { LICENSE_REQUIRED } from '../shared/license'

/**
 * `free`로 열어 두는 이유는 다섯이다 — 읽기(잠금 화면 뒤에서도 앱이 스스로를
 * 그려야 한다), 내보내기(데이터를 인질로 잡지 않는다), 라이선스 자체(잠긴
 * 사람이 키를 넣어 풀 수 있어야 한다), 결제와 무관한 앱 메타·업데이트,
 * 그리고 바깥 열기(첨부·외부 링크·전역 단축키 — 어느 것도 쓰기가 아니다).
 *
 * 다섯 번째를 빠뜨리지 말 것. 지워진 `freeChannels.ts`에는 있었는데 옮겨 적으면서
 * 세 자리(여기·테스트·CLAUDE.md)에서 다 빠졌고, 규칙을 따르는 다음 사람이 첨부
 * 열기와 구매 링크를 유료로 돌리게 돼 있었다.
 *
 * **부류 이름은 목록이 아니다.** 실제로 무엇이 무료인지는 `registeredTiers()`가
 * 답하고, `ipc-gate.test.ts`가 그 집합 전체를 못 박는다. 이 주석을 목록처럼
 * 읽고 관리하려 하면 곧 어긋난다 — 실제로 그랬다.
 */
export type Tier = 'free' | 'paid'

type Listener = Parameters<typeof ipcMain.handle>[1]

/**
 * 우리 문서가 아닌 곳에서 온 호출의 거절.
 *
 * **`LICENSE_REQUIRED`와 다른 문자열이어야 한다.** 렌더러의 `useStore`가 그 값을
 * 보고 잠금 화면을 띄우는데, 이건 라이선스와 아무 상관이 없다 — 여기서 같은 값을
 * 쓰면 떨어뜨린 페이지가 유발한 거절이 "라이선스를 사세요"로 보인다.
 *
 * `shared`가 아니라 여기 있는 이유: 정상적인 렌더러는 이 값을 절대 받지 않는다.
 * 받는 쪽이 있다면 그건 우리 문서가 아니고, 그쪽에 문구를 맞춰 줄 이유가 없다.
 */
export const UNTRUSTED_SENDER = 'untrusted_sender'

/**
 * 이 창이 실제로 로드하는 문서. `index.ts`의 `loadURL`/`loadFile`과 **같은 값**이라야
 * 한다 — 갈리면 정상 렌더러가 통째로 거절당한다.
 *
 * 번들에서는 `__dirname`이 `out/main`이고 문서는 `out/renderer/index.html`이다.
 * 호출마다 다시 계산하는 이유는 `ELECTRON_RENDERER_URL`이 whenReady 전후로
 * 달라질 수 있고, 이 함수가 도는 시점은 항상 그 뒤이기 때문이다.
 */
function expectedDocument(): string {
  return process.env.ELECTRON_RENDERER_URL ?? bundledDocument()
}

/**
 * 번들 문서의 `file:` URL. **경로 계산만** 기억한다 — 그건 실행 중에 바뀔 수 없다.
 * 환경변수는 매번 다시 읽는다(공짜이고, 기억해 두면 dev 서버가 늦게 뜨는 순서에서
 * 틀린 값이 굳는다).
 */
let bundled: string | null = null
function bundledDocument(): string {
  bundled ??= pathToFileURL(join(__dirname, '../renderer/index.html')).href
  return bundled
}

/**
 * 이 호출이 **우리 문서**에서 왔는가.
 *
 * 왜 필요한가: preload는 그 webContents가 무엇을 로드하든 다시 실행되므로
 * `window.api`가 새 문서에도 걸린다. 창에 HTML 파일을 하나 떨어뜨리면(Electron의
 * 기본 동작이 그 파일로 네비게이트하는 것이다) 그 페이지가 등급만 통과하면
 * 되는 IPC 표면을 통째로 물려받는다 — `index.html`의 CSP는 옛 문서의 메타
 * 태그라 새 문서에 적용되지 않는다.
 *
 * 그래서 **등급 앞에** 이 검사가 온다. `free`도 예외가 아니다: `open-attachment`,
 * `open-external`, `export-data`, `calendar:select`는 전부 무료이고 그중 어느
 * 것도 남의 페이지가 불러도 되는 것이 아니다.
 *
 * 비교 방식이 스킴마다 다른 것이 요점이다. dev의 vite 서버는 경로가
 * `/`·`/index.html`·`/@vite/client`로 갈리므로 **오리진**이 경계다. 출하는
 * `file:`이고 그 오리진은 `null`이라 경계가 되지 못한다 — 떨어뜨린 파일도
 * `file:`이므로 스킴만 보면 아무것도 막지 못한다. 그래서 그쪽은 경로를 통째로 맞춘다.
 */
export function isTrustedSender(senderUrl: string | undefined | null, expected: string): boolean {
  if (!senderUrl || !expected) return false
  if (senderUrl === expected) return true
  try {
    const from = new URL(senderUrl)
    const ours = new URL(expected)
    if (from.protocol !== ours.protocol) return false
    // http(s)에서만 오리진이 의미를 갖는다. `URL.origin`은 그 외 스킴에서
    // `'null'` 문자열을 내므로, 두 `file:` URL이 오리진 비교로 같아져 버린다.
    if (from.protocol !== 'http:' && from.protocol !== 'https:') return false
    return from.origin === ours.origin
  } catch {
    return false
  }
}

/**
 * 등록된 채널의 등급. **등록의 부산물이지 평행 목록이 아니다.**
 *
 * 등급을 인자로 옮기면서 "무엇이 무료인가"를 한눈에 볼 자리가 사라졌다. 등급
 * 뒤집기는 채널 이름 옆의 한 토큰만 바뀌는 diff라, 배관처럼 읽히면서 컴파일도
 * 린트도 통과한다. (여기에 등록 호출의 예시를 **진짜 채널 이름으로** 적지 말 것 —
 * `preload/wiring.test.ts`가 `src/main`을 통째로 스크레이프해서 주석 속 이름을
 * 실제 등록으로 센다.) 여기서 나온 집합을 테스트가 통째로 단언하면
 * 그 한 토큰이 반드시 의도적인 편집이 된다.
 */
const tiers = new Map<string, Tier>()

export function registeredTiers(): ReadonlyMap<string, Tier> {
  return tiers
}

/**
 * 등록한다. 모든 채널이 발신자 검사를 지나고, `paid`면 라이선스까지 확인한다.
 *
 * 한때 `free`는 **등록 시점에** 갈라져 맨 핸들러가 걸렸다 — 호출마다 판정을
 * 계산했다가 버리지 않으려는 것이었다. 발신자 검사가 생기면서 그 갈림이 사라졌다:
 * 무료 채널이야말로 잠긴 앱에서도 열려 있어서 남의 페이지가 노릴 표면이고,
 * 등록 시점에 갈라 두면 그 절반이 검사를 통째로 건너뛴다.
 *
 * 대신 비용을 흔한 경우에서 없앤다 — 출하 빌드의 `senderFrame.url`은 문서 URL과
 * **문자열이 같아서** `isTrustedSender`의 첫 줄에서 끝난다. URL 파싱은 dev
 * 서버(경로가 갈린다)와 거절 경로에서만 돈다.
 */
export function handle(channel: string, tier: Tier, listener: Listener): void {
  tiers.set(channel, tier)
  ipcMain.handle(channel, (event, ...args) => {
    // **누가 부르는가가 먼저다.** 등급은 "이 사용자가 이걸 해도 되는가"이고
    // 이건 "이게 우리 화면인가"다 — 두 번째 답이 아니오면 첫 번째는 물을 필요가 없다.
    // `senderFrame`은 프레임이 이미 사라졌으면 null이다. 그때도 거절한다.
    if (!isTrustedSender(event.senderFrame?.url, expectedDocument())) {
      throw new Error(UNTRUSTED_SENDER)
    }
    // 매니저가 없는 빌드는 잠그지 않는다 — 우리 실수로 돈 낸 사람을 막는 것보다
    // 못 막는 편이 낫다(publicLicenseState와 같은 판단).
    if (tier === 'paid' && licensing()?.allowsPaidFeatures() === false) throw new Error(LICENSE_REQUIRED)
    return listener(event, ...args)
  })
}
