/**
 * 브리지 릴리스(v1.5.0, com.haru.app)의 첫 실행 — codex 3단계.
 *
 * 공지판이 아니다. 이 릴리스가 해야 할 일은 새 앱이 **안전하게 이어받을 수 있는
 * 조건을 만드는 것**이다:
 *   1. userData 무결성 검사 (판정만, 고치지 않는다)
 *   2. 전환 전 백업 — `backup-before-greenday-2/`, 원자적, 있으면 건드리지 않는다
 *   3. 암호화 sentinel — `safeStorage.encryptString('keycheck-v1')`
 *   4. 마이그레이션 상태 파일 — 원자적 기록
 *   5. 동시 실행 방지 — 호출처(index.ts)가 single instance lock 뒤에서 부른다
 *
 * 매 실행 돌아도 안전하다(멱등). 상태 파일이 이미 이 버전의 기록을 갖고 sentinel이
 * 제자리에 있으면 1~4를 건너뛴다.
 *
 * electron을 import하지 않는다 — 경로·시계·crypto를 받는다.
 */

import { join } from 'node:path'
import type { KeyCrypto } from '../database'
import type { BridgeStatus } from '../../shared/migration'
import { GREENDAY_DOWNLOAD_URL } from '../../shared/migration'
import {
  BRIDGE_BACKUP_DIR,
  MIGRATION_STATE_FILE,
  SENTINEL_FILE,
  backupUserData,
  checkIntegrity,
  checkSentinel,
  emptyState,
  readState,
  writeSentinel,
  writeStateAtomic,
  type MigrationState
} from './handoff'

export interface BridgeDeps {
  userData: string
  appVersion: string
  bundleId: string
  crypto: KeyCrypto
  now: () => string
}

export interface BridgeOutcome {
  status: BridgeStatus
  state: MigrationState
  /** 이번 실행에서 1~4를 실제로 돌렸는가. */
  performed: boolean
}

/** "나중에"의 기본 간격. 짧으면 잔소리고 길면 잊는다. */
export const SNOOZE_DAYS = 3

export function runBridge(deps: BridgeDeps): BridgeOutcome {
  const statePath = join(deps.userData, MIGRATION_STATE_FILE)
  const sentinelPath = join(deps.userData, SENTINEL_FILE)
  const existing = readState(statePath) ?? emptyState()

  const alreadyDone =
    existing.bridge !== null &&
    existing.bridge.appVersion === deps.appVersion &&
    existing.bridge.sentinelPath !== null &&
    checkSentinel(sentinelPath, deps.crypto) === 'ok'

  if (alreadyDone) {
    return { status: toStatus(existing, deps.now()), state: existing, performed: false }
  }

  const at = deps.now()
  const integrity = checkIntegrity(deps.userData)
  const backup = backupUserData(deps.userData, BRIDGE_BACKUP_DIR, { appVersion: deps.appVersion, at })
  // sentinel이 있어도 다시 쓴다 — 지금 이 앱의 키로 만든 것이어야 의미가 있다.
  const sentinel = writeSentinel(sentinelPath, deps.crypto)

  const state: MigrationState = {
    ...existing,
    bridge: {
      appVersion: deps.appVersion,
      bundleId: deps.bundleId,
      at,
      backupDir: backup.dir,
      sentinelPath: sentinel === 'written' ? sentinelPath : null,
      integrity: integrity.status
    }
  }
  writeStateAtomic(statePath, state)
  return { status: toStatus(state, at), state, performed: true }
}

/** "나중에" — 안내를 며칠 뒤로 미룬다. 설정에서 언제든 다시 열 수 있다. */
export function snoozeBridgeNotice(userData: string, now: string, days = SNOOZE_DAYS): BridgeStatus {
  const statePath = join(userData, MIGRATION_STATE_FILE)
  const state = readState(statePath) ?? emptyState()
  const until = new Date(new Date(now).getTime() + days * 24 * 60 * 60 * 1000).toISOString()
  const next = { ...state, noticeSnoozedUntil: until }
  writeStateAtomic(statePath, next)
  return toStatus(next, now)
}

/** 설정에서 "다시 보기" — 스누즈를 지운다. */
export function clearBridgeSnooze(userData: string, now: string): BridgeStatus {
  const statePath = join(userData, MIGRATION_STATE_FILE)
  const state = readState(statePath) ?? emptyState()
  const next = { ...state, noticeSnoozedUntil: null }
  writeStateAtomic(statePath, next)
  return toStatus(next, now)
}

export function toStatus(state: MigrationState, now: string): BridgeStatus {
  const snoozed = state.noticeSnoozedUntil !== null && new Date(state.noticeSnoozedUntil).getTime() > new Date(now).getTime()
  return {
    mode: 'bridge',
    noticeDue: !snoozed,
    snoozedUntil: snoozed ? state.noticeSnoozedUntil : null,
    backupReady: state.bridge?.backupDir !== null && state.bridge?.backupDir !== undefined,
    integrity: state.bridge?.integrity ?? 'missing',
    sentinelReady: Boolean(state.bridge?.sentinelPath),
    downloadUrl: GREENDAY_DOWNLOAD_URL
  }
}
