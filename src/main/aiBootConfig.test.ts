/**
 * 부팅 직후 첫 AI 요청이 **저장된 설정**으로 나가는가.
 *
 * App.tsx의 시작 effect가 보내는 첫 AI IPC는 `ai:check-connection`이다 — `ai:get-config`가
 * 아니다(그건 설정 화면이나 AI 패널을 **열어야** 나간다). 그런데 메인의 전역 `config`는
 * `getAiConfig()`/`getAiConfigInternal()` 안에서만 디스크로부터 채워졌다. 그래서 한때
 * 부팅 직후의 연결 확인이 사용자가 무엇을 설정했든 기본값 `http://localhost:11434`를 쳤고,
 * 로컬 Ollama가 없는 사람은 "AI 꺼짐"이 켤 방법 없이 한 세션 내내 붙어 있었다
 * (패널의 재검사는 `aiConnected === null`일 때만 돈다).
 *
 * 형제 파일 `aiEgress.test.ts`의 헬퍼는 모듈을 올린 뒤 `getAiConfigInternal()`을 부른다 —
 * 바로 그 가정("앱이 시작하면서 설정을 읽는다")이 거짓이라 이 결함이 기존 AI 테스트
 * 전부를 통과해 버렸다. 여기서는 **아무것도 부르지 않고** 바로 진입점을 친다.
 *
 * `./database`와 `node:dns/promises`를 목킹해 디스크와 진짜 DNS를 타지 않는다.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const disk: { config: Record<string, unknown> | null } = { config: null }
vi.mock('./database', () => ({
  getAiConfig: () => disk.config,
  saveAiConfig: (next: Record<string, unknown>) => {
    disk.config = next
  }
}))

const dns = new Map<string, string[]>()
vi.mock('node:dns/promises', () => ({
  lookup: async (host: string) => {
    const found = dns.get(host)
    if (!found) throw Object.assign(new Error(`ENOTFOUND ${host}`), { code: 'ENOTFOUND' })
    return found.map((address) => ({ address, family: 4 }))
  }
}))

beforeEach(() => {
  mockFetch.mockReset()
  disk.config = null
  dns.clear()
  dns.set('api.openai.com', ['93.184.216.34'])
})

/** 앱이 막 부팅한 상태. **아무도 `ai:get-config`를 부르지 않았다.** */
async function bootAiService() {
  vi.resetModules()
  return await import('./ai-service')
}

const SAVED = {
  provider: 'openai',
  baseUrl: 'https://api.openai.com',
  model: 'gpt-4o-mini',
  apiKey: null,
  maxHistoryMessages: 200,
  localOnly: false
}

describe('부팅 직후 — 저장된 설정으로 나간다', () => {
  it('첫 ai:check-connection이 저장된 OpenAI 주소를 친다', async () => {
    disk.config = { ...SAVED }
    const ai = await bootAiService()
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}), headers: new Headers(), status: 200 })

    const result = await ai.checkConnection()

    expect(mockFetch).toHaveBeenCalled()
    expect(String(mockFetch.mock.calls[0][0])).toBe('https://api.openai.com/v1/models')
    expect(result.connected).toBe(true)
  })

  it('비기본 포트 Ollama도 저장된 주소를 친다', async () => {
    disk.config = { ...SAVED, provider: 'ollama', baseUrl: 'http://127.0.0.1:12345' }
    const ai = await bootAiService()
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [] }),
      headers: new Headers(),
      status: 200
    })

    await ai.checkConnection()

    expect(String(mockFetch.mock.calls[0][0])).toBe('http://127.0.0.1:12345/api/tags')
  })

  // 연결 확인만 고쳐서는 안 되는 이유. 이 경로(할일 추가 폼의 AI 버튼)는 설정 화면도
  // AI 패널도 거치지 않아, 부팅 뒤 곧바로 `callLlm`의 `snapshot()`에 닿는다.
  it('설정 화면을 열기 전 누른 할일 폼 AI 버튼도 저장된 주소로 간다', async () => {
    disk.config = { ...SAVED }
    const ai = await bootAiService()
    mockFetch.mockRejectedValue(new Error('boom'))

    await expect(ai.createTaskFromNL('내일 3시 회의', [])).rejects.toBeTruthy()

    expect(mockFetch).toHaveBeenCalled()
    expect(String(mockFetch.mock.calls[0][0])).toBe('https://api.openai.com/v1/chat/completions')
  })
})
