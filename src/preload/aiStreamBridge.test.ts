/**
 * Value: protects=preload가 AI 스트림의 요청 id를 양방향으로 그대로 통과시키는 계약
 *   (`aiStreamChat`의 5번째 인자 → invoke, 세 이벤트의 마지막 인자 → 콜백);
 *   fails_when=preload/index.ts에서 requestId를 invoke에 안 넘기거나 핸들러가 콜백에 id를 안
 *   넘기면(스토어가 모든 토큰·done을 '남의 것'으로 버려 AI 채팅이 통째로 멈춘다);
 *   why_new=wiring.test.ts는 소스 텍스트에서 채널 이름만 대조하고 인자는 보지 않는다. useStore.test.ts는 window.api를 통째로 대역으로 바꿔 preload를
 *   지나지 않는다; seam=none
 *
 * preload를 실제로 import한다 — `contextBridge.exposeInMainWorld`가 받은 객체가 곧 렌더러의
 * `window.api`다.
 */

import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'

const bus = vi.hoisted(() => ({ exposed: null as Record<string, unknown> | null }))
const ipc = vi.hoisted(() => ({ invoke: vi.fn(async () => undefined) }))
const emitter = new EventEmitter()

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_key: string, api: Record<string, unknown>) => {
      bus.exposed = api
    }
  },
  ipcRenderer: {
    invoke: ipc.invoke,
    on: (channel: string, handler: (...args: unknown[]) => void) => emitter.on(channel, handler),
    removeListener: (channel: string, handler: (...args: unknown[]) => void) =>
      emitter.removeListener(channel, handler)
  }
}))

await import('./index')

type Api = {
  aiStreamChat: (m: string, t: unknown[], h: unknown[], id: string) => Promise<unknown>
  onAiStreamToken: (cb: (token: string, id: string) => void) => () => void
  onAiStreamDone: (cb: (id: string) => void) => () => void
  onAiStreamError: (cb: (error: string, id: string) => void) => () => void
}
const api = (): Api => {
  if (!bus.exposed) throw new Error('preload가 window.api를 노출하지 않았다')
  return bus.exposed as unknown as Api
}

/** main의 `sender.send(channel, ...args)`가 렌더러에 닿는 모양 — 첫 인자는 IpcRendererEvent다. */
const fromMain = (channel: string, ...args: unknown[]): void => {
  emitter.emit(channel, {}, ...args)
}

describe('preload — AI 스트림 요청 id를 양쪽으로 통과시킨다', () => {
  it('요청은 id를 main까지 싣고, 세 응답 이벤트는 id를 콜백까지 싣는다', async () => {
    await api().aiStreamChat('질문', [], [], 'req-7')
    expect(ipc.invoke).toHaveBeenCalledWith('ai:stream-chat', '질문', [], [], 'req-7')

    const tokens: [string, string][] = []
    const dones: string[] = []
    const errors: [string, string][] = []
    const offToken = api().onAiStreamToken((token, id) => tokens.push([token, id]))
    const offDone = api().onAiStreamDone((id) => dones.push(id))
    const offError = api().onAiStreamError((error, id) => errors.push([error, id]))

    fromMain('ai:stream-token', '안', 'req-7')
    fromMain('ai:stream-error', '끊김', 'req-7')
    fromMain('ai:stream-done', 'req-7')

    expect(tokens).toEqual([['안', 'req-7']])
    expect(errors).toEqual([['끊김', 'req-7']])
    expect(dones).toEqual(['req-7'])

    // 정리 함수가 실제로 떼어 낸다 — 남으면 다음 질문의 리스너와 겹쳐 두 번씩 받는다.
    offToken()
    offDone()
    offError()
    fromMain('ai:stream-token', '뒤늦은', 'req-7')
    expect(tokens).toHaveLength(1)
  })
})
