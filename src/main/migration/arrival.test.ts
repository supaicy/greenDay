import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dismissOldAppHint, releaseSecretsLock, runArrival } from './arrival'
import { runBridge } from './bridge'
import { BRIDGE_BACKUP_DIR, MIGRATION_STATE_FILE, SENTINEL_FILE, checkIntegrity, readState } from './handoff'
import { _resetSecretsGateForTests, secretsGate } from './secrets-gate'
import { sealSecret } from '../secret-envelope'
import { DEFAULT_GOOGLE_CONFIG, readGoogleConfig } from '../google-config'
import { fakeCrypto } from './fake-crypto.helper'

// 실제 구현을 그대로 감싼다 — 동작은 같고, "불렸는가"만 볼 수 있게 한다.
vi.mock('./handoff', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./handoff')>()
  return { ...actual, checkIntegrity: vi.fn(actual.checkIntegrity) }
})

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
    // 지킬 암호문이 있어야 잠금이 의미를 갖는다 — 없으면 `applyGate`가 (옳게) 열어 둔다.
    seedGoogleTokens()
    writeFileSync(join(tmp, SENTINEL_FILE), fakeCrypto('old').encrypt('tampered'), 'utf-8')
    const r = runArrival(deps())
    expect(r.status).toMatchObject({ sentinel: 'mismatch', secretsLocked: true })
  })

  it('지킬 암호문이 하나도 없으면 denied 여도 잠그지 않는다 — 옛 앱 안내가 막히던 버그', () => {
    // 연동(AI·CalDAV·Google)을 하나도 안 쓴 v1.4.1 사용자: `*_enc` 가 어디에도 없고
    // 브리지가 sentinel 만 심어 뒀다. 여기서 Keychain 을 거부하면 전에는 영구히 잠겼는데,
    // `preserveCiphertext` 가 되살릴 암호문이 없으니 그 잠금은 아무것도 지키지 못한 채
    // 닫는 버튼 없는 보호 모드 배너만 매 실행 띄우고 `oldAppRemovable` 을 영원히 false 로
    // 만들었다 — 옛 haru 앱을 지워도 된다는 안내가 영영 안 뜬다.
    seedFromBridge()
    const r = runArrival(deps({ crypto: fakeCrypto('new-random-key') }))
    expect(r.status).toMatchObject({ sentinel: 'denied', secretsLocked: false, lockReason: null, oldAppRemovable: true })
    expect(secretsGate().locked).toBe(false)
  })

  it('암호문이 없으면 unavailable·mismatch 도 마찬가지로 열어 둔다', () => {
    seedFromBridge()
    expect(runArrival(deps({ crypto: fakeCrypto('old', false) })).status).toMatchObject({
      sentinel: 'unavailable',
      secretsLocked: false,
      oldAppRemovable: true
    })
    _resetSecretsGateForTests()
    writeFileSync(join(tmp, SENTINEL_FILE), fakeCrypto('old').encrypt('tampered'), 'utf-8')
    expect(runArrival(deps()).status).toMatchObject({ sentinel: 'mismatch', secretsLocked: false, oldAppRemovable: true })
  })

  // 위 면제가 열어 주는 사용자가 바로 다음에 하는 일이 연동 추가다(AI 키·CalDAV 암호·Google).
  // 면제가 낡은 sentinel 을 그대로 두면, 방금 지금 키로 올바르게 넣은 비밀값 앞에서 다음
  // 실행(completedBefore)이 `ciphertexts=true` + 같은 낡은 결과를 보고 잠근다 — 닫을 수 없는
  // 보호 모드 배너, 거짓 "Google 다시 연결", `oldAppRemovable=false`.
  describe('면제로 열었으면 지금 키로 sentinel 을 새로 심는다 — 다음에 넣은 비밀값이 잠기지 않는다', () => {
    const AI_KEY = (key: string) => JSON.stringify({ apiKey_enc: fakeCrypto(key).encrypt('sk-live') })

    it.each([
      ['mismatch', 'old', () => writeFileSync(join(tmp, SENTINEL_FILE), fakeCrypto('old').encrypt('tampered'), 'utf-8')],
      ['corrupt', 'old', () => writeFileSync(join(tmp, SENTINEL_FILE), 'not base64 !!', 'utf-8')],
      ['denied', 'new-random-key', () => {}]
    ] as const)('첫 실행 %s → 열림, 비밀값을 넣은 다음 실행도 열림', (expected, key, tamper) => {
      seedFromBridge()
      tamper()
      const first = runArrival(deps({ crypto: fakeCrypto(key) }))
      expect(first.status).toMatchObject({ performed: true, sentinel: expected, secretsLocked: false })

      // 사용자가 지금 키로 AI 키를 넣는다.
      writeFileSync(join(tmp, 'ai-config.json'), AI_KEY(key), 'utf-8')
      _resetSecretsGateForTests()

      const second = runArrival(deps({ crypto: fakeCrypto(key) }))
      expect(second.status).toMatchObject({
        performed: false,
        sentinel: 'ok',
        secretsLocked: false,
        lockReason: null,
        oldAppRemovable: true
      })
      expect(secretsGate().locked).toBe(false)
    })

    it('completedBefore 분기도 같다 — 거기서 처음 낡은 sentinel 을 본 경우(missing·mismatch)', () => {
      seedFromBridge()
      runArrival(deps())
      // 완료된 설치에서 sentinel 이 사라지거나 다른 키 것으로 바뀌었다. 지킬 것은 아직 없다.
      rmSync(join(tmp, SENTINEL_FILE))
      expect(runArrival(deps()).status).toMatchObject({ performed: false, sentinel: 'missing', secretsLocked: false })
      writeFileSync(join(tmp, 'ai-config.json'), AI_KEY('old'), 'utf-8')
      expect(runArrival(deps()).status).toMatchObject({ sentinel: 'ok', secretsLocked: false })

      rmSync(join(tmp, 'ai-config.json'))
      writeFileSync(join(tmp, SENTINEL_FILE), fakeCrypto('old').encrypt('tampered'), 'utf-8')
      expect(runArrival(deps()).status).toMatchObject({ performed: false, sentinel: 'mismatch', secretsLocked: false })
      writeFileSync(join(tmp, 'ai-config.json'), AI_KEY('old'), 'utf-8')
      expect(runArrival(deps()).status).toMatchObject({ sentinel: 'ok', secretsLocked: false })
      expect(secretsGate().locked).toBe(false)
    })

    // 반대쪽도 못박는다: 지킬 암호문이 있는 잠금 앞에서는 절대 새로 심지 않는다 —
    // 새 키 sentinel 이 옛 암호문을 "검증"하는 척하게 된다.
    it('잠겼으면 sentinel 을 건드리지 않는다', () => {
      seedFromBridge()
      seedGoogleTokens()
      const before = readFileSync(join(tmp, SENTINEL_FILE), 'utf-8')
      expect(runArrival(deps({ crypto: fakeCrypto('new') })).status.secretsLocked).toBe(true)
      expect(runArrival(deps({ crypto: fakeCrypto('new') })).status.secretsLocked).toBe(true)
      expect(readFileSync(join(tmp, SENTINEL_FILE), 'utf-8')).toBe(before)
    })
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

  // 첫 실행만 고치면 고친 것이 아니다 — completedBefore 분기가 다음 실행부터 답을 뒤집는다.
  it('두 번째 실행에서도 안내가 남는다 — 잠기지 않았다고 판정을 건너뛰지 않는다', () => {
    seedFromBridge()
    seedGoogleTokens()
    const unreadable = { googleTokensReadable: () => false }
    expect(runArrival(deps(unreadable)).status.googleReconnect).toBe(true)
    // 완료된 설치 분기(performed:false)도 첫 실행과 같은 식을 써야 한다. 한때
    // `locked ? … : false` 라, 잠기지 않은 채 봉투만 거절된 사용자는 안내를 딱 한 번
    // 보고(배너 dismiss 는 실행마다 초기화되는 useState 다) 그 뒤로 Google 동기화가
    // 조용히 죽어 있었다.
    const second = runArrival(deps(unreadable))
    expect(second.status.performed).toBe(false)
    expect(second.status.secretsLocked).toBe(false)
    expect(second.status.googleReconnect).toBe(true)
  })

  // 반대쪽도 못박는다: 매 실행 조르기만 하면 정상 사용자가 닫을 수 없는 배너를 안고 산다.
  it('토큰이 정상이면 두 번째 실행은 조용하다 — 과잉 안내 회귀 방지', () => {
    seedFromBridge()
    seedGoogleTokens()
    runArrival(deps())
    expect(runArrival(deps()).status.googleReconnect).toBe(false)
  })

  it('잠긴 두 번째 실행은 그대로 재연결 안내 — 기존 동작 유지', () => {
    seedFromBridge()
    seedGoogleTokens()
    runArrival(deps({ crypto: fakeCrypto('new') }))
    const second = runArrival(deps({ crypto: fakeCrypto('new') }))
    expect(second.status.performed).toBe(false)
    expect(second.status.secretsLocked).toBe(true)
    expect(second.status.googleReconnect).toBe(true)
  })

  it('토큰이 없으면 재연결을 말하지 않는다', () => {
    seedFromBridge()
    // Google 토큰은 없지만 AI 키가 있다 — 잠글 이유(지킬 암호문)는 있는 상태다.
    writeFileSync(join(tmp, 'ai-config.json'), JSON.stringify({ apiKey_enc: 'QUFB' }), 'utf-8')
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

  // 닫은 안내는 다시 뜨지 않으니, 매 실행 데이터 파일과 .bak 을 통째로 파싱할 이유가 없다.
  it('안내를 닫았으면 completedBefore 는 옛 앱·무결성 판정을 아예 하지 않는다', () => {
    seedFromBridge()
    runArrival(deps())
    dismissOldAppHint(tmp)
    const oldAppPresent = vi.fn(() => true)
    vi.mocked(checkIntegrity).mockClear()
    const r = runArrival(deps({ oldAppPresent }))
    expect(r.status).toMatchObject({ performed: false, oldAppRemovable: false, oldAppHintDismissed: true })
    expect(oldAppPresent).not.toHaveBeenCalled()
    expect(checkIntegrity).not.toHaveBeenCalled()
  })

  it('DB 스키마는 건드리지 않는다 — 데이터 파일 바이트가 같다', () => {
    const raw = JSON.stringify({ tasks: [{ id: 1, weird: 'legacy-field' }], lists: [], version: 'whatever' })
    writeFileSync(join(tmp, 'ticktick-data.json'), raw, 'utf-8')
    runArrival(deps())
    expect(readFileSync(join(tmp, 'ticktick-data.json'), 'utf-8')).toBe(raw)
  })
})

/**
 * 배너 문구(`migration.arrival.oldAppBody`)는 "새 Greenday가 데이터를 정상적으로
 * 읽었습니다"라고 **단언**한다. 판정이 `!locked && oldAppPresent()` 뿐이던 동안에는
 * 한 건도 이어받지 못한 설치에서도 같은 말을 했고, 그 말을 믿은 사용자가 옛 데이터를
 * 열 수 있던 유일한 앱을 지웠다.
 */
describe('옛 앱 제거 안내는 데이터를 실제로 이어받았을 때만', () => {
  it('이어받은 데이터가 하나도 없으면(빈 userData·MAS 컨테이너) 안내하지 않는다', () => {
    expect(runArrival(deps()).status.oldAppRemovable).toBe(false)
  })

  // initDatabase() 가 던져 `dbFailedTitle` 대화상자가 뜬 바로 그 상태다.
  it('데이터 파일이 깨졌으면 안내하지 않는다', () => {
    writeFileSync(join(tmp, 'ticktick-data.json'), '{ this is not json', 'utf-8')
    expect(runArrival(deps()).status.oldAppRemovable).toBe(false)
  })

  // 첫 실행만 고치면 고친 것이 아니다 — completedBefore 분기가 다음 실행에서 다시 연다.
  it('두 번째 실행(completedBefore)도 같은 판정을 쓴다', () => {
    runArrival(deps())
    const r = runArrival(deps())
    expect(r.status.performed).toBe(false)
    expect(r.status.oldAppRemovable).toBe(false)
  })

  // 반대쪽도 못박는다: 지나치게 닫으면 정상 이전 사용자가 옛 앱을 영영 안고 산다.
  it('primary 가 없어도 .bak 이 읽히면 안내한다 — database.ts 가 실제로 그쪽에서 복구한다', () => {
    writeFileSync(join(tmp, 'ticktick-data.json.bak'), JSON.stringify({ tasks: [{ id: 1 }] }), 'utf-8')
    expect(runArrival(deps()).status.oldAppRemovable).toBe(true)
  })

  it('브리지를 거쳐 실제 데이터가 읽히면 두 실행 모두 안내한다', () => {
    seedFromBridge()
    expect(runArrival(deps()).status.oldAppRemovable).toBe(true)
    expect(runArrival(deps()).status.oldAppRemovable).toBe(true)
  })
})
