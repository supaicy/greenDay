// AiConfig — main / renderer 양쪽에서 공유하는 단일 정의
export interface AiConfig {
  provider: 'ollama' | 'openai' | 'custom'
  baseUrl: string
  model: string
  apiKey: string | null
  maxHistoryMessages: number
}
