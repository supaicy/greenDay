import { describe, it, expect } from 'vitest'
import { validateTaskInput, validateTaskUpdate } from './validate'

describe('validateTaskInput', () => {
  it('id와 title이 있으면 통과', () => {
    const out = validateTaskInput({ id: 't1', title: '할일', extra: 1 })
    expect(out.id).toBe('t1')
    expect(out.title).toBe('할일')
  })

  it('객체가 아니면 throw', () => {
    expect(() => validateTaskInput(null)).toThrow('Invalid task payload')
    expect(() => validateTaskInput('x')).toThrow('Invalid task payload')
  })

  it('id가 문자열이 아니면 throw', () => {
    expect(() => validateTaskInput({ id: 1, title: 'a' })).toThrow('Invalid task payload')
  })

  it('title이 없으면 throw', () => {
    expect(() => validateTaskInput({ id: 't1' })).toThrow('Invalid task payload')
  })
})

describe('validateTaskUpdate', () => {
  it('id만 있으면 통과 (부분 업데이트)', () => {
    expect(validateTaskUpdate({ id: 't1', completed: true }).id).toBe('t1')
    expect(validateTaskUpdate({ id: 't1', priority: 'high' }).id).toBe('t1')
  })
  it('title이 있으면 문자열이어야 통과', () => {
    expect(validateTaskUpdate({ id: 't1', title: 'x' }).title).toBe('x')
  })
  it('title이 문자열이 아니면 throw', () => {
    expect(() => validateTaskUpdate({ id: 't1', title: 5 })).toThrow('Invalid task payload')
  })
  it('id가 없거나 비면 throw', () => {
    expect(() => validateTaskUpdate({ completed: true })).toThrow('Invalid task payload')
    expect(() => validateTaskUpdate({ id: '' })).toThrow('Invalid task payload')
  })
  it('객체가 아니면 throw', () => {
    expect(() => validateTaskUpdate(null)).toThrow('Invalid task payload')
    expect(() => validateTaskUpdate([])).toThrow('Invalid task payload')
  })
})

// scheduledOverrides는 렌더러가 보내는 중첩 페이로드다. IPC 경계에서 모양을
// 확인하지 않으면 그대로 디스크에 직렬화된다(database.ts updateTask).
// 신뢰 경계의 방어는 렌더러가 아니라 여기 있어야 한다.
describe('validateTaskUpdate — scheduledOverrides 모양', () => {
  it('정상 페이로드는 통과시킨다', () => {
    const ok = {
      id: 't1',
      scheduledOverrides: { '2026-08-17': { start: '2026-08-17T08:00:00', end: '2026-08-17T09:00:00' } }
    }
    expect(validateTaskUpdate(ok)).toBe(ok)
    expect(validateTaskUpdate({ id: 't1', scheduledOverrides: { '2026-08-17': null } })).toBeTruthy()
    expect(validateTaskUpdate({ id: 't1', scheduledOverrides: null })).toBeTruthy()
  })

  it('날짜 형식이 아닌 키를 거부한다', () => {
    expect(() => validateTaskUpdate({ id: 't1', scheduledOverrides: { 'not-a-date': null } })).toThrow()
    // JSON.parse는 리터럴과 달리 '__proto__'를 실제 own 키로 만든다. 이 맵은
    // 저장 후 다시 파싱되므로, 그런 키가 디스크까지 가지 않게 막아야 한다.
    const polluted = JSON.parse('{"__proto__": {"start": "x", "end": "y"}}')
    expect(() => validateTaskUpdate({ id: 't1', scheduledOverrides: polluted })).toThrow()
  })

  it('start/end가 문자열이 아닌 값을 거부한다', () => {
    expect(() => validateTaskUpdate({ id: 't1', scheduledOverrides: { '2026-08-17': { start: 1, end: 2 } } })).toThrow()
    expect(() => validateTaskUpdate({ id: 't1', scheduledOverrides: { '2026-08-17': {} } })).toThrow()
  })

  it('배열이나 원시값을 오버라이드 맵으로 받지 않는다', () => {
    expect(() => validateTaskUpdate({ id: 't1', scheduledOverrides: [] })).toThrow()
    expect(() => validateTaskUpdate({ id: 't1', scheduledOverrides: 'x' })).toThrow()
  })

  it('키 개수를 제한한다 — 무한히 커지는 맵이 디스크로 가지 않게', () => {
    const huge: Record<string, null> = {}
    for (let i = 0; i < 1001; i++) huge[`2026-01-${String((i % 28) + 1).padStart(2, '0')}-${i}`] = null
    expect(() => validateTaskUpdate({ id: 't1', scheduledOverrides: huge })).toThrow()
  })
})

