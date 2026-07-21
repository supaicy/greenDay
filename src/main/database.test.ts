import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readHistoryFile, writeHistoryFile, encodeApiKey, decodeApiKey } from './database'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'haru-db-test-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('chat history file I/O', () => {
  it('readHistoryFile: 파일이 없으면 빈 배열', () => {
    expect(readHistoryFile(join(tmp, 'missing.json'))).toEqual([])
  })

  it('readHistoryFile: 손상된 JSON은 빈 배열', () => {
    const p = join(tmp, 'corrupt.json')
    writeFileSync(p, '{not valid', 'utf-8')
    expect(readHistoryFile(p)).toEqual([])
  })

  it('readHistoryFile: messages가 배열이 아니면 빈 배열', () => {
    const p = join(tmp, 'weird.json')
    writeFileSync(p, JSON.stringify({ version: 1, messages: 'nope' }), 'utf-8')
    expect(readHistoryFile(p)).toEqual([])
  })

  it('writeHistoryFile → readHistoryFile 라운드트립 일치', () => {
    const p = join(tmp, 'ai-chat.json')
    const msgs = [
      { id: 'u1', role: 'user', content: 'hi', timestamp: '2026-04-20T00:00:00.000Z' },
      { id: 'a1', role: 'assistant', content: 'hello', timestamp: '2026-04-20T00:00:01.000Z' }
    ]
    writeHistoryFile(p, msgs)
    expect(readHistoryFile(p)).toEqual(msgs)
  })

  it('writeHistoryFile은 version: 1을 파일에 기록', () => {
    const p = join(tmp, 'ai-chat.json')
    writeHistoryFile(p, [])
    const raw = JSON.parse(readFileSync(p, 'utf-8'))
    expect(raw.version).toBe(1)
    expect(raw.messages).toEqual([])
  })
})

// === API 키 암호화 ===
const fakeCrypto = {
  available: () => true,
  encrypt: (s: string) => `enc(${s})`,
  decrypt: (b64: string) => b64.replace(/^enc\(/, '').replace(/\)$/, '')
}

describe('API 키 암호화', () => {
  it('encodeApiKey: 평문 키를 암호화하고 apiKey를 null로 만든다', () => {
    const out = encodeApiKey({ provider: 'openai', apiKey: 'sk-123' }, fakeCrypto)
    expect(out.apiKey).toBeNull()
    expect(out.apiKey_enc).toBe('enc(sk-123)')
  })

  it('decodeApiKey: 암호문을 평문 키로 복원한다', () => {
    const out = decodeApiKey({ provider: 'openai', apiKey: null, apiKey_enc: 'enc(sk-123)' }, fakeCrypto)
    expect(out.apiKey).toBe('sk-123')
    expect(out.apiKey_enc).toBeUndefined()
  })

  it('encode→decode 라운드트립', () => {
    const enc = encodeApiKey({ provider: 'openai', apiKey: 'sk-xyz' }, fakeCrypto)
    const dec = decodeApiKey(enc, fakeCrypto)
    expect(dec.apiKey).toBe('sk-xyz')
  })

  it('암호화 불가 시 평문 그대로 통과', () => {
    const noCrypto = { available: () => false, encrypt: () => '', decrypt: () => '' }
    const out = encodeApiKey({ apiKey: 'sk-1' }, noCrypto)
    expect(out.apiKey).toBe('sk-1')
    expect(out.apiKey_enc).toBeUndefined()
  })

  it('decodeApiKey: crypto 불가 시 apiKey_enc를 보존한다 (키 소실 방지)', () => {
    const noCrypto = { available: () => false, encrypt: () => '', decrypt: () => '' }
    const out = decodeApiKey({ provider: 'openai', apiKey: null, apiKey_enc: 'enc(sk-1)' }, noCrypto)
    expect(out.apiKey_enc).toBe('enc(sk-1)')
    expect(out.apiKey).toBeNull()
  })
})
