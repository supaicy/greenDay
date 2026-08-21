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

  it('**원본을 덮어쓰지 않는다** — 쓰기가 일어나도, 종료 플러시에서도', () => {
    // 부팅이 계속되므로 IPC는 살아 있다. 사용자가 뭐 하나만 건드리면 이 경로다.
    db.createTask({ id: 'x', title: 'ghost' } as never)
    db.closeDatabase()
    expect(readFileSync(dbPath, 'utf-8'), '원본이 빈 값으로 덮어써졌다').toBe(CORRUPT)
  })
})
