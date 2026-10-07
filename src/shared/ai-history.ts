// 멀티턴 채팅 히스토리 — main / renderer 공유 정의
export interface ChatHistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

// 모델에 되먹이는 직전 대화의 최대 메시지 수 (토큰 사용량 상한).
export const AI_CONTEXT_LIMIT = 10

// 임의 입력을 유효한 대화 히스토리로 정규화한다: 유효한 role + 비어있지 않은 내용만
// 남기고, 최근 AI_CONTEXT_LIMIT개로 제한. renderer(생성)와 main(방어) 양쪽에서 사용.
export function normalizeChatHistory(messages: unknown): ChatHistoryMessage[] {
  if (!Array.isArray(messages)) return []
  return messages
    .filter(
      (m): m is ChatHistoryMessage =>
        !!m &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.trim().length > 0
    )
    .slice(-AI_CONTEXT_LIMIT)
    .map((m) => ({ role: m.role, content: m.content }))
}
