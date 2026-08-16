import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readHistoryFile, writeHistoryFile, encodeApiKey, decodeApiKey, capEvents } from './database'

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

// === capEvents: score.events 상한 ===
describe('capEvents', () => {
  it('상한 미만 → 원본 배열 반환', () => {
    const arr = [1, 2, 3]
    expect(capEvents(arr, 5)).toEqual([1, 2, 3])
  })

  it('상한과 동일 → 원본 배열 반환', () => {
    const arr = Array.from({ length: 200 }, (_, i) => i)
    const result = capEvents(arr)
    expect(result).toHaveLength(200)
    expect(result[0]).toBe(0)
    expect(result[199]).toBe(199)
  })

  it('상한 초과 → 최근 N개(꼬리)만 보존', () => {
    // 201개 이벤트에서 최근 200개(인덱스 1~200)만 남아야 함
    const arr = Array.from({ length: 201 }, (_, i) => i)
    const result = capEvents(arr)
    expect(result).toHaveLength(200)
    expect(result[0]).toBe(1) // 가장 오래된 이벤트 제거
    expect(result[199]).toBe(200) // 최신 이벤트 보존
  })

  it('max 파라미터 커스터마이즈', () => {
    const arr = [10, 20, 30, 40, 50]
    const result = capEvents(arr, 3)
    expect(result).toEqual([30, 40, 50])
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

// 태스크 영속화 왕복. 이 경계에는 그동안 테스트가 없어서, 새 컬럼이 생겨도
// createTask가 그걸 저장하지 않는 것을 아무것도 잡지 못했다.
describe('task 영속화 왕복', () => {
  let db: typeof import('./database')

  beforeEach(async () => {
    vi.resetModules()
    const dir = tmp
    vi.doMock('electron', () => ({
      app: { getPath: () => dir, on: () => {} },
      safeStorage: { isEncryptionAvailable: () => false }
    }))
    db = await import('./database')
    db.initDatabase()
  })

  it('createTask가 회차 오버라이드를 저장한다', () => {
    db.createTask({
      id: 'r1',
      title: '운동',
      listId: 'inbox',
      isRecurring: true,
      recurringPattern: 'weekly:1',
      scheduledStart: '2026-08-10T14:00:00',
      scheduledEnd: '2026-08-10T15:00:00',
      scheduledOverrides: { '2026-08-17': { start: '2026-08-17T08:00:00', end: '2026-08-17T09:00:00' } }
    })
    const row = (db.getTasks() as Record<string, unknown>[]).find((t) => t.id === 'r1')
    expect(row?.scheduled_start).toBe('2026-08-10T14:00:00')
    // 컬럼은 JSON 문자열로 저장된다(mapTask가 그렇게 읽는다).
    expect(JSON.parse(row?.scheduled_overrides as string)).toEqual({
      '2026-08-17': { start: '2026-08-17T08:00:00', end: '2026-08-17T09:00:00' }
    })
  })

  it('updateTask가 오버라이드를 설정하고 null로 지운다', () => {
    db.createTask({ id: 'r2', title: '독서', listId: 'inbox' })
    db.updateTask({ id: 'r2', scheduledOverrides: { '2026-08-18': null } })
    let row = (db.getTasks() as Record<string, unknown>[]).find((t) => t.id === 'r2')
    expect(JSON.parse(row?.scheduled_overrides as string)).toEqual({ '2026-08-18': null })

    db.updateTask({ id: 'r2', scheduledOverrides: null })
    row = (db.getTasks() as Record<string, unknown>[]).find((t) => t.id === 'r2')
    expect(row?.scheduled_overrides).toBeNull()
  })

  it('구버전 데이터 행에도 오버라이드 컬럼을 채운다', () => {
    // 이 필드가 생기기 전에 만들어진 행(키 자체가 없음)
    const legacy = {
      lists: [],
      tasks: [{ id: 'old', title: '옛날 할일', list_id: 'inbox', sort_order: 1 }],
      habits: [],
      habitLogs: [],
      folders: [],
      pomodoroSessions: [],
      score: { total: 0, events: [] }
    }
    writeFileSync(join(tmp, 'ticktick-data.json'), JSON.stringify(legacy), 'utf-8')
    db.initDatabase()
    const row = (db.getTasks() as Record<string, unknown>[]).find((t) => t.id === 'old')
    expect(row).toBeDefined()
    expect(row).toHaveProperty('scheduled_overrides')
    expect(row?.scheduled_overrides).toBeNull()
  })
})

// 구버전에서는 요일을 고르지 않고 '매주'를 적용할 수 있었고, 그 행은
// recurring_pattern='weekly:'로 남았다. 예전 파서는 Number('')=0으로 읽어
// 매주 일요일로 굴러갔지만, 새 파서는 빈 목록이라 다음 회차를 계산하지 못한다
// → 업그레이드하면 그 시리즈가 아무 신호 없이 끝난다. 로드 시 정규화한다.
describe('구버전 weekly: 패턴 정규화', () => {
  let db: typeof import('./database')

  const loadWith = async (tasks: Record<string, unknown>[]) => {
    vi.resetModules()
    const dir = tmp
    vi.doMock('electron', () => ({ app: { getPath: () => dir, on: () => {} }, safeStorage: { isEncryptionAvailable: () => false } }))
    writeFileSync(
      join(tmp, 'ticktick-data.json'),
      JSON.stringify({ lists: [], tasks, habits: [], habitLogs: [], folders: [], pomodoroSessions: [], score: { total: 0, events: [] } }),
      'utf-8'
    )
    db = await import('./database')
    db.initDatabase()
    return db.getTasks() as Record<string, unknown>[]
  }

  it('마감일의 요일로 패턴을 복구한다', async () => {
    // 2026-08-12는 수요일(3)
    const rows = await loadWith([
      { id: 'w', title: '주간회의', list_id: 'inbox', sort_order: 1, is_recurring: 1, recurring_pattern: 'weekly:', due_date: '2026-08-12' }
    ])
    expect(rows.find((t) => t.id === 'w')?.recurring_pattern).toBe('weekly:3')
  })

  it('기준 삼을 마감일이 없으면 반복을 끈다 — 조용히 멈추는 대신 화면에 보이게', async () => {
    const rows = await loadWith([
      { id: 'n', title: '기한없음', list_id: 'inbox', sort_order: 1, is_recurring: 1, recurring_pattern: 'weekly:', due_date: null }
    ])
    const row = rows.find((t) => t.id === 'n')
    expect(row?.recurring_pattern).toBeNull()
    expect(row?.is_recurring).toBe(0)
  })

  it('정상 패턴은 건드리지 않는다', async () => {
    const rows = await loadWith([
      { id: 'ok', title: '정상', list_id: 'inbox', sort_order: 1, is_recurring: 1, recurring_pattern: 'weekly:1,3', due_date: '2026-08-10' }
    ])
    expect(rows.find((t) => t.id === 'ok')?.recurring_pattern).toBe('weekly:1,3')
  })
})
