/**
 * M17 — 첨부 사본이 아무 참조도 없이 폴더에 쌓인다.
 * M2  — 첨부 폴더 안의 **끊어진** 심링크가 봉쇄를 통과하고 `copyFileSync`가
 *       그걸 따라가 폴더 밖에 쓴다.
 *
 * codex가 `/private/tmp/greenday-audit-attachment.test.ts`에 M17 재현을 써 뒀었는데
 * 스크래치가 정리되면서 사라졌다. 리포트에 적힌 시나리오(참조 제거·영구 삭제·
 * 휴지통 비우기 **어느 경로에서도** 사본이 지워지지 않는다)를 옮겨 놨다.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let root: string
let attachmentsDir: string
let outside: string
let db: typeof import('./database')

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'greenday-attach-'))
  attachmentsDir = join(root, 'attachments')
  outside = mkdtempSync(join(tmpdir(), 'greenday-outside-'))
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
  rmSync(outside, { recursive: true, force: true })
})

/** 첨부 하나를 만들어 할일에 붙인다. 저장 이름은 앱이 쓰는 `uuid-원본명` 모양. */
function attach(taskId: string, storedName: string): string {
  const source = join(outside, `src-${storedName}`)
  writeFileSync(source, 'payload', 'utf-8')
  const dest = db.copyAttachment(source, storedName)
  db.createTask({ id: taskId, title: taskId, listId: 'inbox', attachments: [`원본.txt|${dest}`] })
  return dest
}

const stored = (): string[] => readdirSync(attachmentsDir).sort()

describe('M17 첨부 GC', () => {
  it('참조를 떼면 다음 부팅이 사본을 걷어낸다', () => {
    attach('t1', 'aaa-note.txt')
    expect(stored()).toEqual(['aaa-note.txt'])

    // 목록에서 첨부만 뗀다 — 행은 그대로 남는다.
    db.updateTask({ id: 't1', attachments: [] })
    expect(stored(), '참조를 떼자마자 지우면 되돌릴 수 없다').toEqual(['aaa-note.txt'])

    db.closeDatabase() // 디바운스된 저장을 디스크로 내린다
    db.initDatabase() // 다음 부팅
    expect(stored()).toEqual([])
  })

  it('영구 삭제가 그 할일의 사본을 함께 지운다', () => {
    attach('t1', 'aaa-note.txt')
    attach('t2', 'bbb-memo.txt')
    db.deleteTask('t1')
    db.permanentDeleteTask('t1')
    db.closeDatabase() // 삭제가 디스크에 확정되어야 GC가 돈다

    expect(stored()).toEqual(['bbb-memo.txt'])
  })

  it('휴지통 비우기가 그 안의 사본을 함께 지운다', () => {
    attach('t1', 'aaa-note.txt')
    attach('t2', 'bbb-memo.txt')
    db.deleteTask('t1')
    db.emptyTrash()
    db.closeDatabase()

    expect(stored()).toEqual(['bbb-memo.txt'])
  })

  /**
   * **삭제의 내구성이 확보되기 전에는 걷지 않는다.**
   *
   * `save()`는 300ms 디바운스인데 예전에는 GC가 즉시 돌았다. 그 창에서 종료되면
   * 디스크의 할일은 여전히 첨부를 참조하는데 파일은 이미 사라진 상태가 된다 —
   * 다음 부팅에서 "첨부가 있다고 하는데 열리지 않는" 할일이 된다.
   * 검증이 이 상태를 실제로 만들어 보였다.
   */
  describe('디바운스 창에서 종료해도 참조와 파일이 어긋나지 않는다', () => {
    it('커밋 전에는 파일을 지우지 않는다', () => {
      attach('t1', 'aaa-note.txt')
      db.closeDatabase() // t1 + 첨부가 디스크에 있다

      db.deleteTask('t1')
      db.permanentDeleteTask('t1')
      // 여기서 종료된다 — 삭제는 아직 디바운스 안이다.
      expect(stored(), '삭제가 디스크에 닿기 전에 파일을 지웠다').toEqual(['aaa-note.txt'])

      // 디스크의 할일은 여전히 그 첨부를 참조하고 있다.
      const onDisk = JSON.parse(readFileSync(join(root, 'ticktick-data.json'), 'utf-8'))
      expect((onDisk.tasks as { id: string }[]).map((t) => t.id)).toEqual(['t1'])
    })

    it('그 상태로 재시작해도 첨부가 살아 있다', () => {
      attach('t1', 'aaa-note.txt')
      db.closeDatabase()

      db.deleteTask('t1')
      db.permanentDeleteTask('t1')
      // 커밋되지 않은 채 프로세스가 죽었다 = 다음 부팅은 옛 디스크 상태로 시작한다.
      db.initDatabase()

      expect(stored()).toEqual(['aaa-note.txt'])
      expect((db.getTasks() as { id: string }[]).map((t) => t.id)).toEqual(['t1'])
    })

    it('커밋이 끝나면 그때 걷는다', () => {
      attach('t1', 'aaa-note.txt')
      db.closeDatabase()

      db.deleteTask('t1')
      db.permanentDeleteTask('t1')
      db.closeDatabase() // 커밋 = 이제 참조가 진짜로 없다

      expect(stored()).toEqual([])
    })
  })

  // 휴지통은 되돌릴 수 있는 상태다. 거기 있는 참조까지 죽은 것으로 세면
  // 복원한 할일의 첨부가 사라진다.
  it('휴지통에 있는 할일의 첨부는 남긴다', () => {
    attach('t1', 'aaa-note.txt')
    db.deleteTask('t1')
    db.closeDatabase()
    db.initDatabase()

    expect(stored()).toEqual(['aaa-note.txt'])
  })

  describe('unreferencedAttachments — 판독이 애매하면 남긴다', () => {
    const rows = (attachments: string) => [{ id: 't', attachments }]

    it('참조되지 않는 이름만 고른다', () => {
      const refs = rows(JSON.stringify(['원본.txt|/x/attachments/keep.txt']))
      expect(db.unreferencedAttachments(['keep.txt', 'orphan.txt'], refs)).toEqual(['orphan.txt'])
    })

    // 파일명에 `|`가 들어갈 수 있어서 어느 조각이 경로인지 확실하지 않다.
    // 조각을 나누지 않고 컬럼 원문에 이름이 나타나는지만 본다.
    it('파일명에 구분자가 섞여 있어도 참조로 센다', () => {
      const refs = rows(JSON.stringify(['a|b.txt|/x/attachments/uuid-a|b.txt']))
      expect(db.unreferencedAttachments(['uuid-a|b.txt'], refs)).toEqual([])
    })

    it('컬럼이 깨진 행이 있어도 그 원문에 이름이 있으면 남긴다', () => {
      expect(db.unreferencedAttachments(['keep.txt'], rows('{망가진 JSON keep.txt'))).toEqual([])
    })

    // 예전에는 컬럼 원문에 이름이 **부분 문자열**로 나타나는지만 봤다. 그러면
    // 참조가 `long-a.txt` 하나뿐일 때 고아인 `a.txt`도 참조 중으로 오인해
    // 영원히 남았다 — GC가 아무것도 못 걷는 흔한 경우다(검증이 실측).
    it('더 긴 이름의 부분 문자열이라고 고아를 살려 두지 않는다', () => {
      const refs = rows(JSON.stringify(['긴 파일.txt|/x/attachments/long-a.txt']))
      expect(db.unreferencedAttachments(['long-a.txt', 'a.txt'], refs)).toEqual(['a.txt'])
    })

    it('경로 구분자가 어느 쪽이든 이름을 뽑아낸다', () => {
      const posix = rows(JSON.stringify(['n|/x/attachments/keep.txt']))
      const win = rows(JSON.stringify(['n|C:\\\\x\\\\attachments\\\\keep.txt']))
      expect(db.unreferencedAttachments(['keep.txt'], posix)).toEqual([])
      expect(db.unreferencedAttachments(['keep.txt'], win)).toEqual([])
    })

    it('첨부가 없는 행만 있으면 전부 고아다', () => {
      expect(db.unreferencedAttachments(['a.txt'], rows('[]'))).toEqual(['a.txt'])
    })
  })
})

