/**
 * 삭제는 **자손 전부**에 캐스케이드한다 — 직계 하위작업만이 아니다.
 *
 * 상세 패널은 고른 할일이 하위작업이어도 SubtaskList를 그리므로 A→B→C 같은 3단
 * 트리가 실제로 생긴다. 예전 캐스케이드는 한 단계(`parent_id === id`)뿐이라 A를
 * 지우면 A·B만 휴지통으로 가고 C는 살아 남았다. 그러면 다음 부팅의
 * `healUnreachableTasks`가 "살아 있는데 조상이 휴지통"인 C를 보고 B와 A를
 * 휴지통에서 **꺼냈다** — 사용자가 일부러 지운 것이 재시작마다 되살아났다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let root: string
let db: typeof import('./database')

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'greenday-cascade-'))
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

type Row = { id: string; parent_id: string | null; deleted_at: string | null; deleted_with: string | null }
const activeIds = (): string[] => (db.getTasks() as Row[]).map((t) => t.id).sort()
const trashIds = (): string[] => (db.getTrashTasks() as Row[]).map((t) => t.id).sort()
const trashRow = (id: string): Row | undefined => (db.getTrashTasks() as Row[]).find((t) => t.id === id)

/** 앱을 껐다 켠다 — 디스크로 내려가고 부팅 시 정리(`healUnreachableTasks`)가 돈다. */
function reboot(): void {
  db.closeDatabase()
  db.initDatabase()
}

/** A → B → C 세 단 트리 + 무관한 할일 하나. */
function threeLevels(): void {
  db.createTask({ id: 'A', title: 'A', listId: 'inbox' })
  db.createTask({ id: 'B', title: 'B', listId: 'inbox', parentId: 'A' })
  db.createTask({ id: 'C', title: 'C', listId: 'inbox', parentId: 'B' })
  db.createTask({ id: 'Z', title: '무관', listId: 'inbox' })
}

describe('deleteTask는 자손 전부를 함께 내린다', () => {
  it('A를 지우면 손자 C까지 휴지통으로 간다', () => {
    threeLevels()
    db.deleteTask('A')
    expect(activeIds(), '손자가 살아 남았다').toEqual(['Z'])
    expect(trashIds()).toEqual(['A', 'B', 'C'])
  })

  it('재시작해도 휴지통에 그대로 있다 — 부팅 정리가 지운 것을 되살리지 않는다', () => {
    threeLevels()
    db.deleteTask('A')
    reboot()
    expect(activeIds(), '재시작이 일부러 지운 할일을 되살렸다').toEqual(['Z'])
    expect(trashIds()).toEqual(['A', 'B', 'C'])
    reboot()
    expect(activeIds()).toEqual(['Z'])
    expect(trashIds()).toEqual(['A', 'B', 'C'])
  })

  it('함께 내려간 자손은 모두 그 조작의 뿌리를 가리킨다', () => {
    threeLevels()
    db.deleteTask('A')
    expect(trashRow('A')?.deleted_with).toBeNull()
    expect(trashRow('B')?.deleted_with).toBe('A')
    expect(trashRow('C')?.deleted_with).toBe('A')
  })

  it('restoreTask(A)가 세 단 모두를 되살린다 — 재시작 뒤에도', () => {
    threeLevels()
    db.deleteTask('A')
    reboot()
    db.restoreTask('A')
    expect(activeIds()).toEqual(['A', 'B', 'C', 'Z'])
    expect(trashIds()).toEqual([])
    reboot()
    expect(activeIds()).toEqual(['A', 'B', 'C', 'Z'])
  })

  it('그 전에 따로 지운 손자는 뿌리 복원에 딸려 오지 않는다', () => {
    threeLevels()
    db.deleteTask('C')
    db.deleteTask('A')
    db.restoreTask('A')
    expect(activeIds()).toEqual(['A', 'B', 'Z'])
    expect(trashIds()).toEqual(['C'])
  })

  it('따로 지운 중간 단계 아래의 자손은 그 중간 단계와 함께 남는다', () => {
    threeLevels()
    db.deleteTask('B') // B, C가 함께 내려간다
    db.deleteTask('A')
    db.restoreTask('A')
    expect(activeIds()).toEqual(['A', 'Z'])
    expect(trashIds()).toEqual(['B', 'C'])
    db.restoreTask('B')
    expect(activeIds()).toEqual(['A', 'B', 'C', 'Z'])
  })

  it('손상된 순환 parent_id에서 멈춘다', () => {
    db.createTask({ id: 'a', title: 'a', listId: 'inbox' })
    db.createTask({ id: 'b', title: 'b', listId: 'inbox', parentId: 'a' })
    db.updateTask({ id: 'a', parentId: 'b' }) // a ↔ b
    db.deleteTask('a')
    expect(trashIds()).toEqual(['a', 'b'])
    db.restoreTask('a')
    expect(trashIds()).toEqual([])
  })
})

describe('permanentDeleteTask는 자손 전부를 지운다', () => {
  it('A를 영구 삭제하면 B와 C도 사라진다', () => {
    threeLevels()
    db.deleteTask('A')
    db.permanentDeleteTask('A')
    expect(activeIds()).toEqual(['Z'])
    expect(trashIds(), '손자가 휴지통에 고아로 남았다').toEqual([])
  })

  it('순환 parent_id에서 멈춘다', () => {
    db.createTask({ id: 'a', title: 'a', listId: 'inbox' })
    db.createTask({ id: 'b', title: 'b', listId: 'inbox', parentId: 'a' })
    db.updateTask({ id: 'a', parentId: 'b' })
    db.permanentDeleteTask('a')
    expect(activeIds()).toEqual([])
  })
})

describe('일괄 삭제도 자손 전부를 내린다', () => {
  it('부모만 골라 일괄 삭제해도 손자까지 내려가고, 재시작해도 남는다', () => {
    threeLevels()
    db.batchUpdateTasks(['A'], { deleted: true })
    expect(activeIds()).toEqual(['Z'])
    expect(trashIds()).toEqual(['A', 'B', 'C'])
    reboot()
    expect(activeIds()).toEqual(['Z'])
  })

  it('배치에 자손이 함께 실려 와도 모두 뿌리를 가리켜, 뿌리 복원 하나로 다 올라온다', () => {
    threeLevels()
    db.batchUpdateTasks(['A', 'B', 'C'], { deleted: true })
    expect(trashRow('B')?.deleted_with).toBe('A')
    expect(trashRow('C')?.deleted_with).toBe('A')
    db.restoreTask('A')
    expect(activeIds()).toEqual(['A', 'B', 'C', 'Z'])
  })

  it('이미 휴지통에 있던 자손의 표시는 다시 찍지 않는다', () => {
    threeLevels()
    db.deleteTask('C')
    const before = trashRow('C')
    db.batchUpdateTasks(['A'], { deleted: true })
    expect(trashRow('C')?.deleted_at).toBe(before?.deleted_at)
    expect(trashRow('C')?.deleted_with).toBeNull()
  })
})
