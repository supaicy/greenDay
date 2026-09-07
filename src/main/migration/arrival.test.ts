import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dismissOldAppHint, releaseSecretsLock, runArrival } from './arrival'
import { runBridge } from './bridge'
import { BRIDGE_BACKUP_DIR, MIGRATION_STATE_FILE, SENTINEL_FILE, readState } from './handoff'
import { _resetSecretsGateForTests, secretsGate } from './secrets-gate'
import { sealSecret } from '../secret-envelope'
import { DEFAULT_GOOGLE_CONFIG, readGoogleConfig } from '../google-config'
import { fakeCrypto } from './fake-crypto.helper'

/**
 * 새 번들 ID(v2.0.0)의 첫 실행 — codex 6단계의 분기 하나하나.
 *
 * 순서가 곧 계약이다: 잠금 → 백업 → 표식 → **안내 → sentinel** → 게이트 → 옛 앱 → 저장 시작.
 * 각 테스트는 호출 순서까지 본다(`calls`).
 */

let tmp: string
const NOW = '2026-09-08T09:00:00.000Z'
let calls: string[]

function deps(over: Partial<Parameters<typeof runArrival>[0]> = {}) {
  return {
    userData: tmp,
    appVersion: '2.0.0',
    bundleId: 'com.begreen.greenday',
    crypto: fakeCrypto('old'),
    now: () => NOW,
    singleInstance: true,
    holdSaves: () => calls.push('hold'),
    releaseSaves: () => calls.push('release'),
    notifyKeychain: () => calls.push('notify'),
    oldAppPresent: () => true,
    googleTokensReadable: () => true,
    ...over
  }
}

/** 옛 앱이 남긴 것들 — 브리지가 실제로 돈 뒤의 userData. */
function seedFromBridge(): void {
  writeFileSync(join(tmp, 'ticktick-data.json'), JSON.stringify({ tasks: [{ id: 1 }] }), 'utf-8')
  runBridge({ userData: tmp, appVersion: '1.5.0', bundleId: 'com.haru.app', crypto: fakeCrypto('old'), now: () => '2026-09-01T00:00:00.000Z' })
}

function seedGoogleTokens(key = fakeCrypto('old')): void {
  const tokens = { accessToken: 'a', refreshToken: 'r', expiresAt: '2030-01-01T00:00:00.000Z', scope: 's' }
  writeFileSync(
    join(tmp, 'google-config.json'),
    JSON.stringify({ ...DEFAULT_GOOGLE_CONFIG, tokens_enc: sealSecret(JSON.stringify(tokens), 'google.tokens', 'google', key), account: 'me' }),
    'utf-8'
  )
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'greenday-arrival-'))
  calls = []
  _resetSecretsGateForTests()
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
  _resetSecretsGateForTests()
})

describe('행복한 길 — 브리지를 거쳤고 Keychain 을 허용했다', () => {
  it('안내 → sentinel ok → 열림 → 옛 앱 제거 안내 → 저장 시작', () => {
    seedFromBridge()
    seedGoogleTokens()
    const r = runArrival(deps())
    expect(calls).toEqual(['hold', 'notify', 'release'])
    expect(r.status).toEqual({
      mode: 'arrival',
      performed: true,
      bridgeMarker: true,
      sentinel: 'ok',
      secretsLocked: false,
      lockReason: null,
      googleReconnect: false,
      oldAppRemovable: true,
      oldAppHintDismissed: false
    })
    expect(secretsGate().locked).toBe(false)
    expect(readState(join(tmp, MIGRATION_STATE_FILE))?.arrival).toMatchObject({
      appVersion: '2.0.0',
      bundleId: 'com.begreen.greenday',
      completedAt: NOW,
      sentinel: 'ok'
    })
  })

  it('브리지의 백업이 있으면 덮지 않고 그것을 쓴다', () => {
    seedFromBridge()
    writeFileSync(join(tmp, 'ticktick-data.json'), JSON.stringify({ tasks: [] }), 'utf-8')
    runArrival(deps())
    expect(JSON.parse(readFileSync(join(tmp, BRIDGE_BACKUP_DIR, 'ticktick-data.json'), 'utf-8')).tasks).toHaveLength(1)
  })

  it('두 번째 실행은 백업·안내를 반복하지 않고 게이트만 다시 잰다', () => {
    seedFromBridge()
    runArrival(deps())
    calls = []
    const r = runArrival(deps())
    expect(r.status.performed).toBe(false)
    expect(calls).toEqual(['hold', 'release'])
    expect(r.status.secretsLocked).toBe(false)
  })
})

