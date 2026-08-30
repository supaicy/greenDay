/**
 * 웨이브 1.5 — 저장 실패가 조용히 성공으로 끝나던 경로.
 *
 * 예전에는 비동기 저장 실패가 콘솔로만 갔다. mutator IPC는 이미 성공으로 끝난
 * 뒤라, 사용자는 편집이 저장됐다고 믿고 앱을 닫는다. 검증이 임시 경로를
 * 디렉터리로 막아 재현했다: 할일 생성은 성공했는데 450ms 뒤에도 디스크에 없었다.
 *
 * 여기서 못 박는 것: **실패는 상태에 남고, 스스로 다시 시도하고, 종료가 판정을
 * 돌려준다.**
 *
 * 실패 주입은 `.tmp-<세대>` 자리에 **디렉터리를 미리 만들어** 한다. `openSync`가
 * EISDIR로 던지므로 디스크 오류를 흉내내는 가장 싼 방법이고, 검증자가 쓴 것과
 * 같은 방식이다.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SAVE_DEBOUNCE_MS = 300
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

let root: string
let dbPath: string
let db: typeof import('./database')

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'greenday-savefail-'))
  dbPath = join(root, 'ticktick-data.json')
  vi.resetModules()
  const dir = root
  vi.doMock('electron', () => ({
    app: { getPath: () => dir, getVersion: () => '0.0.0-test' },
    safeStorage: { isEncryptionAvailable: () => false }
  }))
  db = await import('./database')
  db.initDatabase()
  // 부팅이 예약한 저장을 먼저 확정시킨다 — 그래야 아래 세대 번호가 예측 가능하다.
  db.closeDatabase()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** 다음 저장이 쓰려는 임시 경로를 디렉터리로 막는다. */
function blockNextWrite(): string {
  const blocked = `${dbPath}.tmp-2`
  mkdirSync(blocked, { recursive: true })
  return blocked
}

const taskIds = (): string[] =>
  (JSON.parse(readFileSync(dbPath, 'utf-8')).tasks as { id: string }[]).map((t) => t.id)

describe('비동기 저장 실패', () => {
  it('조용히 성공하지 않는다 — 상태에 남는다', async () => {
    blockNextWrite()
    db.createTask({ id: 'a', title: 'A', listId: 'inbox' })
    await sleep(SAVE_DEBOUNCE_MS + 100)

    const health = db.saveHealth()
    expect(health.settled, '저장이 실패했는데 건강하다고 답했다').toBe(false)
    expect(health.pending).toBe(true)
    expect(health.lastError).toBeTruthy()
    expect(taskIds(), '전제: 디스크에는 아직 없다').toEqual([])
  })

  // 예전에는 로그만 남기고 반환해서, 다음 mutation이 올 때까지(또는 영영)
  // 디스크가 메모리를 따라잡지 못했다. 디스크가 잠깐 가득 차거나 폴더 권한이
  // 바뀐 경우는 스스로 회복되어야 한다.
  it('막힘이 풀리면 스스로 다시 시도해 따라잡는다', async () => {
    const blocked = blockNextWrite()
    db.createTask({ id: 'a', title: 'A', listId: 'inbox' })
    await sleep(SAVE_DEBOUNCE_MS + 100)
    expect(db.saveHealth().settled).toBe(false)

    rmSync(blocked, { recursive: true, force: true })
    // 첫 재시도는 500ms 뒤다.
    await sleep(900)

    expect(db.saveHealth().settled, '재시도가 없어 영영 밀린 채다').toBe(true)
    expect(taskIds()).toEqual(['a'])
  })

  it('성공하면 지난 실패 표시를 지운다', async () => {
    const blocked = blockNextWrite()
    db.createTask({ id: 'a', title: 'A', listId: 'inbox' })
    await sleep(SAVE_DEBOUNCE_MS + 100)
    expect(db.saveHealth().lastError).toBeTruthy()

    rmSync(blocked, { recursive: true, force: true })
    await sleep(900)
    expect(db.saveHealth().lastError).toBeNull()
  })
})

