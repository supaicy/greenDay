import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fakeCrypto } from './fake-crypto.helper'
import {
  BACKUP_MANIFEST,
  BRIDGE_BACKUP_DIR,
  SENTINEL_PLAINTEXT,
  backupExists,
  backupUserData,
  checkIntegrity,
  checkSentinel,
  emptyState,
  hasStoredCiphertexts,
  readState,
  writeSentinel,
  writeStateAtomic
} from './handoff'

/**
 * 번들 ID 마이그레이션의 파일 원시 연산. 2026-09-07, docs/27 의 codex 3·6단계.
 *
 * 전부 임시 디렉터리다 — electron 없이, 실제 Keychain 없이 돈다. `KeyCrypto`는 키를
 * 흉내 내는 가짜다: 같은 키면 풀리고, 다른 키면 던진다(safeStorage와 같은 계약).
 */

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'greenday-handoff-'))
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('상태 파일', () => {
  it('없으면 null, 쓰면 그대로 읽힌다', () => {
    const p = join(tmp, 'migration-state.json')
    expect(readState(p)).toBeNull()
    const state = { ...emptyState(), noticeSnoozedUntil: '2026-09-10T00:00:00.000Z' }
    writeStateAtomic(p, state)
    expect(readState(p)).toEqual(state)
    // 임시 파일이 남지 않는다.
    expect(readdirSync(tmp).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('깨진 파일은 옆으로 치우고 null — 다음 쓰기가 원인을 덮지 않는다', () => {
    const p = join(tmp, 'migration-state.json')
    writeFileSync(p, '{not json', 'utf-8')
    expect(readState(p)).toBeNull()
    expect(existsSync(p)).toBe(false)
    expect(readdirSync(tmp).some((f) => f.startsWith('migration-state.json.corrupt-'))).toBe(true)
  })

  it('모르는 version 은 처음으로 본다', () => {
    const p = join(tmp, 'migration-state.json')
    writeFileSync(p, JSON.stringify({ version: 2, bridge: null }), 'utf-8')
    expect(readState(p)).toBeNull()
  })

  it('레코드 모양이 아니면 그 칸만 null 로', () => {
    const p = join(tmp, 'migration-state.json')
    writeFileSync(p, JSON.stringify({ version: 1, bridge: { appVersion: 5 }, arrival: 'x' }), 'utf-8')
    expect(readState(p)).toEqual(emptyState())
  })
})

describe('무결성', () => {
  it('데이터 파일이 없으면 missing (새 설치)', () => {
    expect(checkIntegrity(tmp)).toEqual({ status: 'missing', backupReadable: false, taskCount: null })
  })

  it('정상 파일은 ok 와 할일 수', () => {
    writeFileSync(join(tmp, 'ticktick-data.json'), JSON.stringify({ tasks: [{}, {}], lists: [] }), 'utf-8')
    expect(checkIntegrity(tmp)).toEqual({ status: 'ok', backupReadable: false, taskCount: 2 })
  })

  it('primary 가 깨지고 .bak 이 살아 있으면 corrupt + backupReadable', () => {
    writeFileSync(join(tmp, 'ticktick-data.json'), '{broken', 'utf-8')
    writeFileSync(join(tmp, 'ticktick-data.json.bak'), JSON.stringify({ tasks: [{}] }), 'utf-8')
    expect(checkIntegrity(tmp)).toEqual({ status: 'corrupt', backupReadable: true, taskCount: 1 })
  })

  it('primary 가 없고 .bak 만 있으면 ok — database.ts 가 그쪽에서 연다', () => {
    writeFileSync(join(tmp, 'ticktick-data.json.bak'), JSON.stringify({ tasks: [] }), 'utf-8')
    expect(checkIntegrity(tmp).status).toBe('ok')
  })
})

describe('백업', () => {
  const seed = (): void => {
    writeFileSync(join(tmp, 'ticktick-data.json'), '{"tasks":[]}', 'utf-8')
    writeFileSync(join(tmp, 'ai-config.json'), '{"apiKey_enc":"abc"}', 'utf-8')
    mkdirSync(join(tmp, 'attachments'))
    writeFileSync(join(tmp, 'attachments', 'a.txt'), 'hello', 'utf-8')
  }

  it('데이터 파일·첨부를 복사하고 매니페스트를 남긴다 — 암호문은 그대로', () => {
    seed()
    const r = backupUserData(tmp, BRIDGE_BACKUP_DIR, { appVersion: '1.5.0', at: '2026-09-07T00:00:00.000Z' })
    expect(r.existed).toBe(false)
    expect(r.copied).toEqual(['ticktick-data.json', 'ai-config.json', 'attachments/'])
    expect(readFileSync(join(r.dir, 'ai-config.json'), 'utf-8')).toBe('{"apiKey_enc":"abc"}')
    expect(readFileSync(join(r.dir, 'attachments', 'a.txt'), 'utf-8')).toBe('hello')
    const manifest = JSON.parse(readFileSync(join(r.dir, BACKUP_MANIFEST), 'utf-8'))
    expect(manifest).toMatchObject({ version: 1, appVersion: '1.5.0', files: r.copied })
    expect(backupExists(tmp, BRIDGE_BACKUP_DIR)).toBe(true)
    // 스테이징이 남지 않는다.
    expect(readdirSync(tmp).some((f) => f.includes('.partial-'))).toBe(false)
  })

  it('이미 있으면 절대 덮지 않는다 — "전환 전"의 뜻', () => {
    seed()
    backupUserData(tmp, BRIDGE_BACKUP_DIR, { appVersion: '1.5.0', at: 'a' })
    writeFileSync(join(tmp, 'ticktick-data.json'), '{"tasks":[{"changed":1}]}', 'utf-8')
    const r = backupUserData(tmp, BRIDGE_BACKUP_DIR, { appVersion: '2.0.0', at: 'b' })
    expect(r.existed).toBe(true)
    expect(readFileSync(join(r.dir, 'ticktick-data.json'), 'utf-8')).toBe('{"tasks":[]}')
  })

  it('매니페스트 없는 반쪽 디렉터리는 옆으로 치우고 다시 만든다', () => {
    seed()
    mkdirSync(join(tmp, BRIDGE_BACKUP_DIR))
    writeFileSync(join(tmp, BRIDGE_BACKUP_DIR, 'ticktick-data.json'), 'half', 'utf-8')
    mkdirSync(join(tmp, `${BRIDGE_BACKUP_DIR}.partial-old`))
    const r = backupUserData(tmp, BRIDGE_BACKUP_DIR, { appVersion: '1.5.0', at: 'a' })
    expect(r.existed).toBe(false)
    expect(readFileSync(join(r.dir, 'ticktick-data.json'), 'utf-8')).toBe('{"tasks":[]}')
    expect(existsSync(join(tmp, `${BRIDGE_BACKUP_DIR}.partial-old`))).toBe(false)
    expect(readdirSync(tmp).some((f) => f.startsWith(`${BRIDGE_BACKUP_DIR}.incomplete-`))).toBe(true)
  })

  it('빈 userData 도 백업이 된다(파일 0개, 매니페스트만)', () => {
    const r = backupUserData(tmp, BRIDGE_BACKUP_DIR, { appVersion: '1.5.0', at: 'a' })
    expect(r.copied).toEqual([])
    expect(backupExists(tmp, BRIDGE_BACKUP_DIR)).toBe(true)
  })
})

describe('sentinel', () => {
  const p = (): string => join(tmp, 'keycheck.sentinel')

  it('같은 키면 ok', () => {
    expect(writeSentinel(p(), fakeCrypto('k1'))).toBe('written')
    expect(checkSentinel(p(), fakeCrypto('k1'))).toBe('ok')
  })

  it('다른 키(항목 삭제 → 새 랜덤 키, 또는 거부)면 denied', () => {
    writeSentinel(p(), fakeCrypto('k1'))
    expect(checkSentinel(p(), fakeCrypto('k2'))).toBe('denied')
  })

  it('없으면 missing, 암호화 불가면 unavailable', () => {
    expect(checkSentinel(p(), fakeCrypto('k1'))).toBe('missing')
    writeSentinel(p(), fakeCrypto('k1'))
    expect(checkSentinel(p(), fakeCrypto('k1', false))).toBe('unavailable')
    expect(writeSentinel(join(tmp, 'x'), fakeCrypto('k1', false))).toBe('unavailable')
  })

  it('풀리는데 값이 다르면 mismatch, base64 가 아니면 corrupt', () => {
    writeFileSync(p(), fakeCrypto('k1').encrypt('something-else'), 'utf-8')
    expect(checkSentinel(p(), fakeCrypto('k1'))).toBe('mismatch')
    writeFileSync(p(), '!!not base64!!', 'utf-8')
    expect(checkSentinel(p(), fakeCrypto('k1'))).toBe('corrupt')
    writeFileSync(p(), '', 'utf-8')
    expect(checkSentinel(p(), fakeCrypto('k1'))).toBe('corrupt')
  })

  it('평문 자체는 비밀이 아니다 — 파일에 평문이 그대로 있지는 않다', () => {
    writeSentinel(p(), fakeCrypto('k1'))
    expect(readFileSync(p(), 'utf-8')).not.toContain(SENTINEL_PLAINTEXT)
  })
})

describe('hasStoredCiphertexts', () => {
  it('세 파일 모두 없거나 비어 있으면 false — v1.4.1 사용자의 보통 상태', () => {
    expect(hasStoredCiphertexts(tmp)).toBe(false)
    writeFileSync(join(tmp, 'ai-config.json'), JSON.stringify({ apiKey_enc: null }), 'utf-8')
    writeFileSync(join(tmp, 'google-config.json'), '{broken', 'utf-8')
    expect(hasStoredCiphertexts(tmp)).toBe(false)
  })

  it('하나라도 암호문이 있으면 true', () => {
    writeFileSync(join(tmp, 'calendar-config.json'), JSON.stringify({ password_enc: 'abc' }), 'utf-8')
    expect(hasStoredCiphertexts(tmp)).toBe(true)
  })
})
