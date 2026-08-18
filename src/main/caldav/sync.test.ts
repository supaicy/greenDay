import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  taskToEvent,
  fingerprint,
  isSyncable,
  planSync,
  eventUid,
  eventHref,
  type TaskRow,
  type SyncState, localToIso } from './sync'

const CALENDAR = 'https://caldav.icloud.com/998877/calendars/home/'

function task(overrides: Partial<TaskRow> = {}): TaskRow {
  return { id: 't1', title: '장보기', ...overrides }
}

function entryFor(t: TaskRow, extra: Partial<SyncState[string]> = {}): SyncState[string] {
  const event = taskToEvent(t)
  if (!event) throw new Error('테스트 준비 오류: 날짜 없는 할일로는 상태를 만들 수 없다')
  return {
    href: eventHref(CALENDAR, t.id),
    etag: '"v1"',
    fingerprint: fingerprint(event),
    sequence: 0,
    ...extra
  }
}

describe('eventUid / eventHref', () => {
  it('같은 할일은 항상 같은 UID·경로를 갖는다 (상태를 잃어도 중복 생성되지 않는다)', () => {
    expect(eventUid('abc')).toBe('greenday-abc@supaicy.github.io')
    expect(eventHref(CALENDAR, 'abc')).toBe(`${CALENDAR}greenday-abc%40supaicy.github.io.ics`)
  })

  it('캘린더 URL 끝의 슬래시 유무에 관계없이 같은 경로를 만든다', () => {
    expect(eventHref('https://x/c', 'a')).toBe(eventHref('https://x/c/', 'a'))
  })
})

describe('taskToEvent', () => {
  it('예약된 시간 블록은 그대로 옮긴다', () => {
    const event = taskToEvent(
      task({ scheduled_start: '2026-08-03T05:00:00.000Z', scheduled_end: '2026-08-03T07:00:00.000Z' })
    )
    expect(event?.allDay).toBe(false)
    expect(event?.start).toBe('2026-08-03T05:00:00.000Z')
    expect(event?.end).toBe('2026-08-03T07:00:00.000Z')
  })

  it('마감일+시각이면 한 시간짜리 일정이 된다', () => {
    const event = taskToEvent(task({ due_date: '2026-08-03', due_time: '15:00' }))
    expect(event?.allDay).toBe(false)
    const minutes = (new Date(event?.end ?? 0).getTime() - new Date(event?.start ?? 0).getTime()) / 60000
    expect(minutes).toBe(60)
  })

  it('마감일만 있으면 종일 일정이고 DTEND는 다음 날이다 (배타적 종료)', () => {
    const event = taskToEvent(task({ due_date: '2026-08-03' }))
    expect(event?.allDay).toBe(true)
    expect(event?.start).toBe('2026-08-03')
    expect(event?.end).toBe('2026-08-04')
  })

  it('월말·연말에도 종일 종료일이 다음 날로 넘어간다', () => {
    expect(taskToEvent(task({ due_date: '2026-08-31' }))?.end).toBe('2026-09-01')
    expect(taskToEvent(task({ due_date: '2026-12-31' }))?.end).toBe('2027-01-01')
    expect(taskToEvent(task({ due_date: '2028-02-28' }))?.end).toBe('2028-02-29') // 윤년
  })

  it('날짜가 전혀 없으면 캘린더에 올리지 않는다', () => {
    expect(taskToEvent(task())).toBeNull()
  })

  it('예약 시간이 마감일보다 우선한다', () => {
    const event = taskToEvent(
      task({
        due_date: '2026-08-10',
        scheduled_start: '2026-08-03T05:00:00.000Z',
        scheduled_end: '2026-08-03T06:00:00.000Z'
      })
    )
    expect(event?.start).toBe('2026-08-03T05:00:00.000Z')
  })

  it('제목이 비면 자리표시 문구를 넣는다 (SUMMARY 없는 일정은 캘린더에서 안 보인다)', () => {
    expect(taskToEvent(task({ title: '', due_date: '2026-08-03' }))?.summary).toBe('(제목 없음)')
  })

  it('완료 여부를 싣는다', () => {
    expect(taskToEvent(task({ due_date: '2026-08-03', completed: 1 }))?.completed).toBe(true)
    expect(taskToEvent(task({ due_date: '2026-08-03', completed: 0 }))?.completed).toBe(false)
  })
})

