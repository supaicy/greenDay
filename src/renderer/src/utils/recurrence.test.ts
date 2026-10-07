import { describe, it, expect } from 'vitest'
import { nextRecurringDate, shiftIsoByDays, daysBetween, nextRecurrenceSpawn } from './recurrence'

describe('nextRecurringDate', () => {
  // ── daily ──────────────────────────────────────────────
  it('daily: 하루 뒤 날짜 반환', () => {
    expect(nextRecurringDate('daily', '2026-07-21')).toBe('2026-07-22')
  })

  it('daily: 월말 → 다음 달 1일', () => {
    expect(nextRecurringDate('daily', '2026-07-31')).toBe('2026-08-01')
  })

  it('daily: 12월 31일 → 다음 해 1월 1일', () => {
    expect(nextRecurringDate('daily', '2026-12-31')).toBe('2027-01-01')
  })

  // ── weekly ─────────────────────────────────────────────
  it('weekly: 단일 요일 — 다음 월요일(1) 반환', () => {
    // 2026-07-21 화요일(2) → 다음 월요일(1)은 2026-07-27
    expect(nextRecurringDate('weekly:1', '2026-07-21')).toBe('2026-07-27')
  })

  it('weekly: 복수 요일 — 가장 가까운 다음 날짜', () => {
    // 2026-07-21 화요일(2) → weekly:1,3,5 → 다음은 수(3) 2026-07-22
    expect(nextRecurringDate('weekly:1,3,5', '2026-07-21')).toBe('2026-07-22')
  })

  it('weekly: 주 내 마지막 요일이면 다음 주로 넘어감', () => {
    // 2026-07-24 금요일(5) → weekly:1,3,5 → 다음은 월(1) 2026-07-27
    expect(nextRecurringDate('weekly:1,3,5', '2026-07-24')).toBe('2026-07-27')
  })

  it('weekly: 일요일(0) 포함 시 주 경계 처리', () => {
    // 2026-07-25 토요일(6) → weekly:0 → 다음 일요일(0) 2026-07-26
    expect(nextRecurringDate('weekly:0', '2026-07-25')).toBe('2026-07-26')
  })

  it('weekly: from 요일과 동일한 날은 건너뜀 (strictly after)', () => {
    // 2026-07-21 화요일(2) → weekly:2 → 다음 화요일 2026-07-28
    expect(nextRecurringDate('weekly:2', '2026-07-21')).toBe('2026-07-28')
  })

  // ── monthly ────────────────────────────────────────────
  it('monthly: 다음 달 해당일 반환', () => {
    expect(nextRecurringDate('monthly:15', '2026-07-21')).toBe('2026-08-15')
  })

  it('monthly: 패딩 없는 숫자 — monthly:5', () => {
    expect(nextRecurringDate('monthly:5', '2026-07-21')).toBe('2026-08-05')
  })

  it('monthly: 12월이면 다음 해 1월', () => {
    // 기준일은 10일을 지난 날이어야 한다. 12/05를 쓰면 같은 달 12/10이 아직
    // 남아 있어 연 경계가 아니라 '같은 달에 남은 회차'를 검사하게 된다.
    expect(nextRecurringDate('monthly:10', '2026-12-15')).toBe('2027-01-10')
  })

  // ── yearly ─────────────────────────────────────────────
  it('yearly: 내년 같은 월일 반환', () => {
    expect(nextRecurringDate('yearly:07-21', '2026-07-21')).toBe('2027-07-21')
  })

  it('yearly: 올해 그 월일이 이미 지났으면 내년', () => {
    expect(nextRecurringDate('yearly:01-01', '2026-07-21')).toBe('2027-01-01')
  })

  it('yearly: 패딩 없는 월일 — yearly:7-21', () => {
    expect(nextRecurringDate('yearly:7-21', '2026-07-21')).toBe('2027-07-21')
  })

  // ── 인식 불가 패턴 ──────────────────────────────────────
  it('unknown pattern: null 반환', () => {
    expect(nextRecurringDate('biweekly', '2026-07-21')).toBeNull()
  })

  it('빈 문자열: null 반환', () => {
    expect(nextRecurringDate('', '2026-07-21')).toBeNull()
  })
})

describe('shiftIsoByDays', () => {
  it('날짜만 있을 때 N일 이동', () => {
    expect(shiftIsoByDays('2026-07-21', 3)).toBe('2026-07-24')
  })

  it('시간 부분 보존', () => {
    expect(shiftIsoByDays('2026-07-21T09:00:00.000Z', 3)).toBe('2026-07-24T09:00:00.000Z')
  })

  it('월 경계 넘김', () => {
    expect(shiftIsoByDays('2026-07-30', 5)).toBe('2026-08-04')
  })

  it('연 경계 넘김', () => {
    expect(shiftIsoByDays('2026-12-30', 5)).toBe('2027-01-04')
  })

  it('음수 이동', () => {
    expect(shiftIsoByDays('2026-07-21', -10)).toBe('2026-07-11')
  })
})

