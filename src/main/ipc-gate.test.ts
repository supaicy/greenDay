/**
 * 게이트가 **배선돼 있는지** 확인한다.
 *
 * `freeChannels.test.ts`는 판정 함수가 옳은지를 본다. 그것만으로는 부족하다 —
 * 등록 래퍼가 그 함수를 부르지 않으면 판정이 아무리 옳아도 아무것도 안 막는다.
 * 실제로 래퍼에서 확인 한 줄을 지워도 다른 테스트는 전부 통과했다.
 *
 * 그래서 여기서는 진짜 `setupIpcHandlers()`를 가짜 `ipcMain`에 물려 등록시키고,
 * 등록된 핸들러를 직접 불러 본다.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

// electron을 CJS로 끌어오는 유틸 — 목이 없으면 여기서 모듈 로딩이 터진다.
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false }, electronApp: {}, optimizer: {} }))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, listener: Handler) => handlers.set(channel, listener)
  },
  app: { getPath: () => '/tmp/greenday-gate-test', getVersion: () => '0.0.0-test' },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
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
const { LICENSE_REQUIRED } = await import('./licensing/freeChannels')

beforeAll(() => {
  setupIpcHandlers()
})

/** 등록된 핸들러를 실제로 부른다. 막혔으면 던진다. */
function invoke(channel: string): unknown {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`등록되지 않은 채널: ${channel}`)
  return handler({})
}

describe('IPC 게이트 배선', () => {
  it('핸들러가 실제로 등록됐다', () => {
    // 이게 0이면 아래 검사가 전부 공짜로 통과한다.
    expect(handlers.size).toBeGreaterThan(50)
  })

  it('잠긴 상태에서 유료 채널은 거절한다', () => {
    allowsPaid = false
    for (const channel of ['create-task', 'update-task', 'delete-task', 'reorder-tasks', 'calendar:sync-now']) {
      expect(() => invoke(channel), `${channel}이 안 막혔다`).toThrow(LICENSE_REQUIRED)
    }
  })

  it('잠긴 상태에서도 읽기와 내보내기와 라이선스는 통과시킨다', () => {
    allowsPaid = false
    // 던지지 않는 것만 본다 — 여기서 확인하려는 것은 게이트지 각 핸들러의 결과가 아니다.
    for (const channel of ['get-tasks', 'get-lists', 'license:state', 'app:capabilities']) {
      expect(() => invoke(channel), `${channel}이 막혔다`).not.toThrow()
    }
  })

  it('유료 상태에서는 유료 채널이 통과한다', () => {
    allowsPaid = true
    expect(() => invoke('get-tasks')).not.toThrow()
    // create-task는 인자 검증에서 던질 수 있으므로, 라이선스 거절이 아닌지만 본다.
    try {
      invoke('create-task')
    } catch (e) {
      expect((e as Error).message).not.toBe(LICENSE_REQUIRED)
    }
  })

  it('초기화에 실패한 빌드는 아무도 잠그지 않는다', () => {
    allowsPaid = null
    expect(() => invoke('reorder-tasks')).not.toThrow(LICENSE_REQUIRED)
  })
})
