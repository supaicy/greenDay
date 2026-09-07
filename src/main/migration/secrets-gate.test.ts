import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _resetSecretsGateForTests, lockSecrets, preserveCiphertext, secretsGate, secretsLocked, unlockSecrets } from './secrets-gate'
import { encodeApiKey, decodeApiKey } from '../database'
import { DEFAULT_CONFIG, decodeConfig, readConfigFile, writeConfigFile } from '../calendar-config'
import { DEFAULT_GOOGLE_CONFIG, readGoogleConfig, writeGoogleConfig } from '../google-config'
import { sealSecret } from '../secret-envelope'
import { fakeCrypto } from './fake-crypto.helper'

/**
 * 보호 모드 — Keychain 거부 상태에서 저장 한 번이 원본 암호문을 지우던 경로를 막는다.
 *
 * 각 테스트는 "옛 키로 봉인된 암호문이 파일에 있고, 새 앱은 그 키가 없다"를 흉내 낸다:
 * 파일은 `fakeCrypto('old')`로, 앱은 `fakeCrypto('new')`로.
 */

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'greenday-gate-'))
  _resetSecretsGateForTests()
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
  _resetSecretsGateForTests()
})

describe('게이트 상태', () => {
  it('처음은 열려 있고, 잠그면 이유가 남는다', () => {
    expect(secretsLocked()).toBe(false)
    lockSecrets('denied')
    expect(secretsGate()).toEqual({ locked: true, reason: 'denied' })
    unlockSecrets()
    expect(secretsGate()).toEqual({ locked: false, reason: null })
  })
})

describe('preserveCiphertext', () => {
  it('열려 있으면 아무것도 하지 않는다 — 평소 동작 그대로', () => {
    const p = join(tmp, 'f.json')
    writeFileSync(p, JSON.stringify({ x_enc: 'old' }), 'utf-8')
    expect(preserveCiphertext({ x_enc: null }, p, 'x_enc')).toEqual({ x_enc: null })
  })

  it('잠겨 있고 새 값이 비면 파일의 암호문을 되살린다', () => {
    lockSecrets('denied')
    const p = join(tmp, 'f.json')
    writeFileSync(p, JSON.stringify({ x_enc: 'old' }), 'utf-8')
    expect(preserveCiphertext({ x_enc: null, other: 1 }, p, 'x_enc')).toEqual({ x_enc: 'old', other: 1 })
    expect(preserveCiphertext({}, p, 'x_enc')).toEqual({ x_enc: 'old' })
  })

  it('잠겨 있어도 새 값이 있으면 그것이 이긴다 — 사용자가 새로 넣은 비밀', () => {
    lockSecrets('denied')
    const p = join(tmp, 'f.json')
    writeFileSync(p, JSON.stringify({ x_enc: 'old' }), 'utf-8')
    expect(preserveCiphertext({ x_enc: 'fresh' }, p, 'x_enc')).toEqual({ x_enc: 'fresh' })
  })

  it('clearSecret(연결 해제)이면 잠겨 있어도 지운다', () => {
    lockSecrets('denied')
    const p = join(tmp, 'f.json')
    writeFileSync(p, JSON.stringify({ x_enc: 'old' }), 'utf-8')
    expect(preserveCiphertext({ x_enc: null }, p, 'x_enc', true)).toEqual({ x_enc: null })
  })

  it('파일이 없거나 깨졌거나 그 칸이 비어 있으면 손대지 않는다', () => {
    lockSecrets('denied')
    expect(preserveCiphertext({ x_enc: null }, join(tmp, 'nope.json'), 'x_enc')).toEqual({ x_enc: null })
    const p = join(tmp, 'f.json')
    writeFileSync(p, '{broken', 'utf-8')
    expect(preserveCiphertext({ x_enc: null }, p, 'x_enc')).toEqual({ x_enc: null })
    writeFileSync(p, JSON.stringify({ x_enc: '' }), 'utf-8')
    expect(preserveCiphertext({ x_enc: null }, p, 'x_enc')).toEqual({ x_enc: null })
  })
})

