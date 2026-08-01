/**
 * haru 할일 ↔ 캘린더 일정 매핑과 동기화 계획.
 *
 * 전부 순수 함수다 — 네트워크도 파일도 건드리지 않는다. 실제 요청은 호출하는 쪽이
 * 계획(plan)을 보고 수행한다. 그래야 "무엇을 올릴지"를 서버 없이 검증할 수 있다.
 */

import type { CalendarEvent } from './ical'

/** database.ts가 돌려주는 행에서 동기화에 필요한 부분만. */
export interface TaskRow {
  id: string
  title: string
  description?: string | null
  completed?: unknown
  due_date?: string | null
  due_time?: string | null
  scheduled_start?: string | null
  scheduled_end?: string | null
  deleted_at?: string | null
  parent_id?: string | null
}

export interface SyncEntry {
  /** 서버 리소스 경로 */
  href: string
  etag: string | null
  /** 마지막으로 올린 내용의 지문. 같으면 다시 올리지 않는다. */
  fingerprint: string
  /** 마지막으로 올린 SEQUENCE. 갱신할 때마다 1씩 올린다. */
  sequence: number
}

/** taskId → 마지막 동기화 상태 */
export type SyncState = Record<string, SyncEntry>

export interface SyncPlan {
  creates: { taskId: string; href: string; event: CalendarEvent }[]
  updates: { taskId: string; href: string; etag: string | null; event: CalendarEvent }[]
  deletes: { taskId: string; href: string; etag: string | null }[]
  /** 날짜가 없어 캘린더에 올릴 수 없는 할일 수. 사용자에게 왜 안 올라갔는지 알린다. */
  skippedNoDate: number
}

/** 일정 하나가 차지하는 기본 길이(분). 마감 시각만 있고 종료가 없을 때 쓴다. */
const DEFAULT_DURATION_MIN = 60

export function eventUid(taskId: string): string {
  return `haru-${taskId}@haru.app`
}

/** 서버에 둘 파일 이름. UID 기준이라 같은 할일은 항상 같은 경로다. */
export function eventHref(calendarUrl: string, taskId: string): string {
  const base = calendarUrl.endsWith('/') ? calendarUrl : `${calendarUrl}/`
  return `${base}${encodeURIComponent(eventUid(taskId))}.ics`
}

function addDays(yyyyMmDd: string, days: number): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number)
  const date = new Date(y, m - 1, d + days)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 로컬 날짜+시각을 UTC ISO로. 'YYYY-MM-DD' + 'HH:MM' */
function localToIso(date: string, time: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  return new Date(y, m - 1, d, hh, mm, 0, 0).toISOString()
}

/**
 * 할일을 캘린더 일정으로. 캘린더에 올릴 수 없는 할일은 null.
 *
 * - scheduledStart/End가 있으면 그 시간 블록 그대로
 * - dueDate + dueTime이면 그 시각부터 한 시간
 * - dueDate만 있으면 종일 일정
 * - 날짜가 전혀 없으면 null (캘린더에 놓을 자리가 없다)
 */
export function taskToEvent(task: TaskRow, sequence = 0): CalendarEvent | null {
  const completed = Boolean(task.completed)
  const base = {
    uid: eventUid(task.id),
    summary: task.title || '(제목 없음)',
    description: task.description ?? '',
    rrule: null,
    lastModified: null,
    sequence,
    completed
  }

  if (task.scheduled_start && task.scheduled_end) {
    return {
      ...base,
      start: new Date(task.scheduled_start).toISOString(),
      end: new Date(task.scheduled_end).toISOString(),
      allDay: false
    }
  }

  if (task.due_date && task.due_time) {
    const start = localToIso(task.due_date, task.due_time)
    return {
      ...base,
      start,
      end: new Date(new Date(start).getTime() + DEFAULT_DURATION_MIN * 60_000).toISOString(),
      allDay: false
    }
  }

  if (task.due_date) {
    // 종일 일정의 DTEND는 배타적이다 — 하루짜리면 다음 날을 넣어야 한다.
    return { ...base, start: task.due_date, end: addDays(task.due_date, 1), allDay: true }
  }

  return null
}

/**
 * 다시 올릴지 판단할 지문. 우리가 서버에 쓰는 필드만 넣는다 — sequence는 넣지 않는다
 * (넣으면 올릴 때마다 지문이 바뀌어 매번 다시 올리게 된다).
 */
export function fingerprint(event: CalendarEvent): string {
  return JSON.stringify([
    event.summary,
    event.description,
    event.start,
    event.end,
    event.allDay,
    event.completed
  ])
}

/** 캘린더에 올릴 대상인가. 삭제됨·하위작업은 제외한다. */
export function isSyncable(task: TaskRow): boolean {
  if (task.deleted_at) return false
  // 하위 작업까지 올리면 캘린더가 잘게 쪼개진 항목으로 뒤덮인다. 상위 항목만 올린다.
  if (task.parent_id) return false
  return true
}

/**
 * 현재 할일 목록과 지난 동기화 상태를 비교해 무엇을 만들고/고치고/지울지 계산한다.
 *
 * 지문이 같으면 건드리지 않는다. 서버에서 사라진 항목을 되살리는 일은 하지 않는다 —
 * 사용자가 Calendar.app에서 지운 것을 앱이 계속 되돌려 놓으면 지울 방법이 없어진다.
 */
export function planSync(tasks: TaskRow[], state: SyncState, calendarUrl: string): SyncPlan {
  const plan: SyncPlan = { creates: [], updates: [], deletes: [], skippedNoDate: 0 }
  const seen = new Set<string>()

  for (const task of tasks) {
    if (!isSyncable(task)) continue

    const previous = state[task.id]
    // 지문 비교용으로는 이전 sequence 그대로 만든다 (지문에 sequence는 안 들어가지만,
    // 갱신으로 확정되기 전에 값을 올려 두면 변경 없는 항목의 sequence까지 올라간다).
    const event = taskToEvent(task, previous?.sequence ?? 0)
    if (!event) {
      plan.skippedNoDate++
      // 날짜가 지워진 할일은 캘린더에서도 내려야 한다.
      if (previous) {
        seen.add(task.id)
        plan.deletes.push({ taskId: task.id, href: previous.href, etag: previous.etag })
      }
      continue
    }

    seen.add(task.id)
    const href = previous?.href ?? eventHref(calendarUrl, task.id)

    if (!previous) {
      plan.creates.push({ taskId: task.id, href, event })
    } else if (previous.fingerprint !== fingerprint(event)) {
      // 일부 서버는 SEQUENCE가 줄거나 같으면 갱신을 거부한다.
      const bumped = { ...event, sequence: previous.sequence + 1 }
      plan.updates.push({ taskId: task.id, href, etag: previous.etag, event: bumped })
    }
  }

  // 상태에는 있는데 이번 목록에 없는 것 = 삭제되었거나 휴지통으로 갔다.
  for (const [taskId, entry] of Object.entries(state)) {
    if (seen.has(taskId)) continue
    plan.deletes.push({ taskId, href: entry.href, etag: entry.etag })
  }

  return plan
}
