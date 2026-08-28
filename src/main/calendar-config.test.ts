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
    // 암호문의 **모양**이 아니라 왕복을 못 박는다. 형식은 결속 봉투가 들어오면서
    // 바뀌었고(M1), 그때도 바뀌면 안 되는 것은 "평문이 남지 않는다"와 "되읽힌다"다.
    expect(decodeConfig(stored as unknown as Record<string, unknown>, workingCrypto).password).toBe(
      'abcd-efgh-ijkl-mnop'
    )
  })

  it('결속(오리진·계정)은 암호문 안에 들어간다 — 파일 편집으로 못 바꾼다', () => {
    const stored = encodeConfig(config(), workingCrypto)
    expect(JSON.stringify(stored)).not.toContain('passwordBinding')
    expect(workingCrypto.decrypt(String(stored.password_enc))).toContain('https://caldav.icloud.com')
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

/**
 * M1 — serverUrl·username이 바뀌어도 저장된 앱 암호가 그대로 재사용되던 것.
 *
 * 그 값은 새 오리진으로 `Authorization: Basic`에 실려 나간다. 설정 파일 한 줄을
 * 고치는 것만으로 iCloud 앱 암호를 임의 서버에 보낼 수 있었다.
 */
describe('M1 — 자격증명 오리진 결속', () => {
  /** 정상적으로 저장된 상태를 만든다 — 결속이 암호문 안에 들어간 파일. */
  function storedAt(serverUrl: string, username: string): Record<string, unknown> {
    return encodeConfig(
      config({ serverUrl, username, password: 'abcd-efgh-ijkl-mnop' }),
      workingCrypto
    ) as unknown as Record<string, unknown>
  }

  it('오리진이 그대로면 저장된 비밀번호를 계속 쓴다', () => {
    const decoded = decodeConfig(storedAt('https://caldav.icloud.com', 'user@icloud.com'), workingCrypto)
    expect(decoded.password).toBe('abcd-efgh-ijkl-mnop')
    expect(decoded.calendarUrl).toBe('https://caldav.icloud.com/1/calendars/home/')
  })

  it('serverUrl만 바꿔치기하면 비밀번호를 내주지 않는다', () => {
    const tampered = { ...storedAt('https://caldav.icloud.com', 'user@icloud.com'), serverUrl: 'https://evil.example' }
    const decoded = decodeConfig(tampered, workingCrypto)
    expect(decoded.password).toBeNull()
  })

  it('username만 바꿔도 마찬가지다', () => {
    const tampered = { ...storedAt('https://caldav.icloud.com', 'user@icloud.com'), username: 'victim@icloud.com' }
    expect(decodeConfig(tampered, workingCrypto).password).toBeNull()
  })

  it('결속이 깨지면 고른 캘린더와 동기화 상태도 함께 버린다', () => {
    // 이전 서버의 리소스를 가리키는 값이다. 남겨 두면 새 서버의 같은 경로에
    // 남의 일정을 덮어쓰거나, 없는 href를 매번 갱신하려 든다.
    const tampered = { ...storedAt('https://caldav.icloud.com', 'user@icloud.com'), serverUrl: 'https://evil.example' }
    const decoded = decodeConfig(tampered, workingCrypto)
    expect(decoded.calendarUrl).toBeNull()
    expect(decoded.calendarName).toBeNull()
    expect(decoded.syncState).toEqual({})
    expect(decoded.enabled).toBe(false)
  })

  it('결속이 깨진 설정을 다시 저장해도 암호문이 되살아나지 않는다', () => {
    // 읽기 검사 하나에만 기대면, 그 검사를 지나치는 경로가 하나 생기는 순간 뚫린다.
    const tampered = { ...storedAt('https://caldav.icloud.com', 'user@icloud.com'), serverUrl: 'https://evil.example' }
    const decoded = decodeConfig(tampered, workingCrypto)
    const rewritten = encodeConfig(decoded, workingCrypto)
    expect(rewritten.password_enc).toBeNull()
  })

  it('결속을 들고 서버만 옮기면(스프레드 그대로) 비밀번호가 따라가지 않는다', () => {
    // `calendar:save-credentials`가 하는 일이 정확히 이 스프레드다:
    // 비밀번호는 그대로 두고 serverUrl만 바꾼다.
    const saved = decodeConfig(storedAt('https://caldav.icloud.com', 'user@icloud.com'), workingCrypto)
    const moved = { ...saved, serverUrl: 'https://evil.example' }
    const stored = encodeConfig(moved, workingCrypto)
    expect(stored.password_enc).toBeNull()
    expect(JSON.stringify(stored)).not.toContain('abcd-efgh-ijkl-mnop')
  })

  it('새 비밀번호를 직접 입력하면 새 서버에 결속된다 (서버 이전을 막지 않는다)', () => {
    const saved = decodeConfig(storedAt('https://caldav.icloud.com', 'user@icloud.com'), workingCrypto)
    const moved = { ...saved, serverUrl: 'https://cloud.example/remote.php/dav', password: 'new-app-password' }
    const decoded = decodeConfig(encodeConfig(moved, workingCrypto) as unknown as Record<string, unknown>, workingCrypto)
    expect(decoded.password).toBe('new-app-password')
  })

  it('호스트 대소문자와 기본 포트는 같은 오리진으로 본다', () => {
    const stored = storedAt('https://caldav.icloud.com', 'user@icloud.com')
    const equivalent = { ...stored, serverUrl: 'https://CalDAV.iCloud.COM:443' }
    expect(decodeConfig(equivalent, workingCrypto).password).toBe('abcd-efgh-ijkl-mnop')
  })

  it('파싱할 수 없는 serverUrl은 비밀번호를 내주지 않는다', () => {
    const broken = { ...storedAt('https://caldav.icloud.com', 'user@icloud.com'), serverUrl: 'not a url' }
    expect(decodeConfig(broken, workingCrypto).password).toBeNull()
  })

  it('결속은 렌더러로 나가지 않는다 (안에 비밀번호가 들어 있다)', () => {
    const decoded = decodeConfig(storedAt('https://caldav.icloud.com', 'user@icloud.com'), workingCrypto)
    const publicConfig = toPublicConfig(decoded)
    expect('passwordBinding' in publicConfig).toBe(false)
    expect(JSON.stringify(publicConfig)).not.toContain('abcd-efgh-ijkl-mnop')
  })

  it('옛 형식(결속 없는 암호문)도 계속 읽는다 — 출하된 설치를 잠그지 않는다', () => {
    // 결속이 들어오기 전에 저장된 파일. 파일이 스스로 말하는 설정에 결속된 것으로 읽고,
    // 다음 저장에서 새 형식으로 굳는다.
    const legacy = {
      serverUrl: 'https://caldav.icloud.com',
      username: 'user@icloud.com',
      password_enc: workingCrypto.encrypt('abcd-efgh-ijkl-mnop')
    }
    const decoded = decodeConfig(legacy, workingCrypto)
    expect(decoded.password).toBe('abcd-efgh-ijkl-mnop')
    // 다시 저장하면 새 형식이 되어 그 다음부터는 바꿔치기가 걸린다.
    const upgraded = encodeConfig(decoded, workingCrypto) as unknown as Record<string, unknown>
    expect(decodeConfig({ ...upgraded, serverUrl: 'https://evil.example' }, workingCrypto).password).toBeNull()
  })
})
