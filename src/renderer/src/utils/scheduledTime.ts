import type { Task } from '../types'
import { occursOn } from './recurrence'

/**
 * Snap an ISO local datetime string to the nearest 15-minute grid point
 * (round-half-up). Input format: "YYYY-MM-DDTHH:mm:ss".
 */
export function snapTo15Min(iso: string): string {
  const d = new Date(iso)
  const originalDate = iso.slice(0, 10) // "YYYY-MM-DD"
  const minutes = d.getMinutes()
  const snapped = Math.round(minutes / 15) * 15
  d.setMinutes(snapped, 0, 0)
  let result = toLocalIso(d)
  // Clamp: if snapping rolled into the next day, pin to 23:45 of the original day
  if (result.slice(0, 10) !== originalDate) {
    result = `${originalDate}T23:45:00`
  }
  return result
}

function toLocalIso(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  )
}

/**
 * Compute the scheduled block for a specific occurrence of a task.
 *
 * - Per-date override first: scheduledOverrides[date]가 있으면 그 값이 이긴다
 *   (null이면 그날 블록 없음 — 다른 날로 옮긴 회차).
 * - Non-recurring tasks: returns {start, end} verbatim from task.scheduledStart/End.
 * - Recurring tasks: treats task.scheduledStart/End as a time-of-day + duration
 *   template, rendered ONLY on actual occurrence dates (occursOn). 게이트가
 *   없던 시절에는 주 1회 할일의 블록이 매일 떴다.
 *
 * Returns null if the task has no scheduled template.
 *
 * Input strings must be naive local ISO ("YYYY-MM-DDTHH:mm:ss"); any timezone
 * suffix (Z or ±HH:MM) would be silently propagated and cause parsing drift.
 */
export function getScheduledForOccurrence(
  task: Pick<
    Task,
    | 'scheduledStart'
    | 'scheduledEnd'
    | 'isRecurring'
    | 'recurringPattern'
    | 'dueDate'
    | 'scheduledOverrides'
    | 'completed'
    | 'completedAt'
  >,
  occurrenceDate: string // "YYYY-MM-DD"
): { start: string; end: string } | null {
  // 완료한 반복 인스턴스는 자기 회차에만 남는다. 미래 발생일은 완료로 새로
  // 스폰된 인스턴스의 몫이다 — 둘 다 주장하면 같은 블록이 두 개 뜨고,
  // 회차를 완료할 때마다 하나씩 늘어난다.
  //
  // '자기 회차'는 dueDate만이 아니다. (a) 기한을 지운 반복은 dueDate가 없어
  // 완료본이 모든 날짜에 그려졌으므로 완료 시각을 대신 쓴다. (b) 다른 날로
  // 옮긴 회차는 오버라이드에 그 날짜가 있으므로, 그 자리도 자기 회차다.
  if (task.isRecurring && task.completed) {
    const ownDate = task.dueDate ?? task.completedAt?.slice(0, 10) ?? null
    const movedHere = task.scheduledOverrides != null && occurrenceDate in task.scheduledOverrides
    if (!movedHere && occurrenceDate !== ownDate) return null
  }
  // 오버라이드는 반복 회차의 예외라 반복 task에만 의미가 있다. 반복을 끈 뒤
  // 남은 값을 읽으면 유령 블록이 된다(스토어가 정리하지만, 여기서도 게이트를 둔다).
  if (task.isRecurring) {
    const override = task.scheduledOverrides?.[occurrenceDate]
    if (override !== undefined) return override
  }
  if (!task.scheduledStart || !task.scheduledEnd) return null
  if (!task.isRecurring) {
    return { start: task.scheduledStart, end: task.scheduledEnd }
  }
  if (!occursOn(task.recurringPattern, task.dueDate, occurrenceDate)) return null
  const startTimePart = task.scheduledStart.slice(11) // "HH:mm:ss"
  const endTimePart = task.scheduledEnd.slice(11)
  return {
    start: `${occurrenceDate}T${startTimePart}`,
    end: `${occurrenceDate}T${endTimePart}`
  }
}

/** 시간블록 최소 길이(ms). 이보다 짧으면 updateTask가 거부한다. */
export const MIN_BLOCK_MS = 15 * 60 * 1000

export function isValidSchedulePair(start: string | null, end: string | null): boolean {
  if (start === null && end === null) return true
  if (start === null || end === null) return false
  const s = new Date(start).getTime()
  const e = new Date(end).getTime()
  if (!Number.isFinite(s) || !Number.isFinite(e)) return false
  return e - s >= MIN_BLOCK_MS
}

