// AI Service Layer — Ollama / OpenAI 호환 API 클라이언트
import * as db from './database'
import { type AiConfig, isLocalAiConfig } from '../shared/ai-config'
import { type ChatHistoryMessage, normalizeChatHistory } from '../shared/ai-history'

const ALLOWED_ACTIONS = ['create_task', 'chat_response', 'task_action'] as const
const ACTION_OPS = ['complete', 'reschedule', 'delete', 'none'] as const
const VALID_PRIORITIES = ['none', 'low', 'medium', 'high'] as const
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const DEFAULT_TIMEOUT = 30_000
// 스트리밍은 전체 시간이 아니라 '토큰 간 유휴' 기준으로 끊는다. 긴 응답도 토큰이
// 계속 오면 유지되고, 모델이 중간에 멈추면 이 시간 뒤 중단된다.
const STREAM_IDLE_TIMEOUT = 30_000
const MAX_RETRIES = 2
// 응답 최대 토큰 (폭주 방지 안전장치 — 일반 답변엔 넉넉). OpenAI 호환 필드라
// Ollama/OpenAI/커스텀 모두 동작.
const MAX_RESPONSE_TOKENS = 2048

const DEFAULT_CONFIG: AiConfig = {
  provider: 'ollama',
  baseUrl: 'http://localhost:11434',
  model: 'llama3.2:latest',
  apiKey: null,
  maxHistoryMessages: 200,
  localOnly: false
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

export function isAllowedUrl(url: string): boolean {
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
    // 의도적 허용: localhost/127.0.0.1은 로컬 Ollama 서버용. 그 외 사설/메타데이터
    // 대역은 위에서 차단됨. 사용자가 직접 설정하는 신뢰 엔드포인트만 통과.
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
  const next = { ...config, ...updates }
  // 로컬 전용(프라이버시) 모드 강제: 잠금이 켜져 있으면 외부(비-로컬) 제공자로
  // 저장할 수 없다. 렌더러가 우회하더라도 여기서 막아 데이터 유출을 방지한다.
  if (next.localOnly && !isLocalAiConfig(next)) {
    throw new Error('로컬 전용 모드에서는 외부 AI 제공자를 사용할 수 없습니다')
  }
  config = next
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

// 모델을 미리 메모리에 올려두고 keep_alive를 늘려, 유휴 후 첫 응답의 콜드 로드
// 지연을 없앤다. Ollama 로컬에서만 의미 있음(OpenAI/커스텀은 서버가 상주 관리).
// keep_alive는 /v1 채팅 엔드포인트가 무시하므로 네이티브 /api/generate 로 설정한다.
export async function warmupModel(): Promise<void> {
  const cfg = getAiConfigInternal()
  if (cfg.provider !== 'ollama') return
  try {
    await fetch(`${cfg.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, prompt: '', keep_alive: '30m' }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT)
    })
  } catch {
    // 웜업 실패는 무시 — 실제 요청 때 어차피 로드된다.
  }
}

// === 모델 설치(원클릭 Ollama 온보딩) ===
// Ollama 서버가 떠 있으면 CLI/PATH 없이 HTTP /api/pull 로 모델을 내려받는다.
// 다운로드는 수 분 걸릴 수 있어 '유휴' 타임아웃(진행 라인마다 리셋)으로 관리한다.
const PULL_IDLE_TIMEOUT = 60_000

export interface PullProgress {
  status: string
  completed?: number
  total?: number
  // total을 알 때만 0–100, 아니면 null(불확정 단계: manifest/verify 등)
  percent: number | null
  error?: string
}

// /api/pull NDJSON 한 줄을 진행 상태로 파싱. 빈 줄/비JSON은 null.
export function parsePullProgress(line: string): PullProgress | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (typeof obj.error === 'string') return { status: 'error', percent: null, error: obj.error }
  const status = typeof obj.status === 'string' ? obj.status : ''
  const completed = typeof obj.completed === 'number' ? obj.completed : undefined
  const total = typeof obj.total === 'number' && obj.total > 0 ? obj.total : undefined
  const percent =
    completed != null && total != null ? Math.max(0, Math.min(100, Math.round((completed / total) * 100))) : null
  return { status, completed, total, percent }
}

export async function pullModel(
  model: string,
  onProgress: (p: PullProgress) => void,
  onDone: () => void,
  onError: (error: string) => void
): Promise<void> {
  const cfg = getAiConfigInternal()
  if (cfg.provider !== 'ollama') {
    onError('모델 설치는 Ollama(로컬)에서만 가능합니다')
    return
  }
  if (!isAllowedUrl(cfg.baseUrl)) {
    onError('허용되지 않은 서버 주소입니다')
    return
  }
  const name = String(model || '').trim()
  if (!name) {
    onError('모델 이름이 비어 있습니다')
    return
  }

  const controller = new AbortController()
  let idleTimer = setTimeout(() => controller.abort(), PULL_IDLE_TIMEOUT)
  const resetIdle = (): void => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => controller.abort(), PULL_IDLE_TIMEOUT)
  }
  let sawError = ''

  const emitLine = (line: string): void => {
    const p = parsePullProgress(line)
    if (!p) return
    if (p.error) sawError = p.error
    onProgress(p)
  }

  try {
    const res = await fetch(`${cfg.baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: true }),
      signal: controller.signal
    })
    if (!res.ok) {
      onError(`설치 실패: HTTP ${res.status}`)
      return
    }
    const reader = res.body?.getReader()
    if (!reader) {
      onError('응답 본문이 없습니다')
      return
    }
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      resetIdle()
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) emitLine(line)
    }
    buffer += decoder.decode()
    if (buffer) emitLine(buffer)

    if (sawError) onError(sawError)
    else onDone()
  } catch (err) {
    const message = err instanceof Error ? err.message : '설치 실패'
    onError(message.includes('abort') ? '설치가 시간 초과로 중단되었습니다' : message)
  } finally {
    clearTimeout(idleTimer)
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

// 기존 할일에 대한 파괴적 액션(완료/리스케줄/삭제). 실행 전 렌더러에서 확인 카드 필수.
export interface ActionResult {
  action: 'task_action'
  // op 집합의 단일 출처는 ACTION_OPS — 타입을 배열에서 파생해 드리프트를 막는다.
  op: (typeof ACTION_OPS)[number]
  // 대상 태스크의 (모델이 고른) 제목. 렌더러가 실제 태스크 id로 해석한다.
  taskTitle: string
  // reschedule일 때 새 마감일(YYYY-MM-DD), 그 외 null.
  dueDate: string | null
}

type AiResult = TaskResult | ChatResult | ActionResult

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
{tagHint}Today is {today}. Return ONLY the JSON, no explanation.`

// 프롬프트에 넣을 기존 태그 어휘의 최대 개수 — 너무 길면 프롬프트가 비대해진다.
const MAX_TAG_VOCAB = 30

// 기존 태스크에서 중복 없는 태그 어휘를 최대 max개 뽑는다. 태스크 생성 시 모델이
// 새 태그를 만들기보다 사용자의 기존 태그를 재사용하도록 프롬프트에 힌트로 넣는다.
export function taskTagVocabulary(tasks: TaskContext[], max = MAX_TAG_VOCAB): string[] {
  const seen = new Set<string>()
  for (const t of tasks) {
    for (const tag of t.tags ?? []) {
      if (tag) seen.add(tag)
      if (seen.size >= max) return [...seen]
    }
  }
  return [...seen]
}

export function buildTaskSystemPrompt(existingTags: string[]): string {
  const tagHint =
    existingTags.length > 0
      ? `When a tag fits, prefer reusing one of the user's existing tags instead of inventing a new one: ${existingTags
          .map((t) => `#${t}`)
          .join(' ')}.\n`
      : ''
  return TASK_SYSTEM_PROMPT.replace('{tagHint}', tagHint)
}

export function chatPromptBase(taskSummary: string): string {
  return `You are a productivity assistant for the app "haru". The user can ask about their tasks, schedule, and productivity.
