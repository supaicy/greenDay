/**
 * 데이터 파일을 못 읽은 세션이 **원본을 덮어쓰지 않는가.**
 *
 * 예전에는 `load()`의 던짐이 부팅을 끊어서 창도 IPC도 없었고, 그래서 파일이
 * 덮어써질 수 없었다 — 우연한 보호였다. 그 던짐을 잡아 창을 띄우게 바꾸면서
 * 그 보호가 사라졌고, `dbPath`는 진짜 파일을 가리키는데 `data`는 빈 기본값이라
 * 사용자가 뭐 하나만 건드리면 원본이 빈 값으로 날아가는 상태가 됐다.
 * 리뷰 세 갈래가 각자 이 자리에 도달했다.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'greenday-db-'))
const dbPath = join(root, 'ticktick-data.json')
const CORRUPT = '{"lists":[{"id":"inbox"'

vi.mock('electron', () => ({
  app: { getPath: () => root, getVersion: () => '0.0.0-test' },
  BrowserWindow: { getAllWindows: () => [] }
}))

const db = await import('./database')

beforeAll(() => {
  writeFileSync(dbPath, CORRUPT, 'utf-8')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('깨진 데이터 파일', () => {
  it('초기화는 던지되, 원본 사본을 먼저 남긴다', () => {
    expect(() => db.initDatabase()).toThrow()
    const aside = readdirSync(root).filter((f) => f.includes('.corrupt-'))
    expect(aside, '원본 사본이 없다').toHaveLength(1)
    expect(readFileSync(join(root, aside[0]), 'utf-8')).toBe(CORRUPT)
  })

  it('그 세션은 읽기 전용이다', () => {
    expect(db.isDatabaseReadOnly()).toBe(true)
  })

  // 조용한 성공이 아니라 거절이어야 한다. 디스크를 지키는 것만으로는 부족하다:
  // `save()`만 조용히 반환하면 mutator가 메모리를 먼저 바꾸고 IPC는 성공으로 끝나서,
  // 사용자는 빈 앱에서 한 세션치를 편집하고 재시작 때 전부 잃는다.
  it('모든 변경 경로가 DB_READ_ONLY로 거절한다', () => {
    const attempts: [string, () => void][] = [
      ['createTask', () => db.createTask({ id: 'x', title: 'ghost' })],
      ['updateTask', () => db.updateTask({ id: 'x', title: 'ghost' })],
      ['deleteTask', () => db.deleteTask('x')],
      ['restoreTask', () => db.restoreTask('x')],
      ['permanentDeleteTask', () => db.permanentDeleteTask('x')],
      ['emptyTrash', () => db.emptyTrash()],
      ['reorderTasks', () => db.reorderTasks(['x'])],
      ['batchUpdateTasks', () => db.batchUpdateTasks(['x'], { completed: true })],
      ['createList', () => db.createList('l', 'L', '#fff', 'list', null)],
      ['updateList', () => db.updateList('l', { name: 'L' })],
      ['deleteList', () => db.deleteList('l')],
      ['createFolder', () => db.createFolder('f', 'F')],
      ['updateFolder', () => db.updateFolder('f', 'F', false)],
      ['deleteFolder', () => db.deleteFolder('f')],
      ['createHabit', () => db.createHabit('h', 'H', '#fff', 'daily', [])],
      ['deleteHabit', () => db.deleteHabit('h')],
      ['toggleHabitLog', () => db.toggleHabitLog('hl', 'h', '2026-08-28')],
      ['savePomodoroSession', () => db.savePomodoroSession({ id: 'p' })],
      ['addScoreEvent', () => db.addScoreEvent({ type: 'taskComplete', points: 3 })],
      ['addScoreEvents', () => db.addScoreEvents([{ type: 'taskComplete', points: 3 }])],
      ['copyAttachment', () => db.copyAttachment('/dev/null', 'a.txt')]
    ]
    for (const [name, run] of attempts) {
      expect(run, `${name}이 조용히 성공했다`).toThrow(db.DB_READ_ONLY)
    }
  })

  it('거절된 변경은 메모리에도 남지 않는다', () => {
    expect(db.getTasks()).toEqual([])
    expect(db.getLists()).toEqual([])
    expect(db.getHabits()).toEqual([])
  })

  // 내보내기는 잠금 화면에서도 눌리는 무료 경로다. 여기서 빈 `data`를 직렬화하면
  // 사용자가 고른 경로에 `{"tasks":[]…}`가 쓰이고, 하필 기존 백업 위에 저장하면
  // **진짜 백업까지 덮인다.**
  it('내보내기와 백업도 거절한다 — 빈 백업으로 진짜 백업을 덮지 않는다', () => {
    expect(() => db.exportData()).toThrow(db.DB_READ_ONLY)
    expect(() => db.createBackupArchive()).toThrow(db.DB_READ_ONLY)
  })

  it('**원본을 덮어쓰지 않는다** — 쓰기가 일어나도, 종료 플러시에서도', () => {
    // 부팅이 계속되므로 IPC는 살아 있다. 사용자가 뭐 하나만 건드리면 이 경로다.
    expect(() => db.createTask({ id: 'x', title: 'ghost' })).toThrow()
    db.closeDatabase()
    expect(readFileSync(dbPath, 'utf-8'), '원본이 빈 값으로 덮어써졌다').toBe(CORRUPT)
  })

  // 복구 경로는 고장의 대상에 묶이면 안 된다. 데이터 파일이 깨진 그 순간이
  // 사용자가 백업을 꺼내는 순간이다.
  it('백업 복원은 읽기 전용 세션에서도 돌고, 성공하면 잠금을 푼다', () => {
    const archive = JSON.stringify(
      db.buildArchive({
        data: {
          lists: [{ id: 'inbox', name: '기본함' }],
          tasks: [{ id: 'r1', title: '복원됨', list_id: 'inbox' }],
          habits: [],
          habitLogs: [],
          folders: [],
          pomodoroSessions: [],
          score: { total: 0, events: [], taskNet: {} }
        },
        chat: [],
        attachments: [],
        attachmentsDir: '/old/attachments',
        appVersion: '0.0.0-test',
        createdAt: '2026-08-28T00:00:00.000Z'
      })
    )

    const summary = db.restoreBackupArchive(archive)
    expect(summary.tasks).toBe(1)
    expect(db.isDatabaseReadOnly(), '복원 뒤에도 읽기 전용으로 남았다').toBe(false)
    expect((db.getTasks() as { id: string }[]).map((t) => t.id)).toEqual(['r1'])

    // 이제 디스크에 있는 것은 우리가 방금 쓴 온전한 파일이다.
    expect(JSON.parse(readFileSync(dbPath, 'utf-8')).tasks).toHaveLength(1)
    expect(() => db.createTask({ id: 'ok', title: '이제 된다' })).not.toThrow()
  })
})
