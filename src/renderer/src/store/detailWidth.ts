// Clamp the right-detail panel width (px) so it always keeps the sidebar plus
// >=320px of the middle task list visible, and never drops below a usable
// 320px. On narrow windows the ceiling wins but is floored at 320.
// 576 = 256px sidebar (w-64) + 320px minimum task-list width.
export function clampDetailWidth(px: number, windowWidth: number): number {
  const ceil = Math.max(320, windowWidth - 576)
  return Math.min(Math.max(px, 320), ceil)
}