Answer in the same language the user writes in (Korean or English).
When the user writes in Korean, respond ONLY in Korean: use Hangul and standard punctuation, and never mix in English words, Chinese, Japanese, Thai, or any other script within a word or sentence. If you are unsure of a Korean term, paraphrase it in Korean instead of switching languages.
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
  // 런타임 방어: 잠금이 켜졌는데 비-로컬 구성이면(예: 손으로 수정된 config) 외부 호출 차단
  if (config.localOnly && !isLocalAiConfig(config)) {
    throw new Error('로컬 전용 모드: 외부 제공자 호출이 차단되었습니다')
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`

  const body: Record<string, unknown> = {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt.replace('{today}', getToday()) },
      { role: 'user', content: userMessage }
    ],
    temperature: 0.3,
    max_tokens: MAX_RESPONSE_TOKENS,
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
  dueTime?: string | null
  priority: string
  completed: boolean
  tags?: string[]
}

function summarizeTasks(tasks: TaskContext[]): string {
  if (tasks.length === 0) return 'No tasks.'
  return tasks
    .map((t) => {
      const status = t.completed ? '[done]' : '[todo]'
      const due = t.dueDate ? ` (due: ${t.dueDate}${t.dueTime ? ` ${t.dueTime}` : ''})` : ''
      const pri = t.priority !== 'none' ? ` [${t.priority}]` : ''
      const tags = t.tags && t.tags.length > 0 ? ` ${t.tags.map((tag) => `#${tag}`).join(' ')}` : ''
      return `${status} ${t.title}${due}${pri}${tags}`
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

export async function createTaskFromNL(input: string, existingTasks: TaskContext[]): Promise<TaskResult> {
  const prompt = buildTaskSystemPrompt(taskTagVocabulary(existingTasks))
  const result = await callLlm(prompt, input, true)
  return sanitizeTaskResult(result)
}

// 기존 할일 액션 해석용 시스템 프롬프트. 미완료 최상위 태스크 목록을 주고,
// 모델이 대상 태스크의 정확한 제목 + 연산을 고르게 한다.
export function buildActionSystemPrompt(tasks: TaskContext[]): string {
  const list = tasks
    .filter((t) => !t.completed)
    .map((t) => `- ${t.title}${t.dueDate ? ` (due: ${t.dueDate})` : ''}`)
    .join('\n')
  return `You manage the user's EXISTING task list. The user wants to act on ONE existing task.
Return ONLY JSON: {"action":"task_action","op":"${ACTION_OPS.join('|')}","taskTitle":"<exact title from the list, or empty>","dueDate":"YYYY-MM-DD or null"}
Rules:
- op: complete = mark done (완료/끝냈어/했어), reschedule = change the due date (미뤄/내일로/모레/다음주), delete = remove it (삭제/지워/없애).
- taskTitle: copy the EXACT title of the single best-matching task from the list below. If nothing matches, use op="none" and taskTitle="".
- dueDate: for reschedule, resolve relative dates (내일/모레/다음 주 등) against Today into YYYY-MM-DD. Otherwise null.
Tasks:
${list || '(none)'}
Today is {today}. Return ONLY the JSON, no explanation.`
}

function sanitizeActionResult(raw: AiResult): ActionResult {
  if (raw.action !== 'task_action') {
    throw new Error('Unexpected action from task-action interpret')
  }
  // 위 가드로 raw는 ActionResult로 좁혀진다(캐스트 불필요).
  const r = raw
  const op = ACTION_OPS.includes(r.op as (typeof ACTION_OPS)[number]) ? r.op : 'none'
  return {
    action: 'task_action',
    op,
    taskTitle: typeof r.taskTitle === 'string' ? r.taskTitle.slice(0, 500) : '',
    dueDate:
      // 리스케줄 날짜는 형식/파싱뿐 아니라 '오늘 이후'여야 한다 — 모델이 과거 날짜로
      // 잘못 해석하면 무효(null)로 떨궈, 렌더러가 구체적 날짜를 다시 묻게 한다.
      op === 'reschedule' &&
      typeof r.dueDate === 'string' &&
      DATE_RE.test(r.dueDate) &&
      !Number.isNaN(Date.parse(r.dueDate)) &&
      r.dueDate >= getToday()
        ? r.dueDate
        : null
  }
}

// 사용자 메시지를 기존 할일 액션으로 해석. 확인 카드용 구조화 결과만 반환하며,
// 실제 변경은 렌더러가 사용자 확인 후 수행한다(파괴적 액션 안전장치).
export async function interpretTaskAction(message: string, existingTasks: TaskContext[]): Promise<ActionResult> {
  const prompt = buildActionSystemPrompt(existingTasks)
  const result = await callLlm(prompt, message, true)
  return sanitizeActionResult(result)
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
  history: ChatHistoryMessage[],
  onToken: (token: string) => void,
  onDone: () => void,
  onError: (error: string) => void
): Promise<void> {
  // 런타임 방어: 잠금이 켜졌는데 비-로컬 구성이면 외부 호출 차단
  if (config.localOnly && !isLocalAiConfig(config)) {
    onError('로컬 전용 모드: 외부 제공자 호출이 차단되었습니다')
    return
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`

  const summary = summarizeTasks(existingTasks)
  const systemPrompt = chatPromptBase(summary)

  // 직전 대화를 컨텍스트로 포함 (멀티턴). 방어적으로 재검증 + 최근 N개로 제한.
  const priorTurns = normalizeChatHistory(history)

  const body = {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...priorTurns,
      { role: 'user', content: userMessage }
    ],
    temperature: 0.3,
    max_tokens: MAX_RESPONSE_TOKENS,
    stream: true
  }

  // 이미 토큰을 하나라도 흘려보냈으면 재시도하지 않는다 (중복 출력 방지).
  // 연결/헤더 단계 실패만 재시도한다.
  let emittedAny = false
  let lastError = 'Stream failed'

  // SSE 한 줄에서 델타 토큰을 추출해 emit. 성공 시 true.
  const emitLine = (line: string): void => {
    const trimmed = line.trim()
    if (!trimmed || trimmed === 'data: [DONE]' || !trimmed.startsWith('data: ')) return
    try {
      const token = JSON.parse(trimmed.slice(6)).choices?.[0]?.delta?.content || ''
      if (token) {
        emittedAny = true
        onToken(token)
      }
    } catch {
      // skip malformed SSE lines
    }
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController()
    // 처음엔 연결(첫 바이트) 타임아웃, 데이터가 오기 시작하면 유휴 타임아웃으로 리셋.
    let idleTimer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT)
    const resetIdle = (): void => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => controller.abort(), STREAM_IDLE_TIMEOUT)
    }

    try {
      const res = await fetch(getChatUrl(), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      })

      if (!res.ok) {
        lastError = `API error: ${res.status}`
        if (attempt < MAX_RETRIES && !emittedAny) continue
        onError(lastError)
        return
      }

      const reader = res.body?.getReader()
      if (!reader) {
        lastError = 'No response body'
        if (attempt < MAX_RETRIES && !emittedAny) continue
        onError(lastError)
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        resetIdle()
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) emitLine(line)
      }
      // 남은 멀티바이트/마지막 줄 flush
      buffer += decoder.decode()
      if (buffer) emitLine(buffer)

      onDone()
      return
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Stream failed'
      lastError = message.includes('abort') ? '응답 시간이 초과되었습니다' : message
      if (attempt < MAX_RETRIES && !emittedAny) continue
      onError(lastError)
      return
    } finally {
      // continue/return/throw 어느 경로든 이번 시도의 타이머를 정리
      clearTimeout(idleTimer)
    }
  }

  // 루프는 정상적으로 항상 return 하지만, 안전망으로 종단 콜백을 보장한다.
  onError(lastError)
}
