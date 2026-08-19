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
import { licensing } from './licensing/service'

/**
 * 잠긴 채널이 돌려주는 거절.
 *
 * `undefined`를 돌려주면 호출한 쪽이 성공으로 읽고 화면에만 존재하는 유령 편집이
 * 남는다. 거절은 거절처럼 생겨야 한다.
 *
 * **`shared/`가 아니라 여기 있다.** 한때 "렌더러가 '잠김'과 '핸들러가 터짐'을
 * 구분할 수 있어야 하니 양쪽이 아는 자리"라고 적어 뒀는데 둘 다 틀렸다: 그렇게
 * 구분하는 렌더러 코드가 없고, 있더라도 이 상수로는 못 한다 — `ipcRenderer.invoke`가
 * 거절을 `Error invoking remote method 'create-task': Error: license_required`로
 * 감싸 보내므로 `===` 비교가 맞지 않는다. 나중에 그 구분이 실제로 필요해지면
 * preload가 타입 있는 결과로 매핑하는 별도의 일이고, 그때 소비자와 함께 옮긴다.
 */
export const LICENSE_REQUIRED = 'license_required'

/**
 * `free`로 열어 두는 이유는 넷이다 — 읽기(잠금 화면 뒤에서도 앱이 스스로를
 * 그려야 한다), 내보내기(데이터를 인질로 잡지 않는다), 라이선스 자체(잠긴
 * 사람이 키를 넣어 풀 수 있어야 한다), 그리고 결제와 무관한 앱 메타·업데이트.
 *
 * **부류 이름은 목록이 아니다.** 실제로 무엇이 무료인지는 `registeredTiers()`가
 * 답하고, `ipc-gate.test.ts`가 그 집합 전체를 못 박는다. 이 주석을 목록처럼
 * 읽고 관리하려 하면 곧 어긋난다 — 실제로 그랬다.
 */
export type Tier = 'free' | 'paid'

type Listener = Parameters<typeof ipcMain.handle>[1]

/**
 * 등록된 채널의 등급. **등록의 부산물이지 평행 목록이 아니다.**
 *
 * 등급을 인자로 옮기면서 "무엇이 무료인가"를 한눈에 볼 자리가 사라졌다. 등급
 * 뒤집기는 `handle('create-task', 'free', …)`처럼 한 토큰짜리 diff라, 배관처럼
 * 읽히면서 컴파일도 린트도 통과한다. 여기서 나온 집합을 테스트가 통째로 단언하면
 * 그 한 토큰이 반드시 의도적인 편집이 된다.
 */
const tiers = new Map<string, Tier>()

export function registeredTiers(): ReadonlyMap<string, Tier> {
  return tiers
}

/**
 * 등록한다. `paid`면 매 호출마다 메인 프로세스에서 라이선스를 확인한다.
 *
 * `free`는 **등록 시점에** 갈라져 맨 핸들러가 걸린다 — 호출마다 판정을 계산했다가
 * 버리지 않는다.
 */
export function handle(channel: string, tier: Tier, listener: Listener): void {
  tiers.set(channel, tier)
  if (tier === 'free') {
    ipcMain.handle(channel, listener)
    return
  }
  ipcMain.handle(channel, (event, ...args) => {
    // 매니저가 없는 빌드는 잠그지 않는다 — 우리 실수로 돈 낸 사람을 막는 것보다
    // 못 막는 편이 낫다(publicLicenseState와 같은 판단).
    if (licensing()?.allowsPaidFeatures() === false) throw new Error(LICENSE_REQUIRED)
    return listener(event, ...args)
  })
}
