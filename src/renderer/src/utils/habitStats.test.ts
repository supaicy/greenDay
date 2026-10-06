/**
 * 습관 완료율의 분모 — **요일 지정 습관**과 여러 습관의 합산.
 *
 * Value: protects=the denominator counts only targetDays weekdays after each habit's creation;
 *   fails_when=the weekday filter is dropped or the dow mapping is off, or empty targetDays reads as "no days";
 *   why_new=StatsView.test.tsx uses only an every-day habit, so the weekday branch never ran; seam=none
 *
 * 화면 테스트(StatsView.test.tsx)는 매일 습관 하나로만 돌아서, 요일을 거르는 줄을 지워도
 * 21%·14%가 그대로 나왔다. 월·수·금 습관은 그 줄이 없으면 분모가 14로 부풀어 실제보다
 * 낮게 보인다 — 이 함수가 고치려던 "숫자가 실제를 말하지 않는" 바로 그 부류다.
 */

import { describe, expect, it } from 'vitest'
import type { Habit, HabitLog } from '../types'
import { habitCompletionRate } from './habitStats'

// 2026-09-25는 금요일이다. 창은 09-12(토) ~ 09-25(금) 14일.
const TODAY = '2026-09-25'
// 창보다 한참 전, 어느 시간대에서도 같은 로컬 날짜가 되는 시각.
const LONG_AGO = '2026-01-01T12:00:00.000Z'

function habit(id: string, targetDays: number[], createdAt = LONG_AGO): Habit {
  return { id, name: id, color: '#4A90D9', frequency: 'daily', targetDays, createdAt } as Habit
}
function logs(habitId: string, dates: string[]): HabitLog[] {
  return dates.map((date, i) => ({ id: `${habitId}-${i}`, habitId, date, completed: true }) as HabitLog)
}

describe('habitCompletionRate — 분모는 해내기로 한 날', () => {
  it('월·수·금 습관은 그 요일만 센다 — 지정하지 않은 화요일 체크는 분모도 분자도 아니다', () => {
    // 기대한 날: 09-14(월) 16(수) 18(금) 21(월) 23(수) 25(금) = 6일
    const rate = habitCompletionRate(
      [habit('mwf', [1, 3, 5])],
      logs('mwf', ['2026-09-14', '2026-09-16', '2026-09-18', '2026-09-15']),
      TODAY
    )
    expect(rate).toBe(50) // 3 / 6 — 요일 필터가 없으면 4 / 14 = 29
  })

  it('targetDays가 비면 매일로 본다 — 0%가 박히지 않는다', () => {
    const week = ['2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']
    expect(habitCompletionRate([habit('any', [])], logs('any', week), TODAY)).toBe(50) // 7 / 14
  })

  it('여러 습관은 습관마다 만든 날 이후만 합산한다', () => {
    // a: 매일, 오래전 → 14일 기대. b: 매일, 09-20 로컬 정오에 만듦 → 09-20 ~ 09-25 6일 기대.
    const createdLocalNoon = new Date(2026, 8, 20, 12).toISOString()
    const rate = habitCompletionRate(
      [habit('a', [0, 1, 2, 3, 4, 5, 6]), habit('b', [0, 1, 2, 3, 4, 5, 6], createdLocalNoon)],
      [
        ...logs('a', ['2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']),
        ...logs('b', ['2026-09-23', '2026-09-24', '2026-09-25'])
      ],
      TODAY
    )
    expect(rate).toBe(50) // (7 + 3) / (14 + 6)
  })
})
