/**
 * C4 — 저장의 원자성과 세대 직렬화.
 *
 * 감사가 지연 주입으로 실측한 두 손실 경로를 여기서 못 박는다.
 *
 *   (a) **세대 미직렬화** — A 저장이 날아가는 중에 B를 추가하고 종료 플러시가
 *       `[A,B]`를 쓴 뒤 A의 콜백이 착륙하면 파일이 `[A]`로 되돌아갔다.
 *   (b) **비원자적 전체 쓰기** — 유일한 할일 DB를 대상 파일에 직접 잘라 썼다.
 *       중간에 죽으면 깨진 JSON만 남고 되돌릴 이전 정상본이 없었다.
 *
 * (a)를 재현하려면 순서를 강제해야 한다. `node:fs/promises`의 `open`을 감싸
 * **쓰기와 커밋 사이에서 붙잡는** 게이트를 끼운다 — 그 사이에 종료 플러시를
 * 밀어 넣는 것이 이 테스트의 전부다.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 열린 핸들이 쓰기를 끝낸 뒤 붙잡힐 관문. 테스트가 직접 연다. */
let hold: Promise<void> | null = null
/** 게이트에 도달했음을 테스트에 알린다. */
let reachedGate: (() => void) | null = null

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args)
      return {
        writeFile: async (...w: Parameters<typeof handle.writeFile>) => {
          const result = await handle.writeFile(...w)
          if (hold) {
            reachedGate?.()
            await hold
          }
          return result
        },
        sync: () => handle.sync(),
        close: () => handle.close()
      }
    }
  }
})

const SAVE_DEBOUNCE_MS = 300
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

let root: string
let dbPath: string
let db: typeof import('./database')

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'greenday-atomic-'))
  dbPath = join(root, 'ticktick-data.json')
  hold = null
  reachedGate = null
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
  rmSync(root, { recursive: true, force: true })
})

const titles = (): string[] => {
  const raw = JSON.parse(readFileSync(dbPath, 'utf-8'))
  return (raw.tasks as { title: string }[]).map((t) => t.title)
}

/**
 * 구형 쓰기가 커밋 지점에 도달할 때까지 몰아간 다음, **그 직후에 멈춰 세운다.**
 *
 * 멈춰 세우는 것이 핵심이다. 그냥 놓아 주면 큐가 곧바로 다음 세대를 한 번 더
 * 커밋해서 피해를 스스로 덮는다 — 실제 종료 경로에는 그 한 바퀴가 없다
 * (`closeDatabase()` 다음은 프로세스 종료다). 뒤따르는 바퀴를 막아야 구형 쓰기가
 * 남긴 파일 상태를 그대로 볼 수 있다.
 */
async function staleWriteLandsAfterShutdown(): Promise<void> {
  db.createTask({ id: 'a', title: 'A', listId: 'inbox' })

  // 디바운스가 끝나 비동기 커밋이 시작되고, 쓰기 직후 게이트에 걸린다.
  const atGate = new Promise<void>((resolve) => {
    reachedGate = resolve
  })
  let release: () => void = () => {}
  hold = new Promise<void>((resolve) => {
    release = resolve
  })
  await sleep(SAVE_DEBOUNCE_MS + 50)
  await atGate

  // 구형 쓰기가 붙잡혀 있는 동안 B가 들어오고 앱이 종료된다.
  db.createTask({ id: 'b', title: 'B', listId: 'inbox' })
  db.closeDatabase()
  expect(titles(), '종료 플러시가 두 건을 다 적어야 한다').toEqual(['A', 'B'])

  // 놓아 주되, 뒤따르는 바퀴는 영영 붙잡아 둔다(= 프로세스가 죽은 것과 같다).
  release()
  hold = new Promise<void>(() => {})
  await sleep(50)
}

