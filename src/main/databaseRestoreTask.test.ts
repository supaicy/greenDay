/**
 * H5 — 삭제와 복원의 대칭.
 *
 * `deleteTask`는 `t.id === id || t.parent_id === id`로 하위작업까지 함께 내리는데
 * `restoreTask`는 그 한 행만 되살렸다. 그래서 Cmd+Z 한 번이 "부모는 살아났는데
 * 하위작업 셋은 휴지통에 남은" 상태를 만들었고, 화면에서는 하위작업이 통째로
 * 사라진 것으로 보였다.
 *
 * codex가 `/private/tmp`에 같은 시나리오의 재현 테스트를 써 뒀었는데 스크래치가
 * 정리되면서 사라졌다. 리포트에 적힌 절차(`deleteTask(parent)` → `restoreTask(parent)`
 * → 부모만 active, child는 `getTrashTasks()`에 남음)를 그대로 옮겨 놨다.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let root: string
let db: typeof import('./database')

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'greenday-restore-'))
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

const activeIds = (): string[] => (db.getTasks() as { id: string }[]).map((t) => t.id)
const trashIds = (): string[] => (db.getTrashTasks() as { id: string }[]).map((t) => t.id)

function parentWithChildren(): void {
  db.createTask({ id: 'p', title: '부모', listId: 'inbox' })
  db.createTask({ id: 'c1', title: '하위1', listId: 'inbox', parentId: 'p' })
  db.createTask({ id: 'c2', title: '하위2', listId: 'inbox', parentId: 'p' })
}

describe('restoreTask는 deleteTask의 거울이다', () => {
  it('부모를 지우면 하위작업도 함께 내려간다 (기존 동작)', () => {
    parentWithChildren()
    db.deleteTask('p')
    expect(activeIds()).toEqual([])
    expect(trashIds().sort()).toEqual(['c1', 'c2', 'p'])
  })

  it('부모를 되살리면 함께 내려간 하위작업도 올라온다', () => {
    parentWithChildren()
    db.deleteTask('p')
    db.restoreTask('p')

    expect(activeIds().sort(), '하위작업이 휴지통에 남았다').toEqual(['c1', 'c2', 'p'])
    expect(trashIds()).toEqual([])
  })

  // 되살리는 집합을 "이 부모의 하위작업 전부"로 잡으면 이번엔 반대로 틀린다:
  // 사용자가 **따로** 지운 하위작업까지 끌어올린다. 같은 삭제였다는 증거는
  // `deleteTask`가 한 번에 찍는 타임스탬프다.
  it('그 전에 따로 지운 하위작업은 휴지통에 그대로 둔다', () => {
    parentWithChildren()
    db.deleteTask('c1') // 하위작업 하나만 먼저 지운다
    db.deleteTask('p') // 그 뒤 부모를 지운다 → p와 c2가 같은 타임스탬프

    db.restoreTask('p')

    expect(activeIds().sort()).toEqual(['c2', 'p'])
    expect(trashIds(), '따로 지웠던 하위작업까지 끌어올렸다').toEqual(['c1'])
  })

  it('휴지통에 없는 id는 아무것도 바꾸지 않는다', () => {
    parentWithChildren()
    db.restoreTask('p')
    expect(activeIds().sort()).toEqual(['c1', 'c2', 'p'])
    expect(trashIds()).toEqual([])
  })

  it('하위작업 하나만 되살릴 수도 있다', () => {
    parentWithChildren()
    db.deleteTask('c1')
    db.restoreTask('c1')
    expect(activeIds().sort()).toEqual(['c1', 'c2', 'p'])
  })
})
