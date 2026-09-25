import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  taskToEvent,
  fingerprint,
  isSyncable,
  planSync,
  eventUid,
  eventHref,
  type TaskRow,
  type SyncState,
  localToIso
} from './sync'
import { serializeEvent, type CalendarEvent } from './ical'

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

/**
 * `taskToEvent`가 null이 아님을 확인하고 좁힌다.
 *
 * 반복 테스트는 전부 "올릴 수 있는 할일"을 전제로 하므로, 그 전제가 깨지면
 * 뒤이은 단언이 아니라 여기서 터지는 편이 진단이 빠르다.
 */
function eventOf(task: TaskRow): CalendarEvent {
  const event = taskToEvent(task)
  if (!event) throw new Error('캘린더에 올릴 수 없는 할일이다 — 테스트 전제가 틀렸다')
  return event
}

/**
 * H16b — 반복 할일이 **한 번짜리 고정 일정 하나**로 나가던 것.
 *
 * `TaskRow`에 반복 세 열이 아예 없어서 `rrule: null`이 박혔다. 화면은 이미
 * 회차별 오버라이드를 우선해 그리고 있었으므로, 로컬과 내보낸 캘린더가 조용히 갈라졌다.
 */
describe('H16b — 반복 할일 내보내기', () => {
  function recurring(overrides: Partial<TaskRow> = {}): TaskRow {
    return {
      id: 't1',
      title: '주간 회의',
      due_date: '2026-08-03', // 월요일
      due_time: '10:00',
      is_recurring: 1,
      recurring_pattern: 'weekly:1',
      ...overrides
    }
  }

  it('반복 할일에 RRULE이 붙는다', () => {
    expect(eventOf(recurring()).rrule).toBe('FREQ=WEEKLY;BYDAY=MO')
  })

  it('반복이 아니면 규칙을 붙이지 않는다', () => {
    expect(eventOf(recurring({ is_recurring: 0 })).rrule).toBeNull()
    expect(eventOf(recurring({ recurring_pattern: null })).rrule).toBeNull()
  })

  it('is_recurring이 0/1 정수여도 읽는다 (DB가 그렇게 준다)', () => {
    expect(eventOf(recurring({ is_recurring: 1 })).rrule).toBe('FREQ=WEEKLY;BYDAY=MO')
    expect(eventOf(recurring({ is_recurring: 0 })).rrule).toBeNull()
  })

  it('없앤 회차는 EXDATE로 나간다', () => {
    const event = taskToEvent(
      recurring({ scheduled_overrides: JSON.stringify({ '2026-08-10': null }) })
    )
    // 로컬 10:00을 UTC로 옮긴 값이어야 한다 — UTC 시각을 로컬 날짜에 붙이면
    // 날짜 경계 근처에서 회차가 하루씩 어긋난다.
    expect(event?.exdates).toEqual([localToIso('2026-08-10', '10:00')])
    expect(event?.overrides).toEqual([])
  })

  it('발생일이 아닌 날의 삭제 표시는 무시한다 — 뺄 것이 없다', () => {
    const event = taskToEvent(
      recurring({ scheduled_overrides: JSON.stringify({ '2026-08-11': null }) }) // 화요일
    )
    expect(event?.exdates).toEqual([])
  })

  it('옮긴 회차는 RECURRENCE-ID 예외로 나간다', () => {
    const event = taskToEvent(
      recurring({
        scheduled_start: '2026-08-03T10:00:00',
        scheduled_end: '2026-08-03T11:00:00',
        scheduled_overrides: JSON.stringify({
          '2026-08-10': { start: '2026-08-10T14:00:00', end: '2026-08-10T15:30:00' }
        })
      })
    )
    expect(event?.overrides).toHaveLength(1)
    expect(event?.overrides[0].start).toBe(new Date('2026-08-10T14:00:00').toISOString())
    expect(event?.overrides[0].end).toBe(new Date('2026-08-10T15:30:00').toISOString())
  })

  it('발생일이 아닌 날로 옮긴 회차는 RDATE로 자리를 만들고 그 자리를 지목한다', () => {
    const event = taskToEvent(
      recurring({
        scheduled_start: '2026-08-03T10:00:00',
        scheduled_end: '2026-08-03T11:00:00',
        // 8/12는 수요일 — 이 반복(월요일)의 발생일이 아니다.
        scheduled_overrides: JSON.stringify({
          '2026-08-12': { start: '2026-08-12T09:00:00', end: '2026-08-12T10:00:00' }
        })
      })
    )
    const moved = new Date('2026-08-12T09:00:00').toISOString()
    expect(event?.rdates).toContain(moved)
    expect(event?.overrides[0].recurrenceId).toBe(moved)
  })

  it('오버라이드는 객체로 와도 읽는다 (렌더러를 거친 값)', () => {
    const event = taskToEvent(recurring({ scheduled_overrides: { '2026-08-10': null } }))
    expect(event?.exdates).toEqual([localToIso('2026-08-10', '10:00')])
  })

  it('망가진 오버라이드는 동기화를 멈추지 않는다', () => {
    for (const broken of ['not json', '[]', '{"2026-08-10":{"start":1}}', null, 42]) {
      expect(() => taskToEvent(recurring({ scheduled_overrides: broken }))).not.toThrow()
    }
  })

  it('클램프되는 달은 RDATE로 메운다 (RRULE이 건너뛰는 자리)', () => {
    const event = taskToEvent(
      recurring({ due_date: '2026-01-31', recurring_pattern: 'monthly:31' })
    )
    expect(event?.rrule).toBe('FREQ=MONTHLY;BYMONTHDAY=31')
    expect(event?.rdates.some((d) => d.startsWith('2026-02-28'))).toBe(true)
  })

  it('종일 반복은 날짜 형식으로 낸다', () => {
    const event = taskToEvent(recurring({ due_time: null, scheduled_overrides: JSON.stringify({ '2026-08-10': null }) }))
    expect(event?.allDay).toBe(true)
    expect(event?.exdates).toEqual(['2026-08-10'])
  })

  it('같은 입력이면 항상 같은 값이다 — 지문이 흔들리면 매번 다시 올린다', () => {
    const t = recurring({ recurring_pattern: 'monthly:31', due_date: '2026-01-31' })
    expect(fingerprint(eventOf(t))).toBe(fingerprint(eventOf(t)))
  })
})

