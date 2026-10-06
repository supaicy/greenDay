/**
 * 휴지통 버그(`bfa8b55`)와 한 단계짜리 캐스케이드가 **이미 남긴** 보이지 않는 행을
 * 부팅 때 정리한다.
 *
 * 사용자 파일에 남아 있을 수 있는 것은 두 가지다:
 *
 *   (가) 살아 있는 행 + 휴지통에 있는 조상 — 목록은 `isTopLevel`(= parentId 없음)로
 *        거르고 하위작업은 **살아 있는** 부모 상세 안에서만 그려지므로 어느 화면에도 없다.
 *        옛 빌드에서 휴지통의 하위작업만 복원했거나, 삭제가 한 단계만 캐스케이드해
 *        A→B→C에서 C만 살아 남은 경우다.
 *   (나) 그 상태에서 휴지통을 비우면 부모 행만 사라져, parent_id가 없는 id를 가리키는
 *        살아 있는 행 — 보이지도 고치지도 지우지도 못한다.
 *
 * (가)는 **살아 있는 행을 그 조상과 함께 휴지통으로** 보낸다. 한때는 반대로 조상을
 * 꺼냈는데, 그러면 3단 트리를 일부러 지운 것이 재시작마다 되살아났다 — 부팅 정리는
 * 사용자의 삭제를 되돌려서는 안 된다. 그 조상 삭제의 뿌리를 `deleted_with`에 적어
 * 두므로 뿌리를 복원하면 함께 올라온다.
 * (나)는 매달 곳이 없으니 최상위로 올린다. 어느 경우에도 행을 지우지 않는다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let root: string
let db: typeof import('./database')

const T = '2026-09-01T00:00:00.000Z'
function row(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    title: id,
    list_id: 'inbox',
    parent_id: null,
    completed: 0,
    deleted_at: null,
    deleted_with: null,
    sort_order: 0,
    created_at: T,
    ...extra
  }
}

/** 옛 빌드가 남긴 파일을 깔고 부팅한다. */
async function bootWith(tasks: Record<string, unknown>[]): Promise<void> {
  writeFileSync(join(root, 'ticktick-data.json'), JSON.stringify({ tasks, lists: [] }))
  db = await import('./database')
  db.initDatabase()
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'greenday-orphan-'))
  vi.resetModules()
  const dir = root
  vi.doMock('electron', () => ({
    app: { getPath: () => dir, getVersion: () => '0.0.0-test' },
    safeStorage: { isEncryptionAvailable: () => false }
  }))
})

afterEach(() => {
  db.closeDatabase()
  rmSync(root, { recursive: true, force: true })
})

type Row = { id: string; parent_id: string | null; deleted_at: string | null; deleted_with: string | null }
const active = (): Row[] => db.getTasks() as Row[]
const trash = (): string[] => (db.getTrashTasks() as Row[]).map((t) => t.id).sort()
const trashRow = (id: string): Row | undefined => (db.getTrashTasks() as Row[]).find((t) => t.id === id)
/** 렌더러가 목록에 세우는 행 + 그 행들의 상세 안에 그려지는 하위작업. 이 밖이면 화면에 없다. */
function visibleIds(): string[] {
  const live = active()
  const liveIds = new Set(live.map((t) => t.id))
  const shown = new Set<string>()
  const top = live.filter((t) => !t.parent_id)
  const stack = [...top]
  while (stack.length) {
    const t = stack.pop() as Row
    if (shown.has(t.id)) continue
    shown.add(t.id)
    for (const c of live) if (c.parent_id === t.id && liveIds.has(c.id)) stack.push(c)
  }
  return [...shown].sort()
}

