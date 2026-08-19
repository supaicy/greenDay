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

import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { licensing } from './licensing/service'
import { LICENSE_REQUIRED } from '../shared/license'

/**
 * `free`로 열어 두는 것은 네 부류뿐이다.
 *
 *   1. **읽기** — 잠금 화면 뒤에서도 앱이 스스로를 그릴 수 있어야 하고,
 *      무엇보다 내보내기가 읽기 위에 서 있다.
 *   2. **내보내기** — 자기 할일을 꺼낼 수 없게 만드는 것은 환불이 아니라 신고를
 *      부르는 종류의 실패다. 데이터를 인질로 잡지 않는다.
 *   3. **라이선스 자체** — 잠긴 사람이 키를 넣어 풀 수 있어야 한다.
 *   4. **앱 메타와 바깥 열기** — 구매 링크를 눌러야 하고, 알림 권한 안내와
 *      업데이트는 결제와 무관하다.
 */
export type Tier = 'free' | 'paid'

type Listener = (event: IpcMainInvokeEvent, ...args: never[]) => unknown

/**
 * 등록한다. `paid`면 매 호출마다 메인 프로세스에서 라이선스를 확인한다.
 *
 * `free`는 **등록 시점에** 갈라져 맨 핸들러가 걸린다 — 호출마다 판정을 계산했다가
 * 버리지 않는다. 그 판정은 최악의 경우(토큰이 만료됐는데 상태가 아직 안 옮겨간
 * 창) ed25519 검증 한 번이라, `get-tasks`나 `reorder-tasks` 위에 올라가면 안 된다.
 */
export function handle(channel: string, tier: Tier, listener: Listener): void {
  if (tier === 'free') {
    ipcMain.handle(channel, listener as Parameters<typeof ipcMain.handle>[1])
    return
  }
  ipcMain.handle(channel, (event, ...args) => {
    // 매니저가 없는 빌드는 잠그지 않는다 — 우리 실수로 돈 낸 사람을 막는 것보다
    // 못 막는 편이 낫다(publicLicenseState와 같은 판단).
    if (licensing()?.allowsPaidFeatures() === false) throw new Error(LICENSE_REQUIRED)
    return listener(event, ...(args as never[]))
  })
}
