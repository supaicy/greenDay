import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 첫 실행 마이그레이션의 "데이터 잠금 → … → 마지막에만 저장 시작"(migration/arrival.ts).
 *
 * `holdSaves()` 동안은 mutation이 메모리에만 쌓이고 디스크에 닿지 않아야 하고,
 * `releaseSaves()` 순간 밀린 것이 한 번에 커밋돼야 한다 — 잃는 변경이 없어야 한다.
 */

const SAVE_DEBOUNCE_MS = 300
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

let root: string
let dbPath: string
let db: typeof import('./database')

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'greenday-hold-'))
  dbPath = join(root, 'ticktick-data.json')
  vi.resetModules()
  const dir = root
  vi.doMock('electron', () => ({
    app: { getPath: () => dir, getVersion: () => '0.0.0-test' },
    safeStorage: { isEncryptionAvailable: () => false }
  }))
  db = await import('./database')
  db.initDatabase()
})

afterEach(() => {
  db.closeDatabase()
  rmSync(root, { recursive: true, force: true })
})

/** initDatabase 는 빈 파일을 만들어 둔다 — 존재가 아니라 내용으로 본다. */
const tasksOnDisk = (): unknown[] => (existsSync(dbPath) ? JSON.parse(readFileSync(dbPath, 'utf-8')).tasks : [])

describe('holdSaves / releaseSaves', () => {
  it('붙드는 동안은 디바운스가 지나도 디스크에 쓰지 않는다', async () => {
    db.holdSaves()
    expect(db.savesAreHeld()).toBe(true)
    db.createTask({ id: 't1', title: 'held' })
    await sleep(SAVE_DEBOUNCE_MS + 150)
    expect(tasksOnDisk()).toEqual([])
    expect(db.saveHealth().pending).toBe(true)
  })

  it('풀면 밀린 변경이 한 번에 커밋된다 — 잃는 것이 없다', async () => {
    db.holdSaves()
    db.createTask({ id: 't1', title: 'a' })
    db.createTask({ id: 't2', title: 'b' })
    db.releaseSaves()
    expect(db.savesAreHeld()).toBe(false)
    await sleep(SAVE_DEBOUNCE_MS + 150)
    expect(tasksOnDisk().map((t) => (t as { id: string }).id)).toEqual(['t1', 't2'])
    expect(db.saveHealth().settled).toBe(true)
  })

  it('붙들지 않았으면 release 는 아무것도 하지 않는다', async () => {
    await sleep(SAVE_DEBOUNCE_MS + 150) // initDatabase 의 첫 저장이 가라앉기를 기다린다
    const before = db.saveHealth()
    expect(before.settled).toBe(true)
    db.releaseSaves()
    await sleep(SAVE_DEBOUNCE_MS + 150)
    expect(tasksOnDisk()).toEqual([])
    expect(db.saveHealth()).toEqual(before)
  })

  it('붙들려 있어도 종료 플러시는 쓴다 — 프로세스가 사라지는 마당에 메모리를 지키는 유일한 길', () => {
    db.holdSaves()
    db.createTask({ id: 't1', title: 'quit' })
    db.closeDatabase()
    expect(tasksOnDisk()).toHaveLength(1)
  })
})
