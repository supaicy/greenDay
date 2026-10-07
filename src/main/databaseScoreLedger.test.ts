/**
 * M8 — 완료 이벤트가 200개 창 밖으로 밀리면 완료 취소가 점수를 회수하지 못한다.
 *
 * `score.events`는 표시용이라 `capEvents`가 200개로 자른다. 회수액을 그 배열에서
 * 구하면, 완료 뒤 다른 점수 이벤트가 200건 쌓인 순간 회수액이 0이 된다 —
 * 지급은 됐는데 회수는 안 되는 순증이고, 같은 할일로 몇 번이든 반복 가능하다.
 * 원장(`taskNet`)은 자르지 않는다.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let root: string
let db: typeof import('./database')

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'greenday-score-'))
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

const score = (): { total: number; events: unknown[]; taskNet: Record<string, number> } =>
  db.getScore() as { total: number; events: unknown[]; taskNet: Record<string, number> }

describe('점수 원장', () => {
  it('할일별 순지급액을 기록한다', () => {
    db.addScoreEvent({ type: 'taskComplete', points: 3, taskId: 't1' })
    expect(score().taskNet).toEqual({ t1: 3 })
  })

  it('회수하면 0이 되고 원장에서 사라진다 — 무한히 자라지 않게', () => {
    db.addScoreEvent({ type: 'taskComplete', points: 3, taskId: 't1' })
    db.addScoreEvent({ type: 'taskComplete', points: -3, taskId: 't1' })
    expect(score().taskNet).toEqual({})
    expect(score().total).toBe(0)
  })

  // 이게 이 항목의 전부다: 200건이 흘러간 뒤에도 회수액을 알고 있어야 한다.
  it('이벤트 200개가 흘러간 뒤에도 회수액을 기억한다', () => {
    db.addScoreEvent({ type: 'taskComplete', points: 3, taskId: 'old' })

    // 표시용 배열에서 'old'의 완료 이벤트를 밀어낸다.
    for (let i = 0; i < 250; i++) {
      db.addScoreEvent({ type: 'habitComplete', points: 1, taskId: `filler-${i}` })
    }
    const events = score().events as { taskId?: string }[]
    expect(events, '전제: 배열이 잘렸다').toHaveLength(200)
    expect(events.some((e) => e.taskId === 'old'), '전제: 옛 이벤트가 창 밖으로 밀렸다').toBe(false)

    // 원장은 그대로 알고 있다 → 회수가 실제로 일어난다.
    expect(score().taskNet.old).toBe(3)
    const before = score().total
    db.addScoreEvent({ type: 'taskComplete', points: -score().taskNet.old, taskId: 'old' })
    expect(score().total, '회수되지 않아 점수가 순증했다').toBe(before - 3)
    expect(score().taskNet.old).toBeUndefined()
  })

  // 총점이 0에서 잘리면 요청액과 실제 반영액이 갈린다. 원장이 요청액을 기억하면
  // "지급된 적 없는 점수"를 회수하게 되어 총점이 0으로 끌려 내려간다.
  it('원장은 요청액이 아니라 **실제 반영된 delta**를 적는다', () => {
    db.addScoreEvent({ type: 'taskComplete', points: -100, taskId: 't1' })
    expect(score().total).toBe(0)
    expect(score().taskNet).toEqual({})
  })

  it('addScoreEvents도 같은 원장을 쓴다', () => {
    db.addScoreEvents([
      { type: 'taskComplete', points: 3, taskId: 't1' },
      { type: 'taskComplete', points: 2, taskId: 't2' },
      { type: 'taskComplete', points: 1, taskId: 't1' }
    ])
    expect(score().taskNet).toEqual({ t1: 4, t2: 2 })
  })

  it('taskId가 없는 이벤트는 원장에 남기지 않는다', () => {
    db.addScoreEvent({ type: 'habitComplete', points: 1 })
    expect(score().taskNet).toEqual({})
    expect(score().total).toBe(1)
  })

  it('원장은 디스크를 왕복해도 살아남는다', () => {
    db.addScoreEvent({ type: 'taskComplete', points: 5, taskId: 't1' })
    db.closeDatabase()
    db.initDatabase()
    expect(score().taskNet).toEqual({ t1: 5 })
  })
})

describe('normalizeScore — 마이그레이션', () => {
  it('taskNet이 없던 파일은 남아 있는 이벤트에서 되짚는다', () => {
    expect(
      db.normalizeScore({
        total: 5,
        events: [
          { type: 'taskComplete', points: 3, taskId: 't1' },
          { type: 'taskComplete', points: 2, taskId: 't2' }
        ]
      })
    ).toEqual({
      total: 5,
      events: expect.any(Array),
      taskNet: { t1: 3, t2: 2 }
    })
  })

  it('저장된 taskNet이 있으면 그것을 쓴다', () => {
    const out = db.normalizeScore({ total: 9, events: [], taskNet: { t1: 7 } })
    expect(out?.taskNet).toEqual({ t1: 7 })
  })

  it('손으로 고쳐진 값은 버린다', () => {
    const out = db.normalizeScore({ total: 'NaN', events: 'nope', taskNet: { a: 'x', b: 0, c: 4 } })
    expect(out).toEqual({ total: 0, events: [], taskNet: { c: 4 } })
  })

  it('score가 아예 없는 파일도 온전한 모양으로 로드된다', () => {
    const legacy = { lists: [], tasks: [], habits: [], habitLogs: [], folders: [], pomodoroSessions: [] }
    writeFileSync(join(root, 'ticktick-data.json'), JSON.stringify(legacy), 'utf-8')
    db.initDatabase()
    expect(score()).toEqual({ total: 0, events: [], taskNet: {} })
  })
})
