/**
 * 첫 실행 시퀀스에서 **백업보다 먼저 지워지는 것이 없어야 한다.**
 *
 * index.ts의 순서는 `holdSaves() → initDatabase() → runMigrationOnBoot()`이고,
 * 그 주석은 "initDatabase는 읽기만 하고"라고 적혀 있었다. 사실이 아니었다:
 * initDatabase는 손상된 primary를 `.corrupt-*`로 rename하고(`quarantine`)
 * 참조 없는 첨부를 unlink한다(`gcAttachments`). 둘 다 `save()`를 지나지 않는
 * 직접 파일 조작이라 `savesHeld` 가드를 비껴갔고, 그래서 전환 전 백업
 * (`backup-before-greenday-2/`)이 만들어질 때는 이미 사라진 뒤였다.
 *
 * 그 결과가 영구 데이터 손실이다. `.bak`이 낡아 첨부를 참조하는 할일을 모르면
 * 아직 살아 있는 사진·PDF가 "참조 없음"으로 보여 unlink되고, 손상된 primary는
 * `DATA_FILES`에 `.corrupt-*`가 없어 백업에도 안 담긴다 — BridgeNotice가 약속하는
 * "무슨 일이 있어도 되돌릴 수 있습니다"(`migration.bridge.backupDone`)가 정확히
 * 이 상황에서 거짓이 된다.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let root: string
let db: typeof import('./database')

/** 첨부 하나가 **손상된 primary에만** 참조돼 있고, `.bak`은 그보다 낡아 그 할일을 모른다. */
function seedCorruptPrimaryWithOlderBackup(): void {
  mkdirSync(join(root, 'attachments'), { recursive: true })
  writeFileSync(join(root, 'attachments', 'uuid-photo.jpg'), 'JPEG-BYTES', 'utf-8')
  // primary: 잘린 JSON — readDataFile이 'corrupt'로 읽어 `.bak`으로 넘어간다.
  writeFileSync(
    join(root, 'ticktick-data.json'),
    '{"lists":[],"tasks":[{"id":"t1","attachments":"[\\"photo.jpg|uuid-photo.jpg\\"]"',
    'utf-8'
  )
  // .bak: 읽히지만 더 낡다 — 첨부를 참조하는 할일이 아직 없던 시절의 스냅샷.
  writeFileSync(join(root, 'ticktick-data.json.bak'), JSON.stringify({ lists: [], tasks: [], habits: [] }), 'utf-8')
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'greenday-firstrun-'))
  seedCorruptPrimaryWithOlderBackup()
  vi.resetModules()
  const dir = root
  vi.doMock('electron', () => ({
    app: { getPath: () => dir, getVersion: () => '2.0.0-test' },
    safeStorage: { isEncryptionAvailable: () => false }
  }))
  db = await import('./database')
})

afterEach(() => {
  // 붙든 채 끝난 테스트가 디바운스 타이머를 남기면 폴더가 사라진 뒤에 저장이 돌아
  // 다른 파일의 테스트에 실패를 흘린다. 종료 플러시가 타이머를 걷어 준다.
  db.closeDatabase()
  rmSync(root, { recursive: true, force: true })
})

describe('holdSaves 중의 initDatabase — 파괴적 조작은 백업 뒤로 미룬다', () => {
  it('붙들려 있는 동안 첨부를 지우지 않는다', () => {
    db.holdSaves() // index.ts가 initDatabase 앞에서 거는 것과 같은 순서
    db.initDatabase()
    expect(readdirSync(join(root, 'attachments'))).toEqual(['uuid-photo.jpg'])
  })

  it('붙들려 있는 동안 손상된 primary를 옆으로 치우지 않는다', () => {
    db.holdSaves()
    db.initDatabase()
    expect(existsSync(join(root, 'ticktick-data.json'))).toBe(true)
  })

  it('전환 전 백업이 첨부와 손상 전 원본을 모두 담는다', async () => {
    const { backupUserData, BRIDGE_BACKUP_DIR } = await import('./migration/handoff')
    db.holdSaves()
    db.initDatabase()
    // runMigrationOnBoot → runArrival 3단계가 부르는 그 백업.
    const backup = backupUserData(root, BRIDGE_BACKUP_DIR, {
      appVersion: '2.0.0',
      at: '2026-09-25T00:00:00.000Z'
    })
    expect(existsSync(join(backup.dir, 'attachments', 'uuid-photo.jpg'))).toBe(true)
    expect(backup.copied).toContain('ticktick-data.json')
  })

  it('풀면 그때 격리하고 첨부를 걷는다 — 미루는 것이지 없애는 것이 아니다', () => {
    db.holdSaves()
    db.initDatabase()
    db.releaseSaves()
    expect(readdirSync(join(root, 'attachments'))).toEqual([])
    expect(existsSync(join(root, 'ticktick-data.json'))).toBe(false)
    expect(readdirSync(root).some((n) => n.startsWith('ticktick-data.json.corrupt-'))).toBe(true)
    // `.bak`은 우리를 구해 준 정상본이다 — 회전에 덮이지 않았다.
    expect(existsSync(join(root, 'ticktick-data.json.bak'))).toBe(true)
  })

  it('붙들린 채 종료해도 새 데이터가 손상본을 덮지 않는다', () => {
    db.holdSaves()
    db.initDatabase()
    db.closeDatabase() // 종료 플러시는 붙들려 있어도 쓴다
    expect(readdirSync(root).some((n) => n.startsWith('ticktick-data.json.corrupt-'))).toBe(true)
    expect(existsSync(join(root, 'ticktick-data.json.bak'))).toBe(true)
  })
})
