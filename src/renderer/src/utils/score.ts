// 점수·레벨 단일 출처. 사이드바와 통계가 각자 다른 식을 쓰다 같은 점수에서
// Lv.0 / Lv.1로 갈렸다(2026-08-05 검증). 표시 지점이 늘어도 어긋나지 않도록 여기서만 계산한다.
import type { Priority } from '../types'

/** 레벨당 필요 점수. */
export const POINTS_PER_LEVEL = 100

/** 총점 → 레벨. 0점이 Lv.1이다(Lv.0을 보여 주면 시작도 못 한 것처럼 읽힌다). */
export function levelFromScore(total: number): number {
  return Math.floor(Math.max(0, total) / POINTS_PER_LEVEL) + 1
}

/** 현재 레벨 안에서 쌓은 점수(0~99). 진행 바 폭에 그대로 쓴다. */
export function levelProgress(total: number): number {
  return Math.max(0, total) % POINTS_PER_LEVEL
}

/** 다음 레벨까지 남은 점수(1~100). */
export function pointsToNextLevel(total: number): number {
  return POINTS_PER_LEVEL - levelProgress(total)
}

/**
 * 할일 완료 시 주는 점수. 완료를 취소하면 같은 값을 되돌려야 하므로
 * 지급/회수 양쪽이 이 함수 하나만 보게 한다 — 값이 갈리면 점수가 새거나 부풀었다.
 */
export function pointsForTask(priority: Priority): number {
  if (priority === 'high') return 3
  if (priority === 'medium') return 2
  return 1
}

/** 습관 체크 1회 점수. 체크 해제 시 같은 값을 회수한다. */
export const POINTS_PER_HABIT = 1

/** 포모도로 집중 세션 1회 점수. */
export const POINTS_PER_POMODORO = 2
