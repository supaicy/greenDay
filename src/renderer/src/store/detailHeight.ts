// Clamp the bottom-detail panel height (px) so it always keeps >=160px of the
// view visible and never drops below a usable 240px. On tiny windows where
// (contentHeight - 160) < 240 the ceiling wins but is floored at 240.
export function clampDetailHeight(px: number, contentHeight: number): number {
  const ceil = Math.max(240, contentHeight - 160)
  return Math.min(Math.max(px, 240), ceil)
}
