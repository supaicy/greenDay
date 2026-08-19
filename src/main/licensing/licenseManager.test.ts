import { describe, it, expect } from 'vitest'
import { createLicenseManager, type LicenseManager, type LicenseState } from './licenseManager'
import { licenseHash } from './activationToken'
import { PRODUCT_SLUG } from '../../shared/license'
import { GRACE_DURATION_MS, TRIAL_DURATION_MS } from './trialWindow'
import type { ClientResult, LicenseClient } from './licenseClient'
import type { LicenseRecord } from './licenseStore'
import { importTestKey, makeKeyPair, signTestToken } from './testTokens'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 7, 18)
const KEY = 'GREENDAY-A2B3-C4D5-E6F7-G8H9'
const OTHER_KEY = 'GREENDAY-J2K3-M4N5-P6Q7-R8S9'
const DEVICE = 'a'.repeat(64)
const TOKEN_TTL_MS = 30 * DAY

const pair = makeKeyPair()
const publicKey = importTestKey(pair.rawBase64)

/** 서버가 발급하는 것과 같은 모양의 토큰. */
function token(over: { expMs?: number; iatMs?: number; dev?: string; prod?: string; lic?: string } = {}): string {
  const iatMs = over.iatMs ?? NOW
  return signTestToken(
    {
      lic: over.lic ?? licenseHash(KEY),
      dev: over.dev ?? DEVICE,
      prod: over.prod ?? PRODUCT_SLUG,
      exp: Math.floor((over.expMs ?? iatMs + TOKEN_TTL_MS) / 1000),
      iat: Math.floor(iatMs / 1000)
    },
    pair.privateKey
  )
}

interface Harness {
  manager: LicenseManager
  record: LicenseRecord
  /** 예약된 타이머들. 실제로 자지 않고 손으로 깨운다. */
  timers: { atMs: number; fire: () => void }[]
  setNow: (ms: number) => void
  /** 단조 시계로 잰 시간이 흘렀다고 알린다 — 벽시계와 무관하게 타이머가 깬다. */
  fireDueTimers: () => void
  calls: string[]
  /** 기기 id를 몇 번 읽었는가. 읽는 데 서브프로세스가 든다. */
  deviceReads: () => number
  /** 디스크에 몇 번 썼는가. 메인 프로세스의 동기 writeFileSync다. */
  writes: () => number
  /** 화면에 알린 상태들. 이게 없으면 렌더러가 마감을 모른다. */
  changes: LicenseState[]
}

