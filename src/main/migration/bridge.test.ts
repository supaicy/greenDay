import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearBridgeSnooze, runBridge, snoozeBridgeNotice, SNOOZE_DAYS } from './bridge'
import { BRIDGE_BACKUP_DIR, MIGRATION_STATE_FILE, SENTINEL_FILE, checkSentinel, readState } from './handoff'
import { fakeCrypto } from './fake-crypto.helper'

/** 브리지 릴리스(v1.5.0)의 첫 실행 — codex 3단계. */

let tmp: string
const NOW = '2026-09-07T12:00:00.000Z'
const deps = (over: Partial<Parameters<typeof runBridge>[0]> = {}) => ({
  userData: tmp,
  appVersion: '1.5.0',
  bundleId: 'com.haru.app',
  crypto: fakeCrypto('old'),
  now: () => NOW,
  ...over
})

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'greenday-bridge-'))
  writeFileSync(join(tmp, 'ticktick-data.json'), JSON.stringify({ tasks: [{ id: 1 }], lists: [] }), 'utf-8')
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('runBridge', () => {
  it('무결성 → 백업 → sentinel → 상태 파일, 그리고 안내는 지금 뜬다', () => {
    const r = runBridge(deps())
    expect(r.performed).toBe(true)
    expect(r.status).toEqual({
      mode: 'bridge',
      noticeDue: true,
      snoozedUntil: null,
      backupReady: true,
      integrity: 'ok',
      sentinelReady: true,
      downloadUrl: 'https://begreen.dev/greenday'
    })
    expect(existsSync(join(tmp, BRIDGE_BACKUP_DIR, 'ticktick-data.json'))).toBe(true)
    expect(checkSentinel(join(tmp, SENTINEL_FILE), fakeCrypto('old'))).toBe('ok')
    const state = readState(join(tmp, MIGRATION_STATE_FILE))
    expect(state?.bridge).toMatchObject({
      appVersion: '1.5.0',
      bundleId: 'com.haru.app',
      at: NOW,
      backupDir: join(tmp, BRIDGE_BACKUP_DIR),
      sentinelPath: join(tmp, SENTINEL_FILE),
      integrity: 'ok'
    })
  })

  it('두 번째 실행은 아무것도 다시 하지 않는다(멱등) — 백업도 그대로', () => {
    runBridge(deps())
    writeFileSync(join(tmp, 'ticktick-data.json'), JSON.stringify({ tasks: [] }), 'utf-8')
    const r = runBridge(deps())
    expect(r.performed).toBe(false)
    expect(JSON.parse(readFileSync(join(tmp, BRIDGE_BACKUP_DIR, 'ticktick-data.json'), 'utf-8')).tasks).toHaveLength(1)
  })

  it('sentinel 이 지워졌으면 다시 만든다', () => {
    runBridge(deps())
    rmSync(join(tmp, SENTINEL_FILE))
    const r = runBridge(deps())
    expect(r.performed).toBe(true)
    expect(existsSync(join(tmp, SENTINEL_FILE))).toBe(true)
  })

  it('암호화가 불가능한 환경이면 sentinelReady=false 로 정직하게 말한다', () => {
    const r = runBridge(deps({ crypto: fakeCrypto('old', false) }))
    expect(r.status.sentinelReady).toBe(false)
    expect(r.status.backupReady).toBe(true)
    expect(readState(join(tmp, MIGRATION_STATE_FILE))?.bridge?.sentinelPath).toBeNull()
  })

  it('데이터가 깨져 있으면 integrity=corrupt — 고치지는 않는다', () => {
    writeFileSync(join(tmp, 'ticktick-data.json'), '{broken', 'utf-8')
    const r = runBridge(deps())
    expect(r.status.integrity).toBe('corrupt')
    expect(readFileSync(join(tmp, 'ticktick-data.json'), 'utf-8')).toBe('{broken')
    // 손상본도 백업에 그대로 담긴다 — 복구 재료다.
    expect(readFileSync(join(tmp, BRIDGE_BACKUP_DIR, 'ticktick-data.json'), 'utf-8')).toBe('{broken')
  })
})

describe('나중에', () => {
  it('스누즈하면 만료 전에는 안내가 안 뜨고, 지나면 다시 뜬다', () => {
    runBridge(deps())
    const snoozed = snoozeBridgeNotice(tmp, NOW)
    expect(snoozed.noticeDue).toBe(false)
    const until = new Date(NOW).getTime() + SNOOZE_DAYS * 86400_000
    expect(snoozed.snoozedUntil).toBe(new Date(until).toISOString())

    const later = new Date(until + 1000).toISOString()
    expect(runBridge(deps({ now: () => later })).status.noticeDue).toBe(true)
    expect(runBridge(deps({ now: () => NOW })).status.noticeDue).toBe(false)
  })

  it('설정의 "다시 보기"는 스누즈를 지운다', () => {
    runBridge(deps())
    snoozeBridgeNotice(tmp, NOW)
    expect(clearBridgeSnooze(tmp, NOW).noticeDue).toBe(true)
    expect(runBridge(deps()).status.noticeDue).toBe(true)
  })
})