/**
 * Date → 로컬 기준 "YYYY-MM-DDTHH:mm:00".
 * 캘린더·타임블록이 같은 직렬화를 각자 손으로 쓰고 있어 규칙이 갈릴 여지가 있었다.
 */
export function toLocalIsoMinute(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`
}

export interface TimeBlockDropContext {
  /** 드롭 지점의 컬럼 상단 기준 y(px). */
  yPx: number
  dayStr: string // 드롭된 날짜 "YYYY-MM-DD"
  startHour: number // 컬럼 맨 위가 나타내는 시각
  pxPerMin: number
  task: Task
  /** true면 기존 블록 이동(TASK_BLOCK), false면 레일/목록에서 신규 배정(TASK_ID). */
  isBlockMove: boolean
  /** 블록을 끌기 시작한 발생일(BLOCK_DATE MIME). 반복 회차 이동 판정에 쓴다. */
  sourceDate: string | null
}

/**
 * 주/일 캘린더 onDrop 공통 리졸버 — 스냅·클램프·길이 보존을 한곳에서 판정한다.
 *
 * 반복 할일의 기존 블록 이동은 시리즈 템플릿 대신 그 회차만 오버라이드한다
 * (2026-08-15 제품 결정). 다른 날로 옮기면 원래 발생일은 null로 억제하고,
 * 원래 자리가 오버라이드로 생긴 날(비발생일)이었다면 키를 지운다.
 */
export function resolveTimeBlockDrop(ctx: TimeBlockDropContext): (Partial<Task> & { id: string }) | null {
  const { yPx, dayStr, startHour, pxPerMin, task, isBlockMove, sourceDate } = ctx
  const totalMin = startHour * 60 + yPx / pxPerMin
  // 로컬 날짜 구성요소로 만든다. 분 단위로 더하는 것은 같지만, epoch ms 산술로
  // 하면 서머타임 전환일에 전환 이후 시간대가 통째로 한 시간 밀린다(실측:
  // America/New_York 2026-03-08의 09:00 행이 10:00으로 저장됐다).
  // 시/분을 따로 pad하지 않는 이유는 그대로다 — 컬럼 아래로 넘칠 때 'T24:05'
  // 같은 파싱 불가 문자열이 나온다. Date 생성자가 다음 날로 굴려준다.
  const [dy, dm, dd] = dayStr.split('-').map(Number)
  const rawStart = toLocalIsoMinute(new Date(dy, dm - 1, dd, 0, Math.floor(totalMin)))
  const dayEnd = new Date(`${dayStr}T23:59:00`).getTime()
  // 하루 끝에서 최소 블록(15분)을 확보하지 못하면 updateTask가 조용히 거부하므로 시작을 끌어올린다.
  const startMs = Math.min(new Date(snapTo15Min(rawStart)).getTime(), dayEnd - MIN_BLOCK_MS)
  const start = toLocalIsoMinute(new Date(startMs))

  // 기존 블록 이동은 원래 길이를 보존한다(오버라이드된 회차면 그 길이).
  let durMs = 30 * 60000
  if (isBlockMove) {
    const sch =
      getScheduledForOccurrence(task, sourceDate ?? dayStr) ??
      (task.scheduledStart && task.scheduledEnd ? { start: task.scheduledStart, end: task.scheduledEnd } : null)
    if (sch) durMs = new Date(sch.end).getTime() - new Date(sch.start).getTime()
  }
  const end = toLocalIsoMinute(new Date(Math.min(startMs + durMs, dayEnd)))

  if (isBlockMove && task.isRecurring) {
    const overrides = { ...(task.scheduledOverrides ?? {}) }
    if (sourceDate && sourceDate !== dayStr) {
      if (occursOn(task.recurringPattern, task.dueDate, sourceDate)) overrides[sourceDate] = null
      else delete overrides[sourceDate]
    }
    overrides[dayStr] = { start, end }
    return { id: task.id, scheduledOverrides: overrides }
  }
  // 레일에서 반복 할일을 놓았는데 그날이 발생일이 아니면, 템플릿만 세팅하면
  // 레일에서는 빠지고(scheduledStart가 생겼으니) 블록은 occursOn에 막혀 안 그려진다
  // — 양쪽 화면에서 사라진다. 놓은 그날의 회차를 함께 만들어 준다.
  if (task.isRecurring && !occursOn(task.recurringPattern, task.dueDate, dayStr)) {
    return {
      id: task.id,
      scheduledStart: start,
      scheduledEnd: end,
      scheduledOverrides: { ...(task.scheduledOverrides ?? {}), [dayStr]: { start, end } }
    }
  }
  return { id: task.id, scheduledStart: start, scheduledEnd: end }
}
