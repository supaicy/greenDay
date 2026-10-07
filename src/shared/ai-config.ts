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

// baseUrl에서 hostname만 추출(대괄호 제거). 파싱 실패 시 null.
// IPv6 루프백은 hostname이 '[::1]' 형태로 오므로 대괄호를 제거하고 비교.
function hostnameOf(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).hostname.replace(/^\[|\]$/g, '')
  } catch {
    return null
  }
}

// 데이터가 기기를 벗어나지 않는 온디바이스 구성인가?
// provider가 ollama이고 baseUrl이 로컬(localhost/127.0.0.1/::1)일 때만 true.
export function isLocalAiConfig(c: Pick<AiConfig, 'provider' | 'baseUrl'>): boolean {
  if (c.provider !== 'ollama') return false
  const host = hostnameOf(c.baseUrl)
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

// AI 호출이 실제로 나가는 목적지를 사람이 읽을 수 있게 표현한다(이그레스 가시성).
// isLocal이면 데이터가 기기를 벗어나지 않고, 아니면 host로 외부 전송된다.
// host 파싱 실패 시 '알 수 없음'.
export function aiDestination(c: Pick<AiConfig, 'provider' | 'baseUrl'>): { host: string; isLocal: boolean } {
  return { host: hostnameOf(c.baseUrl) ?? '알 수 없음', isLocal: isLocalAiConfig(c) }
}
