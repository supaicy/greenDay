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

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

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
const { LICENSE_REQUIRED, UNTRUSTED_SENDER, isTrustedSender, registeredTiers } = await import('./ipc-gate')

/**
 * dev 서버를 흉내 내 앱 문서 URL을 **이 테스트가 아는 값**으로 고정한다.
 * 번들 경로(`__dirname`)에 기대면 실행 위치에 따라 답이 달라진다.
 */
const APP_ORIGIN = 'http://localhost:5173'
const APP_DOCUMENT = `${APP_ORIGIN}/index.html`
const previousRendererUrl = process.env.ELECTRON_RENDERER_URL

beforeAll(() => {
  process.env.ELECTRON_RENDERER_URL = APP_ORIGIN
  // **둘 다 부른다.** `setupIpcHandlers()`만 부르던 동안 `app-ipc.ts`의 세 채널이
  // `registeredTiers()`에 아예 안 나타나서, 등급을 `paid`로 뒤집어도 테스트가
  // 전부 통과했다. 그 셋이 `index.ts` 안에 있어 부를 수가 없었던 것이 원인이라
  // 모듈로 빼냈다.
  setupIpcHandlers()
  setupAppIpc(false)
})

afterAll(() => {
  if (previousRendererUrl === undefined) delete process.env.ELECTRON_RENDERER_URL
  else process.env.ELECTRON_RENDERER_URL = previousRendererUrl
})

/** 우리 문서에서 온 호출. 발신자 검사가 생긴 뒤로 `{}`는 더 이상 통과하지 않는다. */
function invoke(channel: string): unknown {
  return invokeFrom(channel, APP_DOCUMENT)
}

function invokeFrom(channel: string, senderUrl: string | undefined): unknown {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`등록되지 않은 채널: ${channel}`)
  return handler({ senderFrame: senderUrl === undefined ? null : { url: senderUrl } })
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
  // 연결 **해제**는 자격증명을 지우는 길이라 잠겨도 열어 둔다 — 부류 2를
  // "내보내기"보다 넓게 읽는다: 자기 것을 꺼내거나 지우는 길이다. 잠겼다고
  // 저장된 비밀번호를 못 지우게 하면 유료화가 자격증명을 인질로 잡는 것이 된다.
  'calendar:disconnect',
  'google:disconnect',
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

/**
 * 창에 HTML 파일을 떨어뜨리면 Electron은 그 파일로 네비게이트하고, preload는
 * **어떤 문서에든** 다시 걸린다 — `window.api`가 통째로 그 페이지의 것이 된다.
 * 등급만 보는 게이트는 그걸 막지 못한다.
 */
describe('발신자 경계', () => {
  it('우리 문서가 아니면 등급과 무관하게 거절한다', () => {
    allowsPaid = true
    // 무료 채널도 예외가 아니다. 잠긴 앱에서도 열려 있어서 오히려 노릴 표면이고,
    // `open-attachment`·`open-external`·`export-data`가 전부 여기 있다.
    for (const channel of ['get-tasks', 'export-data', 'open-external', 'license:state', 'create-task']) {
      expect(() => invokeFrom(channel, 'file:///Users/x/Downloads/evil.html'), `${channel}이 안 막혔다`).toThrow(
        UNTRUSTED_SENDER
      )
    }
  })

  it('거절은 라이선스 거절과 구분된다', () => {
    // 같은 문자열을 쓰면 떨어뜨린 페이지가 유발한 거절이 렌더러에서
    // "라이선스를 사세요"로 보인다 — `useStore`가 그 값으로 잠금 화면을 띄운다.
    allowsPaid = true
    expect(UNTRUSTED_SENDER).not.toBe(LICENSE_REQUIRED)
    expect(() => invokeFrom('get-tasks', 'file:///evil.html')).not.toThrow(LICENSE_REQUIRED)
  })

  it('프레임이 이미 사라졌으면 거절한다', () => {
    // `senderFrame`은 null일 수 있다. 그때 통과시키면 검사가 무의미해진다.
    allowsPaid = true
    expect(() => invokeFrom('get-tasks', undefined)).toThrow(UNTRUSTED_SENDER)
  })

  it('우리 문서는 그대로 통과한다', () => {
    allowsPaid = true
    expect(() => invoke('get-tasks')).not.toThrow()
    // dev 서버는 경로가 갈린다 — 오리진이 같으면 통과해야 한다.
    expect(() => invokeFrom('get-tasks', `${APP_ORIGIN}/`)).not.toThrow()
  })
})

describe('isTrustedSender', () => {
  it('file:은 경로까지 정확히 맞아야 한다', () => {
    // `URL.origin`이 file:에서 문자열 `'null'`이라, 오리진 비교로 만들면
    // **모든** file: URL이 서로 같아진다 — 떨어뜨린 파일도 file:이다.
    const ours = 'file:///Applications/Greenday.app/Contents/Resources/app.asar/out/renderer/index.html'
    expect(isTrustedSender(ours, ours)).toBe(true)
    expect(isTrustedSender('file:///Users/x/Downloads/evil.html', ours)).toBe(false)
    expect(isTrustedSender('file:///Applications/Greenday.app/Contents/Resources/evil.html', ours)).toBe(false)
  })

  it('http는 오리진이 경계다', () => {
    expect(isTrustedSender('http://localhost:5173/index.html', 'http://localhost:5173')).toBe(true)
    expect(isTrustedSender('http://localhost:5173/@vite/client', 'http://localhost:5173')).toBe(true)
    // 포트가 다르면 다른 오리진이다.
    expect(isTrustedSender('http://localhost:5174/index.html', 'http://localhost:5173')).toBe(false)
    expect(isTrustedSender('http://evil.example/index.html', 'http://localhost:5173')).toBe(false)
    // 스킴 승격도 다른 오리진이다.
    expect(isTrustedSender('https://localhost:5173/index.html', 'http://localhost:5173')).toBe(false)
  })

  it('빈 값과 깨진 URL은 거절한다', () => {
    expect(isTrustedSender(undefined, 'http://localhost:5173')).toBe(false)
    expect(isTrustedSender(null, 'http://localhost:5173')).toBe(false)
    expect(isTrustedSender('', 'http://localhost:5173')).toBe(false)
    expect(isTrustedSender('not a url', 'http://localhost:5173')).toBe(false)
    // 기대값이 비어 있으면(계산 실패) 아무것도 통과시키지 않는다.
    expect(isTrustedSender('http://localhost:5173/', '')).toBe(false)
  })
})
