/**
 * 첨부 GC는 **지우지 않고 격리 폴더로 옮긴다.**
 *
 * `.bak`에서 복구한 부팅에서는 `data.tasks`가 한 저장 낡았다. 마지막으로 커밋된
 * 쓰기에서 붙인 첨부는 손상된 primary(곧 `.corrupt-*`로 치워질 것)만 참조하므로
 * "참조 없음"으로 보이고, 예전 GC는 그것을 그 자리에서 unlink했다 — 손상본 사본은
 * 남는데 그것이 가리키는 파일은 영영 사라지는 영구 손실이었다. 복구 부팅에서 GC를
 * 건너뛰는 것만으로는 안 된다: 다음 부팅이 같은 판정으로 지운다.
 *
 * 그래서 걷는 것은 `<userData>/attachments-quarantine/`으로의 이동이고, 실제 삭제는
 * 30일이 지난 격리분에만 일어난다.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  chmodSync,
  existsSync,
  lstatSync,
  lutimesSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let root: string
let outside: string
let attachmentsDir: string
let quarantineDir: string
let db: typeof import('./database')

const DAY_MS = 24 * 60 * 60 * 1000

function lstatOrNull(target: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(target)
  } catch {
    return null
  }
}

async function loadDb(): Promise<void> {
  vi.resetModules()
  const dir = root
  vi.doMock('electron', () => ({
    app: { getPath: () => dir, getVersion: () => '0.0.0-test' },
    safeStorage: { isEncryptionAvailable: () => false }
  }))
  db = await import('./database')
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'greenday-quarantine-'))
  outside = mkdtempSync(join(tmpdir(), 'greenday-quarantine-outside-'))
  attachmentsDir = join(root, 'attachments')
  quarantineDir = join(root, 'attachments-quarantine')
  await loadDb()
})

afterEach(() => {
  db.closeDatabase()
  try {
    chmodSync(quarantineDir, 0o700)
  } catch {
    /* 없거나 디렉터리가 아니다 */
  }
  rmSync(root, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

const live = (): string[] => readdirSync(attachmentsDir).sort()

/** 격리 폴더 아래의 모든 항목: 이름 → 전체 경로. 하위 폴더(스윕 단위)를 한 단계 내려간다. */
function quarantined(): Map<string, string> {
  const found = new Map<string, string>()
  if (!existsSync(quarantineDir)) return found
  for (const sweep of readdirSync(quarantineDir)) {
    const sweepPath = join(quarantineDir, sweep)
    if (!lstatSync(sweepPath).isDirectory()) continue
    for (const name of readdirSync(sweepPath)) found.set(name, join(sweepPath, name))
  }
  return found
}

function attach(taskId: string, storedName: string, body = 'payload'): string {
  const source = join(outside, `src-${storedName}`)
  writeFileSync(source, body, 'utf-8')
  const dest = db.copyAttachment(source, storedName)
  db.createTask({ id: taskId, title: taskId, listId: 'inbox', attachments: [`원본.txt|${dest}`] })
  return dest
}

describe('.bak 복구 부팅 — 손상된 primary만 아는 첨부를 잃지 않는다', () => {
  /**
   * primary는 두 첨부를 참조하지만 잘려 있다. `.bak`은 한 저장 전이라 옛 첨부만 안다.
   * 마지막 쓰기에서 붙인 `uuid-new.jpg`는 손상본에만 참조가 남아 있다.
   */
  function seedRecovery(): void {
    mkdirSync(attachmentsDir, { recursive: true })
    writeFileSync(join(attachmentsDir, 'uuid-old.jpg'), 'OLD-BYTES', 'utf-8')
    writeFileSync(join(attachmentsDir, 'uuid-new.jpg'), 'NEW-BYTES', 'utf-8')
    const oldTask = { id: 't-old', attachments: JSON.stringify([`old.jpg|${join(attachmentsDir, 'uuid-old.jpg')}`]) }
    const newTask = { id: 't-new', attachments: JSON.stringify([`new.jpg|${join(attachmentsDir, 'uuid-new.jpg')}`]) }
    const full = JSON.stringify({ lists: [], tasks: [oldTask, newTask], habits: [] })
    // 잘린 JSON — readDataFile이 'corrupt'로 읽어 `.bak`으로 넘어간다.
    writeFileSync(join(root, 'ticktick-data.json'), full.slice(0, full.length - 20), 'utf-8')
    writeFileSync(join(root, 'ticktick-data.json.bak'), JSON.stringify({ lists: [], tasks: [oldTask], habits: [] }), 'utf-8')
  }

  it('복구 부팅의 GC가 최신 첨부를 지우지 않고 격리 폴더로 옮긴다', () => {
    seedRecovery()
    db.initDatabase()

    // 전제: 정말 `.bak`에서 복구했고 손상본은 옆으로 치워졌다.
    expect(readdirSync(root).some((n) => n.startsWith('ticktick-data.json.corrupt-'))).toBe(true)
    expect(live()).toEqual(['uuid-old.jpg'])

    const moved = quarantined().get('uuid-new.jpg')
    expect(moved, '손상본만 참조하던 첨부가 영구 삭제됐다').toBeDefined()
    expect(readFileSync(moved as string, 'utf-8')).toBe('NEW-BYTES')
  })

  it('다음 부팅도 격리분을 지우지 않는다 — 30일 안에는 되찾을 수 있다', () => {
    seedRecovery()
    db.initDatabase()
    db.closeDatabase()
    db.initDatabase()
    db.closeDatabase()
    db.initDatabase()

    expect(quarantined().has('uuid-new.jpg')).toBe(true)
  })
})

describe('평범한 고아도 지우지 않고 옮긴다', () => {
  it('부팅 스윕: 참조를 뗀 첨부가 격리 폴더로 간다', () => {
    db.initDatabase()
    attach('t1', 'aaa-note.txt', 'NOTE')
    db.updateTask({ id: 't1', attachments: [] })
    db.closeDatabase()
    db.initDatabase()

    expect(live()).toEqual([])
    const moved = quarantined().get('aaa-note.txt')
    expect(moved, '고아 첨부를 그 자리에서 지웠다').toBeDefined()
    expect(readFileSync(moved as string, 'utf-8')).toBe('NOTE')
  })

  it('예약 스윕(영구 삭제)도 옮긴다', () => {
    db.initDatabase()
    attach('t1', 'aaa-doomed.txt', 'DOOMED')
    attach('t2', 'bbb-keep.txt')
    db.deleteTask('t1')
    db.permanentDeleteTask('t1')
    db.closeDatabase() // 커밋 = 예약된 스윕이 돈다

    expect(live()).toEqual(['bbb-keep.txt'])
    expect(readFileSync(quarantined().get('aaa-doomed.txt') as string, 'utf-8')).toBe('DOOMED')
  })

  it('반환값은 "살아 있는 폴더에서 빠진 개수"다', () => {
    db.initDatabase()
    writeFileSync(join(attachmentsDir, 'x-orphan.txt'), 'x', 'utf-8')
    writeFileSync(join(attachmentsDir, 'y-orphan.txt'), 'y', 'utf-8')
    expect(db.gcAttachments()).toBe(2)
    expect(db.gcAttachments()).toBe(0)
  })

  it('같은 이름이 두 번 걸려도 앞선 격리분을 덮지 않는다', () => {
    db.initDatabase()
    writeFileSync(join(attachmentsDir, 'same.txt'), 'first', 'utf-8')
    db.gcAttachments()
    writeFileSync(join(attachmentsDir, 'same.txt'), 'second', 'utf-8')
    db.gcAttachments()

    const bodies = readdirSync(quarantineDir)
      .map((sweep) => join(quarantineDir, sweep, 'same.txt'))
      .filter((p) => existsSync(p))
      .map((p) => readFileSync(p, 'utf-8'))
      .sort()
    expect(bodies).toEqual(['first', 'second'])
  })

  // 심링크를 옮길 때 **링크 자체**를 옮긴다 — 대상은 첨부 폴더 밖이고 우리 것이 아니다.
  it('심링크는 링크만 옮기고 대상은 건드리지 않는다', () => {
    db.initDatabase()
    const target = join(outside, 'precious.txt')
    writeFileSync(target, 'PRECIOUS', 'utf-8')
    symlinkSync(target, join(attachmentsDir, 'link.txt'))
    db.gcAttachments()

    expect(live()).toEqual([])
    expect(readFileSync(target, 'utf-8')).toBe('PRECIOUS')
    const moved = quarantined().get('link.txt')
    expect(moved).toBeDefined()
    expect(lstatSync(moved as string).isSymbolicLink()).toBe(true)
  })

  // 예전 unlinkSync는 디렉터리에서 실패해 남겼다. rename은 디렉터리도 옮길 수 있으니
  // 그 동작을 일부러 지킨다 — 앱이 만들지 않는 모양이다.
  it('첨부 폴더 안의 하위 폴더는 옮기지 않는다', () => {
    db.initDatabase()
    mkdirSync(join(attachmentsDir, 'subdir'))
    writeFileSync(join(attachmentsDir, 'subdir', 'inner.txt'), 'x', 'utf-8')
    expect(db.gcAttachments()).toBe(0)
    expect(live()).toEqual(['subdir'])
  })
})

describe('옮길 수 없으면 지우지 않고 남긴다', () => {
  it('격리 폴더 자리에 파일이 있으면 첨부를 그대로 둔다', () => {
    db.initDatabase()
    writeFileSync(quarantineDir, 'not a dir', 'utf-8')
    writeFileSync(join(attachmentsDir, 'orphan.txt'), 'x', 'utf-8')

    expect(db.gcAttachments()).toBe(0)
    expect(live(), '옮기지 못하자 지워 버렸다').toEqual(['orphan.txt'])
  })

  it('격리 폴더에 쓸 수 없으면 첨부를 그대로 둔다', () => {
    db.initDatabase()
    mkdirSync(quarantineDir)
    chmodSync(quarantineDir, 0o500)
    writeFileSync(join(attachmentsDir, 'orphan.txt'), 'x', 'utf-8')

    expect(db.gcAttachments()).toBe(0)
    expect(live()).toEqual(['orphan.txt'])
  })

  // 격리 폴더가 바깥을 가리키는 심링크면 그리로 옮기지도, 그 안을 정리하지도 않는다 —
  // 정리가 첨부 폴더 밖의 파일을 지우는 원시연산이 된다.
  it('격리 폴더가 심링크면 옮기지도 정리하지도 않는다', () => {
    db.initDatabase()
    const victim = join(outside, 'old-sweep')
    mkdirSync(victim)
    writeFileSync(join(victim, 'keep.txt'), 'x', 'utf-8')
    const old = new Date(Date.now() - 60 * DAY_MS)
    utimesSync(victim, old, old)
    symlinkSync(outside, quarantineDir)
    writeFileSync(join(attachmentsDir, 'orphan.txt'), 'x', 'utf-8')

    expect(db.gcAttachments()).toBe(0)
    expect(live()).toEqual(['orphan.txt'])
    expect(existsSync(join(victim, 'keep.txt')), '격리 폴더 정리가 바깥 파일을 지웠다').toBe(true)
  })
})

describe('30일이 지난 격리분만 정리한다', () => {
  function seedSweep(name: string, ageDays: number): string {
    const sweep = join(quarantineDir, name)
    mkdirSync(sweep, { recursive: true })
    writeFileSync(join(sweep, `${name}.txt`), name, 'utf-8')
    const when = new Date(Date.now() - ageDays * DAY_MS)
    utimesSync(sweep, when, when)
    return sweep
  }

  it('부팅 GC가 31일 된 것을 지우고 29일 된 것을 남긴다', () => {
    const stale = seedSweep('stale', 31)
    const fresh = seedSweep('fresh', 29)
    db.initDatabase()

    expect(existsSync(stale), '30일이 지난 격리분이 남았다').toBe(false)
    expect(existsSync(join(fresh, 'fresh.txt'))).toBe(true)
  })

  it('붙들려 있는 동안에는 정리도 미룬다', () => {
    const stale = seedSweep('stale', 31)
    db.holdSaves()
    db.initDatabase()
    expect(existsSync(stale)).toBe(true)
    db.releaseSaves()
    expect(existsSync(stale)).toBe(false)
  })

  it('격리 폴더 안의 심링크 항목은 링크만 지운다', () => {
    const target = join(outside, 'target-dir')
    mkdirSync(target)
    writeFileSync(join(target, 'keep.txt'), 'x', 'utf-8')
    mkdirSync(quarantineDir, { recursive: true })
    const link = join(quarantineDir, 'link')
    symlinkSync(target, link)
    const old = new Date(Date.now() - 60 * DAY_MS)
    // 링크도 대상도 낡게 둔다 — 정리 대상은 링크이고, 대상의 내용은 남아야 한다.
    utimesSync(target, old, old)
    lutimesSync(link, old, old)
    db.initDatabase()

    expect(lstatOrNull(link), '낡은 링크 항목이 정리되지 않았다').toBeNull()
    expect(readFileSync(join(target, 'keep.txt'), 'utf-8')).toBe('x')
  })
})
