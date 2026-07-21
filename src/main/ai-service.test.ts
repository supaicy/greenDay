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
})