// 생성 경로도 같은 검사를 받아야 한다. update만 막으면, createTask가 그대로
// 디스크에 직렬화하므로 신뢰 경계에 구멍이 남는다.
describe('validateTaskInput — scheduledOverrides 모양', () => {
  it('정상 페이로드는 통과시킨다', () => {
    const ok = { id: 't1', title: '운동', scheduledOverrides: { '2026-08-17': null } }
    expect(validateTaskInput(ok)).toBe(ok)
  })

  it('update와 같은 규칙으로 거부한다', () => {
    expect(() => validateTaskInput({ id: 't1', title: 'x', scheduledOverrides: { bad: null } })).toThrow()
    expect(() => validateTaskInput({ id: 't1', title: 'x', scheduledOverrides: [] })).toThrow()
    const polluted = JSON.parse('{"__proto__": null}')
    expect(() => validateTaskInput({ id: 't1', title: 'x', scheduledOverrides: polluted })).toThrow()
  })
})

/**
 * startDate·pinned는 렌더러가 새로 보내는 필드다. 이 경계를 통과하면 그대로
 * 디스크에 남으므로, 모양 검사는 렌더러가 아니라 여기 있어야 한다.
 */
describe('validateTaskUpdate — 기간·고정', () => {
  it('YYYY-MM-DD가 아닌 startDate는 거부한다', () => {
    expect(() => validateTaskUpdate({ id: 't1', startDate: '2026/08/20' })).toThrow()
    expect(() => validateTaskUpdate({ id: 't1', startDate: '오늘' })).toThrow()
    expect(() => validateTaskUpdate({ id: 't1', startDate: 20260820 })).toThrow()
  })

  it('정상 startDate와 null은 통과시킨다', () => {
    expect(validateTaskUpdate({ id: 't1', startDate: '2026-08-20' })).toBeTruthy()
    expect(validateTaskUpdate({ id: 't1', startDate: null })).toBeTruthy()
  })

  it('pinned는 불리언만 받는다', () => {
    expect(() => validateTaskUpdate({ id: 't1', pinned: 'yes' })).toThrow()
    expect(() => validateTaskUpdate({ id: 't1', pinned: 1 })).toThrow()
    expect(validateTaskUpdate({ id: 't1', pinned: true })).toBeTruthy()
  })

  it('생성 경로도 같은 규칙을 받는다', () => {
    expect(() => validateTaskInput({ id: 't1', title: 'x', startDate: 'nope' })).toThrow()
    expect(() => validateTaskInput({ id: 't1', title: 'x', pinned: 'nope' })).toThrow()
  })
})

/**
 * 날짜 필드는 CalDAV로 나갈 때 iCal 본문에 거의 그대로 실린다
 * (ical.ts toDateStamp은 하이픈만 지운다). 이 경계를 통과한 값이 그대로
 * VEVENT가 되므로, 모양뿐 아니라 '진짜 날짜인가'까지 여기서 막는다.
 */
