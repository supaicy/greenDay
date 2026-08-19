/**
 * 게이트가 **배선돼 있는지**, 그리고 **정책이 무엇인지** 확인한다.
 *
 * 실제로 등록시키고 불러 본다. 정책이 옳은 것과 배선이 된 것은 따로 깨지고,
 * 실제로 래퍼에서 확인 한 줄을 지웠을 때 다른 테스트가 전부 통과했다.
 *
 * 우회 경로(`ipcMain.handle` 직접 호출)는 여기가 아니라 `ipcMainBoundary.test.ts`가
 * 본다 — 그건 이 파일의 커다란 electron 목이 하나도 필요 없는 검사인데, 여기 있으면
 * 핸들러 import 그래프가 한 번 깨질 때 보안 가드까지 같이 쓰러진다.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false }, electronApp: {}, optimizer: {} }))

// `app-ipc.ts`가 끌어온다. 업데이트 채널을 실제로 불러 보지는 않으므로 형태만 있으면 된다.
vi.mock('electron-updater', () => ({
  autoUpdater: { downloadUpdate: vi.fn(), quitAndInstall: vi.fn() }
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, listener: Handler) => handlers.set(channel, listener)
  },
  app: { getPath: () => '/tmp/greenday-gate-test', getVersion: () => '0.0.0-test' },
  // 취소된 것으로 답한다. 무료 채널이 막히지 않는지 보려고 실제로 부르는데,
  // undefined를 돌려주면 핸들러가 비동기로 터져 unhandled rejection이 샌다.
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: undefined }))
  },
  Notification: Object.assign(
    vi.fn(() => ({ show: vi.fn() })),
    { isSupported: () => false }
  ),
  globalShortcut: { register: vi.fn(), unregisterAll: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openPath: vi.fn(), openExternal: vi.fn() },
  Menu: { buildFromTemplate: (t: unknown) => t, setApplicationMenu: vi.fn() }
}))

/** 라이선스 판정만 우리가 흔든다. 나머지 모듈은 진짜를 쓴다. */
let allowsPaid: boolean | null = true
vi.mock('./licensing/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./licensing/service')>()
  return {
    ...actual,
    licensing: () => (allowsPaid === null ? null : { allowsPaidFeatures: () => allowsPaid })
  }
})

const { setupIpcHandlers } = await import('./ipc-handlers')
const { setupAppIpc } = await import('./app-ipc')
const { LICENSE_REQUIRED, registeredTiers } = await import('./ipc-gate')

beforeAll(() => {
  // **둘 다 부른다.** `setupIpcHandlers()`만 부르던 동안 `app-ipc.ts`의 세 채널이
  // `registeredTiers()`에 아예 안 나타나서, 등급을 `paid`로 뒤집어도 테스트가
  // 전부 통과했다. 그 셋이 `index.ts` 안에 있어 부를 수가 없었던 것이 원인이라
  // 모듈로 빼냈다.
  setupIpcHandlers()
  setupAppIpc(false)
})

function invoke(channel: string): unknown {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`등록되지 않은 채널: ${channel}`)
  return handler({})
}

/**
 * 무료로 열린 채널의 **완전한 목록**. 등급이 인자가 되면서 이 질문에 한눈에
 * 답할 자리가 없어졌고, 등급 뒤집기는 배관처럼 읽히는 한 토큰짜리 diff가 됐다.
 * 여기서 통째로 못 박으면 그 한 토큰이 반드시 의도적인 편집이 된다.
 *
 * 다섯 부류다. 늘리기 전에 그 이유부터 적을 것.
 *   1. **읽기** — 잠금 화면 뒤에서도 앱이 스스로를 그려야 한다.
 *   2. **내보내기** — 데이터를 인질로 잡지 않는다.
 *   3. **라이선스 자체** — 잠긴 사람이 키를 넣어 풀 수 있어야 한다.
 *   4. **앱 메타와 업데이트** — 구버전에 묶어 두지 않는다.
 *   5. **바깥 열기** — 첨부 열기·외부 링크·전역 단축키 등록. 어느 것도
 *      쓰기가 아니고, 눌러서 열리는 창의 쓰기는 이미 유료다.
 */
