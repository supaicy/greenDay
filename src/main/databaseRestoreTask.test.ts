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
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

/**
 * `deleted_with` 마이그레이션 — 이 컬럼이 생기기 전에 버려진 행.
 *
 * 한때 "부모와 같은 시각에 내려갔으면 캐스케이드"로 추정했다. 그런데
 * `toISOString()`이 밀리초까지라 **따로 지운** 부모와 자식이 같은 값을 갖는
 * 경우가 실제로 있고(검증이 legacy 파일로 재현), 그러면 사용자가 따로 버린 행이
 * 부모 복원에 되살아난다 — 추정이 틀렸을 때의 결과가 "예전 동작"이 아니라 부활이었다.
 */
describe('deleted_with 마이그레이션', () => {
  const legacyFile = (tasks: Record<string, unknown>[]): void => {
    writeFileSync(
      join(root, 'ticktick-data.json'),
      JSON.stringify({
        lists: [{ id: 'inbox', name: '기본함' }],
        tasks,
        habits: [],
        habitLogs: [],
        folders: [],
        pomodoroSessions: [],
        score: { total: 0, events: [] }
      }),
      'utf-8'
    )
  }

  it('같은 밀리초에 따로 지워진 부모·자식을 묶지 않는다', () => {
    const sameMs = '2026-08-28T00:00:00.000Z'
    legacyFile([
      { id: 'p', title: '부모', list_id: 'inbox', deleted_at: sameMs },
      { id: 'c', title: '자식', list_id: 'inbox', parent_id: 'p', deleted_at: sameMs }
    ])
    db.initDatabase()

    // 렌더러는 이 답을 그대로 옮긴다 — 짐작하던 시절의 "같은 시각이면 함께"와 갈리지 않는다.
    expect(db.restoreTask('p')).toEqual(['p'])
    expect(activeIds(), '따로 지운 자식이 부모 복원에 되살아났다').toEqual(['p'])
    expect(trashIds()).toEqual(['c'])
  })

  it('마이그레이션은 모호한 행을 전부 null로 둔다', () => {
    legacyFile([
      { id: 'p', title: '부모', list_id: 'inbox', deleted_at: '2026-08-28T00:00:00.000Z' },
      { id: 'c', title: '자식', list_id: 'inbox', parent_id: 'p', deleted_at: '2026-08-28T00:00:00.000Z' }
    ])
    db.initDatabase()
    const rows = db.getTrashTasks() as Record<string, unknown>[]
    expect(rows.every((r) => r.deleted_with === null)).toBe(true)
  })

  // 잃는 것은 옛 휴지통 항목의 편의뿐이다. 이 컬럼이 붙은 뒤의 삭제부터는 정확하다.
  it('마이그레이션 뒤 새로 지운 것은 정확하게 묶인다', () => {
    legacyFile([{ id: 'p', title: '부모', list_id: 'inbox' }])
    db.initDatabase()
    db.createTask({ id: 'c', title: '자식', listId: 'inbox', parentId: 'p' })

    db.deleteTask('p')
    db.restoreTask('p')
    expect(activeIds().sort()).toEqual(['c', 'p'])
  })
})

/**
 * 일괄 삭제도 "한 조작"이다 — 배치 안에 부모가 함께 있으면 그 자식은 캐스케이드다.
 *
 * 예전에는 전부 null이라, 일괄 삭제한 부모를 휴지통에서 하나만 골라 복원하면
 * main은 부모만 올리는데 렌더러는 같은 삭제 시각의 자식까지 올려 둘이 갈렸다.
 */
describe('일괄 삭제와 복원', () => {
  it('배치에 부모가 함께 있으면 자식을 캐스케이드로 표시한다', () => {
    db.createTask({ id: 'p', title: '부모', listId: 'inbox' })
    db.createTask({ id: 'c', title: '자식', listId: 'inbox', parentId: 'p' })
    db.batchUpdateTasks(['p', 'c'], { deleted: true })

    db.restoreTask('p')
    expect(activeIds().sort()).toEqual(['c', 'p'])
  })

  it('자식만 일괄 삭제했으면 부모 복원에 딸려 오지 않는다', () => {
    db.createTask({ id: 'p', title: '부모', listId: 'inbox' })
    db.createTask({ id: 'c', title: '자식', listId: 'inbox', parentId: 'p' })
    db.batchUpdateTasks(['c'], { deleted: true })
    db.batchUpdateTasks(['p'], { deleted: true })

    db.restoreTask('p')
    expect(activeIds()).toEqual(['p'])
    expect(trashIds()).toEqual(['c'])
  })
})

/**
 * 휴지통에서 **하위작업만** 복원했을 때.
 *
 * 휴지통은 행을 계층 없이 평평하게 그려서(TrashView) 하위작업 행에도 복원 버튼이
 * 있다. 그런데 목록 뷰는 전부 `isTopLevel`로 거르고 하위작업은 살아 있는 부모의
 * 상세 안에서만 그려진다 — 부모를 휴지통에 둔 채 자식만 올리면 그 행은 DB에는
 * 있는데 어느 화면에도 없고, 나중에 부모를 '영구 삭제'하면 부모 제목만 적힌
 * 확인창 아래에서 같이 지워진다. 휴지통을 비우면 반대로 영원히 남는다.
 */
describe('휴지통에서 하위작업만 복원', () => {
  type Row = { id: string; parent_id: string | null; deleted_at: string | null }

  /** 어느 화면에도 그려질 수 없는 행: 살아 있는데 부모가 휴지통에 있거나 아예 없다. */
  const invisibleIds = (): string[] => {
    const live = db.getTasks() as Row[]
    const rows = [...live, ...(db.getTrashTasks() as Row[])]
    return live
      .filter((t) => t.parent_id && !rows.some((p) => p.id === t.parent_id && !p.deleted_at))
      .map((t) => t.id)
      .sort()
  }

  it('되살아난 하위작업은 어느 화면에도 없는 행이 되면 안 된다', () => {
    parentWithChildren()
    db.deleteTask('p') // p, c1, c2가 함께 휴지통으로
    expect(trashIds().sort()).toEqual(['c1', 'c2', 'p'])

    db.restoreTask('c1') // 휴지통에서 하위작업 행의 '복원'을 누른다

    expect(invisibleIds(), '살아났는데 부모가 휴지통이라 어느 화면에도 없다').toEqual([])
    expect(activeIds()).toContain('c1')
  })

  it("부모 행을 '영구 삭제'해도 살아 있는 하위작업이 함께 지워지지 않는다", () => {
    parentWithChildren()
    db.deleteTask('p')
    db.restoreTask('c1')

    // 휴지통에 남은 행을 하나씩 '영구 삭제'한다 — 확인창에는 그 행의 제목만 나온다.
    for (const id of trashIds()) db.permanentDeleteTask(id)

    expect(activeIds(), '복원했던 하위작업이 부모의 확인창 아래에서 같이 지워졌다').toContain('c1')
  })

  it('휴지통을 비워도 살아 있는 하위작업이 유령으로 남지 않는다', () => {
    parentWithChildren()
    db.deleteTask('p')
    db.restoreTask('c1')

    db.emptyTrash()

    expect(invisibleIds(), '부모 행이 사라져 보이지도 지워지지도 않는 행이 남았다').toEqual([])
    expect(activeIds()).toContain('c1')
  })
})