describe('C4(a) 저장 세대 직렬화', () => {
  // 감사의 재현: 구형 비동기 쓰기가 **더 최신인 종료 플러시를 덮었다.**
  // 세대 번호가 없으면 "누가 더 최신인가"를 말할 수 없어서 마지막에 착륙한 쪽이 이긴다.
  it('날아가던 구형 쓰기가 더 최신인 종료 플러시를 덮지 않는다', async () => {
    await staleWriteLandsAfterShutdown()
    expect(titles(), '구형 쓰기가 착륙하며 파일을 [A]로 되돌렸다').toEqual(['A', 'B'])
  })

  it('물러난 쓰기는 임시 파일을 남기지 않는다', async () => {
    await staleWriteLandsAfterShutdown()
    expect(readdirSync(root).filter((f) => f.includes('.tmp-'))).toEqual([])
  })

  // 밀린 세대가 있으면 큐가 스스로 한 번 더 돈다. 이게 없으면 마지막 변경이
  // 다음 `save()`가 올 때까지(또는 영영) 디스크에 닿지 않는다.
  it('커밋 중에 들어온 변경을 큐가 이어서 커밋한다', async () => {
    db.createTask({ id: 'a', title: 'A', listId: 'inbox' })
    const atGate = new Promise<void>((resolve) => {
      reachedGate = resolve
    })
    let release: () => void = () => {}
    hold = new Promise<void>((resolve) => {
      release = resolve
    })
    await sleep(SAVE_DEBOUNCE_MS + 50)
    await atGate

    db.createTask({ id: 'b', title: 'B', listId: 'inbox' })
    hold = null // 다음 바퀴는 붙잡지 않는다
    release()
    await sleep(100)

    expect(titles()).toEqual(['A', 'B'])
  })
})

describe('C4(b) 원자적 교체', () => {
  it('대상 파일을 제자리에서 자르지 않는다 — 임시 파일 → rename', async () => {
    db.createTask({ id: 'a', title: 'A', listId: 'inbox' })
    db.closeDatabase()
    // 커밋이 끝난 뒤에는 임시 파일이 남지 않는다.
    expect(readdirSync(root).filter((f) => f.includes('.tmp-'))).toEqual([])
    expect(titles()).toEqual(['A'])
  })

  it('직전 정상본을 .bak으로 보존한다', async () => {
    db.createTask({ id: 'a', title: 'A', listId: 'inbox' })
    db.closeDatabase()
    db.createTask({ id: 'b', title: 'B', listId: 'inbox' })
    db.closeDatabase()

    expect(titles()).toEqual(['A', 'B'])
    const backup = JSON.parse(readFileSync(`${dbPath}.bak`, 'utf-8'))
    expect((backup.tasks as { title: string }[]).map((t) => t.title)).toEqual(['A'])
  })

  // `.bak`을 만드느라 `dbPath`가 잠깐 사라지는 창이 있다. 그 틈에서 죽어도
  // 복구되지 않으면, 백업을 만드는 대가로 새 손실 경로를 판 셈이 된다.
  it('대상 파일이 깨졌으면 .bak에서 복구하고 읽기 전용으로 내려가지 않는다', async () => {
    db.createTask({ id: 'a', title: 'A', listId: 'inbox' })
    db.closeDatabase()
    db.createTask({ id: 'b', title: 'B', listId: 'inbox' })
    db.closeDatabase()

    writeFileSync(dbPath, '{"tasks":[{"id"', 'utf-8')
    db.initDatabase()

    expect(db.isDatabaseReadOnly()).toBe(false)
    expect((db.getTasks() as { id: string }[]).map((t) => t.id)).toEqual(['a'])
  })

  it('대상 파일이 아예 없어도 .bak에서 복구한다', async () => {
    db.createTask({ id: 'a', title: 'A', listId: 'inbox' })
    db.closeDatabase()
    db.createTask({ id: 'b', title: 'B', listId: 'inbox' })
    db.closeDatabase()

    rmSync(dbPath)
    expect(existsSync(`${dbPath}.bak`)).toBe(true)
    db.initDatabase()

    expect(db.isDatabaseReadOnly()).toBe(false)
    expect((db.getTasks() as { id: string }[]).map((t) => t.id)).toEqual(['a'])
  })

  it('죽은 프로세스가 남긴 임시 파일을 부팅이 걷어낸다', async () => {
    writeFileSync(`${dbPath}.tmp-7`, 'leftover', 'utf-8')
    db.initDatabase()
    expect(existsSync(`${dbPath}.tmp-7`)).toBe(false)
  })
})
