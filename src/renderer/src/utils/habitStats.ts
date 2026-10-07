import type { Habit, HabitLog } from '../types'
import { fromLocalDateString, toLocalDateString } from '../../../shared/date'

/** 통계가 습관을 보는 창(일). 같은 화면 바로 위의 '최근 14일 완료 추이'와 길이를 맞춘다. */
export const HABIT_WINDOW_DAYS = 14

/**
 * 습관 완료율 = 해낸 날 / **해내기로 한 날**.
 *
 * 분모를 `habitLogs.length`로 두면 구조적으로 영원히 100%다. 체크를 풀 때
 * 로그의 `completed`가 false가 되는 게 아니라 **행 자체가 지워지기** 때문이다
 * (`store/useStore.ts`의 `toggleHabitLog`는 filter로, `main/database.ts`의 같은
 * 이름은 splice로 지운다 — `completed: 0`을 쓰는 곳은 저장소 어디에도 없다).
 * 그래서 남아 있는 로그는 전부 completed=true고, "있는 것 중 완료된 것"은 언제나
 * 전부였다. 거른 날은 데이터에 흔적을 남기지 않으므로 분모는 데이터가 아니라
 * **달력**에서 세야 한다.
 *
 * 기대한 날은 습관마다 (1) 만든 날 이후이고 (2) `targetDays` 요일인, 창 안의
 * 날들이다. 이 가드가 막는 것: 어제 만든 습관이 지난 13일을 거른 것으로 세어져
 * 첫날부터 7%로 시작하는 일.
 */
export function habitCompletionRate(
  habits: Habit[],
  logs: HabitLog[],
  today: string,
  windowDays: number = HABIT_WINDOW_DAYS
): number {
  if (habits.length === 0) return 0

  const end = fromLocalDateString(today)
  const days: { date: string; dow: number }[] = []
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(end)
    d.setDate(d.getDate() - i)
    days.push({ date: toLocalDateString(d), dow: d.getDay() })
  }

  const expected = new Set<string>()
  for (const habit of habits) {
    // createdAt은 UTC ISO다 — 로컬 날짜로 바꿔 비교하지 않으면 KST 00:00~09:00에
    // 만든 습관이 하루 일찍 시작한 것으로 세어진다(같은 화면의 completedAt과 같은 규칙).
    const createdOn = toLocalDateString(new Date(habit.createdAt))
    for (const day of days) {
      if (day.date < createdOn) continue
      // targetDays가 비면 매일로 본다. 빈 배열을 '기대 없음'으로 읽으면 분모가 0이 돼
      // 습관이 있는데도 0%가 박힌다.
      if (habit.targetDays.length > 0 && !habit.targetDays.includes(day.dow)) continue
      expected.add(`${habit.id}:${day.date}`)
    }
  }
  if (expected.size === 0) return 0

  // 분자도 기대 집합 안으로 자른다. 습관 화면(HabitTracker)은 주를 앞으로 넘겨
  // **미래 날짜도** 체크할 수 있어서, 자르지 않으면 100%를 넘는 비율이 나온다.
  const done = new Set<string>()
  for (const log of logs) {
    const key = `${log.habitId}:${log.date}`
    if (log.completed && expected.has(key)) done.add(key)
  }
  return Math.round((done.size / expected.size) * 100)
}