describe('daysBetween', () => {
  it('같은 날 → 0', () => {
    expect(daysBetween('2026-07-21', '2026-07-21')).toBe(0)
  })

  it('순방향 7일 차이', () => {
    expect(daysBetween('2026-07-21', '2026-07-28')).toBe(7)
  })

  it('역방향 → 음수', () => {
    expect(daysBetween('2026-07-28', '2026-07-21')).toBe(-7)
  })

  it('월 경계 넘김', () => {
    expect(daysBetween('2026-07-28', '2026-08-04')).toBe(7)
  })

  it('연 경계 넘김', () => {
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
  })
})

// 반복 발생일 판정 — 캘린더가 시간블록 템플릿을 어느 날에 그릴지 결정한다.
describe('occursOn', () => {
  it('daily: every day from the anchor onward', async () => {
    const { occursOn } = await import('./recurrence')
    expect(occursOn('daily', '2026-08-10', '2026-08-10')).toBe(true)
    expect(occursOn('daily', '2026-08-10', '2026-08-20')).toBe(true)
    expect(occursOn('daily', '2026-08-10', '2026-08-09')).toBe(false)
  })

  it('weekly: only listed weekdays', async () => {
    const { occursOn } = await import('./recurrence')
    expect(occursOn('weekly:1,3', '2026-08-10', '2026-08-17')).toBe(true) // 월
    expect(occursOn('weekly:1,3', '2026-08-10', '2026-08-12')).toBe(true) // 수
    expect(occursOn('weekly:1,3', '2026-08-10', '2026-08-18')).toBe(false) // 화
  })

  it('monthly and yearly: matching day only', async () => {
    const { occursOn } = await import('./recurrence')
    expect(occursOn('monthly:15', '2026-08-15', '2026-09-15')).toBe(true)
    expect(occursOn('monthly:15', '2026-08-15', '2026-09-16')).toBe(false)
    expect(occursOn('yearly:08-15', '2026-08-15', '2027-08-15')).toBe(true)
    expect(occursOn('yearly:08-15', '2026-08-15', '2027-08-16')).toBe(false)
  })

  it('the instance own dueDate always counts, even off-pattern', async () => {
    const { occursOn } = await import('./recurrence')
    expect(occursOn('weekly:1', '2026-08-12', '2026-08-12')).toBe(true) // 수 anchor, 월 패턴
  })

  it('is permissive for unparseable patterns (legacy data)', async () => {
    const { occursOn } = await import('./recurrence')
    expect(occursOn('weekly', null, '2026-08-18')).toBe(true)
  })
})

// 요일을 하나도 안 고르고 '매주'를 적용하면 패턴이 'weekly:'가 된다. 이 값은
// (a) 표시에서 Number('')=0 → '일'로 읽혀 고른 적 없는 일요일 반복을 주장했고,
// (b) nextRecurringDate가 null이라 다음 회차가 영영 생기지 않는다.
describe('빈 weekly 패턴', () => {
  it('없는 요일을 지어내지 않는다', async () => {
    const { formatRecurringPattern } = await import('./recurrence')
    const label = formatRecurringPattern('weekly:')
    expect(label).not.toContain('일')
  })

  it('발생일 판정이 아무 날이나 참이라고 하지 않는다', async () => {
    const { occursOn } = await import('./recurrence')
    // 요일이 비었으면 '매주'로 볼 근거가 없다 — 자기 dueDate만 발생일.
    expect(occursOn('weekly:', '2026-08-10', '2026-08-10')).toBe(true)
    // 8/16은 일요일 — Number('')=0을 요일 0으로 읽으면 여기서 참이 된다.
    expect(occursOn('weekly:', '2026-08-10', '2026-08-16')).toBe(false)
    expect(occursOn('weekly:', '2026-08-10', '2026-08-17')).toBe(false)
  })
})

// 월말·윤년 넘침. formatDate가 new Date(y,m,d)로 정규화하므로 2월 31일은 3월 3일이
// 되고, 그 값이 다음 회차의 기준일이 되어 드리프트가 영구히 쌓인다.
describe('월말/윤년 넘침', () => {
  it('monthly:31은 그 달의 말일로 잡힌다', async () => {
    const { nextRecurringDate } = await import('./recurrence')
    expect(nextRecurringDate('monthly:31', '2026-01-31')).toBe('2026-02-28')
    expect(nextRecurringDate('monthly:31', '2026-03-31')).toBe('2026-04-30')
    expect(nextRecurringDate('monthly:30', '2026-01-30')).toBe('2026-02-28')
  })

  it('윤년 생일(yearly:02-29)은 평년에 2월 말일로 잡힌다', async () => {
    const { nextRecurringDate } = await import('./recurrence')
    expect(nextRecurringDate('yearly:02-29', '2028-02-29')).toBe('2029-02-28')
  })
})