const FREE_CHANNELS = [
  'ai:get-config',
  'ai:get-history',
  'app:capabilities',
  'app:notification-permission',
  'app:open-notification-settings',
  'app:request-notification-permission',
  'calendar:get-config',
  'export-data',
  'get-folders',
  'get-habit-logs',
  'get-habits',
  'get-lists',
  'get-pomodoro-sessions',
  'get-score',
  'get-tasks',
  'get-trash-tasks',
  'google:get-config',
  'license:activate',
  'license:deactivate',
  'license:purchase',
  'license:recover',
  'license:state',
  'open-attachment',
  'open-external',
  'register-global-shortcut',
  // app-ipc.ts — index.ts에서 옮겨 온 셋.
  'set-language',
  'download-update',
  'install-update'
]

describe('정책', () => {
  it('무료로 열린 채널은 이것뿐이다', () => {
    const free = [...registeredTiers()]
      .filter(([, tier]) => tier === 'free')
      .map(([channel]) => channel)
      .sort()
    expect(free).toEqual([...FREE_CHANNELS].sort())
  })

  it('등록된 채널이 빠짐없이 등급을 갖는다', () => {
    // 0이면 아래 검사가 전부 공짜로 통과한다.
    expect(handlers.size).toBeGreaterThan(50)
    // **이게 진짜 경계 검사다.** `handlers`는 목킹된 `ipcMain.handle`이 실제로
    // 본 것이고 `registeredTiers()`는 게이트가 기록한 것이라, 두 집합이 갈리는
    // 순간 누군가 게이트를 통하지 않고 등록한 것이다. 소스 정규식과 달리
    // 별칭·네임스페이스·구조분해 어느 것으로도 피해 갈 수 없다 — 런타임에
    // 남는 흔적을 보기 때문이다.
    expect([...registeredTiers().keys()].sort()).toEqual([...handlers.keys()].sort())
  })
})

describe('잠긴 상태', () => {
  it('유료 채널은 거절한다', () => {
    allowsPaid = false
    for (const channel of ['create-task', 'update-task', 'delete-task', 'reorder-tasks', 'calendar:sync-now']) {
      expect(() => invoke(channel), `${channel}이 안 막혔다`).toThrow(LICENSE_REQUIRED)
    }
  })

  it('읽기·내보내기·라이선스·업데이트는 통과시킨다', () => {
    // 데이터를 인질로 잡지 않고, 잠긴 사람도 키를 넣어 풀 수 있어야 하고,
    // 구버전에 묶어 두지 않는다. 업데이트 채널은 `app-ipc.ts` 쪽이라, 예전에는
    // 이 주석이 "업데이트는 통과시킨다"고 말만 하고 하나도 부르지 않았다.
    allowsPaid = false
    for (const channel of [
      'get-tasks',
      'get-lists',
      'export-data',
      'license:state',
      'app:capabilities',
      'download-update',
      'install-update'
    ]) {
      expect(() => invoke(channel), `${channel}이 막혔다`).not.toThrow()
    }
  })
})

describe('열린 상태', () => {
  it('유료 상태면 유료 채널도 통과한다', () => {
    allowsPaid = true
    expect(() => invoke('get-tasks')).not.toThrow()
    // create-task는 인자 검증에서 던질 수 있으므로, 라이선스 거절이 아닌지만 본다.
    expect(() => invoke('create-task')).not.toThrow(LICENSE_REQUIRED)
  })

  it('초기화에 실패한 빌드는 아무도 잠그지 않는다', () => {
    // 우리 실수로 돈 낸 사람을 막는 것보다, 못 막는 편이 낫다.
    allowsPaid = null
    expect(() => invoke('reorder-tasks')).not.toThrow(LICENSE_REQUIRED)
  })
})