describe('Keychain 거부·잠김·항목 없음 — 보호 모드', () => {
  it('sentinel denied → 잠금, Google 재연결, 옛 앱 안내는 보류, 암호문은 그대로', () => {
    seedFromBridge()
    seedGoogleTokens()
    const before = readFileSync(join(tmp, 'google-config.json'), 'utf-8')
    const r = runArrival(deps({ crypto: fakeCrypto('new-random-key') }))
    expect(calls).toEqual(['hold', 'notify', 'release'])
    expect(r.status).toMatchObject({
      sentinel: 'denied',
      secretsLocked: true,
      lockReason: 'denied',
      googleReconnect: true,
      oldAppRemovable: false
    })
    expect(secretsGate()).toEqual({ locked: true, reason: 'denied' })
    expect(readFileSync(join(tmp, 'google-config.json'), 'utf-8')).toBe(before)
    // 시퀀스는 끝났다고 기록한다 — 다음 실행이 백업·안내를 반복하지 않는다.
    expect(readState(join(tmp, MIGRATION_STATE_FILE))?.arrival?.completedAt).toBe(NOW)
  })

  it('나중에 허용하면(같은 키로 열림) 다음 실행에서 게이트가 풀린다', () => {
    seedFromBridge()
    seedGoogleTokens()
    runArrival(deps({ crypto: fakeCrypto('other') }))
    expect(secretsGate().locked).toBe(true)
    const r = runArrival(deps({ crypto: fakeCrypto('old') }))
    expect(r.status.performed).toBe(false)
    expect(r.status.secretsLocked).toBe(false)
    expect(readGoogleConfig(join(tmp, 'google-config.json'), fakeCrypto('old')).tokens).not.toBeNull()
  })

  it('암호화가 불가능한 환경(unavailable)도 잠근다 — 암호문을 건드릴 수 없으니', () => {
    seedFromBridge()
    seedGoogleTokens()
    const r = runArrival(deps({ crypto: fakeCrypto('old', false) }))
    expect(r.status).toMatchObject({ sentinel: 'unavailable', secretsLocked: true, lockReason: 'unavailable' })
  })

  it('sentinel 이 다른 값으로 풀리면(mismatch) 잠근다', () => {
    seedFromBridge()
    writeFileSync(join(tmp, SENTINEL_FILE), fakeCrypto('old').encrypt('tampered'), 'utf-8')
    const r = runArrival(deps())
    expect(r.status).toMatchObject({ sentinel: 'mismatch', secretsLocked: true })
  })

  it('사용자가 명시적으로 풀면(재연결 뒤) 새 sentinel 을 심고 연다', () => {
    seedFromBridge()
    seedGoogleTokens()
    runArrival(deps({ crypto: fakeCrypto('new') }))
    expect(secretsGate().locked).toBe(true)
    expect(releaseSecretsLock(tmp, fakeCrypto('new'))).toBe(true)
    expect(secretsGate().locked).toBe(false)
    // 다음 실행은 새 키로 ok 다.
    expect(runArrival(deps({ crypto: fakeCrypto('new') })).status.secretsLocked).toBe(false)
    // 암호화 불가면 풀 수 없다.
    _resetSecretsGateForTests()
    expect(releaseSecretsLock(tmp, fakeCrypto('new', false))).toBe(false)
  })
})