describe('fingerprint', () => {
  it('sequence는 지문에 넣지 않는다 (넣으면 올릴 때마다 다시 올리게 된다)', () => {
    const a = taskToEvent(task({ due_date: '2026-08-03' }), 0)
    const b = taskToEvent(task({ due_date: '2026-08-03' }), 7)
    expect(fingerprint(a!)).toBe(fingerprint(b!))
  })

  it('내용이 바뀌면 지문도 바뀐다', () => {
    const before = taskToEvent(task({ due_date: '2026-08-03' }))
    for (const changed of [
      task({ due_date: '2026-08-04' }),
      task({ due_date: '2026-08-03', title: '다른 제목' }),
      task({ due_date: '2026-08-03', description: '메모' }),
      task({ due_date: '2026-08-03', completed: 1 })
    ]) {
      expect(fingerprint(taskToEvent(changed)!)).not.toBe(fingerprint(before!))
    }
  })
})

describe('isSyncable', () => {
  it('휴지통 항목은 제외한다', () => {
    expect(isSyncable(task({ deleted_at: '2026-08-01T00:00:00Z' }))).toBe(false)
  })

  it('하위 작업은 제외한다 (캘린더가 조각난 항목으로 덮이는 것을 막는다)', () => {
    expect(isSyncable(task({ parent_id: 'parent' }))).toBe(false)
  })

  it('보통 할일은 포함한다', () => {
    expect(isSyncable(task({ due_date: '2026-08-03' }))).toBe(true)
  })
})

describe('planSync', () => {
  it('처음 보는 할일은 생성한다', () => {
    const t = task({ due_date: '2026-08-03' })
    const plan = planSync([t], {}, CALENDAR)
    expect(plan.creates).toHaveLength(1)
    expect(plan.creates[0].href).toBe(eventHref(CALENDAR, t.id))
    expect(plan.updates).toHaveLength(0)
    expect(plan.deletes).toHaveLength(0)
  })

  it('내용이 그대로면 아무것도 하지 않는다', () => {
    const t = task({ due_date: '2026-08-03' })
    const plan = planSync([t], { t1: entryFor(t) }, CALENDAR)
    expect(plan.creates).toHaveLength(0)
    expect(plan.updates).toHaveLength(0)
    expect(plan.deletes).toHaveLength(0)
  })

  it('내용이 바뀌면 갱신하고 SEQUENCE를 올린다', () => {
    const before = task({ due_date: '2026-08-03' })
    const after = task({ due_date: '2026-08-05' })
    const plan = planSync([after], { t1: entryFor(before, { sequence: 4 }) }, CALENDAR)
    expect(plan.updates).toHaveLength(1)
    expect(plan.updates[0].event.sequence).toBe(5)
    expect(plan.updates[0].etag).toBe('"v1"')
  })

  it('변경 없는 항목의 SEQUENCE는 올리지 않는다', () => {
    const t = task({ due_date: '2026-08-03' })
    const plan = planSync([t], { t1: entryFor(t, { sequence: 4 }) }, CALENDAR)
    expect(plan.updates).toHaveLength(0)
  })

  it('갱신은 기존 경로를 재사용한다 (경로가 바뀌면 중복 일정이 생긴다)', () => {
    const before = task({ due_date: '2026-08-03' })
    const after = task({ due_date: '2026-08-05' })
    const plan = planSync(
      [after],
      { t1: { ...entryFor(before), href: 'https://caldav.icloud.com/legacy/path.ics' } },
      CALENDAR
    )
    expect(plan.updates[0].href).toBe('https://caldav.icloud.com/legacy/path.ics')
  })

  it('목록에서 사라진 할일은 서버에서도 지운다', () => {
    const t = task({ due_date: '2026-08-03' })
    const plan = planSync([], { t1: entryFor(t) }, CALENDAR)
    expect(plan.deletes).toHaveLength(1)
    expect(plan.deletes[0].taskId).toBe('t1')
    expect(plan.deletes[0].etag).toBe('"v1"')
  })

  it('휴지통으로 간 할일도 서버에서 지운다', () => {
    const t = task({ due_date: '2026-08-03' })
    const trashed = { ...t, deleted_at: '2026-08-02T00:00:00Z' }
    const plan = planSync([trashed], { t1: entryFor(t) }, CALENDAR)
    expect(plan.deletes.map((d) => d.taskId)).toEqual(['t1'])
  })

  it('마감일을 지우면 캘린더에서도 내린다', () => {
    const dated = task({ due_date: '2026-08-03' })
    const undated = task()
    const plan = planSync([undated], { t1: entryFor(dated) }, CALENDAR)
    expect(plan.deletes.map((d) => d.taskId)).toEqual(['t1'])
    expect(plan.deletes).toHaveLength(1) // 두 경로에서 중복 삭제되지 않는다
  })

  it('날짜가 없고 올린 적도 없으면 건너뛴 개수만 센다', () => {
    const plan = planSync([task(), task({ id: 't2' })], {}, CALENDAR)
    expect(plan.skippedNoDate).toBe(2)
    expect(plan.creates).toHaveLength(0)
    expect(plan.deletes).toHaveLength(0)
  })

  it('하위 작업은 계획에 전혀 나타나지 않는다', () => {
    const plan = planSync([task({ parent_id: 'p', due_date: '2026-08-03' })], {}, CALENDAR)
    expect(plan.creates).toHaveLength(0)
    expect(plan.skippedNoDate).toBe(0)
  })

  it('생성·갱신·삭제가 한 번에 섞여도 각각 제자리로 간다', () => {
    const kept = task({ id: 'keep', due_date: '2026-08-03' })
    const changed = task({ id: 'change', due_date: '2026-08-03' })
    const changedAfter = task({ id: 'change', due_date: '2026-08-09' })
    const fresh = task({ id: 'new', due_date: '2026-08-10' })

    const plan = planSync([kept, changedAfter, fresh], {
      keep: entryFor(kept),
      change: entryFor(changed),
      gone: entryFor(task({ id: 'gone', due_date: '2026-08-01' }))
    }, CALENDAR)

    expect(plan.creates.map((c) => c.taskId)).toEqual(['new'])
    expect(plan.updates.map((u) => u.taskId)).toEqual(['change'])
    expect(plan.deletes.map((d) => d.taskId)).toEqual(['gone'])
  })
})

