// Enter 키로 채팅을 전송해야 하는지 판단.
// IME 조합 중(한글/일문/중문의 마지막 글자를 조합하는 중)에는 전송하지 않는다.
// 그래야 첫 Enter가 조합을 '확정'만 하고, 두 번째 Enter에서 전송된다.
// 이 가드가 없으면: 조합 중 Enter → 전송 + 입력창 비움 → 그 직후 IME가 마지막
// 글자를 확정하며 비워진 입력창에 다시 넣어, "마지막 글자가 남는" 현상이 생긴다.
// Shift+Enter는 줄바꿈이므로 전송하지 않는다.
export interface EnterKeyEvent {
  key: string
  shiftKey: boolean
  nativeEvent: { isComposing: boolean }
}

export function shouldSendOnEnter(e: EnterKeyEvent): boolean {
  return e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing
}

// 스크롤 위치가 바닥 근처인지 판단 (채팅 자동 따라내리기 유지 여부).
// threshold px 이내면 true → 새 메시지/토큰이 오면 계속 바닥을 따라간다.
// 사용자가 위로 스크롤해 읽는 중이면 false가 되어 자동 스크롤이 멈춘다.
export function isNearBottom(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  threshold = 40
): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold
}