describe('세 writer — 잠긴 채 저장해도 원본 암호문이 남는다', () => {
  const oldKey = fakeCrypto('old')
  const newKey = fakeCrypto('new')

  it('CalDAV 앱 암호 (calendar-config.json)', () => {
    const p = join(tmp, 'calendar-config.json')
    const sealed = sealSecret('app-pass', 'caldav.password', 'https://caldav.icloud.com|me@icloud.com', oldKey)
    writeFileSync(p, JSON.stringify({ ...DEFAULT_CONFIG, serverUrl: 'https://caldav.icloud.com', username: 'me@icloud.com', password_enc: sealed }), 'utf-8')

    // 새 앱이 읽는다: 키가 달라 비밀번호는 null 이다.
    const loaded = readConfigFile(p, newKey)
    expect(loaded.password).toBeNull()

    // 잠긴 채 lastSyncAt 만 바꿔 저장 — 예전에는 여기서 password_enc 가 null 로 덮였다.
    lockSecrets('denied')
    writeConfigFile(p, { ...loaded, lastSyncAt: '2026-09-07T00:00:00.000Z' }, newKey)
    const raw = JSON.parse(readFileSync(p, 'utf-8'))
    expect(raw.password_enc).toBe(sealed)
    expect(raw.lastSyncAt).toBe('2026-09-07T00:00:00.000Z')
    // 옛 키를 되찾으면(사용자가 "항상 허용") 그대로 풀린다.
    expect(decodeConfig(raw, oldKey).password).toBe('app-pass')

    // 연결 해제는 잠겨 있어도 지운다.
    writeConfigFile(p, { ...DEFAULT_CONFIG }, newKey, { clearSecret: true })
    expect(JSON.parse(readFileSync(p, 'utf-8')).password_enc).toBeNull()
  })

  it('Google 토큰 (google-config.json)', () => {
    const p = join(tmp, 'google-config.json')
    const tokens = { accessToken: 'a', refreshToken: 'r', expiresAt: '2030-01-01T00:00:00.000Z', scope: 's' }
    const sealed = sealSecret(JSON.stringify(tokens), 'google.tokens', 'google', oldKey)
    writeFileSync(p, JSON.stringify({ ...DEFAULT_GOOGLE_CONFIG, tokens_enc: sealed, account: 'me@gmail.com' }), 'utf-8')

    const loaded = readGoogleConfig(p, newKey)
    expect(loaded.tokens).toBeNull()

    lockSecrets('denied')
    writeGoogleConfig(p, { ...loaded, lastError: 'x' }, newKey)
    const raw = JSON.parse(readFileSync(p, 'utf-8'))
    expect(raw.tokens_enc).toBe(sealed)
    expect(readGoogleConfig(p, oldKey).tokens).toEqual(tokens)

    writeGoogleConfig(p, { ...DEFAULT_GOOGLE_CONFIG }, newKey, { clearSecret: true })
    expect(JSON.parse(readFileSync(p, 'utf-8')).tokens_enc).toBeNull()
  })

  it('AI API 키 — encode/decode 순수 함수 + preserve 의 조합', () => {
    const p = join(tmp, 'ai-config.json')
    const stored = encodeApiKey({ provider: 'openai', apiKey: 'sk-secret' }, oldKey)
    writeFileSync(p, JSON.stringify(stored), 'utf-8')
    // 새 키로 읽으면 apiKey 는 null 이고 apiKey_enc 는 메모리에서 사라진다 — 그대로 저장하면 원본이 없어진다.
    const decoded = decodeApiKey(JSON.parse(readFileSync(p, 'utf-8')), newKey)
    expect(decoded.apiKey).toBeNull()
    expect(decoded.apiKey_enc).toBeUndefined()

    lockSecrets('denied')
    const reencoded = preserveCiphertext(encodeApiKey({ ...decoded, model: 'gpt-4o-mini' }, newKey), p, 'apiKey_enc')
    expect(reencoded.apiKey_enc).toBe(stored.apiKey_enc)
    expect(decodeApiKey(reencoded, oldKey).apiKey).toBe('sk-secret')
  })
})