/**
 * 회차를 옮기면 바뀌는 것은 `scheduledOverrides`뿐이고 템플릿의 start/end는 그대로다.
 * 지문이 그 셋만 보던 동안에는 **재업로드를 시도조차 하지 않았다.**
 */
describe('H16b — 지문이 반복 변화를 잡는다', () => {
  const base: TaskRow = {
    id: 't1',
    title: '주간 회의',
    due_date: '2026-08-03',
    due_time: '10:00',
    scheduled_start: '2026-08-03T10:00:00',
    scheduled_end: '2026-08-03T11:00:00',
    is_recurring: 1,
    recurring_pattern: 'weekly:1'
  }

  it('회차를 옮기면 지문이 바뀐다', () => {
    const before = fingerprint(eventOf(base))
    const after = fingerprint(
      eventOf({
        ...base,
        scheduled_overrides: JSON.stringify({
          '2026-08-10': { start: '2026-08-10T14:00:00', end: '2026-08-10T15:00:00' }
        })
      })
    )
    expect(after).not.toBe(before)
  })

  it('회차를 없애도 지문이 바뀐다', () => {
    const before = fingerprint(eventOf(base))
    const after = fingerprint(eventOf({ ...base, scheduled_overrides: JSON.stringify({ '2026-08-10': null }) }))
    expect(after).not.toBe(before)
  })

  it('반복 패턴을 바꾸면 지문이 바뀐다', () => {
    const before = fingerprint(eventOf(base))
    const after = fingerprint(eventOf({ ...base, recurring_pattern: 'weekly:1,3' }))
    expect(after).not.toBe(before)
  })

  it('planSync가 그 변화를 갱신 대상으로 잡는다', () => {
    const event = eventOf(base)
    const state: SyncState = {
      t1: { href: eventHref('https://c/', 't1'), etag: '"v1"', fingerprint: fingerprint(event), sequence: 0 }
    }
    const moved = {
      ...base,
      scheduled_overrides: JSON.stringify({
        '2026-08-10': { start: '2026-08-10T14:00:00', end: '2026-08-10T15:00:00' }
      })
    }
    expect(planSync([moved], state, 'https://c/').updates).toHaveLength(1)
  })
})