// 픽커는 yearly:7-21처럼 0을 채우지 않고 만든다. 발생일 판정이 문자열 비교라
// 1~9월 매년 반복은 늘 false였다 — 블록이 기준일 말고는 아무 데도 안 그려졌다.
describe('yearly 패턴의 0 채움', () => {
  it('패딩 없는 패턴도 발생일로 인식한다', async () => {
    const { occursOn } = await import('./recurrence')
    expect(occursOn('yearly:7-21', '2026-07-21', '2027-07-21')).toBe(true)
    expect(occursOn('yearly:07-21', '2026-07-21', '2027-07-21')).toBe(true)
    expect(occursOn('yearly:7-21', '2026-07-21', '2027-07-22')).toBe(false)
  })

  it('다음 발생일 계산도 패딩 없는 패턴을 받는다', async () => {
    const { nextRecurringDate } = await import('./recurrence')
    expect(nextRecurringDate('yearly:7-21', '2026-07-21')).toBe('2027-07-21')
  })
})

// 오래 밀린 반복은 완료해도 계속 연체로 스폰됐다(1월 기한을 8월에 완료하면
// 다음 회차가 1월 2일). 따라잡으려면 수백 번 완료해야 했다.
describe('밀린 반복 따라잡기', () => {
  it('다음 회차는 오늘 이후로 잡힌다', async () => {
    const { nextRecurringDate } = await import('./recurrence')
    const next = nextRecurringDate('daily', '2026-01-01', '2026-08-16')
    expect(next).toBe('2026-08-17')
  })

  it('밀리지 않은 반복은 그대로 다음 칸이다', async () => {
    const { nextRecurringDate } = await import('./recurrence')
    expect(nextRecurringDate('daily', '2026-08-16', '2026-08-16')).toBe('2026-08-17')
    expect(nextRecurringDate('weekly:1', '2026-08-17', '2026-08-16')).toBe('2026-08-24')
  })
})

// nextRecurringDate는 monthly:31을 말일로 당기는데 occursOn은 d === day라
// 그날을 발생일로 보지 않았다 — 스포너가 만든 날짜에 블록이 안 그려진다.
describe('occursOn monthly 말일 클램프', () => {
  it('스포너가 잡는 날짜를 발생일로 인정한다', async () => {
    const { occursOn, nextRecurringDate } = await import('./recurrence')
    const next = nextRecurringDate('monthly:31', '2026-01-31')
    expect(next).toBe('2026-02-28')
    expect(occursOn('monthly:31', '2026-01-31', next as string)).toBe(true)
    expect(occursOn('monthly:31', '2026-01-31', '2026-03-31')).toBe(true)
    expect(occursOn('monthly:31', '2026-01-31', '2026-03-30')).toBe(false)
  })
})

// 리마인더는 UTC 순간(toISOString)으로 저장된다. 날짜 문자열만 밀고 시간 부분을
// 그대로 두면 UTC 시각이 보존돼, 서머타임을 건너는 순간 사용자가 보는 로컬
// 시각이 한 시간 어긋난다. 벽시계 시각을 보존해야 한다.
describe('shiftInstantByDays — 리마인더 이동', () => {
  it('로컬 벽시계 시각을 보존한다', async () => {
    const { shiftInstantByDays } = await import('./recurrence')
    // 실행 시간대(테스트는 Asia/Seoul 고정)에서 09:00인 순간을 만든다
    const at9 = new Date(2026, 2, 7, 9, 0, 0).toISOString()
    const next = shiftInstantByDays(at9, 1)
    const d = new Date(next)
    expect(d.getHours()).toBe(9)
    expect(d.getMinutes()).toBe(0)
    expect(d.getDate()).toBe(8)
  })

  it('여러 날을 건너도 시각이 유지된다', async () => {
    const { shiftInstantByDays } = await import('./recurrence')
    const at730 = new Date(2026, 0, 31, 7, 30, 0).toISOString()
    const d = new Date(shiftInstantByDays(at730, 30))
    expect([d.getHours(), d.getMinutes()]).toEqual([7, 30])
  })
})

