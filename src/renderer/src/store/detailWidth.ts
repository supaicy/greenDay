// 우측 상세 패널 폭(px)을 clamp — 항상 사이드바 + 최소 320px의 가운데 목록이
// 보이도록 상한을 두고, 하한은 사용 가능한 320px로 고정한다. 좁은 창에서는
// 상한이 이기지만 320에서 바닥친다.
// 576 = 256px 사이드바(w-64) + 320px 목록 최소 폭.
// AI 챗 패널(w-80 = 320px)이 열려 있으면 그 폭까지 추가로 예약해, 상세 패널을
// 최대로 늘린 상태에서 챗을 열어도 가운데 목록이 0으로 짓눌리지 않게 한다.
const SIDEBAR_PLUS_LIST_MIN = 576
export const AI_CHAT_WIDTH = 320

export function clampDetailWidth(px: number, windowWidth: number, aiChatOpen = false): number {
  const reserved = SIDEBAR_PLUS_LIST_MIN + (aiChatOpen ? AI_CHAT_WIDTH : 0)
  const ceil = Math.max(320, windowWidth - reserved)
  return Math.min(Math.max(px, 320), ceil)
}