describe('시간대 처리', () => {
  // 마감 시각은 사용자의 로컬 시각이다. UTC로 잘못 읽으면 일정이 몇 시간 어긋난다.
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-02T00:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('마감 시각을 로컬 시각으로 해석한다', () => {
    const event = taskToEvent(task({ due_date: '2026-08-03', due_time: '15:00' }))
    const local = new Date(event?.start ?? 0)
    expect(local.getHours()).toBe(15)
    expect(local.getMinutes()).toBe(0)
    expect(local.getDate()).toBe(3)
  })
})

describe('taskToEvent — 기간', () => {
  it('기간이 있으면 시작일부터 마감일까지 걸치는 종일 일정이 된다', () => {
    const ev = taskToEvent({ id: 't', title: '스프린트', start_date: '2026-08-18', due_date: '2026-08-20' })
    // DTEND는 배타적이라 마지막 날 다음 날을 넣는다.
    expect(ev).toMatchObject({ start: '2026-08-18', end: '2026-08-21', allDay: true })
  })

  it('기간이 없으면 예전처럼 하루짜리다', () => {
    const ev = taskToEvent({ id: 't', title: '보고서', due_date: '2026-08-20' })
    expect(ev).toMatchObject({ start: '2026-08-20', end: '2026-08-21', allDay: true })
  })

  it('거꾸로 된 기간은 마감일 하루짜리로 떨어뜨린다', () => {
    // IPC 검증은 부분 페이로드라 앞뒤 순서를 못 본다. 손으로 고친 JSON이나
    // 반쪽 쓰기가 들어오면 DTSTART > DTEND인 깨진 VEVENT가 나간다.
    const ev = taskToEvent({ id: 't', title: 'x', start_date: '2026-08-25', due_date: '2026-08-20' })
    expect(ev).toMatchObject({ start: '2026-08-20', end: '2026-08-21', allDay: true })
  })

  it('시작일과 마감일이 같으면 하루짜리다', () => {
    const ev = taskToEvent({ id: 't', title: 'x', start_date: '2026-08-20', due_date: '2026-08-20' })
    expect(ev).toMatchObject({ start: '2026-08-20', end: '2026-08-21', allDay: true })
  })

  it('기간에 마감 시각이 붙어도 기간이 사라지지 않는다', () => {
    // 시각 분기가 먼저라 8/18~8/20 할일이 8/20 09:00의 60분짜리로 쪼그라들었다.
    // 마감 시각은 기한 픽커의 1급 컨트롤이라 기간과 같이 쓰이는 게 보통이다.
    const ev = taskToEvent({ id: 't', title: '스프린트', start_date: '2026-08-18', due_date: '2026-08-20', due_time: '09:00' })
    expect(ev?.allDay).toBe(false)
    expect(ev?.start).toBe(localToIso('2026-08-18', '09:00'))
    expect(ev?.end).toBe(localToIso('2026-08-20', '09:00'))
  })

  it('시간블록이 있으면 기간보다 시간블록이 이긴다', () => {
    const ev = taskToEvent({
      id: 't',
      title: '회의',
      start_date: '2026-08-18',
      due_date: '2026-08-20',
      scheduled_start: '2026-08-19T09:00:00',
      scheduled_end: '2026-08-19T10:00:00'
    })
    expect(ev?.allDay).toBe(false)
  })
})