/**
 * #11 — **완료한 반복 회차가 자기 몫의 끝없는 RRULE을 계속 내보내던 것.**
 *
 * `toggleTask`는 완료한 행의 반복 플래그를 그대로 둔 채 다음 회차를 **새 행**으로
 * 스폰하고, 완료본을 지우는 경로는 어디에도 없다(`database.ts`). `taskToEvent`가
 * `completed`를 보지 않아, 완료할 때마다 UNTIL도 COUNT도 없는 시리즈가 하나씩 늘었다 —
 * 한 달 쓴 매일 습관은 캘린더의 **모든 날**에 같은 일정 서른 개를 그렸고, 미래로도
 * 끝없이 이어졌다. 화면은 이미 반대로 그린다: `getScheduledForOccurrence`가 완료한
 * 회차를 자기 날짜에만 남긴다. 내보내기만 그 규칙을 못 받았다.
 */
describe('#11 — 완료한 반복 회차', () => {
  function habit(over: Partial<TaskRow> = {}): TaskRow {
    return { id: 'x', title: '운동', is_recurring: 1, recurring_pattern: 'daily', ...over }
  }

  it('규칙이 붙는 것은 살아 있는 회차 하나뿐이다', () => {
    // 나흘 쓴 매일 습관 — 완료본 셋과 오늘 하나.
    const days = [
      habit({ id: 'd22', due_date: '2026-09-22', completed: 1 }),
      habit({ id: 'd23', due_date: '2026-09-23', completed: 1 }),
      habit({ id: 'd24', due_date: '2026-09-24', completed: 1 }),
      habit({ id: 'd25', due_date: '2026-09-25' })
    ]
    const withRule = days.map((t) => ({ id: t.id, rrule: taskToEvent(t)?.rrule ?? null })).filter((e) => e.rrule)
    expect(withRule).toEqual([{ id: 'd25', rrule: 'FREQ=DAILY' }])
  })

  it('완료본은 자기 회차 날짜에 놓인다 — 템플릿 날짜에 쌓이지 않는다', () => {
    // 스폰이 scheduledStart를 그대로 복사하므로 템플릿 날짜는 시리즈가 처음 시작한
    // 날(9/20)에 멈춰 있다. 규칙만 떼고 자리를 안 옮기면 완료본 전부가 그 하루에 겹친다.
    const event = eventOf(
      habit({
        due_date: '2026-09-24',
        completed: 1,
        scheduled_start: '2026-09-20T07:00:00',
        scheduled_end: '2026-09-20T07:30:00'
      })
    )
    expect(event.rrule).toBeNull()
    expect(event.start).toBe(localToIso('2026-09-24', '07:00'))
    expect(event.end).toBe(localToIso('2026-09-24', '07:30'))
  })

  it('옮겨 둔 그 회차의 블록은 완료해도 그대로 간다', () => {
    // 화면이 쓰는 규칙과 같다 — 자기 날짜에 오버라이드가 있으면 그 블록이 이긴다.
    const event = eventOf(
      habit({
        due_date: '2026-09-24',
        completed: 1,
        scheduled_start: '2026-09-20T07:00:00',
        scheduled_end: '2026-09-20T07:30:00',
        scheduled_overrides: JSON.stringify({
          '2026-09-24': { start: '2026-09-24T10:00:00', end: '2026-09-24T11:00:00' }
        })
      })
    )
    expect(event.rrule).toBeNull()
    expect(event.start).toBe(new Date('2026-09-24T10:00:00').toISOString())
    expect(event.end).toBe(new Date('2026-09-24T11:00:00').toISOString())
  })

  it('기한 없이 완료된 반복도 규칙 없이 한 건으로 나간다', () => {
    // 어느 회차인지 지목할 근거가 없어도 시리즈로 내보내면 안 된다.
    const event = eventOf(
      habit({ completed: 1, scheduled_start: '2026-09-20T07:00:00', scheduled_end: '2026-09-20T07:30:00' })
    )
    expect(event.rrule).toBeNull()
  })

  it('이미 올라간 무한 시리즈는 다음 동기화가 한 건짜리로 덮는다', () => {
    // 지문에 rrule이 들어 있으니 고치는 순간 갱신 대상이 된다 — 사용자가 캘린더를
    // 손으로 치울 필요가 없다.
    const done = habit({ id: 'd22', due_date: '2026-09-22', completed: 1 })
    const stale: SyncState[string] = {
      href: eventHref(CALENDAR, 'd22'),
      etag: '"v1"',
      fingerprint: 'RRULE이 있던 시절의 지문',
      sequence: 3
    }
    const plan = planSync([done], { d22: stale }, CALENDAR)
    expect(plan.updates).toHaveLength(1)
    expect(plan.updates[0].event.rrule).toBeNull()
    expect(plan.updates[0].event.sequence).toBe(4)
  })
})