describe('부팅 때 보이지 않는 하위작업을 정리한다', () => {
  it('(가) 부모가 휴지통에 있으면 살아 있는 하위작업도 휴지통으로 보낸다 — 부모를 꺼내지 않는다', async () => {
    await bootWith([
      row('p', { deleted_at: T }),
      row('c1', { parent_id: 'p' }), // 옛 빌드에서 이것만 복원했다
      row('c2', { parent_id: 'p', deleted_at: T, deleted_with: 'p' })
    ])
    expect(visibleIds(), '살아 있는데 화면에 없는 행이 남았다').toEqual([])
    expect(trash(), '부팅 정리가 휴지통의 부모를 꺼냈다').toEqual(['c1', 'c2', 'p'])
    const c1 = trashRow('c1')
    expect(c1?.deleted_at, '버려진 시각은 부모의 것을 따른다').toBe(T)
    expect(c1?.deleted_with, '부모를 복원하면 함께 올라와야 한다').toBe('p')
    expect(trashRow('p')?.deleted_at).toBe(T)
    expect(trashRow('p')?.deleted_with).toBeNull()
  })

  it('(가) 조상이 다른 삭제에 딸려 내려갔으면 그 삭제의 뿌리를 가리킨다', async () => {
    await bootWith([
      row('g', { deleted_at: T }),
      row('p', { parent_id: 'g', deleted_at: T, deleted_with: 'g' }),
      row('c', { parent_id: 'p' })
    ])
    expect(visibleIds()).toEqual([])
    expect(trash()).toEqual(['c', 'g', 'p'])
    expect(trashRow('c')?.deleted_with).toBe('g')
    expect(trashRow('g')?.deleted_at, '부팅 정리가 뿌리를 꺼냈다').toBe(T)
    // 뿌리 하나를 복원하면 사슬 전체가 돌아온다.
    db.restoreTask('g')
    expect(visibleIds()).toEqual(['c', 'g', 'p'])
  })

  it('(가) 한 단계 캐스케이드가 남긴 3단 트리: 살아 있는 중간·손자 모두 휴지통의 조상을 따른다', async () => {
    const U = '2026-09-02T00:00:00.000Z'
    await bootWith([
      row('a', { deleted_at: U }),
      row('b', { parent_id: 'a' }),
      row('c', { parent_id: 'b' }),
      row('d', { parent_id: 'c' })
    ])
    expect(visibleIds()).toEqual([])
    expect(trash()).toEqual(['a', 'b', 'c', 'd'])
    for (const id of ['b', 'c', 'd']) {
      expect(trashRow(id)?.deleted_at).toBe(U)
      expect(trashRow(id)?.deleted_with).toBe('a')
    }
  })

  it('(나) 부모가 아예 없으면 최상위로 올린다', async () => {
    await bootWith([row('c', { parent_id: 'gone' })])
    expect(visibleIds()).toEqual(['c'])
    expect(active()[0].parent_id).toBeNull()
  })

  it('손상된 순환 parent_id에 멈추지 않고 고리를 끊는다', async () => {
    await bootWith([row('a', { parent_id: 'b' }), row('b', { parent_id: 'a' }), row('s', { parent_id: 's' })])
    expect(visibleIds()).toEqual(['a', 'b', 's'])
  })

  it('정상 데이터는 건드리지 않는다 — 휴지통의 하위작업도, 살아 있는 계층도 그대로', async () => {
    const tasks = [
      row('p'),
      row('c', { parent_id: 'p' }),
      row('q', { deleted_at: T }),
      row('d', { parent_id: 'q', deleted_at: T, deleted_with: 'q' }),
      row('lone', { parent_id: 'q', deleted_at: T }) // 휴지통 안의 고아는 휴지통이 그린다
    ]
    await bootWith(tasks)
    expect(visibleIds()).toEqual(['c', 'p'])
    expect(trash()).toEqual(['d', 'lone', 'q'])
    expect(trashRow('lone')?.deleted_with, '휴지통 안의 행을 다시 찍었다').toBeNull()
    db.closeDatabase()
    const onDisk = JSON.parse(readFileSync(join(root, 'ticktick-data.json'), 'utf-8')).tasks as Row[]
    expect(onDisk.find((t) => t.id === 'c')?.parent_id).toBe('p')
    expect(onDisk.find((t) => t.id === 'lone')?.parent_id).toBe('q')
    // afterEach가 한 번 더 닫으므로 다시 연다.
    db.initDatabase()
  })

  it('정리한 결과가 디스크에 남고, 다시 부팅해도 같다(멱등)', async () => {
    await bootWith([row('p', { deleted_at: T }), row('c', { parent_id: 'p' }), row('o', { parent_id: 'gone' })])
    db.closeDatabase()
    const onDisk = JSON.parse(readFileSync(join(root, 'ticktick-data.json'), 'utf-8')).tasks as Row[]
    expect(onDisk.find((t) => t.id === 'p')?.deleted_at, '부팅 정리가 휴지통의 부모를 꺼냈다').toBe(T)
    expect(onDisk.find((t) => t.id === 'c')?.deleted_at).toBe(T)
    expect(onDisk.find((t) => t.id === 'c')?.deleted_with).toBe('p')
    expect(onDisk.find((t) => t.id === 'o')?.parent_id).toBeNull()
    db.initDatabase()
    expect(visibleIds()).toEqual(['o'])
    expect(trash()).toEqual(['c', 'p'])
  })
})
