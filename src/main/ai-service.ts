// AI Service Layer — Ollama / OpenAI 호환 API 클라이언트
import * as db from './database'

const ALLOWED_ACTIONS = ['create_task', 'chat_response'] as const
const VALID_PRIORITIES = ['none', 'low', 'medium', 'high'] as const
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const DEFAULT_TIMEOUT = 30_000
const MAX_RETRIES = 2

interface AiConfig {
  provider: 'ollama' | 'openai' | 'custom'
  baseUrl: string
  model: string
  apiKey: string | null
  maxHistoryMessages: number
}

const DEFAULT_CONFIG: AiConfig = {
  provider: 'ollama',
  baseUrl: 'http://localhost:11434',
  model: 'llama3.2:latest',
  apiKey: null,
  maxHistoryMessages: 200
}

let config: AiConfig = { ...DEFAULT_CONFIG }

function getChatUrl(): string {
  return `${config.baseUrl}/v1/chat/completions`
}

export function getAiConfig(): AiConfig {
  const saved = db.getAiConfig()
  if (saved) {
    config = { ...DEFAULT_CONFIG, ...saved } as AiConfig
  }
  // API 키는 렌더러에 마스킹하여 반환
  return { ...config, apiKey: config.apiKey ? `••••••${config.apiKey.slice(-4)}` : null }
}

export function getAiConfigInternal(): AiConfig {
  const saved = db.getAiConfig()
  if (saved) {
    config = { ...DEFAULT_CONFIG, ...saved } as AiConfig
  }
  return { ...config }
}

function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) return false
    const host = parsed.hostname
    // 내부 네트워크 및 메타데이터 엔드포인트 차단
    if (host === '169.254.169.254') return false
    if (host === '0.0.0.0') return false
    if (host.startsWith('10.')) return false
    if (host.startsWith('172.') && /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false
    if (host.startsWith('192.168.')) return false
    // localhost는 Ollama용으로 허용
    return true
  } catch {
    return false
  }
}

export function setAiConfig(updates: Partial<AiConfig>): void {
  if (updates.baseUrl && !isAllowedUrl(updates.baseUrl)) {
    // localhost는 허용, 그 외 내부 IP는 차단
    const parsed = new URL(updates.baseUrl)
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname)) {
      throw new Error('Blocked URL: internal network addresses are not allowed')
    }
  }
  // 마스킹된 API 키('••••••...')가 돌아오면 기존 키 유지
  if (updates.apiKey?.startsWith('••••••')) {
    delete updates.apiKey
  }
  config = { ...config, ...updates }
  db.saveAiConfig({ ...config } as unknown as Record<string, unknown>)
}

