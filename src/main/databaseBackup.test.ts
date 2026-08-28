/**
 * H15 — "백업"이 실제로 복원 가능한가.
 *
 * 예전 내보내기는 `DbData`만 직렬화했다. 첨부는 **절대 경로 문자열**만 남고
 * AI 대화는 별도 파일이라 아예 빠졌으며, 무엇보다 **되읽을 경로가 없었다**
 * (preload에 export만 있고 import가 없다). 그런데 UI는 이를 "Back up"이라 부르고
 * 방침은 "export everything"이라고 안내하므로, 사용자가 복구 가능하다고 믿고
 * 원본을 지울 수 있는 상태였다.
 *
 * 여기서 못 박는 것은 셋이다:
 *   1. 아카이브가 데이터·첨부·대화를 **전부** 담는다.
 *   2. 다른 기기(=다른 첨부 폴더 경로)에서 복원해도 첨부가 연결된 채로 온다.
 *   3. 낯선 파일은 **쓰기를 시작하기 전에** 거절한다.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let root: string
let attachmentsDir: string
let outside: string
let db: typeof import('./database')

async function bootIn(dir: string): Promise<typeof import('./database')> {
  vi.resetModules()
  vi.doMock('electron', () => ({
    app: { getPath: () => dir, getVersion: () => '1.2.3-test' },
    safeStorage: { isEncryptionAvailable: () => false }
  }))
  const mod = await import('./database')
  mod.initDatabase()
  return mod
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'greenday-backup-'))
  attachmentsDir = join(root, 'attachments')
  outside = mkdtempSync(join(tmpdir(), 'greenday-src-'))
  db = await bootIn(root)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

/** 할일 하나 + 첨부 하나 + 대화 한 줄. 백업이 담아야 할 세 종류다. */
function seed(): string {
  const source = join(outside, 'report.pdf')
  writeFileSync(source, 'PDF-BYTES', 'utf-8')
  const dest = db.copyAttachment(source, 'uuid-report.pdf')
  db.createTask({ id: 't1', title: '보고서 마무리', listId: 'inbox', attachments: [`report.pdf|${dest}`] })
  db.createList('work', '업무', '#123456', 'list', null)
  db.createHabit('h1', '물 마시기', '#0f0', 'daily', [])
  db.addScoreEvent({ type: 'taskComplete', points: 3, date: '2026-08-28', taskId: 't1' })
  db.saveChatHistory([{ id: 'm1', role: 'user', content: '안녕', timestamp: '2026-08-28T00:00:00.000Z' }])
  return dest
}

describe('아카이브가 담는 것', () => {
  it('데이터·첨부·대화를 전부 담는다', () => {
    seed()
    const archive = JSON.parse(db.createBackupArchive())

    expect(archive.format).toBe(db.BACKUP_FORMAT)
    expect(archive.schemaVersion).toBe(db.BACKUP_SCHEMA_VERSION)
    expect(archive.appVersion).toBe('1.2.3-test')
    expect((archive.data.tasks as { id: string }[]).map((t) => t.id)).toEqual(['t1'])
    expect((archive.data.lists as { id: string }[]).map((l) => l.id).sort()).toEqual(['inbox', 'work'])
    expect(archive.data.habits).toHaveLength(1)
    // 점수 원장도 함께 간다 — 없으면 복원 뒤 완료 취소가 회수를 못 한다.
    expect(archive.data.score.taskNet).toEqual({ t1: 3 })
    expect(archive.chat).toHaveLength(1)
    expect(archive.attachments).toHaveLength(1)
    expect(archive.attachments[0].name).toBe('uuid-report.pdf')
    expect(Buffer.from(archive.attachments[0].data, 'base64').toString('utf-8')).toBe('PDF-BYTES')
  })

  it('첨부 폴더 절대경로를 함께 적어 둔다', () => {
    seed()
    const archive = JSON.parse(db.createBackupArchive())
    expect(archive.attachmentsDir).toBe(attachmentsDir)
  })
})

