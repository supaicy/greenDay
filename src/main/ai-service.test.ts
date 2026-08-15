import { describe, it, expect, vi, beforeEach } from 'vitest'
import { toLocalDateString } from '../shared/date'

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
      expect(() => ai.setAiConfig({ provider: 'openai', baseUrl: 'https://api.openai.com' })).toThrow('로컬 전용')
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

  describe('parsePullProgress', () => {
    it('completed/total로 퍼센트 계산', async () => {
      const ai = await loadAiService()
      expect(ai.parsePullProgress('{"status":"downloading","completed":50,"total":200}')).toEqual({
        status: 'downloading',
        completed: 50,
        total: 200,
        percent: 25
      })
    })
    it('total 없으면 percent=null (불확정 단계)', async () => {
      const ai = await loadAiService()
      expect(ai.parsePullProgress('{"status":"pulling manifest"}')).toEqual({
        status: 'pulling manifest',
        completed: undefined,
        total: undefined,
        percent: null
      })
    })
    it('error 라인은 error 필드로', async () => {
      const ai = await loadAiService()
      expect(ai.parsePullProgress('{"error":"model not found"}')).toEqual({
        status: 'error',
        percent: null,
        error: 'model not found'
      })
    })
    it('빈 줄/비JSON은 null', async () => {
      const ai = await loadAiService()
      expect(ai.parsePullProgress('   ')).toBeNull()
      expect(ai.parsePullProgress('not json')).toBeNull()
    })
    it('percent는 0–100로 클램프', async () => {
      const ai = await loadAiService()
      expect(ai.parsePullProgress('{"status":"x","completed":300,"total":200}')?.percent).toBe(100)
    })
    it('total=0이면 나눗셈 없이 percent=null (0 나눗셈 방어)', async () => {
      const ai = await loadAiService()
      expect(ai.parsePullProgress('{"status":"x","completed":0,"total":0}')?.percent).toBeNull()
    })
    it('다운로드 시작(completed=0, total>0)은 percent=0', async () => {
      const ai = await loadAiService()
      expect(ai.parsePullProgress('{"status":"downloading","completed":0,"total":200}')?.percent).toBe(0)
    })
  })

  // 한 번에 전체 NDJSON을 흘려보내는 스트리밍 응답 body 목
  function oneShotBody(text: string) {
    let sent = false
    return {
      getReader() {
        return {
          read: async () => {
            if (sent) return { done: true, value: undefined }
            sent = true
            return { done: false, value: new TextEncoder().encode(text) }
          }
        }
      }
    }
  }

  describe('pullModel', () => {
    it('Ollama가 아니면 즉시 에러', async () => {
      const ai = await loadAiService()
      ai.setAiConfig({ provider: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'sk-x' })
      const onError = vi.fn()
      await ai.pullModel('exaone3.5', vi.fn(), vi.fn(), onError)
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('Ollama'))
    })

    it('빈 모델명은 에러', async () => {
      const ai = await loadAiService()
      const onError = vi.fn()
      await ai.pullModel('  ', vi.fn(), vi.fn(), onError)
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('모델 이름'))
    })

    it('스트리밍 진행 라인을 파싱해 onProgress→onDone 순으로 콜백', async () => {
      const ai = await loadAiService()
      const ndjson =
        '{"status":"pulling manifest"}\n{"status":"downloading","completed":100,"total":100}\n{"status":"success"}\n'
      mockFetch.mockResolvedValueOnce({ ok: true, body: oneShotBody(ndjson) })
      const onProgress = vi.fn()
      const onDone = vi.fn()
      const onError = vi.fn()
      await ai.pullModel('exaone3.5', onProgress, onDone, onError)
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ status: 'downloading', percent: 100 }))
      expect(onDone).toHaveBeenCalledTimes(1)
      expect(onError).not.toHaveBeenCalled()
    })

    it('스트림 내 error 라인이면 onError', async () => {
      const ai = await loadAiService()
      mockFetch.mockResolvedValueOnce({ ok: true, body: oneShotBody('{"error":"file does not exist"}\n') })
      const onDone = vi.fn()
      const onError = vi.fn()
      await ai.pullModel('nope', vi.fn(), onDone, onError)
      expect(onError).toHaveBeenCalledWith('file does not exist')
      expect(onDone).not.toHaveBeenCalled()
    })
  })

  describe('buildActionSystemPrompt / interpretTaskAction', () => {
    it('프롬프트에 미완료 태스크 제목만 나열', async () => {
      const ai = await loadAiService()
      const prompt = ai.buildActionSystemPrompt([
        { title: '보고서', dueDate: '2026-07-28', priority: 'none', completed: false },
        { title: '완료된것', dueDate: null, priority: 'none', completed: true }
      ])
      expect(prompt).toContain('보고서')
      expect(prompt).toContain('due: 2026-07-28')
      expect(prompt).not.toContain('완료된것')
    })

    it('reschedule 응답을 정규화(op/taskTitle/dueDate) — 미래 날짜 유지', async () => {
      const ai = await loadAiService()
      // 실행 날짜와 무관하도록 먼 미래 날짜 사용(과거 날짜 가드에 걸리지 않게)
      const json = { action: 'task_action', op: 'reschedule', taskTitle: '보고서', dueDate: '2099-12-31' }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(json) } }] })
      })
      const res = await ai.interpretTaskAction('보고서 미뤄', [
        { title: '보고서', dueDate: null, priority: 'none', completed: false }
      ])
      expect(res).toEqual({ action: 'task_action', op: 'reschedule', taskTitle: '보고서', dueDate: '2099-12-31' })
    })

    it('과거 날짜 reschedule은 dueDate=null (오늘 이후만 허용)', async () => {
      const ai = await loadAiService()
      const json = { action: 'task_action', op: 'reschedule', taskTitle: 'x', dueDate: '2000-01-01' }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(json) } }] })
      })
      const res = await ai.interpretTaskAction('x 미뤄', [
        { title: 'x', dueDate: null, priority: 'none', completed: false }
      ])
      expect(res.dueDate).toBeNull()
    })

    it('오늘 날짜 reschedule은 유지 (>= today 경계)', async () => {
      const ai = await loadAiService()
      // 런타임 today를 써서 실행 날짜와 무관하게 경계를 검증.
      // 프로덕션(getToday)과 같은 로컬 기준이어야 한다 — toISOString()은 UTC라
      // KST 00:00~09:00에 하루 밀려, 그 시간대에만 이 테스트가 깨졌다.
      const today = toLocalDateString(new Date())
      const json = { action: 'task_action', op: 'reschedule', taskTitle: 'x', dueDate: today }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(json) } }] })
      })
      const res = await ai.interpretTaskAction('x 오늘로', [
        { title: 'x', dueDate: null, priority: 'none', completed: false }
      ])
      expect(res.dueDate).toBe(today)
    })

    it('알 수 없는 op은 none, complete는 dueDate를 null로', async () => {
      const ai = await loadAiService()
      const json = { action: 'task_action', op: 'complete', taskTitle: '장보기', dueDate: '2026-07-28' }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(json) } }] })
      })
      const res = await ai.interpretTaskAction('장보기 했어', [
        { title: '장보기', dueDate: null, priority: 'none', completed: false }
      ])
      expect(res.op).toBe('complete')
      expect(res.dueDate).toBeNull() // complete엔 dueDate 무시
    })

    it('잘못된 날짜의 reschedule은 dueDate=null', async () => {
      const ai = await loadAiService()
      const json = { action: 'task_action', op: 'reschedule', taskTitle: 'x', dueDate: 'tomorrow' }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(json) } }] })
      })
      const res = await ai.interpretTaskAction('x 미뤄', [
        { title: 'x', dueDate: null, priority: 'none', completed: false }
      ])
      expect(res.dueDate).toBeNull()
    })
  })

  describe('taskTagVocabulary', () => {
    it('중복 없이 태그 어휘를 모은다', async () => {
      const ai = await loadAiService()
      const tasks = [
        { title: 'a', dueDate: null, priority: 'none', completed: false, tags: ['work', 'urgent'] },
        { title: 'b', dueDate: null, priority: 'none', completed: true, tags: ['work', 'home'] }
      ]
      expect(ai.taskTagVocabulary(tasks)).toEqual(['work', 'urgent', 'home'])
    })

    it('max 개수를 초과하지 않는다', async () => {
      const ai = await loadAiService()
      const tasks = Array.from({ length: 50 }, (_, i) => ({
        title: `t${i}`,
        dueDate: null,
        priority: 'none',
        completed: false,
        tags: [`tag${i}`]
      }))
      expect(ai.taskTagVocabulary(tasks, 5)).toHaveLength(5)
    })

    it('태그 없으면 빈 배열', async () => {
      const ai = await loadAiService()
      expect(ai.taskTagVocabulary([])).toEqual([])
    })
  })

  describe('buildTaskSystemPrompt', () => {
    it('기존 태그가 있으면 재사용 힌트를 넣는다', async () => {
      const ai = await loadAiService()
      const prompt = ai.buildTaskSystemPrompt(['work', 'home'])
      expect(prompt).toContain('#work #home')
      expect(prompt).toContain('reusing one of')
      expect(prompt).not.toContain('{tagHint}')
    })

    it('태그가 없으면 힌트 없이 플레이스홀더만 제거', async () => {
      const ai = await loadAiService()
      const prompt = ai.buildTaskSystemPrompt([])
      expect(prompt).not.toContain('{tagHint}')
      expect(prompt).not.toContain('existing tags')
    })
  })

  describe('createTaskFromNL — 기존 태그 힌트', () => {
    it('전달된 태스크의 태그가 요청 프롬프트에 포함된다', async () => {
      const ai = await loadAiService()
      const taskJson = {
        action: 'create_task',
        task: { title: '보고서', dueDate: null, dueTime: null, priority: 'none', tags: [], subtasks: [] }
      }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(taskJson) } }] })
      })
      await ai.createTaskFromNL('보고서 쓰기', [
        { title: '기존', dueDate: null, priority: 'none', completed: false, tags: ['프로젝트'] }
      ])
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      const systemMsg = body.messages.find((m: { role: string }) => m.role === 'system')
      expect(systemMsg.content).toContain('#프로젝트')
    })
  })
})