export async function checkConnection(): Promise<{ connected: boolean; models?: string[] }> {
  try {
    if (config.provider === 'ollama') {
      const res = await fetch(`${config.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) return { connected: false }
      const data = await res.json()
      const models = (data.models || []).map((m: { name: string }) => m.name)
      return { connected: true, models }
    }
    // OpenAI/Custom: 연결 확인은 간단히 models 엔드포인트
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`
    const res = await fetch(`${config.baseUrl}/v1/models`, { headers, signal: AbortSignal.timeout(5000) })
    return { connected: res.ok }
  } catch {
    return { connected: false }
  }
}

interface TaskResult {
  action: 'create_task'
  task: {
    title: string
    dueDate: string | null
    dueTime: string | null
    priority: 'none' | 'low' | 'medium' | 'high'
    tags: string[]
    subtasks: { title: string; dueDate: string | null }[]
  }
}

interface ChatResult {
  action: 'chat_response'
  message: string
}

type AiResult = TaskResult | ChatResult

const TASK_SYSTEM_PROMPT = `You are a task management assistant. Given a natural language input in Korean or English, extract task information and return ONLY valid JSON in this exact format:
{
  "action": "create_task",
  "task": {
    "title": "task title",
    "dueDate": "YYYY-MM-DD or null",
    "dueTime": "HH:MM or null",
    "priority": "none|low|medium|high",
    "tags": ["tag1"],
    "subtasks": [{"title": "subtask title", "dueDate": "YYYY-MM-DD or null"}]
  }
}
Priority rules: "급하게","긴급","ASAP","중요!","반드시","urgent" → high. "시간 나면","나중에","천천히","여유" → low. Otherwise → none.
Today is {today}. Return ONLY the JSON, no explanation.`

export function chatPromptBase(taskSummary: string): string {
  return `You are a productivity assistant for the app "haru". The user can ask about their tasks, schedule, and productivity.
Answer in the same language the user writes in (Korean or English). When the user writes in Korean, respond ONLY in Korean and never mix languages within a single response.
Be concise and helpful. Reference specific tasks when relevant.

Current tasks summary:
${taskSummary}

Today is ${getToday()}.`
}

export function buildChatSystemPrompt(taskSummary: string): string {
  return `${chatPromptBase(taskSummary)}
Return your response as JSON: {"action":"chat_response","message":"your response here"}`
}

function getToday(): string {
  return new Date().toISOString().split('T')[0]
}

async function callLlm(systemPrompt: string, userMessage: string, useJsonMode: boolean): Promise<AiResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`

  const body: Record<string, unknown> = {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt.replace('{today}', getToday()) },
      { role: 'user', content: userMessage }
    ],
    temperature: 0.3,
    stream: false
  }

  if (useJsonMode) {
    body.response_format = { type: 'json_object' }
  }

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT)

      const res = await fetch(getChatUrl(), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      })
      clearTimeout(timeout)

      if (!res.ok) {
        throw new Error(`API error: ${res.status} ${res.statusText}`)
      }

      const data = await res.json()
      const content = data.choices?.[0]?.message?.content || ''

      if (!content) {
        throw new Error('Empty response from LLM')
      }

      const parsed = JSON.parse(content) as AiResult

      // action 허용 목록 검증
      if (!ALLOWED_ACTIONS.includes(parsed.action as (typeof ALLOWED_ACTIONS)[number])) {
        throw new Error(`Invalid action: ${parsed.action}`)
      }

      return parsed
    } catch (err) {
      lastError = err as Error
      if (attempt < MAX_RETRIES) continue
    }
  }

  throw lastError || new Error('LLM call failed')
}

export interface TaskContext {
  title: string
  dueDate: string | null
  priority: string
  completed: boolean
}

function summarizeTasks(tasks: TaskContext[]): string {
  if (tasks.length === 0) return 'No tasks.'
  return tasks
    .map((t) => {
      const status = t.completed ? '[done]' : '[todo]'
      const due = t.dueDate ? ` (due: ${t.dueDate})` : ''
      const pri = t.priority !== 'none' ? ` [${t.priority}]` : ''
      return `${status} ${t.title}${due}${pri}`
    })
    .join('\n')
}

function sanitizeTaskResult(raw: AiResult): TaskResult {
  if (raw.action !== 'create_task') {
    throw new Error('Unexpected action from task creation')
  }
  const t = (raw as TaskResult).task
  return {
    action: 'create_task',
    task: {
      title: typeof t.title === 'string' ? t.title.slice(0, 500) : 'Untitled',
      dueDate:
        typeof t.dueDate === 'string' && DATE_RE.test(t.dueDate) && !Number.isNaN(Date.parse(t.dueDate))
          ? t.dueDate
          : null,
      dueTime: typeof t.dueTime === 'string' && TIME_RE.test(t.dueTime) ? t.dueTime : null,
      priority: VALID_PRIORITIES.includes(t.priority as (typeof VALID_PRIORITIES)[number]) ? t.priority : 'none',
      tags: Array.isArray(t.tags) ? t.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 20) : [],
      subtasks: Array.isArray(t.subtasks)
        ? t.subtasks
            .filter((s): s is { title: string; dueDate: string | null } => typeof s?.title === 'string')
            .map((s) => ({
              title: s.title.slice(0, 500),
              dueDate:
                typeof s.dueDate === 'string' && DATE_RE.test(s.dueDate) && !Number.isNaN(Date.parse(s.dueDate))
                  ? s.dueDate
                  : null
            }))
            .slice(0, 20)
        : []
    }
  }
}

export async function createTaskFromNL(input: string, _existingTasks: TaskContext[]): Promise<TaskResult> {
  const prompt = TASK_SYSTEM_PROMPT
  const result = await callLlm(prompt, input, true)
  return sanitizeTaskResult(result)
}

export async function chat(userMessage: string, existingTasks: TaskContext[]): Promise<string> {
  const summary = summarizeTasks(existingTasks)
  const prompt = buildChatSystemPrompt(summary)
  const result = await callLlm(prompt, userMessage, true)
  if (result.action !== 'chat_response') {
    throw new Error('Unexpected action from chat')
  }
  return (result as ChatResult).message
}

// 스트리밍 채팅 — MessagePort 대신 간단한 콜백 기반으로 구현
// (Electron IPC에서 스트리밍 이벤트로 전달)
export async function streamChat(
  userMessage: string,
  existingTasks: TaskContext[],
  onToken: (token: string) => void,
  onDone: () => void,
  onError: (error: string) => void
): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`

  const summary = summarizeTasks(existingTasks)
  const systemPrompt = chatPromptBase(summary)

  const body = {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    temperature: 0.3,
    stream: true
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT)

  try {
    const res = await fetch(getChatUrl(), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    })
    clearTimeout(timeout)

    if (!res.ok) {
      onError(`API error: ${res.status}`)
      return
    }

    const reader = res.body?.getReader()
    if (!reader) {
      onError('No response body')
      return
    }

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed === 'data: [DONE]') continue
        if (!trimmed.startsWith('data: ')) continue

        try {
          const json = JSON.parse(trimmed.slice(6))
          const token = json.choices?.[0]?.delta?.content || ''
          if (token) onToken(token)
        } catch {
          // skip malformed SSE lines
        }
      }
    }

    onDone()
  } catch (err) {
    clearTimeout(timeout)
    const message = err instanceof Error ? err.message : 'Stream failed'
    onError(message.includes('abort') ? '응답 시간이 초과되었습니다' : message)
  }
}
