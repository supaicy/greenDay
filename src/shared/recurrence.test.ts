import { describe, it, expect } from 'vitest'
import { occursOn, toRRule, parseWeeklyDays, parseYearlyMonthDay } from './recurrence'

/**
 * 렌더러의 쌍둥이 구현(`renderer/src/utils/recurrence.ts`)과의 대조.
 *
 * **여기서 직접 import할 수 없다.** `src/shared`는 node·web 두 tsconfig 프로젝트에
 * 모두 들어가는데, node 쪽은 renderer를 포함하지 않아 `tsc --build`가 거부한다.
 * 그래서 이 포팅은 일회성으로 대조해 확인했다 — 패턴 10종 × 앵커 4종 × 730일
 * (29,200건) 전부 같은 답이었다. 아래 표가 그 규칙을 이 파일 안에서 다시 못 박는다.
 *
 * 항구적인 드리프트 방지는 렌더러를 이 모듈로 이관하는 것이고, 그 파일은 다른
 * 워크트리 소유라 후속 작업으로 남긴다.
 */

describe('parseWeeklyDays', () => {
  it('요일 목록을 숫자로 읽는다', () => {
    expect(parseWeeklyDays('weekly:1,3,5')).toEqual([1, 3, 5])
  })

  it('요일을 하나도 안 고른 weekly:는 빈 배열이다 (일요일 반복으로 둔갑하지 않는다)', () => {
    expect(parseWeeklyDays('weekly:')).toEqual([])
  })

  it('범위를 벗어난 값은 버린다', () => {
    expect(parseWeeklyDays('weekly:0,7,-1,3')).toEqual([0, 3])
  })
})

describe('parseYearlyMonthDay', () => {
  it('0을 채우지 않은 패턴도 숫자로 읽는다', () => {
    expect(parseYearlyMonthDay('yearly:7-21')).toEqual([6, 21])
  })

  it('형태가 아니면 null', () => {
    expect(parseYearlyMonthDay('yearly:7')).toBeNull()
  })
})

describe('occursOn', () => {
  it('앵커는 패턴과 무관하게 발생일이다', () => {
    // 2026-08-03은 월요일. 화요일 반복이어도 앵커 자신은 그 할일의 회차다.
    expect(occursOn('weekly:2', '2026-08-03', '2026-08-03')).toBe(true)
  })

  it('앵커 이전은 발생일이 아니다', () => {
    expect(occursOn('daily', '2026-08-03', '2026-08-02')).toBe(false)
  })

  it('monthly는 없는 날을 말일로 당긴다', () => {
    expect(occursOn('monthly:31', '2026-01-31', '2026-02-28')).toBe(true)
    expect(occursOn('monthly:31', '2026-01-31', '2026-03-31')).toBe(true)
    expect(occursOn('monthly:31', '2026-01-31', '2026-03-30')).toBe(false)
  })

  it('yearly 2/29는 평년에 2/28로 당긴다', () => {
    expect(occursOn('yearly:2-29', '2024-02-29', '2026-02-28')).toBe(true)
    expect(occursOn('yearly:2-29', '2024-02-29', '2028-02-29')).toBe(true)
  })
})

describe('toRRule', () => {
  it('daily', () => {
    expect(toRRule('daily', '2026-08-03')).toEqual({ rrule: 'FREQ=DAILY', extraDates: [] })
  })

  it('weekly는 요일을 BYDAY로 낸다', () => {
    expect(toRRule('weekly:1,3,5', '2026-08-03').rrule).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR')
    expect(toRRule('weekly:0,6', '2026-08-03').rrule).toBe('FREQ=WEEKLY;BYDAY=SU,SA')
  })

  it('요일을 하나도 안 고른 weekly:는 규칙이 없다 (앵커 하나짜리 일정)', () => {
    expect(toRRule('weekly:', '2026-08-03')).toEqual({ rrule: null, extraDates: [] })
  })

  it('monthly 28일 이하는 나머지가 없다 — 모든 달에 있는 날이다', () => {
    expect(toRRule('monthly:15', '2026-08-03')).toEqual({ rrule: 'FREQ=MONTHLY;BYMONTHDAY=15', extraDates: [] })
  })

  /**
   * 이 앱의 monthly:31은 "31일, 없으면 말일"인데 RFC의 BYMONTHDAY=31은 짧은 달을
   * **건너뛴다.** 그 차이를 메우지 않으면 앱은 2월 28일에 회차를 보여 주는데
   * 사용자의 캘린더에는 아무것도 없다.
   */
  it('monthly 29일 이상은 클램프되는 달을 RDATE로 메운다', () => {
    const { rrule, extraDates } = toRRule('monthly:31', '2026-01-31', 1)
    expect(rrule).toBe('FREQ=MONTHLY;BYMONTHDAY=31')
    // 2026년: 2·4·6·9·11월에 31일이 없다.
    expect(extraDates).toContain('2026-02-28')
    expect(extraDates).toContain('2026-04-30')
    expect(extraDates).toContain('2026-06-30')
    expect(extraDates).toContain('2026-09-30')
    expect(extraDates).toContain('2026-11-30')
    expect(extraDates).not.toContain('2026-03-31')
  })

  it('monthly 30일은 2월만 메운다', () => {
    // horizonYears=1 → 앵커 달부터 12달(2026-01 … 2026-12).
    expect(toRRule('monthly:30', '2026-01-30', 1).extraDates).toEqual(['2026-02-28'])
    expect(toRRule('monthly:30', '2026-01-30', 2).extraDates).toEqual(['2026-02-28', '2027-02-28'])
  })

  it('yearly 2/29는 평년만 메운다', () => {
    const { rrule, extraDates } = toRRule('yearly:2-29', '2024-02-29', 4)
    expect(rrule).toBe('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29')
    expect(extraDates).toEqual(['2025-02-28', '2026-02-28', '2027-02-28'])
    // 윤년은 규칙이 그대로 맞힌다.
    expect(extraDates).not.toContain('2028-02-29')
  })

  it('yearly 평범한 날짜는 나머지가 없다', () => {
    expect(toRRule('yearly:7-21', '2026-07-21')).toEqual({
      rrule: 'FREQ=YEARLY;BYMONTH=7;BYMONTHDAY=21',
      extraDates: []
    })
  })

  it('앵커 자신은 나머지에 넣지 않는다 — DTSTART가 이미 담당한다', () => {
    const { extraDates } = toRRule('monthly:31', '2026-02-28', 1)
    expect(extraDates).not.toContain('2026-02-28')
  })

  it('알 수 없는 패턴은 규칙이 없다', () => {
    expect(toRRule('nonsense', '2026-08-03')).toEqual({ rrule: null, extraDates: [] })
    expect(toRRule(null, '2026-08-03')).toEqual({ rrule: null, extraDates: [] })
  })

  it('같은 입력이면 항상 같은 값이다 — 지문이 시각에 흔들리면 매번 다시 올린다', () => {
    expect(toRRule('monthly:31', '2026-01-31')).toEqual(toRRule('monthly:31', '2026-01-31'))
  })
})