/**
 * 반복 + 시간 블록의 DTSTART가 **템플릿이 얼어붙은 날짜**로 나가던 것.
 *
 * 블록은 시각 템플릿이라 `nextRecurrenceSpawn`이 날짜를 손대지 않고 다음 회차에
 * 물려준다. 화면은 회차마다 날짜를 갈아 끼워 그리는데(`scheduledTime.ts`),
 * 내보내기는 그 얼어붙은 날짜를 그대로 DTSTART에 박았다. RRULE은 DTSTART부터
 * 펼쳐지고 화면은 앵커 이전을 통째로 숨기므로(`occursOn`), 8/1에 잡은 블록 +
 * 9/1 기한인 매일 반복이 iCloud에는 8월 한 달치 **앱에 없는 회차**로 나갔다.
 * 미래 회차에 떨어뜨리면 거울상으로 캘린더 쪽에 구멍이 생겼다.
 */
describe('반복 시간 블록의 DTSTART는 앵커 회차다', () => {
  const drifted: TaskRow = {
    id: 't1',
    title: '아침 스탠드업',
    due_date: '2026-09-01',
    // 블록은 8/1에 잡았고, 완료를 거듭해 기한만 9/1까지 전진했다.
    scheduled_start: '2026-08-01T09:00:00',
    scheduled_end: '2026-08-01T10:00:00',
    is_recurring: 1,
    recurring_pattern: 'daily'
  }

  it('지나간 템플릿 날짜가 아니라 기한 위에 선다', () => {
    const event = eventOf(drifted)
    expect(event.start).toBe(localToIso('2026-09-01', '09:00'))
    expect(event.end).toBe(localToIso('2026-09-01', '10:00'))
  })

  it('미래 회차에 떨어뜨린 블록도 앵커로 돌아온다', () => {
    const event = eventOf({
      ...drifted,
      scheduled_start: '2026-09-10T09:00:00',
      scheduled_end: '2026-09-10T10:00:00'
    })
    expect(event.start).toBe(localToIso('2026-09-01', '09:00'))
  })

  it('블록 날짜가 기한과 같으면 아무것도 움직이지 않는다', () => {
    const same = { ...drifted, scheduled_start: '2026-09-01T09:00:00', scheduled_end: '2026-09-01T10:00:00' }
    expect(eventOf(same).start).toBe(localToIso('2026-09-01', '09:00'))
    expect(eventOf(same).end).toBe(localToIso('2026-09-01', '10:00'))
  })

  it('반복이 아니면 블록이 잡힌 날 그대로 나간다 — 시각 템플릿이 아니다', () => {
    expect(eventOf({ ...drifted, is_recurring: 0 }).start).toBe(new Date('2026-08-01T09:00:00').toISOString())
  })

  it('기간 있는 종일 반복은 건드리지 않는다 — start는 시각이 아니라 기간의 시작일이다', () => {
    const ranged = eventOf({
      id: 't1',
      title: '분기 보고',
      due_date: '2026-09-01',
      start_date: '2026-08-30',
      is_recurring: 1,
      recurring_pattern: 'monthly:1'
    })
    expect(ranged.allDay).toBe(true)
    expect(ranged.start).toBe('2026-08-30')
  })

  it('자정을 넘는 블록은 길이를 지켜 옮긴다 — DTEND가 앞서면 서버가 통째로 거부한다', () => {
    const overnight = eventOf({
      ...drifted,
      scheduled_start: '2026-08-01T23:00:00',
      scheduled_end: '2026-08-02T01:00:00'
    })
    expect(overnight.start).toBe(localToIso('2026-09-01', '23:00'))
    expect(new Date(overnight.end).getTime()).toBeGreaterThan(new Date(overnight.start).getTime())
    expect(overnight.end).toBe(localToIso('2026-09-02', '01:00'))
  })
})

