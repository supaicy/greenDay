import { describe, it, expect } from 'vitest'
import { createLicenseManager, type LicenseManager } from './licenseManager'
import { PRODUCT_SLUG } from './activationToken'
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
function token(over: { expMs?: number; iatMs?: number; dev?: string; prod?: string } = {}): string {
  const iatMs = over.iatMs ?? NOW
  return signTestToken(
    {
      lic: 'f'.repeat(64),
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
}

function harness(
  over: {
    record?: Partial<LicenseRecord>
    client?: Partial<LicenseClient>
    device?: string | null
    enforced?: boolean
    now?: number
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
      write: (next) => Object.assign(record, next)
    },
    publicKey,
    device: () => {
      deviceReads += 1
      return over.device === undefined ? DEVICE : over.device
    },
    deviceName: 'test-machine',
    enforced: over.enforced ?? true,
    now: () => current,
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
    setNow: (ms) => {
      current = ms
    },
    fireDueTimers: () => {
      const due = timers.splice(0, timers.length)
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
    h.setNow(NOW + 40 * DAY)
    h.manager.refreshTrial()
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
    const expMs = NOW - DAY
    const h = harness({
      record: { key: KEY, token: token({ expMs }), lastSeenMs: NOW + 100 * 365 * DAY }
    })
    const state = h.manager.getState()
    expect(state.status).toBe('grace')
    if (state.status === 'grace') expect(state.untilMs).toBe(expMs + GRACE_DURATION_MS)
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
        activate: async () => ({ ok: true, value: { token: token(), expiresAtMs: NOW + TOKEN_TTL_MS } })
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
    h.manager.refreshTrial()
    expect(h.manager.getState().status).toBe('grace')
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

describe('enforcement가 꺼져 있으면', () => {
  it('아무것도 잠기지 않는다', () => {
    const h = harness({ enforced: false, record: { trialStartMs: NOW - 100 * DAY } })
    expect(h.manager.allowsPaidFeatures()).toBe(true)
  })

  it('트라이얼 시작일을 기록조차 하지 않는다', () => {
    // 이게 무료 기간을 정직하게 만든다 — 지금 쓰는 사람들의 30일이 살 것도 없는
    // 상태에서 타들어가면 안 된다. 켜는 날 모두가 온전한 창을 받는다.
    const h = harness({ enforced: false })
    expect(h.record.trialStartMs).toBeNull()
    h.manager.refreshTrial()
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
