import { describe, it, expect } from 'vitest'
import {
  encodeConfig,
  decodeConfig,
  toPublicConfig,
  DEFAULT_CONFIG,
  type CalendarConfig
} from './calendar-config'
import type { KeyCrypto } from './database'

// 실제 safeStorage처럼 평문을 알아볼 수 없게 만든다. 그래야 "평문이 남지 않는다"는
// 검증이 의미를 갖는다 — 값을 그대로 감싸는 가짜였다면 항상 통과했을 것이다.
const workingCrypto: KeyCrypto = {
  available: () => true,
  encrypt: (s) => Buffer.from(s, 'utf-8').reverse().toString('base64'),
  decrypt: (b) => {
    const bytes = Buffer.from(b, 'base64')
    if (bytes.length === 0) throw new Error('복호화 실패')
    return bytes.reverse().toString('utf-8')
  }
}

const unavailableCrypto: KeyCrypto = {
  available: () => false,
  encrypt: () => {
    throw new Error('사용 불가')
  },
  decrypt: () => {
    throw new Error('사용 불가')
  }
}

const failingCrypto: KeyCrypto = {
  available: () => true,
  encrypt: () => {
    throw new Error('키체인 잠김')
  },
  decrypt: () => {
    throw new Error('키체인 잠김')
  }
}

function config(overrides: Partial<CalendarConfig> = {}): CalendarConfig {
  return {
    ...DEFAULT_CONFIG,
    username: 'user@icloud.com',
    password: 'abcd-efgh-ijkl-mnop',
    calendarUrl: 'https://caldav.icloud.com/1/calendars/home/',
    calendarName: '집',
    enabled: true,
    ...overrides
  }
}

describe('encodeConfig', () => {
  it('비밀번호를 평문 필드로 남기지 않는다', () => {
    const stored = encodeConfig(config(), workingCrypto)
    const serialized = JSON.stringify(stored)
    expect(serialized).not.toContain('abcd-efgh-ijkl-mnop')
    expect('password' in stored).toBe(false)
    expect(stored.password_enc).toBe(workingCrypto.encrypt('abcd-efgh-ijkl-mnop'))
  })

  it('암호화가 불가능하면 아예 저장하지 않는다', () => {
    const stored = encodeConfig(config(), unavailableCrypto)
    expect(stored.password_enc).toBeNull()
    expect(JSON.stringify(stored)).not.toContain('abcd-efgh-ijkl-mnop')
  })

  it('암호화가 실패해도 평문으로 흘리지 않는다', () => {
    const stored = encodeConfig(config(), failingCrypto)
    expect(stored.password_enc).toBeNull()
    expect(JSON.stringify(stored)).not.toContain('abcd-efgh-ijkl-mnop')
  })

  it('비밀번호 외의 설정은 그대로 보존한다', () => {
    const stored = encodeConfig(config(), workingCrypto)
    expect(stored.username).toBe('user@icloud.com')
    expect(stored.calendarName).toBe('집')
    expect(stored.enabled).toBe(true)
  })
})

describe('decodeConfig', () => {
  it('저장한 것을 그대로 되읽는다', () => {
    const original = config()
    const restored = decodeConfig(
      JSON.parse(JSON.stringify(encodeConfig(original, workingCrypto))),
      workingCrypto
    )
    expect(restored.password).toBe(original.password)
    expect(restored.username).toBe(original.username)
    expect(restored.calendarUrl).toBe(original.calendarUrl)
  })

  it('다른 기기에서 복사돼 복호화가 안 되면 비밀번호를 null로 둔다', () => {
    const stored = JSON.parse(JSON.stringify(encodeConfig(config(), workingCrypto)))
    stored.password_enc = '' // 다른 기기의 키로 암호화된 값 — 복호화가 실패한다
    const restored = decodeConfig(stored, workingCrypto)
    expect(restored.password).toBeNull()
    // 나머지 설정은 살아 있어야 사용자가 비밀번호만 다시 넣으면 된다.
    expect(restored.username).toBe('user@icloud.com')
    expect(restored.calendarUrl).toBe('https://caldav.icloud.com/1/calendars/home/')
  })

  it('빈 객체를 주면 기본값으로 돌아간다', () => {
    const restored = decodeConfig({}, workingCrypto)
    expect(restored.serverUrl).toBe('https://caldav.icloud.com')
    expect(restored.enabled).toBe(false)
    expect(restored.syncState).toEqual({})
  })

  it('망가진 syncState는 버리고 빈 상태로 시작한다', () => {
    for (const broken of [null, 'string', [1, 2], { a: { href: 1 } }, { a: {} }]) {
      expect(decodeConfig({ syncState: broken }, workingCrypto).syncState).toEqual({})
    }
  })

  it('정상 syncState는 유지한다', () => {
    const syncState = { t1: { href: '/x.ics', etag: '"v1"', fingerprint: 'fp', sequence: 2 } }
    expect(decodeConfig({ syncState }, workingCrypto).syncState).toEqual(syncState)
  })

  it('알 수 없는 provider는 icloud로 되돌린다', () => {
    expect(decodeConfig({ provider: 'exchange' }, workingCrypto).provider).toBe('icloud')
    expect(decodeConfig({ provider: 'caldav' }, workingCrypto).provider).toBe('caldav')
  })
})

describe('toPublicConfig', () => {
  it('렌더러로 비밀번호를 넘기지 않는다', () => {
    const publicConfig = toPublicConfig(config())
    expect(JSON.stringify(publicConfig)).not.toContain('abcd-efgh-ijkl-mnop')
    expect('password' in publicConfig).toBe(false)
    expect(publicConfig.hasPassword).toBe(true)
  })

  it('동기화 상태 원본 대신 개수만 넘긴다', () => {
    const publicConfig = toPublicConfig(
      config({
        syncState: {
          a: { href: '/a', etag: null, fingerprint: 'x', sequence: 0 },
          b: { href: '/b', etag: null, fingerprint: 'y', sequence: 0 }
        }
      })
    )
    expect('syncState' in publicConfig).toBe(false)
    expect(publicConfig.syncedCount).toBe(2)
  })

  it('비밀번호가 없으면 hasPassword가 false다', () => {
    expect(toPublicConfig(config({ password: null })).hasPassword).toBe(false)
  })
})
