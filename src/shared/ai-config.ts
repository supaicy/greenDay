// AiConfig — main / renderer 양쪽에서 공유하는 단일 정의
export interface AiConfig {
  provider: 'ollama' | 'openai' | 'custom'
  baseUrl: string
  model: string
  apiKey: string | null
  maxHistoryMessages: number
  // 로컬 전용(프라이버시) 모드: 켜면 외부 제공자를 쓸 수 없다. main에서 강제.
  localOnly?: boolean
}

// 데이터가 기기를 벗어나지 않는 온디바이스 구성인가?
// provider가 ollama이고 baseUrl이 로컬(localhost/127.0.0.1/::1)일 때만 true.
export function isLocalAiConfig(c: Pick<AiConfig, 'provider' | 'baseUrl'>): boolean {
  if (c.provider !== 'ollama') return false
  try {
    // IPv6 루프백은 hostname이 '[::1]' 형태로 오므로 대괄호를 제거하고 비교
    const host = new URL(c.baseUrl).hostname.replace(/^\[|\]$/g, '')
    return host === 'localhost' || host === '127.0.0.1' || host === '::1'
  } catch {
    return false
  }
}
