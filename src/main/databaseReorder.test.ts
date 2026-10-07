/**
 * 드래그로 바꾼 순서가 디스크에도 남는가.
 *
 * `sort_order`는 **리스트별** 카운터다(createTask가 같은 list_id 안에서 maxOrder+1).
 * 그래서 '전체'·'오늘'·태그처럼 리스트를 가로지르는 뷰에서는 같은 값을 쥔 행이
 * 여럿 보인다. 옛 reorderTasks는 그 동점 슬롯을 그대로 되돌려 줬고, getTasks의
 * 정렬이 안정 정렬이라 파일에 적힌 순서가 그대로 살아나 드롭이 없던 일이 됐다.
 * 렌더러 applyReorder와 짝이다 — 한쪽만 고치면 재시작 때 화면과 디스크가 갈린다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let root: string
let db: typeof import('./database')

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'greenday-reorder-'))
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

const ids = (): string[] => (db.getTasks() as { id: string }[]).map((t) => t.id)

describe('reorderTasks', () => {
  it('리스트별 카운터가 겹쳐도 드롭한 자리에 남는다', () => {
    db.createTask({ id: 'a1', title: 'a1', listId: 'A' })
    db.createTask({ id: 'a2', title: 'a2', listId: 'A' })
    db.createTask({ id: 'b1', title: 'b1', listId: 'B' })
    db.createTask({ id: 'b2', title: 'b2', listId: 'B' })
    // 두 리스트가 각자 1,2를 쥔다 — 이 동점이 버그의 씨앗이었다.
    expect((db.getTasks() as { sort_order: number }[]).map((t) => t.sort_order)).toEqual([1, 1, 2, 2])
    db.reorderTasks(['b1', 'a1', 'a2', 'b2'])
    expect(ids(), '동점 슬롯을 그대로 되돌려 줘서 드롭이 버려졌다').toEqual(['b1', 'a1', 'a2', 'b2'])
  })

  it('한 리스트 안의 순서는 그대로 지켜진다 (회귀 방지)', () => {
    db.createTask({ id: 'x', title: 'x', listId: 'A' })
    db.createTask({ id: 'y', title: 'y', listId: 'A' })
    db.createTask({ id: 'z', title: 'z', listId: 'A' })
    db.reorderTasks(['z', 'x', 'y'])
    expect(ids()).toEqual(['z', 'x', 'y'])
  })
})
