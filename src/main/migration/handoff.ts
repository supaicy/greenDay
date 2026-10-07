/**
 * 번들 ID 마이그레이션의 **파일 원시 연산** — 상태 파일·백업·암호화 sentinel·무결성.
 *
 * electron을 import하지 않는다. 경로와 `KeyCrypto`를 받아 동작하므로 임시 디렉터리로
 * 전부 테스트할 수 있다. 순서를 정하는 것은 `bridge.ts`(옛 앱)와 `arrival.ts`(새 앱)다.
 *
 * ## 왜 이런 모양인가 (docs/27, codex 3·6단계)
 *
 * 두 앱은 같은 userData(`~/Library/Application Support/ticktick`)를 본다 — Electron
 * 내부 앱 이름을 바꾸지 않았기 때문이다. 그래서 "옮긴다"기보다 "같은 폴더를 다른
 * 서명의 앱이 이어받는다"에 가깝고, 위험은 데이터가 아니라 **Keychain**에 있다:
 * `safeStorage` 키는 앱 이름으로 찾지만 ACL은 서명 기준이라, 새 앱은 항목을 찾되
 * 접근을 **물어본다**. 거부되면 복호화가 던지고, 그 상태에서 빈 값을 다시 저장하면
 * 원본 암호문까지 지운다. sentinel은 그 위험을 **실제 비밀값을 건드리지 않고**
 * 먼저 재 보는 장치다.
 *
 * 평문 handoff 파일은 만들지 않는다 — 백업·Spotlight·크래시 수집에 노출된다.
 */

import {
  closeSync,
  constants as fsConstants,
  cpSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { KeyCrypto } from '../database'
import type { SentinelCheck } from '../../shared/migration'

export const MIGRATION_STATE_FILE = 'migration-state.json'
export const SENTINEL_FILE = 'keycheck.sentinel'
/** 브리지가 만드는 전환 전 백업. 새 앱도 이 이름을 보고 "이미 있다"를 판단한다. */
export const BRIDGE_BACKUP_DIR = 'backup-before-greenday-2'
export const SENTINEL_PLAINTEXT = 'keycheck-v1'
export const BACKUP_MANIFEST = 'manifest.json'

/**
 * 백업에 담는 것. **비밀은 암호문 그대로** 복사된다 — 평문화하지 않는다.
 * `device-id`·`license.json`도 넣는다: 라이선스 상태가 이 폴더에 있다.
 */
export const DATA_FILES = [
  'ticktick-data.json',
  'ticktick-data.json.bak',
  'ai-config.json',
  'ai-chat.json',
  'calendar-config.json',
  'google-config.json',
  'license.json',
  'device-id'
] as const
export const DATA_DIRS = ['attachments'] as const

// ── 상태 파일 ────────────────────────────────────────────────────────────────

export interface BridgeRecord {
  appVersion: string
  bundleId: string
  at: string
  backupDir: string | null
  sentinelPath: string | null
  integrity: IntegrityStatus
}

export interface ArrivalRecord {
  appVersion: string
  bundleId: string
  at: string
  backupDir: string | null
  sentinel: SentinelCheck | 'skipped'
  /** 시퀀스를 끝까지 돌았을 때만 채워진다. 없으면 다음 실행이 처음부터 다시 한다. */
  completedAt: string | null
  oldAppHintDismissed: boolean
}

export interface MigrationState {
  version: 1
  bridge: BridgeRecord | null
  arrival: ArrivalRecord | null
  noticeSnoozedUntil: string | null
}

export function emptyState(): MigrationState {
  return { version: 1, bridge: null, arrival: null, noticeSnoozedUntil: null }
}

/**
 * 상태 파일을 읽는다. 없거나 깨졌으면 null — 호출처가 "처음"으로 본다.
 *
 * 깨진 파일은 옆으로 치운다. 남겨 두면 다음 원자적 쓰기가 덮어 버려 무엇이
 * 잘못됐는지 알 길이 없다.
 */
export function readState(filePath: string): MigrationState | null {
  if (!existsSync(filePath)) return null
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf-8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    const s = parsed as Partial<MigrationState>
    if (s.version !== 1) throw new Error(`unknown version ${String(s.version)}`)
    return {
      version: 1,
      bridge: isBridgeRecord(s.bridge) ? s.bridge : null,
      arrival: isArrivalRecord(s.arrival) ? s.arrival : null,
      noticeSnoozedUntil: typeof s.noticeSnoozedUntil === 'string' ? s.noticeSnoozedUntil : null
    }
  } catch (error) {
    try {
      renameSync(filePath, `${filePath}.corrupt-${stamp()}`)
    } catch {
      /* 치우지 못해도 진행한다 — 다음 쓰기가 덮는다 */
    }
    console.error('[migration] 상태 파일을 읽지 못해 처음으로 본다', error)
    return null
  }
}