/**
 * 서머타임 경계 — 앵커와 예외가 서로 다른 UTC 오프셋에 놓일 때.
 *
 * 반복 시리즈를 UTC(`...Z`)로 적으면 RRULE이 "같은 UTC 순간"을 반복한다. 전환일
 * 이후의 09:00 회차가 전부 10:00으로 밀리고, `stampFor`가 날짜마다 로컬로 계산하는
 * EXDATE/RECURRENCE-ID는 그 회차를 한 시간 빗나가 아무것도 지목하지 못한다 —
 * 지운 회차는 캘린더에 남고, 옮긴 회차는 원본과 나란히 두 번 보인다.
 *
 * `vitest.config.ts`의 'west'(America/New_York)에서 실제로 프레임이 갈라진다.
 * Asia/Seoul은 DST가 없어 어긋남이 가려지므로, **이 파일이 TZ_SENSITIVE에 올라
 * 있어야** 회귀가 양쪽에서 잡힌다.
 */
describe('서머타임 경계의 반복 시리즈', () => {
  const NOW = '2026-03-01T00:00:00.000Z'
  const standup = (overrides: Partial<TaskRow> = {}): TaskRow =>
    task({
      is_recurring: 1,
      recurring_pattern: 'daily',
      due_date: '2026-03-01',
      due_time: '09:00',
      ...overrides
    })
  const lineOf = (ics: string, name: string): string =>
    ics.split('\r\n').find((l) => l.startsWith(`${name}:`)) ?? ''
  const icsOf = (t: TaskRow): string => serializeEvent(taskToEvent(t)!, NOW)

  it('DTSTART를 UTC로 적지 않는다 — 적으면 전환 뒤 09:00 회차가 10:00에 뜬다', () => {
    expect(lineOf(icsOf(standup()), 'DTSTART')).toBe('DTSTART:20260301T090000')
  })

  it('EXDATE가 규칙이 만드는 회차와 같은 자리에 선다 (지운 회차가 캘린더에 남던 버그)', () => {
    const ics = icsOf(standup({ scheduled_overrides: JSON.stringify({ '2026-03-10': null }) }))
    expect(lineOf(ics, 'EXDATE')).toBe('EXDATE:20260310T090000')
  })

  it('RECURRENCE-ID도 같은 자리에 선다 (옮긴 회차가 두 번 보이던 버그)', () => {
    const ics = icsOf(
      standup({
        scheduled_overrides: JSON.stringify({
          '2026-03-12': { start: '2026-03-12T14:00', end: '2026-03-12T15:00' }
        })
      })
    )
    expect(lineOf(ics, 'RECURRENCE-ID')).toBe('RECURRENCE-ID:20260312T090000')
  })
})


