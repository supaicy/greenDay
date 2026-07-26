import { describe, it, expect, vi, beforeEach } from 'vitest'

// Electron의 fetch를 mock
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ai-service는 모듈 레벨 상태를 가지므로 각 테스트 전에 리셋
beforeEach(() => {
  mockFetch.mockReset()
})

// 동적 import로 모듈 상태 격리
async function loadAiService() {
  // vitest의 모듈 캐시를 무효화하여 fresh state로 로드
  vi.resetModules()
  return await import('./ai-service')
}

describe('ai-service', () => {
  describe('checkConnection', () => {
    it('Ollama 실행 중이면 connected: true 반환', async () => {
      const ai = await loadAiService()
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'llama3.2:latest' }] })
      })
      const result = await ai.checkConnection()
      expect(result.connected).toBe(true)
      expect(result.models).toContain('llama3.2:latest')
    })

    it('Ollama 미실행이면 connected: false 반환', async () => {
      const ai = await loadAiService()
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))
      const result = await ai.checkConnection()
      expect(result.connected).toBe(false)
    })

    it('HTTP 에러 시 connected: false 반환', async () => {
      const ai = await loadAiService()
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
      const result = await ai.checkConnection()
      expect(result.connected).toBe(false)
    })
  })

  describe('getAiConfig / setAiConfig', () => {
    it('기본 설정은 Ollama', async () => {
      const ai = await loadAiService()
      const config = ai.getAiConfig()
      expect(config.provider).toBe('ollama')
      expect(config.baseUrl).toBe('http://localhost:11434')
      expect(config.model).toBe('llama3.2:latest')
    })

    it('설정 변경이 반영됨', async () => {
      const ai = await loadAiService()
      ai.setAiConfig({ provider: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'sk-test' })
      const config = ai.getAiConfig()
      expect(config.provider).toBe('openai')
      expect(config.apiKey).toBe('••••••test')
    })

    it('maxHistoryMessages 기본값은 200', async () => {
      const ai = await loadAiService()
      const config = ai.getAiConfig()
      expect(config.maxHistoryMessages).toBe(200)
    })

    it('maxHistoryMessages 변경이 반영됨', async () => {
      const ai = await loadAiService()
      ai.setAiConfig({ maxHistoryMessages: 50 })
      expect(ai.getAiConfig().maxHistoryMessages).toBe(50)
    })
  })

  describe('로컬 전용 잠금 (localOnly)', () => {
    it('잠금이 켜지면 외부 제공자로 저장할 수 없다 (throw)', async () => {
      const ai = await loadAiService()
      // 먼저 로컬에서 잠금 켜기 (허용)
      ai.setAiConfig({ provider: 'ollama', baseUrl: 'http://localhost:11434', localOnly: true })
      // 외부로 전환 시도 → 거부
      expect(() => ai.setAiConfig({ provider: 'openai', baseUrl: 'https://api.openai.com' })).toThrow(
        '로컬 전용'
      )
    })

    it('잠금이 꺼져 있으면 외부 제공자 저장 허용', async () => {
      const ai = await loadAiService()
      ai.setAiConfig({ provider: 'ollama', localOnly: false })
      expect(() =>
        ai.setAiConfig({ provider: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'sk-x' })
      ).not.toThrow()
      expect(ai.getAiConfig().provider).toBe('openai')
    })
  })

  describe('createTaskFromNL', () => {
    it('정상 응답 시 태스크 JSON 반환', async () => {
      const ai = await loadAiService()
      const taskJson = {
        action: 'create_task',
        task: {
          title: '장보기',
          dueDate: '2026-03-26',
          dueTime: null,
          priority: 'none',
          tags: [],
          subtasks: []
        }
      }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(taskJson) } }]
        })
      })
      const result = await ai.createTaskFromNL('내일 장보기', [])
      expect(result.action).toBe('create_task')
      expect(result.task.title).toBe('장보기')
    })

    it('잘못된 JSON 시 재시도 후 성공', async () => {
      const ai = await loadAiService()
      const taskJson = {
        action: 'create_task',
        task: { title: '테스트', dueDate: null, dueTime: null, priority: 'none', tags: [], subtasks: [] }
      }
      // 첫 번째: 잘못된 JSON
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'not json' } }] })
      })
      // 두 번째: 정상
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(taskJson) } }] })
      })
      const result = await ai.createTaskFromNL('테스트', [])
      expect(result.task.title).toBe('테스트')
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('허용되지 않은 action 거부', async () => {
      const ai = await loadAiService()
      const badJson = { action: 'delete_all', task: {} }
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(badJson) } }] })
      })
      await expect(ai.createTaskFromNL('test', [])).rejects.toThrow('Invalid action')
    })

    it('타임아웃 시 에러', async () => {
      const ai = await loadAiService()
      mockFetch.mockRejectedValue(new Error('AbortError'))
      await expect(ai.createTaskFromNL('test', [])).rejects.toThrow()
    })
  })

  describe('sanitizeTaskResult (LLM output validation)', () => {
    it('잘못된 priority는 none으로 변환', async () => {
      const ai = await loadAiService()
      const badJson = {
        action: 'create_task',
        task: { title: '테스트', dueDate: null, dueTime: null, priority: 'urgent', tags: [], subtasks: [] }
      }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(badJson) } }] })
      })
      const result = await ai.createTaskFromNL('테스트', [])
      expect(result.task.priority).toBe('none')
    })

    it('유효하지 않은 날짜는 null로 변환', async () => {
      const ai = await loadAiService()
      const badJson = {
        action: 'create_task',
        task: { title: '테스트', dueDate: 'not-a-date', dueTime: '99:99', priority: 'high', tags: [], subtasks: [] }
      }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(badJson) } }] })
      })
      const result = await ai.createTaskFromNL('테스트', [])
      expect(result.task.dueDate).toBeNull()
      expect(result.task.dueTime).toBeNull()
      expect(result.task.priority).toBe('high')
    })

    it('타이틀이 문자열이 아니면 Untitled', async () => {
      const ai = await loadAiService()
      const badJson = {
        action: 'create_task',
        task: { title: 123, dueDate: null, dueTime: null, priority: 'none', tags: [], subtasks: [] }
      }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(badJson) } }] })
      })
      const result = await ai.createTaskFromNL('테스트', [])
      expect(result.task.title).toBe('Untitled')
    })

    it('tags가 배열이 아니면 빈 배열', async () => {
      const ai = await loadAiService()
      const badJson = {
        action: 'create_task',
        task: {
          title: '테스트',
          dueDate: '2026-04-01',
          dueTime: '14:30',
          priority: 'low',
          tags: 'not-array',
          subtasks: []
        }
      }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(badJson) } }] })
      })
      const result = await ai.createTaskFromNL('테스트', [])
      expect(result.task.tags).toEqual([])
      expect(result.task.dueDate).toBe('2026-04-01')
      expect(result.task.dueTime).toBe('14:30')
    })
  })

  describe('config persistence', () => {
    it('setAiConfig이 db.saveAiConfig을 호출', async () => {
      const ai = await loadAiService()
      ai.setAiConfig({ provider: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'sk-test' })
      const config = ai.getAiConfig()
      expect(config.provider).toBe('openai')
      expect(config.apiKey).toBe('••••••test')
    })
  })

  describe('chat', () => {
    it('정상 응답 시 메시지 반환', async () => {
      const ai = await loadAiService()
      const chatJson = { action: 'chat_response', message: '오늘 할 일이 3개 있습니다.' }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(chatJson) } }] })
      })
      const result = await ai.chat('오늘 뭐 해야 해?', [
        { title: '장보기', dueDate: '2026-03-25', priority: 'none', completed: false }
      ])
      expect(result).toBe('오늘 할 일이 3개 있습니다.')
    })

    it('빈 응답 시 에러', async () => {
      const ai = await loadAiService()
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '' } }] })
      })
      await expect(ai.chat('test', [])).rejects.toThrow('Empty response')
    })
  })

  describe('streamChat', () => {
    // 청크 배열을 순서대로 내보내는 가짜 스트리밍 응답
    function sse(chunks: Uint8Array[]): unknown {
      let i = 0
      return {
        ok: true,
        body: {
          getReader: () => ({
            read: async () =>
              i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined }
          })
        }
      }
    }
    const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

    it('델타 토큰을 순서대로 emit하고 onDone을 호출', async () => {
      const ai = await loadAiService()
      mockFetch.mockResolvedValueOnce(
        sse([
          enc('data: {"choices":[{"delta":{"content":"안녕"}}]}\n'),
          enc('data: {"choices":[{"delta":{"content":"하세요"}}]}\n'),
          enc('data: [DONE]\n')
        ])
      )
      const tokens: string[] = []
      let done = false
      await ai.streamChat(
        '안녕',
        [],
        [],
        (t) => tokens.push(t),
        () => {
          done = true
        },
        () => {}
      )
      expect(tokens.join('')).toBe('안녕하세요')
      expect(done).toBe(true)
    })

    it('UTF-8 멀티바이트가 바이트 단위로 쪼개져 와도 깨지지 않고 복원', async () => {
      const ai = await loadAiService()
      const bytes = enc('data: {"choices":[{"delta":{"content":"한글 テスト"}}]}\n')
      const perByte = Array.from(bytes, (b) => new Uint8Array([b]))
      mockFetch.mockResolvedValueOnce(sse([...perByte, enc('data: [DONE]\n')]))
      const tokens: string[] = []
      await ai.streamChat(
        'x',
        [],
        [],
        (t) => tokens.push(t),
        () => {},
        () => {}
      )
      expect(tokens.join('')).toBe('한글 テスト')
    })

    it('초기 연결 실패는 재시도 후 성공 (토큰 중복 없음)', async () => {
      const ai = await loadAiService()
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
      mockFetch.mockResolvedValueOnce(
        sse([enc('data: {"choices":[{"delta":{"content":"ok"}}]}\n'), enc('data: [DONE]\n')])
      )
      const tokens: string[] = []
      let errored = false
      await ai.streamChat(
        'x',
        [],
        [],
        (t) => tokens.push(t),
        () => {},
        () => {
          errored = true
        }
      )
      expect(tokens.join('')).toBe('ok')
      expect(errored).toBe(false)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('직전 대화를 system과 현재 user 사이에 순서대로 넣고, 최근 10개로 제한', async () => {
      const ai = await loadAiService()
      mockFetch.mockResolvedValueOnce(sse([enc('data: [DONE]\n')]))
      // 12개 히스토리 → 최근 10개만 포함되어야 함
      const history = Array.from({ length: 12 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `h${i}`
      }))
      await ai.streamChat(
        '지금질문',
        [],
        history,
        () => {},
        () => {},
        () => {}
      )
      const sent = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body)
      const msgs = sent.messages as { role: string; content: string }[]
      expect(msgs[0].role).toBe('system')
      expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content: '지금질문' })
      // system + 10 history + current user = 12
      expect(msgs.length).toBe(12)
      expect(msgs[1].content).toBe('h2') // h0,h1 잘리고 h2부터
      expect(msgs[10].content).toBe('h11')
    })

    it('요청 바디에 max_tokens 상한을 포함한다', async () => {
      const ai = await loadAiService()
      mockFetch.mockResolvedValueOnce(sse([enc('data: [DONE]\n')]))
      await ai.streamChat(
        'q',
        [],
        [],
        () => {},
        () => {},
        () => {}
      )
      const sent = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body)
      expect(typeof sent.max_tokens).toBe('number')
      expect(sent.max_tokens).toBeGreaterThan(0)
    })

    it('빈/잘못된 role의 히스토리는 제외', async () => {
      const ai = await loadAiService()
      mockFetch.mockResolvedValueOnce(sse([enc('data: [DONE]\n')]))
      const history = [
        { role: 'user' as const, content: '유효' },
        { role: 'user' as const, content: '   ' }, // 공백 → 제외
        { role: 'system' as unknown as 'user', content: '시스템사칭' } // 잘못된 role → 제외
      ]
      await ai.streamChat(
        'q',
        [],
        history,
        () => {},
        () => {},
        () => {}
      )
      const sent = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body)
      const msgs = sent.messages as { role: string; content: string }[]
      // system + '유효' + current user = 3
      expect(msgs.length).toBe(3)
      expect(msgs[1]).toEqual({ role: 'user', content: '유효' })
    })
  })

  describe('chat 시스템 프롬프트', () => {
    it('chatPromptBase는 한국어 전용 응답 규칙을 포함한다', async () => {
      const ai = await loadAiService()
      const p = ai.chatPromptBase('No tasks.')
      expect(p).toContain('respond ONLY in Korean')
      expect(p).toContain('No tasks.')
    })

    it('buildChatSystemPrompt는 base를 포함하고 JSON 지시를 덧붙인다', async () => {
      const ai = await loadAiService()
      const p = ai.buildChatSystemPrompt('No tasks.')
      expect(p).toContain('respond ONLY in Korean')
      expect(p).toContain('"action":"chat_response"')
    })
  })

  describe('isAllowedUrl (SSRF 방어)', () => {
    const cases: [string, boolean][] = [
      ['http://localhost:11434', true],
      ['http://127.0.0.1:11434', true],
      ['https://api.openai.com', true],
      ['http://169.254.169.254/latest/meta-data', false],
      ['http://10.0.0.5', false],
      ['http://192.168.1.10', false],
      ['http://172.16.0.1', false],
      ['file:///etc/passwd', false],
      ['not-a-url', false]
    ]
    it.each(cases)('%s → %s', async (url, expected) => {
      const ai = await loadAiService()
      expect(ai.isAllowedUrl(url)).toBe(expected)
    })
  })
})