function isBridgeRecord(v: unknown): v is BridgeRecord {
  if (!v || typeof v !== 'object') return false
  const r = v as Partial<BridgeRecord>
  return typeof r.appVersion === 'string' && typeof r.bundleId === 'string' && typeof r.at === 'string'
}

function isArrivalRecord(v: unknown): v is ArrivalRecord {
  if (!v || typeof v !== 'object') return false
  const r = v as Partial<ArrivalRecord>
  return typeof r.appVersion === 'string' && typeof r.bundleId === 'string' && typeof r.at === 'string'
}

/**
 * 상태 파일을 **원자적으로** 쓴다 — 임시 파일에 쓰고 fsync한 뒤 rename, 부모 디렉터리도
 * fsync. `database.ts`의 커밋과 같은 규약이다. 반쪽짜리 상태 파일은 "브리지가 돌았다"를
 * 거짓으로 말할 수 있고, 그러면 새 앱이 sentinel을 기대하다 잠근다.
 */
export function writeStateAtomic(filePath: string, state: MigrationState): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const temp = join(dir, `.${basename(filePath)}.${process.pid}.${Date.now()}.tmp`)
  const fd = openSync(temp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC, 0o600)
  try {
    writeFileSync(fd, JSON.stringify(state, null, 2), 'utf-8')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(temp, filePath)
  syncDir(dir)
}

function syncDir(dir: string): void {
  try {
    const fd = openSync(dir, fsConstants.O_RDONLY)
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  } catch {
    /* 디렉터리 fsync를 지원하지 않는 FS — 파일은 이미 fsync됐다 */
  }
}

// ── 무결성 ───────────────────────────────────────────────────────────────────

export type IntegrityStatus = 'ok' | 'missing' | 'corrupt'

export interface IntegrityReport {
  status: IntegrityStatus
  /** primary가 깨졌어도 `.bak`이 읽히면 true — 새 앱이 그쪽에서 복구한다(database.ts). */
  backupReadable: boolean
  taskCount: number | null
}

/**
 * 데이터 파일이 읽히는가. **고치지 않는다** — 판정만 한다. 복구는 `database.ts`의
 * 몫이고, 여기서 손대면 그쪽의 격리·회전 규칙과 어긋난다.
 */
export function checkIntegrity(userData: string): IntegrityReport {
  const primary = join(userData, 'ticktick-data.json')
  const backup = `${primary}.bak`
  const p = parseDataFile(primary)
  const b = parseDataFile(backup)
  if (p.status === 'ok') return { status: 'ok', backupReadable: b.status === 'ok', taskCount: p.taskCount }
  if (p.status === 'missing' && b.status !== 'ok') return { status: 'missing', backupReadable: false, taskCount: null }
  return { status: p.status === 'missing' ? 'ok' : 'corrupt', backupReadable: b.status === 'ok', taskCount: b.taskCount }
}

function parseDataFile(file: string): { status: IntegrityStatus; taskCount: number | null } {
  if (!existsSync(file)) return { status: 'missing', taskCount: null }
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf-8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { status: 'corrupt', taskCount: null }
    const tasks = (parsed as Record<string, unknown>).tasks
    return { status: 'ok', taskCount: Array.isArray(tasks) ? tasks.length : 0 }
  } catch {
    return { status: 'corrupt', taskCount: null }
  }
}

// ── 백업 ─────────────────────────────────────────────────────────────────────

export interface BackupResult {
  dir: string
  /** 이미 있어서 건너뛰었는가. 있는 백업은 절대 덮어쓰지 않는다 — 그게 "전환 전"의 뜻이다. */
  existed: boolean
  copied: string[]
}

/**
 * userData의 데이터 파일과 첨부를 `<userData>/<name>/`에 복사한다.
 *
 * **원자적이다**: 스테이징 디렉터리에 전부 복사한 뒤 rename으로 제자리에 놓는다.
 * 중간에 죽으면 `.partial-` 디렉터리만 남고 다음 실행이 치운다 — 반쪽 백업이
 * "백업 있음"으로 읽히는 일은 없다.
 */
