/**
 * Value: protects=main이 `ai:stream-chat`의 세 이벤트(token/done/error)에 렌더러가 준 요청 id를
 *   그대로 되돌려 주는 계약; fails_when=ipc-handlers.ts의 `sender.send(..., id)` 중 하나라도 id를
 *   빠뜨리거나 다른 값을 실으면(스토어 가드 `id !== requestId`가 그 이벤트를 전부 버려 답변이
 *   비거나 스피너가 영영 안 꺼진다); why_new=useStore.test.ts의 'AI 스트림 요청 격리'는 main을
 *   흉내 낸 가짜 버스로 스토어 쪽만 보고, 실제 핸들러가 id를 싣는지는 어느 테스트도 부르지 않는다;
 *   seam=none
 *
 * 하네스는 `batchUpdateValidation.test.ts`와 같다 — 핸들러를 실제로 등록시키고 직접 부른다.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false }, electronApp: {}, optimizer: {} }))
vi.mock('electron-updater', () => ({ autoUpdater: { downloadUpdate: vi.fn(), quitAndInstall: vi.fn() } }))
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, listener: Handler) => handlers.set(channel, listener) },
  app: { getPath: () => '/tmp/greenday-ai-stream-id-test', getVersion: () => '0.0.0-test' },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  Notification: Object.assign(
    vi.fn(() => ({ show: vi.fn() })),
    { isSupported: () => false }
  ),
  globalShortcut: { register: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openPath: vi.fn(), openExternal: vi.fn() },
  Menu: { buildFromTemplate: (t: unknown) => t, setApplicationMenu: vi.fn() }
}))

vi.mock('./database', () => ({}))

/** 스트림 하나를 그 자리에서 끝까지 흘린다: 토큰 둘, 오류 하나, 완료 하나. */
const ai = vi.hoisted(() => ({
  streamChat: vi.fn(
    async (
      _message: string,
      _tasks: unknown,
      _history: unknown,
      onToken: (token: string) => void,
      onDone: () => void,
      onError: (error: string) => void
    ) => {
      onToken('안')
      onToken('녕')
      onError('끊김')
      onDone()
    }
  )
}))
vi.mock('./ai-service', () => ai)

const { setupIpcHandlers } = await import('./ipc-handlers')

const APP_ORIGIN = 'http://localhost:5173'
const APP_DOCUMENT = `${APP_ORIGIN}/index.html`
const previousRendererUrl = process.env.ELECTRON_RENDERER_URL
beforeAll(() => {
  process.env.ELECTRON_RENDERER_URL = APP_ORIGIN
  setupIpcHandlers()
})
afterAll(() => {
  if (previousRendererUrl === undefined) delete process.env.ELECTRON_RENDERER_URL
  else process.env.ELECTRON_RENDERER_URL = previousRendererUrl
})

describe('ai:stream-chat — 응답 이벤트가 요청 id를 들고 돌아온다', () => {
  it('token·error·done 셋 모두 마지막 인자로 렌더러가 보낸 id를 싣는다', async () => {
    const handler = handlers.get('ai:stream-chat')
    if (!handler) throw new Error('ai:stream-chat이 등록되지 않았다')
    const send = vi.fn()
    const sender = { send, isDestroyed: () => false }

    await handler({ senderFrame: { url: APP_DOCUMENT }, sender }, '질문', [], [], 'req-42')

    expect(ai.streamChat).toHaveBeenCalledTimes(1)
    // 렌더러는 `id !== requestId`면 그 이벤트를 버린다 — 하나라도 빠지면 답변이 비거나
    // done이 안 닿아 스피너가 영영 돈다.
    expect(send.mock.calls).toEqual([
      ['ai:stream-token', '안', 'req-42'],
      ['ai:stream-token', '녕', 'req-42'],
      ['ai:stream-error', '끊김', 'req-42'],
      ['ai:stream-done', 'req-42']
    ])
  })
})
