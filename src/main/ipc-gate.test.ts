/**
 * 게이트가 **배선돼 있는지**, 그리고 **우회할 자리가 없는지** 확인한다.
 *
 * 등급이 필수 인자가 되면서 "무료 채널 목록"과 그 목록을 지키던 소스 스크레이퍼가
 * 사라졌다. 남은 위험은 하나뿐이다 — 누군가 `ipcMain.handle`을 직접 부르는 것.
 * 그건 소스로 막는다(아래 첫 describe).
 *
 * 나머지는 실제로 등록시키고 불러 본다. 정책이 옳은 것과 배선이 된 것은 따로
 * 깨지고, 실제로 래퍼에서 확인 한 줄을 지웠을 때 다른 테스트가 전부 통과했다.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false }, electronApp: {}, optimizer: {} }))

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
const { LICENSE_REQUIRED } = await import('../shared/license')

beforeAll(() => {
  setupIpcHandlers()
})

function invoke(channel: string): unknown {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`등록되지 않은 채널: ${channel}`)
  return handler({})
}

describe('우회할 자리가 없다', () => {
  it('ipcMain.handle은 게이트 안에서만 불린다', () => {
    // 전에는 게이트가 `ipc-handlers.ts`의 파일 지역 헬퍼라, `index.ts`가 raw
    // ipcMain.handle로 등록한 채널 셋이 그냥 열려 있었다. 목록을 지키던 테스트는
    // 그 파일을 훑지도 않아서 볼 수조차 없었다. 이제는 통로가 하나고, 그 통로를
    // 우회하는 순간 여기가 빨개진다.
    const offenders: string[] = []
    for (const file of walk(__dirname)) {
      if (file.endsWith('ipc-gate.ts') || /\.test\.tsx?$/.test(file)) continue
      if (readFileSync(file, 'utf-8').includes('ipcMain.handle')) {
        offenders.push(file.split('/src/')[1])
      }
    }
    expect(offenders, `게이트를 우회해 등록하는 파일: ${offenders.join(', ')}`).toEqual([])
  })

  it('등록된 채널이 실제로 있다', () => {
    // 0이면 아래 검사가 전부 공짜로 통과한다.
    expect(handlers.size).toBeGreaterThan(50)
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
    // 구버전에 묶어 두지 않는다.
    allowsPaid = false
    for (const channel of ['get-tasks', 'get-lists', 'export-data', 'license:state', 'app:capabilities']) {
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

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (full.endsWith('.ts')) out.push(full)
  }
  return out
}
