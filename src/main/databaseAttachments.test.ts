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
import { existsSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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

    expect(stored()).toEqual(['bbb-memo.txt'])
  })

  it('휴지통 비우기가 그 안의 사본을 함께 지운다', () => {
    attach('t1', 'aaa-note.txt')
    attach('t2', 'bbb-memo.txt')
    db.deleteTask('t1')
    db.emptyTrash()

    expect(stored()).toEqual(['bbb-memo.txt'])
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
