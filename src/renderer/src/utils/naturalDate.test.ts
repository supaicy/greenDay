import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseNaturalDateTime } from './naturalDate'

// date-fns의 날짜 계산을 위해 현재 날짜를 고정
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-03-25T09:00:00'))
})

describe('parseNaturalDateTime', () => {
  describe('상대 날짜', () => {
    it('"오늘" → 오늘 날짜', () => {
      const result = parseNaturalDateTime('오늘 회의')
      expect(result).not.toBeNull()
      expect(result?.date).toBe('2026-03-25')
    })

    it('"내일" → 내일 날짜', () => {
      const result = parseNaturalDateTime('내일 장보기')
      expect(result).not.toBeNull()
      expect(result?.date).toBe('2026-03-26')
    })

    it('"모레" → 2일 후', () => {
      const result = parseNaturalDateTime('모레 약속')
      expect(result).not.toBeNull()
      expect(result?.date).toBe('2026-03-27')
    })
  })

  describe('시간 표현 (날짜 없이 시간만 입력하면 null)', () => {
    it('"오후3시30분"만 입력 → null (날짜가 없으면 파싱 안 됨)', () => {
      const result = parseNaturalDateTime('오후3시30분')
      expect(result).toBeNull()
    })

    it('"오늘 오후3시30분" → 오늘 + 15:30', () => {
      const result = parseNaturalDateTime('오늘 오후3시30분')
      expect(result).not.toBeNull()
      expect(result?.date).toBe('2026-03-25')
      expect(result?.time).toBe('15:30')
    })

    it('"오늘 14시50분" → 오늘 + 14:50', () => {
      const result = parseNaturalDateTime('오늘 14시50분')
      expect(result).not.toBeNull()
      expect(result?.time).toBe('14:50')
    })
  })

  describe('날짜 + 시간 결합', () => {
    it('"내일 14시50분" → 내일 날짜 + 14:50', () => {
      const result = parseNaturalDateTime('내일 14시50분')
      expect(result).not.toBeNull()
      expect(result?.date).toBe('2026-03-26')
      expect(result?.time).toBe('14:50')
    })

    it('"내일 오후3시" → 내일 날짜 + 15:00', () => {
      const result = parseNaturalDateTime('내일 오후3시')
      expect(result).not.toBeNull()
      expect(result?.date).toBe('2026-03-26')
      expect(result?.time).toBe('15:00')
    })
  })

  describe('인식 불가', () => {
    it('날짜 없는 입력 → null', () => {
      const result = parseNaturalDateTime('장보기')
      expect(result).toBeNull()
    })
  })

  describe('consumed 토큰 수', () => {
    it('"내일 장보기"에서 1개 토큰 consumed', () => {
      const result = parseNaturalDateTime('내일 장보기')
      expect(result).not.toBeNull()
      expect(result?.consumed).toBe(1)
    })

    it('"내일 14시50분 회의"에서 2개 토큰 consumed', () => {
      const result = parseNaturalDateTime('내일 14시50분 회의')
      expect(result).not.toBeNull()
      expect(result?.consumed).toBe(2)
    })
  })

  // 2026-03-25는 수요일이다.
  describe('영어 표현', () => {
    it('"tomorrow" → 내일 날짜', () => {
      expect(parseNaturalDateTime('groceries tomorrow')).toBeNull() // 날짜는 앞에 와야 한다
      expect(parseNaturalDateTime('tomorrow groceries')?.date).toBe('2026-03-26')
    })

    it('"today"/"day after tomorrow"', () => {
      expect(parseNaturalDateTime('today standup')?.date).toBe('2026-03-25')
      expect(parseNaturalDateTime('day after tomorrow dentist')?.date).toBe('2026-03-27')
    })

    it('"in N days/weeks/months"', () => {
      expect(parseNaturalDateTime('in 3 days review')?.date).toBe('2026-03-28')
      expect(parseNaturalDateTime('in 2 weeks review')?.date).toBe('2026-04-08')
      expect(parseNaturalDateTime('in 1 month review')?.date).toBe('2026-04-25')
    })

    it('"next week" → 다음 월요일', () => {
      expect(parseNaturalDateTime('next week planning')?.date).toBe('2026-03-30')
    })

    it('요일: "friday"는 다가오는 금요일, "next friday"는 그 다음 주', () => {
      expect(parseNaturalDateTime('friday demo')?.date).toBe('2026-03-27')
      expect(parseNaturalDateTime('next friday demo')?.date).toBe('2026-04-03')
    })

    it('"mar 5" / "5 mar" — 이미 지난 날짜는 내년으로', () => {
      expect(parseNaturalDateTime('mar 5 taxes')?.date).toBe('2027-03-05')
      expect(parseNaturalDateTime('april 2 taxes')?.date).toBe('2026-04-02')
      expect(parseNaturalDateTime('2 apr taxes')?.date).toBe('2026-04-02')
    })

    it('오전/오후 시간: "3pm", "3:30 pm", "at 5pm"', () => {
      expect(parseNaturalDateTime('tomorrow 3pm call')?.time).toBe('15:00')
      expect(parseNaturalDateTime('tomorrow 3:30 pm call')?.time).toBe('15:30')
      expect(parseNaturalDateTime('tomorrow at 5pm call')?.time).toBe('17:00')
      expect(parseNaturalDateTime('tomorrow 12am call')?.time).toBe('00:00')
    })

    it('24시간제는 그대로: "tomorrow 14:50"', () => {
      expect(parseNaturalDateTime('tomorrow 14:50 call')?.time).toBe('14:50')
    })

    it('영어 날짜 뒤 consumed 토큰 수', () => {
      expect(parseNaturalDateTime('tomorrow groceries')?.consumed).toBe(1)
      expect(parseNaturalDateTime('next week planning')?.consumed).toBe(2)
      expect(parseNaturalDateTime('tomorrow at 5pm call')?.consumed).toBe(3)
    })
  })

  // Regression: 진단 2.1 — 프로토타입 키가 요일 표 조회를 통과해 앱을 언마운트시켰다
  // Found by /qa on 2026-09-25
  // Report: docs/reports/2026-09-25-전체-진단.html
  describe('프로토타입 체인 키 (앱 전체 크래시 회귀)', () => {
    // 객체 리터럴은 Object.prototype을 상속하므로 MAP['constructor']가 함수를 돌려준다.
    // 그 값이 NEXT_DAY_FN의 인덱스로 들어가 undefined(today) → TypeError가 됐고,
    // 파싱이 useEffect에서 매 타이핑마다 돌기 때문에 글자를 치는 도중 창이 비었다.
    const PROTO_KEYS = [
      'constructor',
      'toString',
      'valueOf',
      'hasOwnProperty',
      'isPrototypeOf',
      'propertyIsEnumerable',
      'toLocaleString',
      '__proto__',
      '__defineGetter__',
      '__defineSetter__',
      '__lookupGetter__',
      '__lookupSetter__'
    ]

    it.each(PROTO_KEYS)('"%s" 단독 입력이 던지지 않는다', (key) => {
      expect(() => parseNaturalDateTime(key)).not.toThrow()
      expect(parseNaturalDateTime(key)).toBeNull()
    })

    it.each(PROTO_KEYS)('"%s"로 시작하는 할일 제목이 던지지 않는다', (key) => {
      expect(() => parseNaturalDateTime(`${key} 장보기`)).not.toThrow()
    })

    it.each(PROTO_KEYS)('한글 주간 접두사 + "%s"가 던지지 않는다', (key) => {
      for (const prefix of ['다음주 ', '이번 ', '이번주 ']) {
        expect(() => parseNaturalDateTime(prefix + key)).not.toThrow()
      }
    })

    it.each(PROTO_KEYS)('영어 주간 접두사 + "%s"가 던지지 않는다', (key) => {
      for (const prefix of ['next ', 'this ']) {
        expect(() => parseNaturalDateTime(prefix + key)).not.toThrow()
      }
    })

    it('정상 요일 파싱은 그대로 동작한다', () => {
      // 2026-03-25는 수요일. 표를 프로토타입 없는 객체로 바꿔도 조회는 같아야 한다.
      expect(parseNaturalDateTime('금요일 회의')?.date).toBe('2026-03-27')
      expect(parseNaturalDateTime('friday meeting')?.date).toBe('2026-03-27')
    })
  })

  // Regression: "다음주 <요일>"이 기준을 today+6으로 잡아 한 주를 건너뛰었다.
  // 49개 (오늘, 목표) 조합 중 21개가 일주일 뒤로 밀렸고, QuickAdd가 그 날짜를
  // 그대로 dueDate로 넣었다. 한 요일만 짚으면 21개 중 하나만 지키게 되므로
  // 오늘 7일 × 목표 7요일을 통째로 돌린다.
  describe('"다음주 <요일>" / "next <weekday>"는 다음 주 안에 떨어진다', () => {
    const KO = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일']
    const EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

    /** 로컬 시간대 기준 yyyy-MM-dd. TZ 프로젝트가 둘이라 UTC로 찍으면 안 된다. */
    function ymd(d: Date): string {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }

    /**
     * 월요일 시작 주 기준 다음 주의 해당 요일. 기대값은 date-fns를 쓰지 않고
     * 손으로 센다 — 구현과 같은 함수를 쓰면 같이 틀려도 초록이 된다.
     */
    function expected(today: Date, dayNum: number): string {
      const toNextMonday = (8 - today.getDay()) % 7 || 7
      const d = new Date(today)
      d.setDate(d.getDate() + toNextMonday + ((dayNum + 6) % 7))
      return ymd(d)
    }

    // 2026-09-20(일) ~ 2026-09-26(토)
    const DAYS = [20, 21, 22, 23, 24, 25, 26]

    it.each(DAYS)('2026-09-%i에 한국어 7개 요일이 모두 다음 주 안', (dom) => {
      const today = new Date(2026, 8, dom, 9, 0, 0)
      vi.setSystemTime(today)
      for (let dayNum = 0; dayNum < 7; dayNum++) {
        expect(parseNaturalDateTime(`다음주 ${KO[dayNum]} 회의`)?.date).toBe(expected(today, dayNum))
      }
    })

    it.each(DAYS)('2026-09-%i에 영어 7개 요일이 모두 다음 주 안', (dom) => {
      const today = new Date(2026, 8, dom, 9, 0, 0)
      vi.setSystemTime(today)
      for (let dayNum = 0; dayNum < 7; dayNum++) {
        expect(parseNaturalDateTime(`next ${EN[dayNum]} demo`)?.date).toBe(expected(today, dayNum))
      }
    })

    // 파서는 "다음주"를 이미 nextMonday(today)로 정의한다. 같은 입력에서
    // "다음주"와 "다음주 월요일"이 갈리면 둘 중 하나는 거짓말이다.
    it.each(DAYS)('2026-09-%i: "다음주" == "다음주 월요일" == "next monday"', (dom) => {
      vi.setSystemTime(new Date(2026, 8, dom, 9, 0, 0))
      const bare = parseNaturalDateTime('다음주 계획')?.date
      expect(bare).toBeTruthy()
      expect(parseNaturalDateTime('다음주 월요일 계획')?.date).toBe(bare)
      expect(parseNaturalDateTime('next monday planning')?.date).toBe(bare)
      expect(parseNaturalDateTime('next week planning')?.date).toBe(bare)
    })

    it('금요일 2026-09-25의 "다음주 화요일"은 09-29지 10-06이 아니다', () => {
      vi.setSystemTime(new Date(2026, 8, 25, 9, 0, 0))
      expect(parseNaturalDateTime('다음주 화요일 회의')?.date).toBe('2026-09-29')
      expect(parseNaturalDateTime('next tuesday demo')?.date).toBe('2026-09-29')
    })

    // 원래 맞던 조합은 그대로여야 한다 — 고친 건 건너뛰던 주뿐이다.
    it('수요일 2026-03-25의 "next friday"는 04-03 그대로', () => {
      vi.setSystemTime(new Date(2026, 2, 25, 9, 0, 0))
      expect(parseNaturalDateTime('next friday demo')?.date).toBe('2026-04-03')
      expect(parseNaturalDateTime('다음주 금요일 데모')?.date).toBe('2026-04-03')
    })
  })
})