function harness(
  over: {
    record?: Partial<LicenseRecord>
    client?: Partial<LicenseClient>
    device?: string | null
    enforced?: boolean
    now?: number
    /** false면 디스크 쓰기가 실패한다 — 저장 실패 경로를 시험한다. */
    storeWritable?: boolean
  } = {}
): Harness {
  const record: LicenseRecord = {
    key: null,
    token: null,
    lastSeenMs: 0,
    trialStartMs: null,
    ...over.record
  }
  let current = over.now ?? NOW
  let deviceReads = 0
  const storeWritable = over.storeWritable ?? true
  let writes = 0
  const changes: LicenseState[] = []
  const timers: { atMs: number; fire: () => void }[] = []
  const calls: string[] = []

  const refuse = async (): Promise<ClientResult<never>> => ({ ok: false, error: 'network' })
  const client: LicenseClient = {
    activate: refuse,
    validate: refuse,
    deactivate: refuse,
    ...over.client
  }
  const traced: LicenseClient = {
    activate: (k, d, n) => {
      calls.push('activate')
      return client.activate(k, d, n)
    },
    validate: (k, d) => {
      calls.push('validate')
      return client.validate(k, d)
    },
    deactivate: (k, d) => {
      calls.push('deactivate')
      return client.deactivate(k, d)
    }
  }

  const manager = createLicenseManager({
    client: traced,
    store: {
      read: () => ({ ...record }),
      write: (next) => {
        writes += 1
        Object.assign(record, next)
        return storeWritable
      }
    },
    publicKey,
    device: () => {
      deviceReads += 1
      return over.device === undefined ? DEVICE : over.device
    },
    deviceName: 'test-machine',
    enforced: over.enforced ?? true,
    now: () => current,
    onChange: (next) => changes.push(next),
    setTimer: (ms, fn) => {
      const entry = { atMs: current + ms, fire: fn }
      timers.push(entry)
      return () => {
        const i = timers.indexOf(entry)
        if (i >= 0) timers.splice(i, 1)
      }
    }
  })

  return {
    manager,
    record,
    timers,
    calls,
    deviceReads: () => deviceReads,
    writes: () => writes,
    changes,
    setNow: (ms) => {
      current = ms
    },
    fireDueTimers: () => {
      // **도래한 것만** 깨운다. 이름 그대로 동작하지 않으면, 아직 오지 않은
      // 마감을 앞당겨 깨워 놓고 "그 시각에 이렇게 된다"고 단언하게 된다 —
      // 콜백이 단조 시계 바닥을 마감까지 끌어올리므로 상태도 함께 앞서 간다.
      const due = timers.filter((t) => t.atMs <= current)
      for (const t of due) timers.splice(timers.indexOf(t), 1)
      for (const t of due) t.fire()
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 결함 1 — 검증되지 않은 로컬 문자열로 유료 상태에 진입
// ─────────────────────────────────────────────────────────────────────────────

describe('결함 1 — 권한은 서명에서만 나온다', () => {
  it('아무 문자열이나 토큰 자리에 써넣어도 유료가 되지 않는다', () => {
    // 파일 두 줄로 영구 무료가 되던 것이 이 결함이었다.
    const h = harness({ record: { key: KEY, token: 'anything-at-all' } })
    expect(h.manager.getState().status).toBe('trial')
    expect(h.manager.allowsPaidFeatures()).toBe(true) // 트라이얼이라 열려 있는 것이지 토큰 때문이 아니다
    // 트라이얼 마감에 걸린 타이머가 실제로 상태를 닫는 경로다.
    h.setNow(NOW + 40 * DAY)
    h.fireDueTimers()
    expect(h.manager.getState().status).toBe('trialExpired')
    expect(h.manager.allowsPaidFeatures()).toBe(false)
  })

  it('다른 키쌍이 서명한 토큰은 라이선스도 유예도 만들지 않는다', () => {
    const other = makeKeyPair()
    const forged = signTestToken(
      { lic: 'f', dev: DEVICE, prod: PRODUCT_SLUG, exp: Math.floor((NOW - DAY) / 1000), iat: 0 },
      other.privateKey
    )
    const h = harness({ record: { key: KEY, token: forged, trialStartMs: NOW - 40 * DAY } })
    expect(h.manager.getState().status).toBe('trialExpired')
    expect(h.manager.allowsPaidFeatures()).toBe(false)
  })

  it('다른 제품의 토큰으로는 열리지 않는다', () => {
    // BicMac 키로 haru가 열리면 안 된다. 제품 격리는 이것뿐이다.
    const h = harness({ record: { key: KEY, token: token({ prod: 'bicmac' }), trialStartMs: NOW - 40 * DAY } })
    expect(h.manager.getState().status).toBe('trialExpired')
  })

  it('다른 기기의 토큰은 유예조차 못 얻는다', () => {
    // license.json을 통째로 복사해 온 경우다. 서명은 완벽하지만, 이 기기가 그
    // 토큰을 가졌던 적이 있다는 증거가 디스크에 하나도 없다.
    const h = harness({
      record: { key: KEY, token: token({ dev: 'b'.repeat(64), expMs: NOW - DAY }), trialStartMs: NOW - 40 * DAY }
    })
    expect(h.manager.getState().status).toBe('trialExpired')
  })

  it('다른 키로 발급된 토큰은 통과하지 못한다', () => {
    // 서명·기기·제품이 다 맞아도 이 키의 토큰이 아니다. 이게 없으면 record.key를
    // 아무 문자열로 바꿔치기해도 옛 토큰이 계속 라이선스로 서고, 서버의 취소가
    // 서명된 마감까지 도달하지 못한다.
    const h = harness({
      record: { key: KEY, token: token({ lic: licenseHash(OTHER_KEY) }), trialStartMs: NOW - 40 * DAY }
    })
    expect(h.manager.getState().status).toBe('trialExpired')
    expect(h.manager.allowsPaidFeatures()).toBe(false)
  })

  it('서버가 다른 키의 토큰을 주면 저장하지 않는다', async () => {
    const h = harness({
      client: {
        activate: async () => ({
          ok: true,
          value: { token: token({ lic: licenseHash(OTHER_KEY) }), expiresAtMs: NOW + TOKEN_TTL_MS }
        })
      }
    })
    expect(await h.manager.activate(KEY)).toBe('badToken')
    expect(h.record.token).toBeNull()
  })

  it('기기를 식별하지 못하면 유예도 없다', () => {
    // 하드웨어를 못 읽는 것이 복사된 파일과 구별되지 않는다. 정직한 답은
    // 거절하고 재활성화를 요구하는 것이다.
    const h = harness({
      device: null,
      record: { key: KEY, token: token({ expMs: NOW - DAY }), trialStartMs: NOW - 40 * DAY }
    })
    expect(h.manager.getState().status).toBe('trialExpired')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 결함 2 — 유예 기간을 로컬 타임스탬프에 앵커링
// ─────────────────────────────────────────────────────────────────────────────

describe('결함 2 — 유예는 토큰의 exp에서만 계산된다', () => {
  it('만료된 진짜 토큰은 exp + 30일까지 버틴다', () => {
    const expMs = NOW - DAY
    const h = harness({ record: { key: KEY, token: token({ expMs }) } })
    const state = h.manager.getState()
    expect(state.status).toBe('grace')
    if (state.status === 'grace') expect(state.untilMs).toBe(expMs + GRACE_DURATION_MS)
    expect(h.manager.allowsPaidFeatures()).toBe(true)
  })

  it('유예 천장을 지나면 닫힌다', () => {
    const expMs = NOW - (GRACE_DURATION_MS + DAY)
    const h = harness({ record: { key: KEY, token: token({ expMs }), trialStartMs: NOW - 40 * DAY } })
    expect(h.manager.getState().status).toBe('trialExpired')
    expect(h.manager.allowsPaidFeatures()).toBe(false)
  })

  it('lastSeen을 미래로 써넣어도 유예가 늘어나지 않는다', () => {
    // 예전 설계는 "마지막으로 확인한 시각" 타임스탬프를 신뢰했다. 그 값은 그것이
    // 보증하려는 토큰과 똑같이 위조 가능해서, 구멍을 막은 게 아니라 옮겼을 뿐이다.
    // 지금은 부풀린 값이 유예를 늘리는 게 아니라 **앞당겨 닫는다** — 어느
    // 방향이든 조작한 사람이 얻는 것은 없다.
    const expMs = NOW - DAY
    const h = harness({
      record: {
        key: KEY,
        token: token({ expMs }),
        lastSeenMs: NOW + 100 * 365 * DAY,
        trialStartMs: NOW - 40 * DAY
      }
    })
    expect(h.manager.getState().status).toBe('trialExpired')
    expect(h.manager.allowsPaidFeatures()).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 결함 3 — 비활성화 중 도착한 응답이 해제된 기기를 다시 라이선스
// ─────────────────────────────────────────────────────────────────────────────

describe('결함 3 — 진행 중인 요청은 자기가 물어본 키에 대해서만 답한다', () => {
  it('해제가 끝난 뒤 도착한 검증 응답은 무시된다', async () => {
    let land: (r: ClientResult<{ token: string; expiresAtMs: number }>) => void = () => {}
    const h = harness({
      // 반감기를 지난 토큰이라 재검증이 네트워크를 친다.
      record: { key: KEY, token: token({ iatMs: NOW - 20 * DAY, expMs: NOW + 10 * DAY }) },
      client: {
        validate: () => new Promise((resolve) => (land = resolve)),
        deactivate: async () => ({ ok: true, value: undefined })
      }
    })

    const pending = h.manager.revalidateIfNeeded()
    expect(await h.manager.deactivate()).toBeNull()
    expect(h.record.key).toBeNull()
    expect(h.record.token).toBeNull()

    // 슬롯은 서버에서 이미 풀렸고 다른 기기가 가져갈 수 있다. 여기서 이 응답을
    // 반영하면 기기 한도가 느린 응답 하나로 무너진다.
    land({ ok: true, value: { token: token(), expiresAtMs: NOW + TOKEN_TTL_MS } })
    await pending

    expect(h.record.token).toBeNull()
    expect(h.manager.getState().status).not.toBe('licensed')
  })

  it('옛 키에 대한 거부는 그 사이 활성화된 새 라이선스를 지우지 않는다', async () => {
    let land: (r: ClientResult<never>) => void = () => {}
    const h = harness({
      record: { key: KEY, token: token({ iatMs: NOW - 20 * DAY, expMs: NOW + 10 * DAY }) },
      client: {
        validate: () => new Promise((resolve) => (land = resolve)),
        // 서버는 **물어본 그 키**의 토큰을 준다 — lic 클레임이 OTHER_KEY의 해시다.
        activate: async () => ({
          ok: true,
          value: { token: token({ lic: licenseHash(OTHER_KEY) }), expiresAtMs: NOW + TOKEN_TTL_MS }
        })
      }
    })

    const pending = h.manager.revalidateIfNeeded()
    expect(await h.manager.activate(OTHER_KEY)).toBeNull()
    expect(h.record.key).toBe(OTHER_KEY)

    land({ ok: false, error: 'revoked' })
    await pending

    expect(h.record.key).toBe(OTHER_KEY)
    expect(h.manager.getState().status).toBe('licensed')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 결함 4 — 시계를 되돌리면 만료 토큰이 무한 갱신
// ─────────────────────────────────────────────────────────────────────────────

describe('결함 4 — 단조 시계로 "마감이 실제로 지났다"를 기록한다', () => {
  it('타이머가 깬 뒤에는 시계를 되돌려도 만료가 유지된다', () => {
    const expMs = NOW + DAY
    const h = harness({ record: { key: KEY, token: token({ expMs }), trialStartMs: NOW - 40 * DAY } })
    expect(h.manager.getState().status).toBe('licensed')

    // 하루가 실제로 흘렀다. setTimeout은 벽시계가 아니라 단조 시계로 잰다 —
    // 날짜를 고쳐도 이 타이머가 일찍 깨지 않는다.
    h.setNow(expMs)
    h.fireDueTimers()
    expect(h.manager.getState().status).toBe('grace')

    // 이제 활성화 시점으로 시계를 되돌린다. 이걸 믿으면 만료된 토큰이 다시
    // 유효해지고, 같은 거짓말로 30일짜리 창이 또 열린다.
    h.setNow(NOW)
    expect(h.manager.getState().status).toBe('grace')
    expect(h.manager.allowsPaidFeatures()).toBe(true)
    expect(h.record.lastSeenMs).toBeGreaterThanOrEqual(expMs)
  })

  it('30일짜리 마감이 즉시 발화하지 않는다', () => {
    // setTimeout은 2^31-1ms(약 24.8일)를 넘는 지연을 1ms로 취급한다. 나눠 걸지
    // 않으면 30일 만료가 예약 즉시 깨어 settle을 무한히 다시 돌린다.
    const h = harness({ record: { key: KEY, token: token({ expMs: NOW + 30 * DAY }) } })
    expect(h.timers).toHaveLength(1)
    expect(h.timers[0].atMs - NOW).toBeLessThanOrEqual(2_147_483_647)

    // 중간에 깨더라도 상태는 그대로고, 다음 조각이 다시 걸린다.
    h.setNow(h.timers[0].atMs)
    h.fireDueTimers()
    expect(h.manager.getState().status).toBe('licensed')
    expect(h.timers).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 결함 5 — 미래로 조작된 시각을 디스크에 되써서 트라이얼이 영구 소멸
// ─────────────────────────────────────────────────────────────────────────────

describe('결함 5 — 큰 오차는 메모리에서만 보정한다', () => {
  it('터무니없이 미래인 시작일은 파일에 되쓰지 않는다', () => {
    // 되쓰면 시계가 고장 난 정상 사용자(메인보드 배터리 사망)가 벽돌이 된다:
    // 시계가 회복되는 순간 창은 이미 몇십 년 지난 것이 되고 앱 안에 되돌릴
    // 방법이 없다. 되쓰지 않으면 조작한 사람은 실행할 때마다 창 하나를 얻는데,
    // 그건 설정을 지우면 어차피 얻는 것이라 새 손해가 아니다.
    const forged = NOW + 100 * 365 * DAY
    const h = harness({ record: { trialStartMs: forged } })
    expect(h.manager.getState().status).toBe('trial')
    expect(h.record.trialStartMs).toBe(forged)
  })

  it('작은 오차는 보정하고 기록한다', () => {
    // NTP 흔들림, 타임존 없는 첫 부팅, 서머타임 계산. 이건 이 Mac이 계속 쓸
    // 시계라, 처음 본 거짓말에 창을 고정해 두는 것이 맞다.
    const slightlyAhead = NOW + 3 * DAY
    const h = harness({ record: { trialStartMs: slightlyAhead } })
    expect(h.record.trialStartMs).toBe(NOW)
    const state = h.manager.getState()
    expect(state.status === 'trial' && state.untilMs).toBe(NOW + TRIAL_DURATION_MS)
  })

  it('시작일을 미래로 조작해도 창이 길어지지 않는다', () => {
    // 창은 시작 + 30일이라, 2100년을 써넣으면 서명 없는 영구 라이선스가 된다.
    const h = harness({ record: { trialStartMs: NOW + 100 * 365 * DAY } })
    const state = h.manager.getState()
    expect(state.status === 'trial' && state.untilMs).toBe(NOW + TRIAL_DURATION_MS)
  })

  it('lastSeen이 터무니없이 미래여도 트라이얼이 즉사하지 않는다', () => {
    // 이 값이 신뢰되면 유효 시각이 거기 얼어붙어 모든 창이 닫히고 모든 토큰이
    // 만료로 읽힌다. 새 키를 사도 소용없다.
    const h = harness({ record: { lastSeenMs: NOW + 100 * 365 * DAY } })
    expect(h.manager.getState().status).toBe('trial')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 결함 6 — 만료 시각을 타이머로만 관리
// ─────────────────────────────────────────────────────────────────────────────

describe('결함 6 — 접근할 때마다 실제 시각으로 다시 계산한다', () => {
  it('프로세스가 살아 있는 채 토큰이 만료되면 유예로 떨어진다', () => {
    // 타이머를 깨우지 않는다 — 절전, 예약 실패, 무엇이든 타이머가 안 왔을 때다.
    const expMs = NOW + DAY
    const h = harness({ record: { key: KEY, token: token({ expMs }) } })
    h.timers.length = 0

    h.setNow(expMs + 1)
    expect(h.manager.allowsPaidFeatures()).toBe(true) // 유예 안이다

    h.setNow(expMs + GRACE_DURATION_MS + 1)
    expect(h.manager.allowsPaidFeatures()).toBe(false)
  })

  it('트라이얼도 타이머 없이 스스로 닫힌다', () => {
    const h = harness({ record: { trialStartMs: NOW } })
    h.timers.length = 0
    expect(h.manager.allowsPaidFeatures()).toBe(true)
    h.setNow(NOW + TRIAL_DURATION_MS)
    expect(h.manager.allowsPaidFeatures()).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 활성화 · 해제 · 재검증
// ─────────────────────────────────────────────────────────────────────────────

describe('activate', () => {
  it('형태가 아닌 키는 네트워크를 치지 않는다', async () => {
    const h = harness()
    expect(await h.manager.activate('BICMAC-A2B3-C4D5-E6F7-G8H9')).toBe('invalidKey')
    expect(h.calls).toEqual([])
  })

  it('성공하면 라이선스가 되고 키와 토큰이 저장된다', async () => {
    const h = harness({
      client: { activate: async () => ({ ok: true, value: { token: token(), expiresAtMs: NOW + TOKEN_TTL_MS } }) }
    })
    expect(await h.manager.activate(`  ${KEY.toLowerCase()}  `)).toBeNull()
    expect(h.record.key).toBe(KEY)
    expect(h.manager.getState().status).toBe('licensed')
  })

  it('서버가 준 토큰이 검증에 실패하면 저장하지 않는다', async () => {
    // hosts를 고쳐 세운 가짜 서버가 여기서 걸린다.
    const other = makeKeyPair()
    const forged = signTestToken(
      { lic: 'f', dev: DEVICE, prod: PRODUCT_SLUG, exp: 9_999_999_999, iat: 0 },
      other.privateKey
    )
    const h = harness({
      client: { activate: async () => ({ ok: true, value: { token: forged, expiresAtMs: NOW + TOKEN_TTL_MS } }) }
    })
    expect(await h.manager.activate(KEY)).toBe('badToken')
    expect(h.record.token).toBeNull()
  })

  it('서버가 만료된 토큰을 주면 라이선스로 치지 않는다', async () => {
    // 서명은 진짜인데 이미 지난 토큰이다. 성공이라고 답하면 사용자는 아무 오류
    // 없이 "트라이얼이 끝났습니다"를 보게 된다 — 돈은 냈는데.
    const h = harness({
      client: {
        activate: async () => ({ ok: true, value: { token: token({ expMs: NOW - DAY }), expiresAtMs: NOW - DAY } })
      }
    })
    expect(await h.manager.activate(KEY)).toBe('badToken')
  })

  it('디스크에 못 적으면 성공이라 답하지 않는다', async () => {
    // 서버 슬롯은 이미 소모됐는데 성공이라 답하면, 사용자는 활성화됐다고 믿고
    // 재시작하면 사라져 있다. 다음에 다시 넣으면 이번엔 기기 한도에 걸린다.
    const h = harness({
      storeWritable: false,
      client: { activate: async () => ({ ok: true, value: { token: token(), expiresAtMs: NOW + TOKEN_TTL_MS } }) }
    })
    expect(await h.manager.activate(KEY)).toBe('saveFailed')
    expect(h.manager.getState().status).not.toBe('licensed')
  })

  it('서버 거부를 그대로 전한다', async () => {
    for (const [error, expected] of [
      ['deviceLimit', 'deviceLimit'],
      ['revoked', 'revoked'],
      ['unknownKey', 'unknownKey'],
      ['network', 'network']
    ] as const) {
      const h = harness({ client: { activate: async () => ({ ok: false, error }) } })
      expect(await h.manager.activate(KEY)).toBe(expected)
    }
  })
})

describe('활성화·해제의 실패 경로 — 전부 사용자 문구가 있는 것들', () => {
  it('기기를 못 읽으면 네트워크도 안 치고 noDevice', async () => {
    const h = harness({ device: null })
    expect(await h.manager.activate(KEY)).toBe('noDevice')
    expect(h.calls).toEqual([])
  })

  it('해제할 것이 없으면 nothing', async () => {
    expect(await harness().manager.deactivate()).toBe('nothing')
  })

  it('슬롯은 잡혔는데 기기를 못 대면 nothing이 아니라 noDevice', async () => {
    // "해제할 게 없다"고 말하면, 두 번째 기기를 여는 유일한 방법에서 사용자를
    // 돌려보내게 된다. 슬롯은 실제로 잡혀 있다.
    const h = harness({ device: null, record: { key: KEY, token: token() } })
    expect(await h.manager.deactivate()).toBe('noDevice')
  })

  it('서버가 해제를 거부하면 refused이고 키는 남는다', async () => {
    for (const error of ['revoked', 'deviceLimit'] as const) {
      const h = harness({
        record: { key: KEY, token: token() },
        client: { deactivate: async () => ({ ok: false, error }) }
      })
      expect(await h.manager.deactivate()).toBe('refused')
      expect(h.record.key).toBe(KEY)
    }
  })

  it('서버도 토큰도 멀쩡한데 상태가 라이선스가 안 되면 incomplete', async () => {
    // 여기서 성공이라고 답하면 사용자는 활성화됐다고 믿는데 앱은 잠긴 채다.
    // 오류도 없고 다시 해볼 것도 없는, 가장 나쁜 침묵이다.
    let reads = 0
    const stored: LicenseRecord = { key: null, token: null, lastSeenMs: 0, trialStartMs: NOW - 40 * DAY }
    const manager = createLicenseManager({
      client: {
        activate: async () => ({ ok: true, value: { token: token(), expiresAtMs: NOW + TOKEN_TTL_MS } }),
        validate: async () => ({ ok: false, error: 'network' }),
        deactivate: async () => ({ ok: false, error: 'network' })
      },
      store: {
        read: () => ({ ...stored }),
        write: (next) => {
          Object.assign(stored, next)
          return true
        }
      },
      publicKey,
      // 활성화는 기기를 한 번 읽고(1회), 뒤이은 settle이 다시 읽는다(2회).
      // 두 번째에서 하드웨어 조회가 실패하면 토큰은 멀쩡한데 상태가 안 선다.
      device: () => (++reads <= 1 ? DEVICE : null),
      deviceName: null,
      enforced: true,
      now: () => NOW,
      setTimer: () => () => {}
    })
    expect(await manager.activate(KEY)).toBe('incomplete')
  })

  it('재검증에서 받은 토큰도 검증에 실패하면 저장하지 않는다', async () => {
    // 활성화 경로만 막고 이쪽을 열어두면, 가짜 서버가 배경 갱신으로 들어온다.
    const other = makeKeyPair()
    const forged = signTestToken(
      { lic: licenseHash(KEY), dev: DEVICE, prod: PRODUCT_SLUG, exp: 9_999_999_999, iat: 0 },
      other.privateKey
    )
    const stored = token({ iatMs: NOW - 20 * DAY, expMs: NOW + 10 * DAY })
    const h = harness({
      record: { key: KEY, token: stored },
      client: { validate: async () => ({ ok: true, value: { token: forged, expiresAtMs: NOW + TOKEN_TTL_MS } }) }
    })
    await h.manager.revalidateIfNeeded()
    expect(h.record.token).toBe(stored)
  })

  it('기기를 못 읽으면 재검증도 네트워크를 치지 않는다', async () => {
    const h = harness({ device: null, record: { key: KEY, token: token() } })
    await h.manager.revalidateIfNeeded()
    expect(h.calls).toEqual([])
  })
})

describe('경계값', () => {
  it('유예 천장 정각은 닫힌 것으로 본다', () => {
    const expMs = NOW - GRACE_DURATION_MS // 천장이 정확히 NOW다
    const h = harness({ record: { key: KEY, token: token({ expMs }), trialStartMs: NOW - 40 * DAY } })
    expect(h.manager.getState().status).toBe('trialExpired')

    const h2 = harness({ record: { key: KEY, token: token({ expMs: expMs + 1000 }), trialStartMs: NOW - 40 * DAY } })
    expect(h2.manager.getState().status).toBe('grace')
  })

  it('이미 지난 마감에는 타이머를 걸지 않는다', () => {
    // 걸면 지연이 0 이하라 즉시 깨어 settle을 무한히 다시 돈다.
    const h = harness({
      record: { key: KEY, token: token({ expMs: NOW - GRACE_DURATION_MS - DAY }), trialStartMs: NOW - 40 * DAY }
    })
    expect(h.timers).toHaveLength(0)
  })
})

describe('deactivate', () => {
  it('서버가 확인해야 로컬을 지운다', async () => {
    // 실패했는데 지우면 라이선스도 없고 슬롯은 잡힌 채인 상태가 된다 —
    // 지원 메일 말고는 빠져나올 길이 없는 유일한 결과다.
    const h = harness({ record: { key: KEY, token: token() }, client: { deactivate: async () => ({ ok: false, error: 'network' }) } })
    expect(await h.manager.deactivate()).toBe('network')
    expect(h.record.key).toBe(KEY)
    expect(h.manager.getState().status).toBe('licensed')
  })

  it('해제 한도는 사람이 풀어줘야 하는 상황으로 구분한다', async () => {
    const h = harness({
      record: { key: KEY, token: token() },
      client: { deactivate: async () => ({ ok: false, error: 'deactivationLimit' }) }
    })
    expect(await h.manager.deactivate()).toBe('deactivationLimit')
    expect(h.record.key).toBe(KEY)
  })

  it('서버에 이미 없는 기기는 로컬도 정리한다', async () => {
    for (const error of ['unknownKey', 'deviceNotActive'] as const) {
      const h = harness({ record: { key: KEY, token: token() }, client: { deactivate: async () => ({ ok: false, error }) } })
      expect(await h.manager.deactivate()).toBeNull()
      expect(h.record.key).toBeNull()
      expect(h.record.token).toBeNull()
    }
  })

  it('서버는 풀었는데 로컬을 못 지우면 성공이라 답하지 않는다', async () => {
    // 슬롯은 이미 서버에서 풀렸다. 여기서 성공이라 답하면 사용자는 다른 기기에
    // 키를 넣고, 이 기기는 재시작 때 옛 토큰을 다시 읽어 **같은 키가 두 기기에서**
    // 활성인 상태가 된다. 활성화에만 걸어 뒀던 확인이다.
    const h = harness({
      storeWritable: false,
      record: { key: KEY, token: token() },
      client: { deactivate: async () => ({ ok: true, value: undefined }) }
    })
    expect(await h.manager.deactivate()).toBe('saveFailed')
  })

  it('해제해도 트라이얼이 새로 열리지는 않는다', async () => {
    const h = harness({
      record: { key: KEY, token: token(), trialStartMs: NOW - 40 * DAY },
      client: { deactivate: async () => ({ ok: true, value: undefined }) }
    })
    expect(await h.manager.deactivate()).toBeNull()
    expect(h.manager.getState().status).toBe('trialExpired')
  })
})

describe('revalidateIfNeeded', () => {
  it('반감기 전에는 네트워크를 치지 않는다', async () => {
    const h = harness({ record: { key: KEY, token: token({ iatMs: NOW - DAY, expMs: NOW + 29 * DAY }) } })
    await h.manager.revalidateIfNeeded()
    expect(h.calls).toEqual([])
  })

  it('반감기를 지나면 갱신한다', async () => {
    const fresh = token({ iatMs: NOW, expMs: NOW + TOKEN_TTL_MS })
    const h = harness({
      record: { key: KEY, token: token({ iatMs: NOW - 20 * DAY, expMs: NOW + 10 * DAY }) },
      client: { validate: async () => ({ ok: true, value: { token: fresh, expiresAtMs: NOW + TOKEN_TTL_MS } }) }
    })
    await h.manager.revalidateIfNeeded()
    expect(h.calls).toEqual(['validate'])
    expect(h.record.token).toBe(fresh)
  })

  it('서버가 거부하면 라이선스를 닫되 키는 남긴다', async () => {
    // 취소는 서명 없이 도착하므로, 잘못된 취소는 재활성화 한 번으로 회복 가능한
    // 자리에 있어야 한다.
    const h = harness({
      record: { key: KEY, token: token({ iatMs: NOW - 20 * DAY, expMs: NOW + 10 * DAY }), trialStartMs: NOW - 40 * DAY },
      client: { validate: async () => ({ ok: false, error: 'revoked' }) }
    })
    await h.manager.revalidateIfNeeded()
    expect(h.record.token).toBeNull()
    expect(h.record.key).toBe(KEY)
    expect(h.manager.getState().status).toBe('trialExpired')
  })

  it('서버에 못 닿으면 아무것도 건드리지 않는다', async () => {
    // 이걸 거부처럼 다루면 기차 터널 하나가 라이선스를 지운다.
    const stored = token({ iatMs: NOW - 20 * DAY, expMs: NOW + 10 * DAY })
    const h = harness({
      record: { key: KEY, token: stored },
      client: { validate: async () => ({ ok: false, error: 'network' }) }
    })
    await h.manager.revalidateIfNeeded()
    expect(h.record.token).toBe(stored)
    expect(h.manager.getState().status).toBe('licensed')
  })

  it('만료된 토큰(유예 중)은 반감기와 무관하게 갱신을 시도한다', async () => {
    const h = harness({
      record: { key: KEY, token: token({ expMs: NOW - DAY }) },
      client: { validate: async () => ({ ok: false, error: 'network' }) }
    })
    await h.manager.revalidateIfNeeded()
    expect(h.calls).toEqual(['validate'])
    expect(h.manager.getState().status).toBe('grace')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// enforcement 스위치
// ─────────────────────────────────────────────────────────────────────────────

describe('시작 비용', () => {
  it('키도 토큰도 없으면 기기 id를 아예 읽지 않는다', async () => {
    // 하드웨어 조회는 서브프로세스다(macOS는 `ioreg`). enforcement가 꺼져 있는
    // 동안은 그게 **모든** 설치라서, 여기서 읽으면 전원이 실행할 때마다 쓰지도
    // 않을 비용을 시작 경로에서 낸다.
    const h = harness()
    await h.manager.revalidateIfNeeded()
    expect(h.deviceReads()).toBe(0)
  })

  it('토큰이 있으면 읽는다 — 검증에 필요하다', () => {
    const h = harness({ record: { key: KEY, token: token() } })
    expect(h.deviceReads()).toBeGreaterThan(0)
  })

  it('트라이얼 평가가 디스크를 한 번만 만진다', () => {
    // 시계 래칫과 시작일을 각자 쓰면 마이크로초 간격으로 writeFileSync가 두 번
    // 돈다. 메인 프로세스의 동기 쓰기라 그대로 시작 시간이 된다.
    const h = harness()
    expect(h.writes()).toBe(1)
  })

  it('라이선스 상태로 시작하면 아예 안 쓴다', () => {
    // 바뀐 것이 없다. 실행할 때마다 쓰면 SSD에 이유 없는 쓰기가 쌓인다.
    const h = harness({ record: { key: KEY, token: token(), lastSeenMs: NOW } })
    expect(h.writes()).toBe(0)
  })
})

describe('상태가 움직이면 화면에 알린다', () => {
  it('마감 타이머가 상태를 옮기면 알림이 나간다', () => {
    // 이 알림이 유일하게 렌더러에 "만료됐다"를 전한다. 없으면 설정 화면이
    // 만료된 라이선스를 계속 "활성"이라고 말한다 — 데스크톱 앱은 몇 주씩 안 꺼진다.
    const expMs = NOW + DAY
    const h = harness({ record: { key: KEY, token: token({ expMs }), trialStartMs: NOW - 40 * DAY } })
    h.changes.length = 0
    h.setNow(expMs)
    h.fireDueTimers()
    expect(h.changes.map((c) => c.status)).toEqual(['grace'])
  })

  it('같은 상태를 다시 도출한 것으로는 알리지 않는다', async () => {
    // 안 그러면 렌더러가 실행마다 아무 의미 없는 갱신을 받고, 구독자 전부가 재렌더된다.
    const h = harness({ record: { key: KEY, token: token({ iatMs: NOW - DAY, expMs: NOW + 29 * DAY }) } })
    h.changes.length = 0
    await h.manager.revalidateIfNeeded()
    expect(h.changes).toEqual([])
  })

  it('마감이 실린 상태는 마감까지 함께 전한다', () => {
    // 화면이 "n일 남음"을 그리려면 이 값이 필요하다.
    const h = harness({ record: { trialStartMs: NOW } })
    const trial = h.changes.find((c) => c.status === 'trial')
    expect(trial && 'untilMs' in trial && trial.untilMs).toBe(NOW + TRIAL_DURATION_MS)
  })
})

describe('dispose', () => {
  it('걸려 있던 마감 타이머를 끈다', () => {
    // 안 끄면 종료가 최대 24일 지연된다.
    const h = harness({ record: { key: KEY, token: token({ expMs: NOW + DAY }) } })
    expect(h.timers).toHaveLength(1)
    h.manager.dispose()
    expect(h.timers).toHaveLength(0)
  })

  it('종료 뒤 착륙한 응답이 타이머를 되살리지 않는다', async () => {
    // 진행 중인 validate는 종료 중에도 착륙한다. 그게 settle을 부르면 몇 주짜리
    // 타이머가 다시 걸려 프로세스가 그만큼 안 끝난다.
    let land: (r: ClientResult<{ token: string; expiresAtMs: number }>) => void = () => {}
    const h = harness({
      record: { key: KEY, token: token({ iatMs: NOW - 20 * DAY, expMs: NOW + 10 * DAY }) },
      client: { validate: () => new Promise((resolve) => (land = resolve)) }
    })
    const pending = h.manager.revalidateIfNeeded()

    h.manager.dispose()
    expect(h.timers).toHaveLength(0)

    land({ ok: true, value: { token: token(), expiresAtMs: NOW + TOKEN_TTL_MS } })
    await pending
    expect(h.timers).toHaveLength(0)
  })
})

describe('getMaskedKey', () => {
  it('마지막 묶음만 남긴다', async () => {
    const h = harness({
      client: { activate: async () => ({ ok: true, value: { token: token(), expiresAtMs: NOW + TOKEN_TTL_MS } }) }
    })
    expect(h.manager.getMaskedKey()).toBeNull()
    await h.manager.activate(KEY)
    expect(h.manager.getMaskedKey()).toBe('GREENDAY-••••-••••-••••-G8H9')
    // 가운데 묶음이 그대로 새면 가리는 의미가 없다.
    expect(h.manager.getMaskedKey()).not.toContain('A2B3')
  })
})

describe('재검증 예약 — 한 번 실패하고 끝나지 않는다', () => {
  /** 재검증 타이머만 골라 낸다. 마감 타이머와 섞이면 무엇을 깨우는지 알 수 없다. */
  const revalidateTimers = (h: Harness): { atMs: number; fire: () => void }[] =>
    h.timers.filter((t) => t.atMs - NOW <= 6 * 60 * 60 * 1000 + 1)

  it('시작할 때 못 닿으면 물러서며 다시 시도한다', async () => {
    // 이게 없으면 **시작 순간 잠깐 오프라인이었던 것만으로** 영영 다시 묻지
    // 않고, 유예가 끝나는 날 멀쩡한 구매자가 잠긴다.
    let attempts = 0
    const h = harness({
      record: { key: KEY, token: token({ iatMs: NOW - 20 * DAY, expMs: NOW + 10 * DAY }) },
      client: {
        validate: async () => {
          attempts += 1
          return { ok: false, error: 'network' }
        }
      }
    })
    await h.manager.revalidateIfNeeded()
    expect(attempts).toBe(1)

    const first = revalidateTimers(h)
    expect(first).toHaveLength(1)
    expect(first[0].atMs - NOW).toBe(60_000) // 1분 뒤
  })

  it('연속 실패마다 간격이 늘고 상한에서 멈춘다', async () => {
    const h = harness({
      record: { key: KEY, token: token({ iatMs: NOW - 20 * DAY, expMs: NOW + 10 * DAY }) },
      client: { validate: async () => ({ ok: false, error: 'network' }) }
    })
    const delays: number[] = []
    for (let i = 0; i < 8; i += 1) {
      await h.manager.revalidateIfNeeded()
      const armed = revalidateTimers(h)
      delays.push(armed[armed.length - 1].atMs - NOW)
      h.timers.length = 0
    }
    // 1·2·4·8·16·32·60·60분 — 물러서되 한 시간을 넘지 않는다.
    expect(delays).toEqual([60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000, 3_600_000, 3_600_000])
  })

  it('한 번 성공하면 간격이 처음으로 돌아간다', async () => {
    let fail = true
    const h = harness({
      record: { key: KEY, token: token({ iatMs: NOW - 20 * DAY, expMs: NOW + 10 * DAY }) },
      client: {
        validate: async () =>
          fail
            ? { ok: false, error: 'network' as const }
            : {
                ok: true as const,
                // 갱신은 됐지만 여전히 반감기 뒤다 — 다음 호출도 네트워크를 친다.
                // 아니면 "성공 뒤 다시 실패"를 시험할 수가 없다.
                value: {
                  token: token({ iatMs: NOW - 20 * DAY, expMs: NOW + 10 * DAY }),
                  expiresAtMs: NOW + 10 * DAY
                }
              }
      }
    })
    await h.manager.revalidateIfNeeded()
    await h.manager.revalidateIfNeeded()
    h.timers.length = 0

    fail = false
    await h.manager.revalidateIfNeeded()
    // 성공했으니 재시도가 아니라 평소 주기로 돌아간다.
    expect(revalidateTimers(h)[0].atMs - NOW).toBe(6 * 60 * 60 * 1000)
    h.timers.length = 0

    // 그리고 **다음 실패는 처음부터** 물러선다. 카운터를 안 되돌리면 여기서
    // 4분이 나오고, 며칠 켜 둔 앱이 잠깐 끊길 때마다 한 시간씩 기다리게 된다.
    fail = true
    await h.manager.revalidateIfNeeded()
    expect(revalidateTimers(h)[0].atMs - NOW).toBe(60_000)
  })

  it('서버가 거부하면 재시도하지 않는다', async () => {
    // 답이 왔고 그 답이 아니오였다. 다시 물어도 같은 답이 온다 — 물러서며
    // 두드리는 것은 취소된 키로 서버를 때리는 것뿐이다.
    const h = harness({
      record: { key: KEY, token: token({ iatMs: NOW - 20 * DAY, expMs: NOW + 10 * DAY }), trialStartMs: NOW - 40 * DAY },
      client: { validate: async () => ({ ok: false, error: 'revoked' }) }
    })
    await h.manager.revalidateIfNeeded()
    expect(revalidateTimers(h)[0].atMs - NOW).toBe(6 * 60 * 60 * 1000)
  })

  it('키가 없어도 주기는 계속 돈다 — 트라이얼 마감을 봐야 한다', async () => {
    const h = harness()
    await h.manager.revalidateIfNeeded()
    expect(revalidateTimers(h).length).toBeGreaterThan(0)
  })

  it('dispose 뒤에는 다시 걸지 않는다', async () => {
    const h = harness({
      record: { key: KEY, token: token({ iatMs: NOW - 20 * DAY, expMs: NOW + 10 * DAY }) },
      client: { validate: async () => ({ ok: false, error: 'network' }) }
    })
    h.manager.dispose()
    await h.manager.revalidateIfNeeded()
    expect(h.timers).toHaveLength(0)
  })
})

describe('enforcement가 꺼져 있으면', () => {
  it('아무것도 잠기지 않는다', () => {
    const h = harness({ enforced: false, record: { trialStartMs: NOW - 100 * DAY } })
    expect(h.manager.allowsPaidFeatures()).toBe(true)
  })

  it('트라이얼 시작일을 기록조차 하지 않는다', async () => {
    // 이게 무료 기간을 정직하게 만든다 — 지금 쓰는 사람들의 30일이 살 것도 없는
    // 상태에서 타들어가면 안 된다. 켜는 날 모두가 온전한 창을 받는다.
    const h = harness({ enforced: false })
    expect(h.record.trialStartMs).toBeNull()
    // 실행마다 도는 경로를 한 바퀴 더 돌려도 여전히 아무것도 안 쓴다.
    await h.manager.revalidateIfNeeded()
    expect(h.record.trialStartMs).toBeNull()
  })

  it('그래도 활성화는 되고 상태는 라이선스가 된다', async () => {
    // 서버가 열린 뒤 enforcement를 켜기 전에도 실거래를 검증할 수 있어야 한다.
    const h = harness({
      enforced: false,
      client: { activate: async () => ({ ok: true, value: { token: token(), expiresAtMs: NOW + TOKEN_TTL_MS } }) }
    })
    expect(await h.manager.activate(KEY)).toBeNull()
    expect(h.manager.getState().status).toBe('licensed')
  })
})
