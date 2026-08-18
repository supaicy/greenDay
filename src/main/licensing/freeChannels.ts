/**
 * 잠긴 상태에서도 열려 있는 IPC 채널 — **명시적 허용 목록**.
 *
 * 방향이 중요하다. 유료 목록을 적으면 기능을 추가할 때마다 거기 넣는 걸 잊어
 * 조용히 새어 나간다. 무료 목록을 적으면 잊었을 때 새 기능이 잠기고, 그건
 * 즉시 눈에 띄어 고쳐진다. 실패가 안전한 쪽으로 기울게 둔다.
 *
 * 여기 있는 것은 네 부류뿐이다.
 *
 *   1. **읽기.** 잠금 화면 뒤에서도 앱이 스스로를 그릴 수 있어야 하고, 무엇보다
 *      내보내기가 읽기 위에 서 있다.
 *   2. **내보내기.** 자기 할일을 꺼낼 수 없게 만드는 것은 환불이 아니라 신고를
 *      부르는 종류의 실패다. 데이터를 인질로 잡지 않는다.
 *   3. **라이선스 자체.** 잠긴 사람이 키를 넣어 풀 수 있어야 한다.
 *   4. **앱 메타와 바깥 열기.** 구매 링크를 눌러야 하고, 알림 권한 안내는 결제와
 *      무관하다.
 */
export const FREE_CHANNELS: ReadonlySet<string> = new Set([
  // 1. 읽기
  'get-folders',
  'get-lists',
  'get-tasks',
  'get-trash-tasks',
  'get-habits',
  'get-habit-logs',
  'get-pomodoro-sessions',
  'get-score',
  'ai:get-config',
  'ai:get-history',
  'calendar:get-config',
  'google:get-config',
  'open-attachment',

  // 2. 내보내기
  'export-data',

  // 3. 라이선스
  'license:state',
  'license:activate',
  'license:deactivate',
  'license:purchase',
  'license:recover',

  // 4. 앱 메타 · 바깥 열기
  'app:capabilities',
  'app:notification-permission',
  'app:request-notification-permission',
  'app:open-notification-settings',
  'open-external',
  'register-global-shortcut'
])

/**
 * 잠긴 채널이 렌더러에 돌려주는 거절.
 *
 * `undefined`를 돌려주면 호출한 쪽이 성공으로 읽고 화면에만 존재하는 유령 편집이
 * 남는다. 거절은 거절처럼 생겨야 하고, 그래야 `useStore`의 persist 래퍼가
 * 콘솔에 흔적을 남긴다.
 */
export const LICENSE_REQUIRED = 'license_required'

/**
 * 이 채널을 지금 막아야 하는가 — 게이트의 판정 전부.
 *
 * `ipc-handlers.ts`의 등록 래퍼에서 떼어내 순수 함수로 둔다. 판정이 electron
 * 클로저 안에 있으면 "정말 막는가"를 시험할 방법이 없고, 실제로 그 상태에서
 * 확인을 통째로 지워도 테스트가 전부 통과했다. 게이트는 게이트인지 확인할 수
 * 있어야 한다.
 *
 * @param allowsPaid 매니저의 판정. **초기화에 실패한 빌드는 `null`이고 막지 않는다** —
 *   우리 실수로 돈 낸 사람을 막는 것보다 못 막는 편이 낫다(publicLicenseState와 같은 판단).
 */
export function isChannelLocked(channel: string, allowsPaid: boolean | null): boolean {
  if (FREE_CHANNELS.has(channel)) return false
  return allowsPaid === false
}