describe('브리지를 거치지 않은 사용자', () => {
  it('v1.4.1 에서 바로 왔다(암호문 없음): 안내도 검사도 없이 열리고, 백업과 sentinel 을 만든다', () => {
    writeFileSync(join(tmp, 'ticktick-data.json'), JSON.stringify({ tasks: [{ id: 1 }] }), 'utf-8')
    const r = runArrival(deps())
    expect(calls).toEqual(['hold', 'release'])
    expect(r.status).toMatchObject({ bridgeMarker: false, sentinel: 'skipped', secretsLocked: false, oldAppRemovable: true })
    expect(existsSync(join(tmp, BRIDGE_BACKUP_DIR, 'ticktick-data.json'))).toBe(true)
    expect(existsSync(join(tmp, SENTINEL_FILE))).toBe(true)
  })

  it('암호문은 있는데 sentinel 이 없다(2.0.x 개발 빌드): 안내 뒤 missing → 잠금, sentinel 은 심지 않는다', () => {
    seedGoogleTokens(fakeCrypto('dev'))
    const r = runArrival(deps({ crypto: fakeCrypto('dev') }))
    expect(calls).toEqual(['hold', 'notify', 'release'])
    expect(r.status).toMatchObject({ bridgeMarker: false, sentinel: 'missing', secretsLocked: true, lockReason: 'missing', googleReconnect: true })
    expect(existsSync(join(tmp, SENTINEL_FILE))).toBe(false)
  })

  it('완전히 새 설치: 아무 파일도 없어도 조용히 지나간다', () => {
    const r = runArrival(deps({ oldAppPresent: () => false }))
    expect(r.status).toMatchObject({ performed: true, sentinel: 'skipped', secretsLocked: false, oldAppRemovable: false })
  })
})

describe('Google 재연결 판정', () => {
  it('열렸지만 토큰이 실제로 안 읽히면(봉투 거절 등) 재연결', () => {
    seedFromBridge()
    seedGoogleTokens()
    const r = runArrival(deps({ googleTokensReadable: () => false }))
    expect(r.status.googleReconnect).toBe(true)
  })

  it('토큰이 없으면 재연결을 말하지 않는다', () => {
    seedFromBridge()
    const r = runArrival(deps({ crypto: fakeCrypto('other') }))
    expect(r.status.secretsLocked).toBe(true)
    expect(r.status.googleReconnect).toBe(false)
  })
})

describe('가장자리', () => {
  it('두 번째 인스턴스는 파일을 만지지 않는다', () => {
    seedFromBridge()
    const notify = vi.fn()
    const r = runArrival(deps({ singleInstance: false, notifyKeychain: notify }))
    expect(calls).toEqual([])
    expect(notify).not.toHaveBeenCalled()
    expect(r.status.performed).toBe(false)
    expect(readState(join(tmp, MIGRATION_STATE_FILE))?.arrival).toBeNull()
  })

  it('중간에 던져도 저장 잠금은 풀린다', () => {
    seedFromBridge()
    expect(() =>
      runArrival(
        deps({
          notifyKeychain: () => {
            throw new Error('dialog exploded')
          }
        })
      )
    ).toThrow('dialog exploded')
    expect(calls).toEqual(['hold', 'release'])
  })

  it('옛 앱 안내를 닫으면 영구히 남고, 다음 실행에도 다시 뜨지 않는다', () => {
    seedFromBridge()
    runArrival(deps())
    dismissOldAppHint(tmp)
    const r = runArrival(deps())
    expect(r.status.oldAppHintDismissed).toBe(true)
    expect(r.status.oldAppRemovable).toBe(false)
  })

  it('DB 스키마는 건드리지 않는다 — 데이터 파일 바이트가 같다', () => {
    const raw = JSON.stringify({ tasks: [{ id: 1, weird: 'legacy-field' }], lists: [], version: 'whatever' })
    writeFileSync(join(tmp, 'ticktick-data.json'), raw, 'utf-8')
    runArrival(deps())
    expect(readFileSync(join(tmp, 'ticktick-data.json'), 'utf-8')).toBe(raw)
  })
})