describe('nextRecurrenceSpawn — 기간', () => {
  it('시작일도 다음 회차로 함께 옮긴다', () => {
    // 기간이 붙은 반복(예: 8/17~8/19 스프린트 회고)을 완료하면, 다음 회차가
    // 시작일을 잃고 하루짜리가 됐다 — 화면에도 캘린더에도 흔적이 남지 않는다.
    const spawn = nextRecurrenceSpawn(
      {
        title: '주간 회고',
        listId: 'inbox',
        dueDate: '2026-08-19',
        startDate: '2026-08-17',
        dueTime: null,
        priority: 'none',
        tags: [],
        reminderAt: null,
        isRecurring: true,
        recurringPattern: 'weekly:3',
        scheduledStart: null,
        scheduledEnd: null,
        scheduledOverrides: null
      } as never,
      [],
      '2026-08-19'
    )
    expect(spawn?.dueDate).toBe('2026-08-26')
    // 기간의 길이(2일)는 유지된다.
    expect(spawn?.startDate).toBe('2026-08-24')
  })

  it('시작일이 없으면 만들지 않는다', () => {
    const spawn = nextRecurrenceSpawn(
      {
        title: '물주기',
        listId: 'inbox',
        dueDate: '2026-08-19',
        startDate: null,
        dueTime: null,
        priority: 'none',
        tags: [],
        reminderAt: null,
        isRecurring: true,
        recurringPattern: 'daily',
        scheduledStart: null,
        scheduledEnd: null,
        scheduledOverrides: null
      } as never,
      [],
      '2026-08-19'
    )
    expect(spawn?.startDate ?? null).toBeNull()
  })
})

describe('nextRecurrenceSpawn — 고정', () => {
  it('고정한 반복은 다음 회차도 고정으로 남는다', () => {
    // 고정은 "이걸 계속 위에 두겠다"는 뜻이다. 완료할 때마다 풀리면 매번 다시
    // 고정해야 한다.
    const spawn = nextRecurrenceSpawn(
      {
        title: '약 먹기',
        listId: 'inbox',
        dueDate: '2026-08-19',
        startDate: null,
        pinned: true,
        dueTime: null,
        priority: 'none',
        tags: [],
        reminderAt: null,
        isRecurring: true,
        recurringPattern: 'daily',
        scheduledStart: null,
        scheduledEnd: null,
        scheduledOverrides: null
      } as never,
      [],
      '2026-08-19'
    )
    expect(spawn?.pinned).toBe(true)
  })
})

// 픽커의 '매월 N일'·'매년 M월 D일'은 마감일과 무관하게 정해진다(기본값 1일 / 1월 1일).
// 그래서 마감일보다 뒤에 있는 회차가 같은 달·같은 해 안에 남아 있는 일이 흔하다.
// 다음 회차를 무조건 한 주기 뒤로 잡던 시절에는 그 회차가 통째로 사라졌다 —
// occursOn과 내보낸 RRULE은 그 날에 블록을 그리는데 정작 그 날 할 일만 없었다
// (매년 반복이면 1년치가 조용히 사라진다).
describe('같은 주기 안에 남은 회차', () => {
  it('monthly: 9/10 마감에 매월 28일이면 다음은 이번 달 28일이다', async () => {
    const { occursOn, nextRecurringDate } = await import('./recurrence')
    const next = nextRecurringDate('monthly:28', '2026-09-10')
    expect(next).toBe('2026-09-28')
    // 스포너와 캘린더가 같은 날을 가리켜야 한다.
    expect(occursOn('monthly:28', '2026-09-10', next as string)).toBe(true)
  })

  it('monthly: 그 달에 없는 날은 같은 달 말일로 당긴다', async () => {
    const { occursOn, nextRecurringDate } = await import('./recurrence')
    const next = nextRecurringDate('monthly:31', '2026-02-15')
    expect(next).toBe('2026-02-28')
    expect(occursOn('monthly:31', '2026-02-15', next as string)).toBe(true)
  })

  it('monthly: 이미 지난 날이면 다음 달로 넘어간다', async () => {
    const { nextRecurringDate } = await import('./recurrence')
    expect(nextRecurringDate('monthly:10', '2026-09-10')).toBe('2026-10-10')
    expect(nextRecurringDate('monthly:5', '2026-09-10')).toBe('2026-10-05')
  })

  it('yearly: 9/25 마감에 매년 12월 25일이면 올해 12월 25일이다', async () => {
    const { occursOn, nextRecurringDate } = await import('./recurrence')
    const next = nextRecurringDate('yearly:12-25', '2026-09-25')
    expect(next).toBe('2026-12-25')
    expect(occursOn('yearly:12-25', '2026-09-25', next as string)).toBe(true)
  })

  it('yearly: 같은 달 안에서는 날짜까지 비교한다', async () => {
    const { nextRecurringDate } = await import('./recurrence')
    expect(nextRecurringDate('yearly:9-28', '2026-09-25')).toBe('2026-09-28')
    expect(nextRecurringDate('yearly:9-20', '2026-09-25')).toBe('2027-09-20')
  })
})