describe('validateTaskUpdate — 날짜 필드가 iCal로 새지 않게', () => {
  it('개행이 섞인 날짜는 거부한다 — VEVENT에 임의 속성을 끼워 넣을 수 있다', () => {
    expect(() => validateTaskUpdate({ id: 't1', dueDate: '2026-08-20\r\nX-EVIL:1' })).toThrow()
    expect(() => validateTaskUpdate({ id: 't1', startDate: '2026-08-18\r\nX-EVIL:1' })).toThrow()
  })

  it('달력에 없는 날짜는 거부한다', () => {
    // 모양만 맞는 값은 DTSTART:00000000 같은 깨진 iCal이 되어 서버가 거부하고,
    // 그 할일만 조용히 동기화되지 않는다.
    expect(() => validateTaskUpdate({ id: 't1', dueDate: '2026-13-45' })).toThrow()
    expect(() => validateTaskUpdate({ id: 't1', dueDate: '0000-00-00' })).toThrow()
    expect(() => validateTaskUpdate({ id: 't1', startDate: '2026-02-29' })).toThrow() // 2026은 윤년이 아니다
  })

  it('정상 날짜와 null은 통과시킨다', () => {
    expect(validateTaskUpdate({ id: 't1', dueDate: '2028-02-29' })).toBeTruthy() // 윤년
    expect(validateTaskUpdate({ id: 't1', dueDate: null })).toBeTruthy()
  })

  it('sortOrder는 유한한 수만 받는다', () => {
    // NaN/Infinity는 JSON에 null로 적혀, 재시작하면 정렬이 무너진다.
    expect(() => validateTaskUpdate({ id: 't1', sortOrder: Number.NaN })).toThrow()
    expect(() => validateTaskUpdate({ id: 't1', sortOrder: Number.POSITIVE_INFINITY })).toThrow()
    expect(() => validateTaskUpdate({ id: 't1', sortOrder: '3' })).toThrow()
    expect(validateTaskUpdate({ id: 't1', sortOrder: 3.5 })).toBeTruthy()
  })
})

// M4의 절반. 날짜는 이미 정규식으로 못 박혀 있었는데(위 describe) **id만 그
// 방어에서 빠져 있었다** — "빈 문자열이 아니다"만 봤다. 이 값은 CalDAV로 나갈 때
// `UID:greenday-<id>@…` 한 줄에 그대로 실린다.
describe('task id — iCalendar 주입 방어', () => {
  it('개행이 섞인 id를 거부한다 — UID 줄에 임의 속성을 끼워 넣을 수 있다', () => {
    const evil = 'abc\r\nX-EVIL:1'
    expect(() => validateTaskInput({ id: evil, title: 'x' })).toThrow()
    expect(() => validateTaskUpdate({ id: evil, title: 'x' })).toThrow()
  })

  it('UID 줄을 끊거나 파라미터를 붙이는 문자를 거부한다', () => {
    for (const id of ['a b', 'a;b', 'a:b', 'a,b', 'a"b', 'a@b', 'a\tb', 'a\\b', 'a\nb']) {
      expect(() => validateTaskInput({ id, title: 'x' }), `${JSON.stringify(id)}가 통과했다`).toThrow()
    }
  })

  it('빈 id와 문자열이 아닌 id도 그대로 거부한다', () => {
    expect(() => validateTaskInput({ id: '', title: 'x' })).toThrow()
    expect(() => validateTaskInput({ id: 42, title: 'x' })).toThrow()
    expect(() => validateTaskUpdate({ id: null })).toThrow()
  })

  it('길이 상한이 있다', () => {
    expect(() => validateTaskInput({ id: 'a'.repeat(129), title: 'x' })).toThrow()
    expect(validateTaskInput({ id: 'a'.repeat(128), title: 'x' })).toBeTruthy()
  })

  // 앱이 만드는 id는 전부 uuid v4다. 이 규칙이 기존 데이터를 전부 통과시켜야 한다.
  it('uuid v4는 통과한다', () => {
    expect(validateTaskInput({ id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', title: 'x' })).toBeTruthy()
    expect(validateTaskUpdate({ id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' })).toBeTruthy()
  })
})