describe('복원', () => {
  it('같은 기기에서 왕복하면 상태가 그대로다', () => {
    seed()
    const archive = db.createBackupArchive()

    db.emptyTrash()
    db.permanentDeleteTask('t1')
    expect(db.getTasks()).toHaveLength(0)

    const summary = db.restoreBackupArchive(archive)
    expect(summary).toEqual({ tasks: 1, lists: 2, attachments: 1 })
    expect((db.getTasks() as { id: string }[]).map((t) => t.id)).toEqual(['t1'])
    expect(db.getChatHistory()).toHaveLength(1)
    expect(readdirSync(attachmentsDir)).toEqual(['uuid-report.pdf'])
  })

  // 이게 "복원 가능한 백업"의 핵심이다. 첨부 참조는 절대경로를 품고 있는데
  // 복원하는 기기의 폴더는 사용자 이름부터 다르다. 갈아끼우지 않으면
  // "복원은 됐는데 첨부가 전부 깨진" 상태가 된다.
  it('다른 기기에서 복원해도 첨부가 연결된 채로 온다', async () => {
    seed()
    const archive = db.createBackupArchive()

    // 완전히 다른 userData 폴더 = 새 기기.
    const other = mkdtempSync(join(tmpdir(), 'greenday-other-'))
    try {
      const fresh = await bootIn(other)
      fresh.restoreBackupArchive(archive)

      const otherAttachments = join(other, 'attachments')
      expect(readdirSync(otherAttachments)).toEqual(['uuid-report.pdf'])
      expect(readFileSync(join(otherAttachments, 'uuid-report.pdf'), 'utf-8')).toBe('PDF-BYTES')

      const row = (fresh.getTasks() as Record<string, unknown>[])[0]
      const refs = JSON.parse(row.attachments as string) as string[]
      expect(refs[0], '첨부 참조가 옛 기기의 경로를 가리킨 채다').toContain(otherAttachments)
      expect(refs[0]).not.toContain(attachmentsDir)
      // 그 경로가 실제로 이 기기의 첨부 폴더 **안**이어야 열린다.
      expect(fresh.isInsideAttachments(refs[0].split('|')[1])).toBe(true)
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })

  it('복원 결과는 즉시 디스크에 있다 — 재시작을 기다리지 않는다', () => {
    seed()
    const archive = db.createBackupArchive()
    db.permanentDeleteTask('t1')

    db.restoreBackupArchive(archive)
    const onDisk = JSON.parse(readFileSync(join(root, 'ticktick-data.json'), 'utf-8'))
    expect((onDisk.tasks as { id: string }[]).map((t) => t.id)).toEqual(['t1'])
  })

  // 복원은 사용자의 현재 데이터를 통째로 갈아치운다. 절반만 맞는 파일을 받아
  // 절반만 복원하면 원래 있던 것도 잃는다.
  describe('낯선 파일은 쓰기 전에 거절한다', () => {
    const cases: [string, string][] = [
      ['JSON이 아니다', 'not json at all'],
      ['우리 형식이 아니다', JSON.stringify({ tasks: [] })],
      ['모르는 스키마 버전', JSON.stringify({ format: 'greenday-backup', schemaVersion: 99, data: {} })],
      ['data가 없다', JSON.stringify({ format: 'greenday-backup', schemaVersion: 1 })]
    ]
    for (const [label, payload] of cases) {
      it(label, () => {
        db.createTask({ id: 'keep', title: '남아야 한다', listId: 'inbox' })
        expect(() => db.restoreBackupArchive(payload)).toThrow()
        expect((db.getTasks() as { id: string }[]).map((t) => t.id), '거절했는데 데이터가 사라졌다').toEqual([
          'keep'
        ])
      })
    }

    // 이름에 경로 조각이 섞여 있으면 복원이 첨부 폴더 밖에 쓴다.
    it('첨부 이름에 경로가 섞여 있으면 거절한다 — 폴더 밖에 쓰지 않는다', () => {
      const escaped = join(outside, 'pwned.txt')
      const payload = JSON.stringify(
        db.buildArchive({
          data: {
            lists: [],
            tasks: [],
            habits: [],
            habitLogs: [],
            folders: [],
            pomodoroSessions: [],
            score: { total: 0, events: [], taskNet: {} }
          },
          chat: [],
          attachments: [{ name: `../../${join('..', escaped)}`, data: 'eA==' }],
          attachmentsDir: '/old',
          appVersion: '',
          createdAt: ''
        })
      )
      expect(() => db.restoreBackupArchive(payload)).toThrow()
      expect(existsSync(escaped), '첨부 폴더 밖에 파일이 만들어졌다').toBe(false)
    })
  })
})

describe('rebaseAttachmentPaths', () => {
  it('접두사를 갈아끼운다', () => {
    const tasks = [{ id: 't', attachments: JSON.stringify(['a.pdf|/old/att/uuid-a.pdf']) }]
    const out = db.rebaseAttachmentPaths(tasks, '/old/att', '/new/att')
    expect(JSON.parse(out[0].attachments as string)).toEqual(['a.pdf|/new/att/uuid-a.pdf'])
  })

  it('파일명에 구분자가 섞여 있어도 경로만 바꾼다', () => {
    const tasks = [{ id: 't', attachments: JSON.stringify(['a|b.pdf|/old/att/uuid-a|b.pdf']) }]
    const out = db.rebaseAttachmentPaths(tasks, '/old/att', '/new/att')
    expect(JSON.parse(out[0].attachments as string)).toEqual(['a|b.pdf|/new/att/uuid-a|b.pdf'])
  })

  it('바꿀 것이 없으면 내용을 건드리지 않는다', () => {
    const tasks = [{ id: 't', attachments: '[]' }]
    expect(db.rebaseAttachmentPaths(tasks, '/old/att', '/new/att')).toStrictEqual(tasks)
    // 옛 경로를 모르면(빈 문자열) 갈아끼울 근거가 없다 — 손대지 않고 그대로 돌려준다.
    expect(db.rebaseAttachmentPaths(tasks, '', '/new/att')).toBe(tasks)
    expect(db.rebaseAttachmentPaths(tasks, '/same', '/same')).toBe(tasks)
  })
})