describe('M2 끊어진 심링크', () => {
  // `existsSync`는 링크를 **따라가므로** 끊어진 링크에서 false를 돌려준다.
  // 그러면 realpath 봉쇄를 통째로 건너뛰고 `copyFileSync`가 링크를 따라가
  // 폴더 밖에 쓴다 — 감사가 실제로 폴더 밖에 파일을 만들어 재현했다.
  it('끊어진 심링크 자리에 쓰기를 거절한다 — 폴더 밖에 파일이 생기지 않는다', () => {
    const escapeTarget = join(outside, 'escaped.txt')
    symlinkSync(escapeTarget, join(attachmentsDir, 'evil.txt'))
    expect(existsSync(escapeTarget), '전제: 링크 대상은 아직 없다').toBe(false)

    const source = join(outside, 'payload.txt')
    writeFileSync(source, 'payload', 'utf-8')

    expect(() => db.copyAttachment(source, 'evil.txt')).toThrow()
    expect(existsSync(escapeTarget), '첨부 폴더 밖에 파일이 만들어졌다').toBe(false)
  })

  it('살아 있는(폴더 밖을 가리키는) 심링크 자리도 거절한다', () => {
    const escapeTarget = join(outside, 'existing.txt')
    writeFileSync(escapeTarget, 'old', 'utf-8')
    symlinkSync(escapeTarget, join(attachmentsDir, 'evil2.txt'))

    const source = join(outside, 'payload2.txt')
    writeFileSync(source, 'payload', 'utf-8')

    expect(() => db.copyAttachment(source, 'evil2.txt')).toThrow()
    expect(readdirSync(outside).includes('existing.txt')).toBe(true)
    expect(db.getTasks()).toEqual([]) // 아무것도 저장되지 않았다
  })

  it('평범한 덮어쓰기는 그대로 통과한다', () => {
    const source = join(outside, 'plain.txt')
    writeFileSync(source, 'v1', 'utf-8')
    db.copyAttachment(source, 'plain.txt')
    writeFileSync(source, 'v2', 'utf-8')
    expect(() => db.copyAttachment(source, 'plain.txt')).not.toThrow()
  })
})