/**
 * **날짜로 못 읽는 값 하나가 동기화 전체를 멈추지 않는다.**
 *
 * `withRecurrence`가 변환을 먼저 하고 유한성 검사를 나중에 해서, 가드가 영영
 * 실행되지 않는 죽은 코드였다 — `new Date('nope').toISOString()`이 먼저 던졌다.
 * 그 예외는 `planSync`를 뚫고 나가 CalDAV·Google 동기화를 통째로 죽였고,
 * `calendar:sync-now`는 "알 수 없는 오류"만 보여 어느 할일인지도 알 수 없었다.
 * IPC 검증은 이 값들을 막지 않는다 — `validate.ts`는 오버라이드의 start/end가
 * 문자열인지만 보고, due_time·scheduled_start는 아예 안 본다. `database.ts`의
 * 부팅 복구도 due_date/start_date만 고치고 이 세 열은 그대로 둔다.
 *
 * 위의 '망가진 오버라이드는 동기화를 멈추지 않는다'는 **모양**이 틀린 값만 봤다
 * (숫자·배열·JSON 아님). 그건 parseOverrides가 미리 걸러 이 자리까지 오지도 않는다.
 * 날짜로 안 읽히는 **문자열**이 빠져 있던 구멍이다.
 */
describe('날짜로 못 읽는 시간값은 그 회차만 버린다', () => {
  function recurring(overrides: Partial<TaskRow> = {}): TaskRow {
    return {
      id: 't1',
      title: '주간 회의',
      due_date: '2026-08-03', // 월요일
      due_time: '10:00',
      is_recurring: 1,
      recurring_pattern: 'weekly:1',
      ...overrides
    }
  }

  it('오버라이드의 start/end가 날짜가 아니면 그 회차만 버린다', () => {
    const broken = JSON.stringify({ '2026-08-10': { start: 'nope', end: 'nope' } })
    const event = taskToEvent(recurring({ scheduled_overrides: broken }))
    expect(event?.rrule).toBe('FREQ=WEEKLY;BYDAY=MO')
    expect(event?.overrides).toEqual([])
  })

  it('망가진 행 하나가 나머지 할일의 동기화를 막지 않는다', () => {
    const bad = recurring({
      id: 'bad',
      scheduled_overrides: JSON.stringify({ '2026-08-10': { start: 'nope', end: 'nope' } })
    })
    const good: TaskRow = { id: 'good', title: '장보기', due_date: '2026-08-05' }
    const plan = planSync([bad, good], {} as SyncState, CALENDAR)
    expect(plan.creates.map((c) => c.taskId).sort()).toEqual(['bad', 'good'])
  })

  it('scheduled_start가 날짜가 아니면 마감일 규칙으로 흘러간다', () => {
    const event = taskToEvent({
      id: 't2',
      title: '망가진 블록',
      scheduled_start: 'nope',
      scheduled_end: 'nope',
      due_date: '2026-08-05',
      due_time: '09:00'
    })
    expect(event?.start).toBe(localToIso('2026-08-05', '09:00'))
  })

  it('망가진 블록에 마감일도 없으면 null — 캘린더에 놓을 자리가 없다', () => {
    expect(
      taskToEvent({ id: 't3', title: 'x', scheduled_start: 'nope', scheduled_end: 'nope' })
    ).toBeNull()
  })

  it('due_time이 시각 모양이 아니면 종일로 낸다', () => {
    const event = taskToEvent({ id: 't4', title: 'x', due_date: '2026-08-05', due_time: 'nope' })
    expect(event?.allDay).toBe(true)
    expect(event?.start).toBe('2026-08-05')
  })

  it('망가진 scheduled_start로도 회차 스탬프를 찍는다 (due_time으로 내려간다)', () => {
    const event = taskToEvent(
      recurring({ scheduled_start: 'nope', scheduled_overrides: JSON.stringify({ '2026-08-10': null }) })
    )
    expect(event?.exdates).toEqual([localToIso('2026-08-10', '10:00')])
  })

  it('끝만 망가진 블록도 앵커로 옮긴다 — reanchor가 그 값을 시각으로 믿으면 던진다', () => {
    // slice(11,16)이 'zzzzz'라 시작 시각보다 "커서", 검사가 없으면 그대로
    // localToIso로 들어가 Invalid Date가 된다.
    const event = taskToEvent(
      recurring({ scheduled_start: '2026-08-01T09:00:00', scheduled_end: 'zzzzzzzzzzzzzzzz' })
    )
    expect(event?.start).toBe(localToIso('2026-08-03', '09:00'))
    expect(new Date(event!.end).getTime()).toBeGreaterThan(new Date(event!.start).getTime())
  })
})
