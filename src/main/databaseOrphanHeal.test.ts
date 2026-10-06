/**
 * 휴지통 버그(`bfa8b55`)가 **이미 남긴** 보이지 않는 행을 부팅 때 되찾는다.
 *
 * `bfa8b55`는 새로 생기는 것만 막았다. 그 전 빌드에서 휴지통의 하위작업만 복원한
 * 사용자 파일에는 두 가지가 남아 있을 수 있다:
 *
 *   (가) 살아 있는 하위작업 + 휴지통에 있는 부모 — 목록은 `isTopLevel`(= parentId 없음)로
 *        거르고 하위작업은 **살아 있는** 부모 상세 안에서만 그려지므로 어느 화면에도 없다.
 *        부모를 '영구 삭제'하면 확인창에 없는 이 행까지 함께 지워진다.
 *   (나) 그 상태에서 휴지통을 비우면 부모 행만 사라져, parent_id가 없는 id를 가리키는
 *        살아 있는 행 — 보이지도 고치지도 지우지도 못한다.
 *
 * 규칙은 `restoreTask`와 같다: (가)는 휴지통에 있는 **조상만** 올린다(지금 빌드에서
 * 그 복원 버튼을 눌렀다면 나왔을 결과이고, 부모를 다시 지우면 원래대로 캐스케이드된다).
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

type Row = { id: string; parent_id: string | null; deleted_at: string | null }
const active = (): Row[] => db.getTasks() as Row[]
const trash = (): string[] => (db.getTrashTasks() as Row[]).map((t) => t.id).sort()
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

describe('부팅 때 보이지 않는 하위작업을 되찾는다', () => {
  it('(가) 부모가 휴지통에 있으면 부모만 함께 올린다 — 그 부모의 다른 하위작업은 휴지통에 둔다', async () => {
    await bootWith([
      row('p', { deleted_at: T }),
      row('c1', { parent_id: 'p' }), // 옛 빌드에서 이것만 복원했다
      row('c2', { parent_id: 'p', deleted_at: T, deleted_with: 'p' })
    ])
    expect(visibleIds(), '살아 있는데 화면에 없는 행이 남았다').toEqual(['c1', 'p'])
    expect(trash()).toEqual(['c2'])
  })

  it('(가) 여러 대의 조상이 휴지통에 있으면 사슬을 따라 모두 올린다', async () => {
    await bootWith([
      row('g', { deleted_at: T }),
      row('p', { parent_id: 'g', deleted_at: T, deleted_with: 'g' }),
      row('c', { parent_id: 'p' })
    ])
    expect(visibleIds()).toEqual(['c', 'g', 'p'])
    expect(trash()).toEqual([])
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
    db.closeDatabase()
    const onDisk = JSON.parse(readFileSync(join(root, 'ticktick-data.json'), 'utf-8')).tasks as Row[]
    expect(onDisk.find((t) => t.id === 'c')?.parent_id).toBe('p')
    expect(onDisk.find((t) => t.id === 'lone')?.parent_id).toBe('q')
    // afterEach가 한 번 더 닫으므로 다시 연다.
    db.initDatabase()
  })

  it('되찾은 결과가 디스크에 남는다 — 다음 부팅에도 같은 행이 보인다', async () => {
    await bootWith([row('p', { deleted_at: T }), row('c', { parent_id: 'p' }), row('o', { parent_id: 'gone' })])
    db.closeDatabase()
    const onDisk = JSON.parse(readFileSync(join(root, 'ticktick-data.json'), 'utf-8')).tasks as Row[]
    expect(onDisk.find((t) => t.id === 'p')?.deleted_at).toBeNull()
    expect(onDisk.find((t) => t.id === 'o')?.parent_id).toBeNull()
    db.initDatabase()
  })
})