describe('종료 플러시 실패', () => {
  // 예전에는 오류를 삼켰다. 그러면 마지막 편집을 잃은 종료와 정상 종료가
  // 호출처에서 구별되지 않는다 — 셸이 사용자에게 알리거나 종료를 막을 근거가 없다.
  it('closeDatabase가 실패를 알린다', () => {
    blockNextWrite()
    db.createTask({ id: 'a', title: 'A', listId: 'inbox' })

    expect(db.closeDatabase(), '잃은 종료를 성공이라고 답했다').toBe(false)
    expect(db.saveHealth().lastError).toBeTruthy()
  })

  it('정상 종료는 true를 돌려준다', () => {
    db.createTask({ id: 'a', title: 'A', listId: 'inbox' })
    expect(db.closeDatabase()).toBe(true)
    expect(taskIds()).toEqual(['a'])
  })

  it('쓸 것이 없으면 true다', () => {
    expect(db.closeDatabase()).toBe(true)
  })
})

describe('복구 세션의 백업 보호', () => {
  /** primary는 손상, `.bak`은 정상인 상태를 만든다. */
  function corruptPrimaryHealthyBackup(): string {
    db.createTask({ id: 'good', title: '살아 있어야 한다', listId: 'inbox' })
    db.closeDatabase()
    db.createTask({ id: 'newer', title: '두 번째', listId: 'inbox' })
    db.closeDatabase() // 이제 .bak = [good], primary = [good, newer]
    const healthy = readFileSync(`${dbPath}.bak`, 'utf-8')
    writeFileSync(dbPath, '{"tasks":[{"id"', 'utf-8')
    return healthy
  }

  // 검증이 실측한 경로: 복구 뒤 첫 저장이 손상된 primary를 건강한 `.bak` 위로
  // 회전시켜, 방금 우리를 구해 준 정상본이 손상 JSON으로 덮였다.
  it('복구 직후 첫 저장이 건강한 .bak을 손상본으로 덮지 않는다', async () => {
    const healthy = corruptPrimaryHealthyBackup()

    db.initDatabase() // .bak에서 복구한다
    expect(db.isDatabaseReadOnly()).toBe(false)
    db.createTask({ id: 'after', title: '복구 뒤 편집', listId: 'inbox' })
    db.closeDatabase()

    const backupNow = readFileSync(`${dbPath}.bak`, 'utf-8')
    expect(() => JSON.parse(backupNow), '.bak이 손상 JSON으로 덮였다').not.toThrow()
    expect(backupNow).toBe(healthy)
  })

  it('손상된 primary를 격리해 둔다 — 지원 문의로 되살릴 수 있게', () => {
    corruptPrimaryHealthyBackup()
    db.initDatabase()

    const quarantined = readdirSync(root).filter((f) => f.includes('.corrupt-'))
    expect(quarantined).toHaveLength(1)
    expect(readFileSync(join(root, quarantined[0]), 'utf-8')).toBe('{"tasks":[{"id"')
  })

  it('복구한 내용 위에서 정상적으로 이어 쓴다', async () => {
    corruptPrimaryHealthyBackup()
    db.initDatabase()
    db.createTask({ id: 'after', title: '복구 뒤 편집', listId: 'inbox' })
    db.closeDatabase()

    expect(taskIds().sort()).toEqual(['after', 'good'])
    // 두 번째 저장부터는 회전이 정상으로 돌아온다.
    db.createTask({ id: 'third', title: '세 번째', listId: 'inbox' })
    db.closeDatabase()
    const backup = JSON.parse(readFileSync(`${dbPath}.bak`, 'utf-8'))
    expect((backup.tasks as { id: string }[]).map((t) => t.id).sort()).toEqual(['after', 'good'])
  })

  it('primary가 없어서 복구한 경우에도 .bak을 지킨다', () => {
    db.createTask({ id: 'good', title: 'G', listId: 'inbox' })
    db.closeDatabase()
    db.createTask({ id: 'newer', title: 'N', listId: 'inbox' })
    db.closeDatabase()
    const healthy = readFileSync(`${dbPath}.bak`, 'utf-8')
    rmSync(dbPath)

    db.initDatabase()
    db.createTask({ id: 'after', title: 'A', listId: 'inbox' })
    db.closeDatabase()

    expect(readFileSync(`${dbPath}.bak`, 'utf-8')).toBe(healthy)
    expect(existsSync(dbPath)).toBe(true)
  })
})