export function backupUserData(userData: string, name: string, meta: { appVersion: string; at: string }): BackupResult {
  const dest = join(userData, name)
  if (existsSync(join(dest, BACKUP_MANIFEST))) return { dir: dest, existed: true, copied: [] }

  // 앞선 실행의 반쪽을 치운다.
  for (const stale of listPartials(userData, name)) rmSync(stale, { recursive: true, force: true })
  // 매니페스트 없는 디렉터리가 이름을 차지하고 있으면(반쪽 rename) 옆으로 치운다.
  if (existsSync(dest)) renameSync(dest, `${dest}.incomplete-${stamp()}`)

  const staging = `${dest}.partial-${stamp()}`
  mkdirSync(staging, { recursive: true })
  const copied: string[] = []
  for (const file of DATA_FILES) {
    const src = join(userData, file)
    if (!existsSync(src) || !statSync(src).isFile()) continue
    copyFileSync(src, join(staging, file))
    copied.push(file)
  }
  for (const dir of DATA_DIRS) {
    const src = join(userData, dir)
    if (!existsSync(src) || !statSync(src).isDirectory()) continue
    cpSync(src, join(staging, dir), { recursive: true })
    copied.push(`${dir}/`)
  }
  const manifest = { version: 1, appVersion: meta.appVersion, createdAt: meta.at, files: copied }
  const manifestPath = join(staging, BACKUP_MANIFEST)
  const fd = openSync(manifestPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC, 0o600)
  try {
    writeFileSync(fd, JSON.stringify(manifest, null, 2), 'utf-8')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(staging, dest)
  syncDir(userData)
  return { dir: dest, existed: false, copied }
}

function listPartials(userData: string, name: string): string[] {
  try {
    return readdirSync(userData)
      .filter((entry) => entry.startsWith(`${name}.partial-`))
      .map((entry) => join(userData, entry))
  } catch {
    return []
  }
}

export function backupExists(userData: string, name: string): boolean {
  return existsSync(join(userData, name, BACKUP_MANIFEST))
}

// ── 암호화 sentinel ──────────────────────────────────────────────────────────

export type SentinelWrite = 'written' | 'unavailable' | 'failed'

/**
 * `safeStorage.encryptString('keycheck-v1')`을 파일로 남긴다. 값 자체는 비밀이 아니다 —
 * 이 파일의 유일한 용도는 "지금 이 앱이 옛 앱과 **같은 키**로 복호화할 수 있는가"를
 * 실제 비밀값을 건드리지 않고 재는 것이다.
 */
export function writeSentinel(filePath: string, crypto: KeyCrypto): SentinelWrite {
  if (!crypto.available()) return 'unavailable'
  try {
    const ciphertext = crypto.encrypt(SENTINEL_PLAINTEXT)
    const temp = `${filePath}.${process.pid}.tmp`
    writeFileSync(temp, ciphertext, { encoding: 'utf-8', mode: 0o600 })
    renameSync(temp, filePath)
    return 'written'
  } catch (error) {
    console.error('[migration] sentinel을 쓰지 못했다', error)
    return 'failed'
  }
}

/**
 * sentinel을 열어 본다. 각 결과가 새 앱의 분기다:
 *   - ok          같은 키다 → 실제 비밀값을 읽어도 된다
 *   - missing     브리지가 안 돌았거나 실패했다 → 재 볼 것이 없다
 *   - unavailable 이 환경에서 safeStorage 자체가 안 된다
 *   - denied      복호화가 던졌다 — Keychain 거부·잠김·항목 없음(새 랜덤 키)
 *   - mismatch    풀리긴 했는데 다른 값 → 다른 키로 만든 sentinel
 *   - corrupt     파일이 base64도 아니다
 */
export function checkSentinel(filePath: string, crypto: KeyCrypto): SentinelCheck {
  if (!existsSync(filePath)) return 'missing'
  if (!crypto.available()) return 'unavailable'
  let ciphertext: string
  try {
    ciphertext = readFileSync(filePath, 'utf-8').trim()
  } catch {
    return 'corrupt'
  }
  if (!ciphertext || !/^[A-Za-z0-9+/=]+$/.test(ciphertext)) return 'corrupt'
  let plain: string
  try {
    plain = crypto.decrypt(ciphertext)
  } catch {
    return 'denied'
  }
  return plain === SENTINEL_PLAINTEXT ? 'ok' : 'mismatch'
}

/**
 * 세 저장소 중 하나라도 암호문을 들고 있는가 — "재 볼 것이 있는가"의 답이다.
 * v1.4.1은 safeStorage를 쓰지 않았으므로 그 사용자에게는 보통 false다.
 */
export function hasStoredCiphertexts(userData: string): boolean {
  const probes: [string, string][] = [
    ['ai-config.json', 'apiKey_enc'],
    ['calendar-config.json', 'password_enc'],
    ['google-config.json', 'tokens_enc']
  ]
  return probes.some(([file, field]) => {
    const raw = readRawJson(join(userData, file))
    return typeof raw?.[field] === 'string' && (raw[field] as string).length > 0
  })
}

export function readRawJson(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf-8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}
