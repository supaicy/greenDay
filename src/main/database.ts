import { app, safeStorage } from 'electron'
import { preserveCiphertext } from './migration/secrets-gate'
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { constants as fsConstants } from 'node:fs'
import { open as openFile } from 'node:fs/promises'
import path from 'node:path'
import { DB_READ_ONLY } from '../shared/db-errors'

const { O_CREAT, O_NOFOLLOW, O_TRUNC, O_WRONLY } = fsConstants

interface DbData {
  lists: Record<string, unknown>[]
  tasks: Record<string, unknown>[]
  habits: Record<string, unknown>[]
  habitLogs: Record<string, unknown>[]
  folders: Record<string, unknown>[]
  pomodoroSessions: Record<string, unknown>[]
  score: ScoreState
}

export interface ScoreState {
  total: number
  /** 표시용 최근 이벤트. `capEvents`가 200개로 자른다 — 원장이 아니다. */
  events: Record<string, unknown>[]
  /**
   * 할일별 **순지급 점수**. 표시용 배열과 분리해 두는 이유가 전부다.
   *
   * 완료 취소가 회수할 금액은 "이 할일에 실제로 지급된 합"인데, 예전에는 그것을
   * `events`를 훑어 구했다. 그 배열이 200개로 잘리므로 완료 이벤트가 창 밖으로
   * 밀리면 회수액이 0이 되고, 지급은 됐는데 회수는 안 되는 순증이 남았다 —
   * 같은 할일로 반복 가능한 무한 점수다. 원장은 자르지 않는다.
   */
  taskNet: Record<string, number>
}

export function readHistoryFile(filePath: string): Record<string, unknown>[] {
  if (!existsSync(filePath)) return []
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'))
    return Array.isArray(raw?.messages) ? raw.messages : []
  } catch {
    return []
  }
}

export function writeHistoryFile(filePath: string, messages: Record<string, unknown>[]): void {
  writeFileSync(filePath, JSON.stringify({ version: 1, messages }, null, 2), 'utf-8')
}

export function getChatHistory(): Record<string, unknown>[] {
  if (!chatHistoryPath) return []
  return readHistoryFile(chatHistoryPath)
}

export function saveChatHistory(messages: Record<string, unknown>[]): void {
  if (!chatHistoryPath) return
  writeHistoryFile(chatHistoryPath, messages)
}

let data: DbData = emptyData()
let dbPath: string
let attachmentsDir: string

/**
 * 데이터 파일을 못 읽었는가. **읽기 실패는 쓰기 금지로 이어져야 한다.**
 *
 * 예전에는 `load()`의 던짐이 그대로 부팅을 끊어서, 창도 IPC도 없었고 그래서
 * 파일이 덮어써질 수 없었다 — 우연한 보호였다. 그 던짐을 잡아 창을 띄우게
 * 바꾸면서 그 보호가 사라졌다: `dbPath`는 이미 사용자의 진짜 파일을 가리키고
 * `data`는 빈 기본값이라, 사용자가 뭐든 하나 건드리는 순간 `save()`가 그
 * 빈 값으로 원본을 덮어쓴다. 복구 가능한 고장이 영구 손실이 되는 것이다.
 */
let dbReadFailed = false

/** 데이터 파일을 못 읽어 쓰기가 막혀 있는가. 부팅이 사용자에게 알리는 데 쓴다. */
export function isDatabaseReadOnly(): boolean {
  return dbReadFailed
}

// 읽기 실패 세션의 거절 이유. 렌더러도 이 문구를 보고 유령 편집을 되돌리므로
// `shared/db-errors.ts`가 원본이다 — `LICENSE_REQUIRED`와 같은 배치다.
export { DB_READ_ONLY } from '../shared/db-errors'

/**
 * 읽기 실패 세션에서는 **메모리도 건드리지 않는다.**
 *
 * 예전에는 `save()`만 조용히 반환했다. 그러면 mutator가 `data`를 먼저 바꾸고
 * IPC는 성공으로 끝나서, 사용자는 오류 대화상자를 닫은 뒤 빈 앱에서 한 세션치를
 * 편집하고 재시작 때 전부 잃는다 — 디스크는 지켰지만 사용자에게는 유령 데이터를
 * 판 셈이다. 거절은 거절처럼 생겨야 한다.
 */
function assertWritable(): void {
  if (dbReadFailed) throw new Error(DB_READ_ONLY)
}

// ── 저장 ─────────────────────────────────────────────────────────────────────

/** 연속 변경을 한 번으로 모으는 창. */
const SAVE_DEBOUNCE_MS = 300
/** 저장이 실패했을 때 다시 시도하는 간격. 물러서며 늘린다. */
const SAVE_RETRY_BASE_MS = 500
const SAVE_RETRY_MAX_MS = 30_000

/**
 * 이 프로세스가 만든 변경의 세대. mutation마다 하나씩 오른다.
 *
 * 예전에는 `savePending` 불리언 하나였고, 그게 **구형 콜백이 새 저장을 지우는**
 * 경로였다: A 저장이 날아가는 중에 B를 추가하고 종료 플러시가 `[A,B]`를 쓴 뒤
 * A의 콜백이 착륙하면 파일이 `[A]`로 되돌아갔다(감사가 지연 주입으로 실측).
 * 불리언은 "누가 더 최신인가"를 말할 수 없다 — 숫자는 말할 수 있다.
 */
let revision = 0
/** 디스크에 확정된 가장 높은 세대. 이보다 낮은 쓰기는 커밋하지 않는다. */
let committedRevision = 0
/** 비동기 커밋이 진행 중인가. 두 개가 동시에 rename 하지 않게 한다. */
let draining = false
let saveTimer: ReturnType<typeof setTimeout> | null = null
/** 연속 실패 횟수. 재시도 간격을 물린다. */
let retryStreak = 0
/** 마지막 저장 실패. 성공하면 지운다. */
let lastSaveError: string | null = null

/**
 * 지금 자리에 있는 primary를 믿을 수 있는가.
 *
 * `.bak`에서 복구한 세션에서는 false로 시작한다. 그 상태로 회전하면 **우리를
 * 방금 구해 준 정상본을 손상본이 덮는다** — 검증이 실측했다. 새 primary를
 * 우리 손으로 커밋한 뒤에야 true로 돌아간다.
 */
let primaryTrusted = true

/** 이 세대가 커밋되면 첨부를 걷는다. 0이면 예약 없음. */
let gcAfterRevision = 0

/**
 * **예약된 스윕이 볼 수 있는 이름들 — 예약 시점에 첨부 폴더에 있던 것만이다.**
 * null이면 제한 없음(부팅 스윕이 그렇다).
 *
 * 없으면: 예약과 커밋 사이에 `copyAttachment`가 넣은 파일이 고아로 보인다.
 * `pick-attachment`는 파일을 **먼저** 복사하고, 그 참조를 적는 `update-task`는
 * 렌더러를 한 바퀴 돌아 나중에 온다. 그 왕복 안에 커밋이 착륙하면 방금 고른
 * 첨부가 아무도 참조하지 않는 것으로 보여 쓸려 나간다 — 목록에는 남았는데 파일은
 * 없어서 눌러도 아무 일도 일어나지 않는 첨부가 된다(`open-attachment`는
 * `isInsideAttachments`가 없는 경로에서 false로 떨어져 조용히 거절한다).
 * 창은 디바운스 300ms이고, 쓰기가 실패 중이면 재시도 백오프 전체(최대 30초)로
 * 벌어진다 — 한 번의 영구 삭제가 그동안 고른 첨부를 전부 먹는다.
 *
 * 미루는 것이지 새는 것이 아니다: 참조가 끝내 오지 않으면 다음 부팅의 무제한
 * 스윕이 걷는다. 참조만 떼는 경로가 이미 그 자리에서 정산된다.
 */
let gcArmedNames: readonly string[] | null = null

/**
 * **붙들려 있는 동안 미뤄 둔 파괴적 파일 조작.**
 *
 * `holdSaves()`는 "디스크 쓰기를 붙든다"는 약속인데, 격리(rename)와 첨부 GC(unlink)는
 * `save()`를 지나지 않는 직접 조작이라 그 가드를 통째로 비껴갔다. 부팅 순서가
 * `holdSaves() → initDatabase() → runMigrationOnBoot()`(index.ts)이므로, 첫 실행에서
 * 그 둘이 **전환 전 백업(`backup-before-greenday-2/`)보다 먼저** 돌았다:
 * 손상된 primary에만 참조가 남아 있던 첨부는 백업이 시작되기 전에 이미 unlink됐고,
 * 손상본은 `.corrupt-*`라는 이름으로 옮겨져 `DATA_FILES`(migration/handoff.ts)에
 * 걸리지 않아 백업에서도 빠졌다 — 되돌릴 사본이 어디에도 없는 영구 삭제였다.
 * 붙들려 있는 동안에는 적어 두기만 하고 `releaseSaves()`(=백업이 끝난 뒤)에 실제로 한다.
 */
let quarantineWhenReleased: string | null = null
let gcAttachmentsWhenReleased = false

/**
 * 미뤄 둔 격리를 지금 한다. **primary를 덮어쓰기 직전에도 반드시 불러야 한다** —
 * 그러지 않으면 종료 플러시가 손상본 자리에 새 데이터를 써서 사용자가 잃은 원본이
 * 통째로 사라진다.
 */
function quarantineDeferred(): void {
  if (quarantineWhenReleased === null) return
  const file = quarantineWhenReleased
  quarantineWhenReleased = null
  quarantine(file)
}

export interface SaveHealth {
  /** 디스크가 메모리를 따라잡았는가. */
  settled: boolean
  /** 아직 디스크에 닿지 않은 변경이 있는가. */
  pending: boolean
  /** 마지막 저장 실패 메시지. 성공하면 null. */
  lastError: string | null
}

/**
 * 저장이 건강한가 — **부팅과 종료가 사용자에게 알리는 데 쓴다.**
 *
 * 예전에는 비동기 저장 실패가 콘솔로만 갔다. mutator IPC는 이미 성공으로
 * 끝난 뒤라, 사용자는 편집이 저장됐다고 믿고 앱을 닫는다. 임시 경로를 디렉터리로
 * 막아 재현했다: 할일 생성은 성공했는데 450ms 뒤에도 디스크에 없었다.
 * 조용한 실패는 유령 데이터를 파는 것이고, 그 값은 사용자가 치른다.
 */
export function saveHealth(): SaveHealth {
  return {
    settled: revision <= committedRevision && lastSaveError === null,
    pending: revision > committedRevision,
    lastError: lastSaveError
  }
}

/**
 * 첫 실행 마이그레이션이 끝날 때까지 디스크 쓰기를 붙든다(`migration/arrival.ts`).
 *
 * 세대는 계속 오른다 — 붙드는 동안의 변경을 잃지 않는다. 풀리는 순간 밀린 세대가
 * 한 번에 커밋된다. 종료 플러시(`flushSave`)는 붙들려 있어도 쓴다: 프로세스가
 * 사라지는 마당에 메모리를 지키는 유일한 길이다.
 */
let savesHeld = false

export function holdSaves(): void {
  savesHeld = true
}

export function releaseSaves(): void {
  if (!savesHeld) return
  savesHeld = false
  // **미뤄 둔 파괴적 조작은 여기서 한다.** 붙드는 구간의 끝은 곧 "전환 전 백업이
  // 끝났다"는 뜻이다(migration/arrival.ts 3단계 → 10단계). 그 뒤에야 지워도
  // 되돌릴 사본이 있다.
  quarantineDeferred()
  if (gcAttachmentsWhenReleased) {
    gcAttachmentsWhenReleased = false
    gcAttachments()
  }
  if (revision > committedRevision && !saveTimer && !dbReadFailed) {
    saveTimer = setTimeout(() => {
      saveTimer = null
      void drain()
    }, SAVE_DEBOUNCE_MS)
  }
}

export function savesAreHeld(): boolean {
  return savesHeld
}

function save(): void {
  // 호출처가 이미 `assertWritable()`로 걸러 주지만, 여기 한 겹을 더 둔다 —
  // 마이그레이션처럼 mutator를 거치지 않는 경로가 있다.
  if (dbReadFailed) return
  revision += 1
  if (savesHeld) return
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    void drain()
  }, SAVE_DEBOUNCE_MS)
}

/**
 * 밀린 세대를 하나씩 커밋한다. **동시에 하나만 돈다.**
 *
 * 큐가 하나라는 것이 요점이다. 여러 개가 겹치면 어느 것이 마지막에 rename 될지
 * 파일시스템 스케줄링이 정하게 되고, 그건 정확히 세대가 뒤집히는 조건이다.
 */
async function drain(): Promise<void> {
  if (draining) return
  draining = true
  try {
    // 붙들려 있으면 쓰지 않는다 — `holdSaves()` 이전에 걸린 타이머가 여기로 들어와도
    // 마찬가지다. `releaseSaves()`가 다시 예약한다.
    while (revision > committedRevision && !savesHeld) {
      const target = revision
      const json = JSON.stringify(data)
      try {
        await writeAtomicAsync(dbPath, json, target)
      } catch (error) {
        // **물러서며 다시 시도한다.** 예전에는 여기서 로그만 남기고 반환했고,
        // 그러면 다음 mutation이 올 때까지(또는 영영) 디스크가 메모리를 따라잡지
        // 못했다. 디스크가 잠깐 가득 차거나 폴더 권한이 바뀐 경우는 스스로 회복된다.
        noteSaveFailed(error, true)
        return
      }
      noteSaveSucceeded()
    }
  } finally {
    draining = false
  }
}

function noteSaveSucceeded(): void {
  retryStreak = 0
  lastSaveError = null
  // 우리가 쓴 것이 자리에 있다. 이제부터는 회전해도 안전하다.
  primaryTrusted = true
  runPendingAttachmentGc()
}

function noteSaveFailed(error: unknown, retry: boolean): void {
  lastSaveError = error instanceof Error ? error.message : String(error)
  console.error('DB 저장 실패:', error)
  if (!retry || saveTimer) return
  retryStreak += 1
  const delay = Math.min(SAVE_RETRY_BASE_MS * 2 ** (retryStreak - 1), SAVE_RETRY_MAX_MS)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void drain()
  }, delay)
}

/** 이 세대의 임시 파일. 세대마다 다른 이름이라 동시 쓰기가 서로의 버퍼를 자르지 않는다. */
function tempPathFor(file: string, target: number): string {
  return `${file}.tmp-${target}`
}

/**
 * 임시 파일 → fsync → rename. `licenseStore.ts`가 `license.json`에 쓰는 것과 같은 모양이다.
 *
 * 제자리에서 자르면 그 사이 전원이 끊겼을 때 **유일한 할일 DB**가 깨진 JSON으로
 * 남고 되돌릴 이전 정상본이 없다. 훨씬 작은 `license.json`이 이미 이 방어를 쓰는데
 * 정작 큰 쪽이 안 쓰고 있었다 — 비대칭이었다.
 */
async function writeAtomicAsync(file: string, json: string, target: number): Promise<void> {
  const temp = tempPathFor(file, target)
  try {
    const handle = await openFile(temp, 'w')
    try {
      await handle.writeFile(json, 'utf-8')
      // rename은 원자적 *교체*이지 내구성 있는 *커밋*이 아니다. 내용이 아직 페이지
      // 캐시에만 있으면 성공이라 답한 뒤 전원이 끊겼을 때 빈 파일이 제자리에 남는다.
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch (error) {
    discardTemp(temp)
    throw error
  }
  commitTemp(file, temp, target)
}

/**
 * 임시 파일을 제자리로 올린다 — **여기가 유일한 커밋 지점이다.**
 *
 * 세대 확인부터 rename까지가 한 덩어리의 동기 블록이어야 한다. JS는 단일
 * 스레드라 이 사이에는 아무것도 끼어들 수 없고, 그래서 "더 최신이 이미 커밋됐다"를
 * 본 쓰기는 **반드시** 물러난다. 검사와 rename 사이에 await를 하나라도 넣으면
 * 그 틈으로 종료 플러시가 들어와 구형 쓰기가 최신을 덮는 원래 버그가 돌아온다.
 */
function commitTemp(file: string, temp: string, target: number): void {
  if (target <= committedRevision) {
    // 우리보다 새 세대가 이미 디스크에 있다. 물러난다.
    discardTemp(temp)
    return
  }
  rotateBackup(file)
  renameSync(temp, file)
  committedRevision = target
  // 파일 내용은 fsync했지만 **디렉터리 엔트리**는 아직이다. POSIX에서 rename의
  // 내구성은 부모 디렉터리를 fsync해야 보장된다 — 그러지 않으면 성공이라 답한
  // 직후의 전원 손실에서 새 이름이 사라질 수 있다. APFS에서 실제로 그렇게
  // 되는지는 확인하지 못했지만, 비용이 무시할 만하고 실패 모드가 파일 전체다.
  syncDirectory(path.dirname(file))
}

function discardTemp(temp: string): void {
  try {
    unlinkSync(temp)
  } catch {
    /* 애초에 안 만들어졌거나, 종료 플러시가 같은 이름을 이미 옮겼다 */
  }
}

function syncDirectory(dir: string): void {
  try {
    const fd = openSync(dir, 'r')
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  } catch {
    // Windows는 디렉터리 핸들을 이렇게 열 수 없다. 그쪽 rename은 메타데이터
    // 저널에 들어가므로 이 보강이 필요 없다.
  }
}

/**
 * 직전 정상본을 `.bak`으로 밀어 둔다.
 *
 * 복사가 아니라 rename이다 — 20k 할일이면 파일이 10 MB고, 저장마다 그만큼을
 * 복사하면 백업이 저장을 느리게 만든다. rename은 상수 시간이다.
 *
 * 대신 `dbPath`가 잠깐 없는 창이 생긴다. 그 틈에서 죽으면 `.bak`만 남는데,
 * `load()`가 그걸 주워 온다 — 그 폴백이 이 선택의 값이다.
 */
function rotateBackup(file: string): void {
  if (!existsSync(file)) return
  // **믿을 수 없는 primary는 절대 `.bak`으로 밀지 않는다.** 이 세션이 `.bak`에서
  // 복구했다면 지금 자리에 있는 primary는 우리가 못 읽은 그 파일이다. 그걸 밀면
  // 방금 우리를 구해 준 정상본이 손상본으로 덮인다 — 검증이 실측한 경로다.
  // (`initDatabase`가 손상본을 격리하므로 대개 위 `existsSync`에서 이미 걸린다.
  //  격리마저 실패했을 때를 위한 두 번째 겹이다.)
  if (!primaryTrusted) return
  try {
    renameSync(file, `${file}.bak`)
  } catch (error) {
    // 백업을 못 만드는 것이 저장을 막을 이유는 아니다. 새 내용이 더 중요하고,
    // 옛 `.bak`은 그대로 남는다.
    console.error('DB 백업 회전 실패:', error)
  }
}

/** 동기 커밋. **던진다** — 복원처럼 결과를 반드시 알아야 하는 호출처가 쓴다. */
function commitSync(target: number): void {
  const temp = tempPathFor(dbPath, target)
  try {
    const json = JSON.stringify(data)
    const fd = openSync(temp, 'w')
    try {
      // `writeSync`가 아니라 `writeFileSync(fd, …)`다 — 앞엣것은 짧은 쓰기를
      // 재시도하지 않아 디스크가 가득 차면 잘린 JSON을 원자적으로 갈아끼운다.
      writeFileSync(fd, json, 'utf-8')
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  } catch (error) {
    discardTemp(temp)
    throw error
  }
  commitTemp(dbPath, temp, target)
}

/**
 * 앱 종료 시의 동기 플러시. **디스크에 확정됐으면 true.**
 *
 * `committedRevision`을 먼저 올리는 것이 요점이다. 그래야 아직 날아가는 중인
 * 구형 비동기 쓰기가 `commitTemp`에서 자기가 낡았음을 보고 물러난다.
 *
 * 결과를 **돌려준다.** 예전에는 여기서 오류를 삼켰고, 그러면 마지막 편집을
 * 잃은 종료와 정상 종료가 호출처에서 구별되지 않았다. 종료를 막을지는 셸이
 * 정할 일이라 판정만 내보낸다(`main/index.ts`의 `will-quit` — 이 워크트리 밖).
 */
function flushSave(): boolean {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (dbReadFailed) return true
  if (revision <= committedRevision) return lastSaveError === null
  // **종료 플러시는 붙들려 있어도 쓴다.** 그러니 미뤄 둔 격리가 남아 있으면 여기서
  // 반드시 먼저 치운다 — 안 그러면 우리 데이터가 손상본 자리로 rename돼 사용자가
  // 잃은 원본이 통째로 사라진다. 첨부 GC는 미룬 채로 둔다: 종료 직전에 파일을
  // 지워서 얻을 것이 없고, 다음 부팅이 어차피 다시 판정한다.
  quarantineDeferred()
  try {
    commitSync(revision)
  } catch (error) {
    // 종료 중이므로 재시도 타이머를 걸지 않는다 — 프로세스가 곧 사라진다.
    noteSaveFailed(error, false)
    return false
  }
  noteSaveSucceeded()
  return true
}

// ── 첨부 GC 예약 ─────────────────────────────────────────────────────────────

/**
 * 행이 사라졌다 — 그 세대가 **디스크에 확정된 뒤에** 첨부를 걷는다.
 *
 * 즉시 걷으면 안 된다. `save()`는 300ms 디바운스인데 GC는 즉시라, 그 창에서
 * 종료되면 디스크의 할일은 여전히 첨부를 참조하는데 파일은 이미 사라진 상태가
 * 된다(검증이 실측). 삭제의 내구성이 확보된 뒤에야 그 참조가 진짜로 없는 것이다.
 */
function scheduleAttachmentGc(): void {
  // **예약 시점의 폴더를 찍어 둔다.** 이 뒤에 들어온 파일은 방금 지운 행이
  // 참조했을 리가 없다 — 아직 참조가 안 적혔을 뿐이다(`gcArmedNames` 주석).
  // 이미 예약돼 있으면 **먼저 찍은 것을 유지한다**: 다시 찍으면 1차 예약 뒤에
  // `copyAttachment`가 넣은 파일이 후보로 들어와 같은 창이 그대로 다시 열린다.
  if (gcAfterRevision === 0) gcArmedNames = listAttachmentNames()
  gcAfterRevision = revision
}

function runPendingAttachmentGc(): void {
  if (gcAfterRevision === 0 || committedRevision < gcAfterRevision) return
  gcAfterRevision = 0
  const armed = gcArmedNames
  gcArmedNames = null
  gcAttachments(armed)
}

/** 죽은 프로세스가 남긴 임시 파일. 다음 부팅에서 걷어낸다. */
function sweepTempFiles(): void {
  const dir = path.dirname(dbPath)
  const prefix = `${path.basename(dbPath)}.tmp-`
  try {
    for (const name of readdirSync(dir)) {
      if (!name.startsWith(prefix)) continue
      try {
        unlinkSync(path.join(dir, name))
      } catch {
        /* 남아 있어도 해가 없다 */
      }
    }
  } catch {
    /* 폴더를 못 읽으면 할 수 있는 게 없다 */
  }
}

function emptyData(): DbData {
  return {
    lists: [],
    tasks: [],
    habits: [],
    habitLogs: [],
    folders: [],
    pomodoroSessions: [],
    score: { total: 0, events: [], taskNet: {} }
  }
}

function shapeData(raw: Record<string, unknown>): DbData {
  const empty = emptyData()
  const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v : [])
  return {
    lists: arr(raw.lists),
    tasks: arr(raw.tasks),
    habits: arr(raw.habits),
    habitLogs: arr(raw.habitLogs),
    folders: arr(raw.folders),
    pomodoroSessions: arr(raw.pomodoroSessions),
    score: normalizeScore(raw.score) ?? empty.score
  }
}

/**
 * 데이터 파일을 읽는다. 못 읽으면 **직전 정상본을 주워 온다.**
 *
 * `rotateBackup`이 저장마다 이전 내용을 `.bak`으로 밀어 두므로, 대상 파일이
 * 깨졌거나(부분 쓰기) 아예 없어도(rename 두 번 사이에서 죽었다) 한 세대 전으로
 * 돌아갈 수 있다. 이 폴백이 없으면 `rotateBackup`이 만드는 짧은 창이 그 자체로
 * 데이터 손실 경로가 된다 — 백업을 만드는 대가로 새 구멍을 파는 셈이다.
 *
 * `.bak`까지 못 읽을 때만 던진다. 그때 호출자가 원본을 옆으로 치우고 세션을
 * 읽기 전용으로 내린다.
 */
interface LoadResult {
  data: DbData
  /** 어디서 읽었는가. `backup`이면 primary는 믿을 수 없다. */
  source: 'primary' | 'backup' | 'empty'
  /** primary가 자리에 있는데 못 읽었는가 — 격리 대상이다. */
  primaryCorrupt: boolean
}

function load(): LoadResult {
  const primary = readDataFile(dbPath)
  if (primary.ok) return { data: shapeData(primary.value), source: 'primary', primaryCorrupt: false }

  const backupPath = `${dbPath}.bak`
  const backup = readDataFile(backupPath)
  const primaryCorrupt = primary.reason === 'corrupt'
  if (backup.ok) {
    if (primaryCorrupt) {
      console.error(`[db] ${dbPath}를 읽지 못해 ${backupPath}에서 복구했다`, primary.error)
    }
    // **출처를 들려 보낸다.** 호출자가 손상된 primary를 격리하고 `.bak`을 보호해야
    // 하는데, 그러려면 "복구했다"는 사실이 반환값에 있어야 한다. 예전에는 없어서
    // 복구 직후 첫 저장이 손상본을 `.bak` 위로 회전시켰다 — 검증이 실측했다.
    return { data: shapeData(backup.value), source: 'backup', primaryCorrupt }
  }

  // 대상도 백업도 **없는** 것은 새 설치다 — 실패가 아니다.
  if (primary.reason === 'missing' && backup.reason === 'missing') {
    return { data: emptyData(), source: 'empty', primaryCorrupt: false }
  }
  // 둘 중 하나는 깨진 것이다. 대상 쪽 이유를 우선한다 — 사용자가 잃은 것이 그쪽이다.
  if (primary.reason === 'corrupt') throw primary.error
  throw backup.reason === 'corrupt' ? backup.error : new Error(`${dbPath}를 읽을 수 없다`)
}

/** 못 읽은 파일을 타임스탬프가 붙은 이름으로 치워 둔다. 치운 경로, 실패하면 null. */
function quarantine(file: string): string | null {
  const aside = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`
  try {
    renameSync(file, aside)
    return aside
  } catch (error) {
    console.error(`[db] ${file} 격리 실패`, error)
    return null
  }
}

type ReadResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: 'missing' }
  | { ok: false; reason: 'corrupt'; error: unknown }

function readDataFile(file: string): ReadResult {
  if (!existsSync(file)) return { ok: false, reason: 'missing' }
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf-8'))
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return { ok: false, reason: 'corrupt', error: new Error(`${file}: 객체가 아니다`) }
    }
    return { ok: true, value: raw as Record<string, unknown> }
  } catch (error) {
    return { ok: false, reason: 'corrupt', error }
  }
}

/**
 * 구버전 픽커는 요일을 하나도 고르지 않은 채 '매주'를 적용할 수 있었고, 그 행은
 * recurring_pattern='weekly:'로 남았다. 예전 파서는 빈 문자열을 Number('')=0으로
 * 읽어 매주 일요일로 굴렸지만, 지금 파서는 빈 목록이라 다음 회차를 계산하지 못한다
 * — 그대로 두면 업그레이드한 사용자의 시리즈가 아무 신호 없이 끝난다.
 * 마감일이 있으면 그 요일로 복구하고, 없으면 반복을 꺼서 화면에 드러낸다.
 */
/**
 * 진짜 달력에 있는 날짜인가. validate.ts와 같은 판정을 로드 경로에도 둔다 —
 * IPC 검증이 생기기 전 빌드나 손으로 고친 JSON에 '2026-02-30' 같은 값이 남아
 * 있으면, 그 할일을 복제·수정하는 순간 검증이 거부하고 렌더러는 그 거부를
 * 아무도 받지 않아 사용자의 조작이 조용히 사라진다.
 */
function isRealIsoDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

function normalizeLegacyWeeklyPattern(t: Record<string, unknown>): void {
  if (t.recurring_pattern !== 'weekly:') return
  const due = typeof t.due_date === 'string' ? t.due_date : null
  if (due) {
    const [y, m, d] = due.split('-').map(Number)
    t.recurring_pattern = `weekly:${new Date(y, m - 1, d).getDay()}`
  } else {
    t.recurring_pattern = null
    t.is_recurring = 0
  }
}

export function initDatabase(): void {
  const userDataPath = app.getPath('userData')
  if (!existsSync(userDataPath)) mkdirSync(userDataPath, { recursive: true })
  dbPath = path.join(userDataPath, 'ticktick-data.json')
  aiConfigPath = path.join(userDataPath, 'ai-config.json')
  chatHistoryPath = path.join(userDataPath, 'ai-chat.json')
  calendarConfigPath = path.join(userDataPath, 'calendar-config.json')
  attachmentsDir = path.join(userDataPath, 'attachments')
  if (!existsSync(attachmentsDir)) mkdirSync(attachmentsDir, { recursive: true })
  // 새 프로세스는 세대 0에서 시작한다. `initDatabase()`를 두 번 부르는 테스트가
  // 앞선 실행의 committedRevision을 물려받으면 첫 저장이 낡은 것으로 오해받는다.
  revision = 0
  committedRevision = 0
  lastSaveError = null
  retryStreak = 0
  gcAfterRevision = 0
  gcArmedNames = null
  primaryTrusted = true
  // 한 프로세스에서 initDatabase()를 두 번 부르는 경로(테스트)가 앞선 실행의
  // 미뤄 둔 격리를 물려받으면 엉뚱한 경로를 치운다.
  quarantineWhenReleased = null
  gcAttachmentsWhenReleased = false
  sweepTempFiles()
  try {
    const loaded = load()
    data = loaded.data
    dbReadFailed = false
    if (loaded.source === 'backup') {
      // **손상본을 자리에서 치운다.** 그러지 않으면 곧 이어지는 첫 저장이
      // `rotateBackup`으로 그것을 `.bak` 위에 밀어, 방금 우리를 구해 준 정상본이
      // 손상본으로 덮인다(검증이 실측). 치우면 `rotateBackup`이 밀 것을 찾지
      // 못해 `.bak`이 그대로 살아남고, 새 primary가 커밋된 뒤부터 정상 회전이다.
      //
      // 다만 **붙들려 있으면 미룬다**(`quarantineWhenReleased` 주석). 첫 실행에서
      // 여기서 바로 치우면 전환 전 백업이 `DATA_FILES`의 `ticktick-data.json`을
      // 찾지 못해 사용자가 잃은 원본이 백업에서 빠진다. 미뤄도 안전한 이유는
      // 바로 아래 `primaryTrusted = false`가 회전을 막고, 붙들린 동안은 저장 자체가
      // 없으며, 유일하게 쓰는 종료 플러시가 쓰기 직전에 `quarantineDeferred()`를
      // 부르기 때문이다.
      if (loaded.primaryCorrupt) {
        if (savesHeld) quarantineWhenReleased = dbPath
        else quarantine(dbPath)
      }
      // 격리가 실패했을 때를 위한 두 번째 겹. 우리 손으로 쓴 primary가
      // 자리에 앉을 때까지 회전을 막는다.
      primaryTrusted = false
    }
  } catch (error) {
    // **원본을 먼저 옆으로 치운다.** 그래야 사용자에게 "덮어쓰지 않았다"고 말할 수
    // 있다 — 다이얼로그를 읽는 동안 백업하라고 부탁하는 것은 약속이 아니다.
    // 그 뒤 이 세션은 읽기 전용으로 간다(`save`/`flushSave`가 즉시 반환).
    dbReadFailed = true
    try {
      const aside = `${dbPath}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`
      copyFileSync(dbPath, aside)
      console.error(`[db] 읽기 실패 — 원본을 ${aside}로 복사했다`, error)
    } catch (copyError) {
      console.error('[db] 읽기 실패, 원본 복사도 실패', error, copyError)
    }
    throw error
  }

  // 기존 데이터 마이그레이션
  data.tasks.forEach((t) => {
    if (t.deleted_at === undefined) t.deleted_at = null
    // 이 컬럼이 생기기 전에 버려진 행은 **모호하다.** 한때 "부모와 같은 시각에
    // 내려갔으면 캐스케이드"로 추정했는데, `toISOString()`이 밀리초까지라 따로
    // 지운 부모와 자식이 같은 값을 갖는 경우가 실제로 있다(검증이 legacy 파일로
    // 재현). 그러면 사용자가 따로 버린 행이 부모 복원에 **되살아난다** —
    // 추정이 틀렸을 때의 결과가 "예전 동작"이 아니라 부활이었다.
    // 확실한 조작 id가 없으므로 null로 둔다: 잃는 것은 옛 휴지통 항목의 편의뿐이고,
    // 이 컬럼이 붙은 뒤의 삭제부터는 정확하다.
    if (t.deleted_with === undefined) t.deleted_with = null
    if (t.due_time === undefined) t.due_time = null
    if (t.reminder_at === undefined) t.reminder_at = null
    if (t.attachments === undefined) t.attachments = '[]'
    if (t.scheduled_start === undefined) t.scheduled_start = null
    if (t.scheduled_end === undefined) t.scheduled_end = null
    if (t.scheduled_overrides === undefined) t.scheduled_overrides = null
    if (t.start_date === undefined) t.start_date = null
    if (t.pinned === undefined) t.pinned = 0
    for (const key of ['due_date', 'start_date']) {
      if (t[key] != null && !isRealIsoDate(t[key])) t[key] = null
    }
    // 기간의 불변식은 렌더러가 지키지만, 구버전으로 내려가 마감일을 지우면
    // 그 빌드의 updateTask는 start_date를 모르므로 끝 없는 시작일이 남는다.
    // 다시 올라와도 그 행을 건드리기 전에는 아무도 고치지 않으므로, 읽는 자리에서 정리한다.
    if (t.start_date && (typeof t.due_date !== 'string' || (t.start_date as string) > t.due_date)) {
      t.start_date = null
    }
    normalizeLegacyWeeklyPattern(t)
  })
  data.lists.forEach((l) => {
    if (l.folder_id === undefined) l.folder_id = null
  })

  // 기존 camelCase PomodoroSession 레코드를 snake_case로 일회 마이그레이션 (멱등)
  data.pomodoroSessions = data.pomodoroSessions.map((s) => {
    // task_id가 이미 있으면 이미 마이그레이션된 레코드
    if (s.task_id !== undefined) return s
    return {
      id: s.id,
      task_id: s.taskId ?? null,
      duration: s.duration,
      type: s.type,
      started_at: s.startedAt ?? null,
      completed_at: s.completedAt ?? null
    }
  })

  const inbox = data.lists.find((l) => l.id === 'inbox')
  if (!inbox) {
    data.lists.push({
      id: 'inbox',
      name: '기본함',
      color: '#4A90D9',
      icon: 'inbox',
      folder_id: null,
      sort_order: 0,
      created_at: new Date().toISOString()
    })
  } else if (inbox.name === '수신함') {
    // 시스템 리스트('inbox')는 UI에서 이름 편집이 불가하므로, 이전 기본 이름을
    // 새 이름으로 정규화한다 (사이드바 '기본함' 표기와 리스트 선택 드롭다운 일치).
    inbox.name = '기본함'
  }
  save()
  // 참조가 사라진 첨부 사본을 걷는다. 참조만 떼는 경로는 행을 지우지 않으므로
  // 그 판정이 확정되는 첫 지점이 다음 부팅이다 — `gcAttachments` 주석 참고.
  gcAttachments()
}

// === Folders ===
export function getFolders(): unknown[] {
  return [...data.folders].sort((a, b) => ((a.sort_order as number) || 0) - ((b.sort_order as number) || 0))
}
export function createFolder(id: string, name: string): void {
  assertWritable()
  const max = data.folders.reduce((m, f) => Math.max(m, (f.sort_order as number) || 0), 0)
  data.folders.push({ id, name, collapsed: 0, sort_order: max + 1, created_at: new Date().toISOString() })
  save()
}
export function updateFolder(id: string, name: string, collapsed: boolean): void {
  assertWritable()
  const f = data.folders.find((f) => f.id === id)
  if (f) {
    f.name = name
    f.collapsed = collapsed ? 1 : 0
    save()
  }
}
export function deleteFolder(id: string): void {
  assertWritable()
  data.folders = data.folders.filter((f) => f.id !== id)
  data.lists.forEach((l) => {
    if (l.folder_id === id) l.folder_id = null
  })
  save()
}

// === Lists ===
export function getLists(): unknown[] {
  return [...data.lists].sort((a, b) => ((a.sort_order as number) || 0) - ((b.sort_order as number) || 0))
}
export function createList(id: string, name: string, color: string, icon: string, folderId: string | null): void {
  assertWritable()
  const max = data.lists.reduce((m, l) => Math.max(m, (l.sort_order as number) || 0), 0)
  data.lists.push({
    id,
    name,
    color,
    icon,
    folder_id: folderId,
    sort_order: max + 1,
    created_at: new Date().toISOString()
  })
  save()
}
export function updateList(id: string, updates: Record<string, unknown>): void {
  assertWritable()
  const list = data.lists.find((l) => l.id === id)
  if (!list) return
  const allowed = ['name', 'color', 'icon', 'folder_id', 'sort_order']
  for (const key of allowed) {
    if (Object.hasOwn(updates, key)) (list as Record<string, unknown>)[key] = updates[key]
  }
  save()
}
export function deleteList(id: string): void {
  assertWritable()
  if (id === 'inbox') return
  data.lists = data.lists.filter((l) => l.id !== id)
  data.tasks.forEach((t) => {
    if (t.list_id === id) t.list_id = 'inbox'
  })
  save()
}

// === Tasks ===
export function getTasks(): unknown[] {
  return [...data.tasks]
    .filter((t) => !t.deleted_at)
    .sort((a, b) => ((a.sort_order as number) || 0) - ((b.sort_order as number) || 0))
}
export function getTrashTasks(): unknown[] {
  return data.tasks.filter((t) => t.deleted_at)
}
export function createTask(task: Record<string, unknown>): void {
  assertWritable()
  // 렌더러가 자리를 정했으면 그 자리를 쓴다. 여기서 maxOrder+1로 다시 매기면
  // '복제본은 원본 바로 아래'처럼 렌더러가 계산한 중간값이 버려져, 화면에서는
  // 제자리에 있던 항목이 재시작 후 목록 맨 끝으로 튄다.
  const maxOrder = data.tasks
    .filter((t) => t.list_id === task.listId && !t.deleted_at)
    .reduce((m, t) => Math.max(m, (t.sort_order as number) || 0), 0)
  // Number.isFinite: NaN/Infinity가 sort_order에 앉으면 정렬이 조용히 무너진다.
  const sortOrder = Number.isFinite(task.sortOrder) ? (task.sortOrder as number) : maxOrder + 1
  data.tasks.push({
    id: task.id,
    title: task.title,
    description: task.description || '',
    completed: 0,
    priority: task.priority || 'none',
    due_date: task.dueDate || null,
    due_time: task.dueTime || null,
    start_date: task.startDate || null,
    reminder_at: task.reminderAt || null,
    pinned: task.pinned ? 1 : 0,
    list_id: task.listId || 'inbox',
    parent_id: task.parentId || null,
    tags: JSON.stringify(task.tags || []),
    attachments: JSON.stringify(task.attachments || []),
    created_at: new Date().toISOString(),
    completed_at: null,
    deleted_at: null,
    deleted_with: null,
    sort_order: sortOrder,
    is_recurring: task.isRecurring ? 1 : 0,
    recurring_pattern: task.recurringPattern || null,
    scheduled_start: task.scheduledStart || null,
    scheduled_end: task.scheduledEnd || null,
    scheduled_overrides: task.scheduledOverrides ? JSON.stringify(task.scheduledOverrides) : null
  })
  save()
}
/** JSON 저장소는 0/1로 적는다 — 불리언으로 새면 옛 레코드와 모양이 갈린다. */
const BOOLEAN_FIELDS = new Set(['isRecurring', 'pinned'])

export function updateTask(task: Record<string, unknown>): void {
  assertWritable()
  const existing = data.tasks.find((t) => t.id === task.id)
  if (!existing) return
  const fields: Record<string, string> = {
    title: 'title',
    description: 'description',
    priority: 'priority',
    dueDate: 'due_date',
    dueTime: 'due_time',
    startDate: 'start_date',
    reminderAt: 'reminder_at',
    pinned: 'pinned',
    listId: 'list_id',
    parentId: 'parent_id',
    isRecurring: 'is_recurring',
    recurringPattern: 'recurring_pattern',
    scheduledStart: 'scheduled_start',
    scheduledEnd: 'scheduled_end'
  }
  // 직렬화를 먼저 끝낸 뒤에 레코드를 건드린다. 순환 참조 등으로 JSON.stringify가
  // 중간에 던지면, 앞쪽 스칼라 필드만 바뀐 절반짜리 레코드가 메모리에 남고
  // 나중의 무관한 save()가 그 상태를 그대로 디스크에 적는다.
  const serialized: Record<string, string | null> = {}
  if (task.tags !== undefined) serialized.tags = JSON.stringify(task.tags)
  if (task.attachments !== undefined) serialized.attachments = JSON.stringify(task.attachments)
  if (task.scheduledOverrides !== undefined) {
    serialized.scheduled_overrides = task.scheduledOverrides === null ? null : JSON.stringify(task.scheduledOverrides)
  }

  for (const [key, col] of Object.entries(fields)) {
    if (task[key] !== undefined) {
      existing[col] = BOOLEAN_FIELDS.has(key) ? (task[key] ? 1 : 0) : task[key]
    }
  }
  for (const [col, value] of Object.entries(serialized)) existing[col] = value
  if (task.completed !== undefined) {
    existing.completed = task.completed ? 1 : 0
    existing.completed_at = task.completed ? new Date().toISOString() : null
  }
  if (task.sortOrder !== undefined) existing.sort_order = task.sortOrder
  save()
}
export function deleteTask(id: string): void {
  assertWritable()
  const now = new Date().toISOString()
  data.tasks.forEach((t) => {
    if (t.id !== id && t.parent_id !== id) return
    // **이미 휴지통에 있는 것은 다시 건드리지 않는다.** `deleted_at`은 "언제
    // 버려졌나"이고, 부모를 지우면서 먼저 따로 버린 하위작업까지 다시 찍으면
    // 그 시각이 거짓이 된다.
    if (t.deleted_at) return
    t.deleted_at = now
    // **함께 내려갔다는 사실을 적어 둔다.** `restoreTask`가 되살릴 집합이 이것이다.
    // 타임스탬프가 같은지로 대신하려 했다가 실패했다: `toISOString()`은 밀리초까지라
    // 연달아 일어난 두 삭제가 같은 값을 갖고, 그러면 사용자가 따로 버린 하위작업이
    // 부모 복원에 끌려 올라온다. 시계는 "무엇이 한 조작이었나"를 답할 수 없다.
    t.deleted_with = t.id === id ? null : id
  })
  save()
}
/**
 * 삭제를 되돌린다. **`deleteTask`의 거울이어야 한다.**
 *
 * 그쪽은 `t.id === id || t.parent_id === id`로 하위작업까지 함께 내리는데
 * 이쪽은 그 한 행만 되살렸다. 그래서 Cmd+Z 한 번이 "부모는 살아났는데
 * 하위작업 셋은 휴지통에 남은" 상태를 만들었고, 화면에서는 하위작업이 통째로
 * 사라진 것으로 보였다.
 *
 * 되살릴 하위작업은 `deleted_with`로 고른다 — `deleteTask`가 부모와 함께 내린
 * 하위작업에만 부모 id를 적어 둔다. 그 전에 따로 지운 하위작업은 사용자가 따로
 * 지운 것이니 휴지통에 그대로 둔다: 부모를 되살렸다고 그것까지 끌고 올라오면
 * 이번엔 반대 방향으로 틀린다.
 */
export function restoreTask(id: string): void {
  assertWritable()
  const parent = data.tasks.find((t) => t.id === id)
  if (!parent) return
  if (!parent.deleted_at) return
  parent.deleted_at = null
  parent.deleted_with = null
  for (const t of data.tasks) {
    if (t.parent_id === id && t.deleted_at && t.deleted_with === id) {
      t.deleted_at = null
      t.deleted_with = null
    }
  }
  // **되살아난 행을 휴지통에 남은 부모에 매달아 두지 않는다.**
  // 휴지통은 계층 없이 평평하게 그려서 하위작업 행에도 복원 버튼이 있다(TrashView).
  // 그런데 목록 뷰는 전부 `isTopLevel`로 거르고 하위작업은 **살아 있는** 부모의 상세
  // 안에서만 그려진다 — 부모를 휴지통에 둔 채 자식만 올리면 그 할일은 DB에는 있는데
  // 어느 화면에도 없다. 사용자에게는 "복원했더니 그냥 사라졌다"이고, 그 뒤 부모 행을
  // '영구 삭제'하면 부모 제목만 적힌 확인창 아래에서 같이 지워진다
  // (`permanentDeleteTask`가 `parent_id === id`를 함께 걷는다). 휴지통을 비우면
  // 이번엔 부모 행만 사라져, 보이지도 고치지도 지우지도 못하는 행이 영원히 남는다.
  // 조상**만** 올린다 — 그 조상의 다른 하위작업까지 끌어올리면 restoreTask(부모)와
  // 같아져, 사용자가 고른 한 줄이 가족 전체를 되살린다.
  let child = parent
  const walked = new Set<string>([id])
  while (typeof child.parent_id === 'string') {
    const parentId = child.parent_id
    const ancestor = data.tasks.find((t) => t.id === parentId)
    // 손상된 파일의 자기참조·순환 parent_id에 여기서 멈추지 않으면 앱이 통째로 선다.
    if (!ancestor || walked.has(ancestor.id as string)) break
    walked.add(ancestor.id as string)
    if (ancestor.deleted_at) {
      ancestor.deleted_at = null
      ancestor.deleted_with = null
    }
    child = ancestor
  }
  save()
}
export function permanentDeleteTask(id: string): void {
  assertWritable()
  data.tasks = data.tasks.filter((t) => t.id !== id && t.parent_id !== id)
  save()
  // 행이 실제로 사라지는 두 경로 중 하나다 — 첨부를 걷지 않으면 아무도 참조하지
  // 않는 사본이 폴더에 영원히 쌓인다. 다만 **지금 걷지는 않는다**: 삭제가 아직
  // 디스크에 없다(300ms 디바운스). 그 창에서 종료되면 디스크의 할일은 첨부를
  // 참조하는데 파일은 사라진 상태가 되고, 다음 부팅에서 "첨부가 있다는데 열리지
  // 않는" 할일이 남는다. 삭제의 내구성이 확보된 뒤에야 그 참조가 진짜로 없다.
  scheduleAttachmentGc()
}
export function emptyTrash(): void {
  assertWritable()
  data.tasks = data.tasks.filter((t) => !t.deleted_at)
  save()
  scheduleAttachmentGc()
}
export function reorderTasks(orderedIds: string[]): void {
  assertWritable()
  // 렌더러의 applyReorder와 같은 규칙: 0..n-1로 새로 매기지 않고, 재배치 대상이
  // 이미 쥐고 있던 sort_order 슬롯만 새 순서대로 다시 나눠 준다. sort_order는
  // 리스트별 카운터라서 전역 재번호는 다른 리스트의 순서를 덮어쓴다.
  const moving = orderedIds.map((id) => data.tasks.find((t) => t.id === id)).filter((t) => t !== undefined)
  const slots = moving.map((t) => (t.sort_order as number) || 0).sort((a, b) => a - b)
  moving.forEach((t, i) => {
    t.sort_order = slots[i]
  })
  save()
}
export function batchUpdateTasks(ids: string[], updates: Record<string, unknown>): void {
  assertWritable()
  // 이 배치 안에 부모도 함께 들어 있는 하위작업은 **한 조작으로 함께 내려간 것**이다.
  // 그 사실을 `deleted_with`에 적어야 부모 하나만 골라 복원했을 때(휴지통 화면)
  // 하위작업이 따라 올라온다. 예전에는 전부 null이라 일괄 삭제한 부모를 되살리면
  // main은 부모만 올리는데 렌더러는 하위작업까지 올려 둘이 갈렸다.
  const batch = new Set(ids)
  for (const id of ids) {
    const task = data.tasks.find((t) => t.id === id)
    if (!task) continue
    if (updates.completed !== undefined) {
      task.completed = updates.completed ? 1 : 0
      task.completed_at = updates.completed ? new Date().toISOString() : null
    }
    if (updates.listId !== undefined) task.list_id = updates.listId
    if (updates.priority !== undefined) task.priority = updates.priority
    if (updates.dueDate !== undefined) task.due_date = updates.dueDate
    // `deleteTask`와 같은 규칙 — 이미 버려진 것의 시각을 다시 찍지 않는다.
    // 일괄 삭제는 호출처가 하위작업 id까지 전부 실어 보내고 되돌리기도 id마다
    // 따로 복원하므로, 여기서는 캐스케이드 표시를 남기지 않는다.
    if (updates.deleted !== undefined) {
      if (!updates.deleted) {
        task.deleted_at = null
        task.deleted_with = null
      } else if (!task.deleted_at) {
        task.deleted_at = new Date().toISOString()
        const parentId = task.parent_id
        task.deleted_with = typeof parentId === 'string' && batch.has(parentId) ? parentId : null
      }
    }
  }
  save()
}

// === Habits ===
export function getHabits(): unknown[] {
  return [...data.habits].sort(
    (a, b) => new Date(a.created_at as string).getTime() - new Date(b.created_at as string).getTime()
  )
}
export function createHabit(id: string, name: string, color: string, frequency: string, targetDays: number[]): void {
  assertWritable()
  data.habits.push({
    id,
    name,
    color,
    frequency,
    target_days: JSON.stringify(targetDays),
    created_at: new Date().toISOString()
  })
  save()
}
export function deleteHabit(id: string): void {
  assertWritable()
  data.habits = data.habits.filter((h) => h.id !== id)
  data.habitLogs = data.habitLogs.filter((l) => l.habit_id !== id)
  save()
}
export function getHabitLogs(): unknown[] {
  return data.habitLogs
}
export function toggleHabitLog(id: string, habitId: string, date: string): void {
  assertWritable()
  const idx = data.habitLogs.findIndex((l) => l.habit_id === habitId && l.date === date)
  if (idx >= 0) data.habitLogs.splice(idx, 1)
  else data.habitLogs.push({ id, habit_id: habitId, date, completed: 1 })
  save()
}

// === Pomodoro Sessions ===
export function getPomodoroSessions(): unknown[] {
  return data.pomodoroSessions
}
export function savePomodoroSession(session: Record<string, unknown>): void {
  assertWritable()
  // 다른 엔티티와 동일하게 snake_case로 저장
  data.pomodoroSessions.push({
    id: session.id,
    task_id: session.taskId ?? null,
    duration: session.duration,
    type: session.type,
    started_at: session.startedAt ?? null,
    completed_at: session.completedAt ?? null
  })
  save()
}

// === Score ===

// 순수 헬퍼: events 배열을 최근 max개로 제한 (오래된 항목 제거, total은 별도 누적)
export function capEvents<T>(events: T[], max = 200): T[] {
  return events.length > max ? events.slice(events.length - max) : events
}

/**
 * 디스크에서 온 score를 온전한 모양으로 만든다.
 *
 * `taskNet`이 없는 것은 이 원장이 생기기 전에 저장된 파일이다. 그때는 남아 있는
 * 이벤트에서 되짚는 것이 할 수 있는 전부다 — 잘려 나간 이력은 복원할 수 없다.
 * 근사이지만 **한 방향으로만 틀린다**(과소 회수 → 옛 완료를 취소해도 점수가
 * 안 깎인다). 새로 지급되는 것부터는 정확하다.
 */
export function normalizeScore(raw: unknown): ScoreState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const events = Array.isArray(o.events) ? (o.events as Record<string, unknown>[]) : []
  const total = typeof o.total === 'number' && Number.isFinite(o.total) ? o.total : 0

  const stored = o.taskNet
  if (typeof stored === 'object' && stored !== null && !Array.isArray(stored)) {
    const taskNet: Record<string, number> = {}
    for (const [id, value] of Object.entries(stored as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value) && value !== 0) taskNet[id] = value
    }
    return { total, events, taskNet }
  }
  return { total, events, taskNet: ledgerFromEvents(events) }
}

function ledgerFromEvents(events: Record<string, unknown>[]): Record<string, number> {
  const taskNet: Record<string, number> = {}
  for (const event of events) {
    const taskId = event.taskId
    if (typeof taskId !== 'string' || !taskId) continue
    const next = (taskNet[taskId] ?? 0) + (Number(event.points) || 0)
    if (next === 0) delete taskNet[taskId]
    else taskNet[taskId] = next
  }
  return taskNet
}

export function getScore(): unknown {
  return data.score
}

/**
 * 이벤트 하나를 반영한다 — 총점·원장·표시용 배열을 **같은 숫자로** 움직인다.
 *
 * 원장에는 요청된 `points`가 아니라 **실제로 반영된 delta**를 적는다. 총점이
 * 0에서 잘리면 둘이 갈리고, 그러면 원장이 "지급된 적 없는 점수"를 기억해
 * 회수가 총점을 0으로 끌어내린다.
 */
function applyScoreEvent(event: Record<string, unknown>): void {
  const before = data.score.total
  // 회수(음수) 이벤트가 들어올 수 있다. 총점은 0 아래로 내려가지 않게 막는다 —
  // 이 기능이 생기기 전 일괄 완료는 점수를 주지 않았으므로, 그때 완료한 항목을
  // 지금 취소하면 준 적 없는 점수를 회수해 음수로 흐를 수 있다.
  data.score.total = Math.max(0, before + (Number(event.points) || 0))
  const applied = data.score.total - before

  const taskId = event.taskId
  if (typeof taskId === 'string' && taskId) {
    const next = (data.score.taskNet[taskId] ?? 0) + applied
    // 0이면 지운다 — 완료·취소를 반복한 할일로 원장이 무한히 자라지 않게.
    if (next === 0) delete data.score.taskNet[taskId]
    else data.score.taskNet[taskId] = next
  }

  data.score.events.push(event)
}

export function addScoreEvents(events: Record<string, unknown>[]): void {
  assertWritable()
  for (const event of events) applyScoreEvent(event)
  data.score.events = capEvents(data.score.events)
  save()
}
export function addScoreEvent(event: Record<string, unknown>): void {
  assertWritable()
  applyScoreEvent(event)
  // 상한 초과 시 가장 오래된 이벤트 제거 (write amplification 방지)
  data.score.events = capEvents(data.score.events)
  save()
}

// === Attachments ===
/**
 * 이 경로가 우리 첨부 폴더 **안**인가.
 *
 * `copyAttachment`가 쓰기 쪽에서 이미 같은 판정을 하고 있었는데, 읽기(여는) 쪽에는
 * 없었다. 그 비대칭이 문제다 — `shell.openPath`는 Finder에서 더블클릭하는 것과
 * 같아서 `.app`·`.command`·`.scpt`를 가리키면 **실행된다.**
 */
export function isInsideAttachments(candidate: string): boolean {
  // **심볼릭 링크까지 푼다.** `path.resolve`는 문자열 연산이라 첨부 폴더 안에
  // 놓인 심링크는 그대로 통과하고, `shell.openPath`가 그 링크가 가리키는 것을
  // 연다 — 이 검사가 막으려던 바로 그 실행 원시연산이 되돌아온다. 오늘 앱이
  // 심링크를 만들지는 않지만, 백업 복원이나 나중에 붙을 동기화가 만들 수 있다.
  //
  // realpath는 없는 경로에서 던진다. 그때는 어차피 열 것도 없으므로 닫는 쪽으로
  // 떨어진다(문자열 검사로 폴백하지 않는다 — 그러면 구멍이 그대로 남는다).
  try {
    const real = realpathSync(path.resolve(candidate))
    const root = realpathSync(attachmentsDir)
    return real.startsWith(root + path.sep)
  } catch {
    return false
  }
}

/**
 * 첨부를 폴더 안으로 복사한다.
 *
 * 판정이 `isInsideAttachments`와 **같지 않다.** 그쪽은 "이미 있는 것을 열어도
 * 되는가"라 존재하지 않으면 닫는 쪽으로 떨어지고, 이쪽은 "여기에 새로 써도
 * 되는가"라 존재하지 않는 것이 정상이다. 그래서 검사를 둘로 나눈다:
 *   - 이름은 `basename`으로 잘라 상위 이동을 없앤다(문자열 검사면 충분하다).
 *   - **이미 뭔가 있으면** realpath로 확인한다 — 그 자리에 바깥을 가리키는
 *     심링크가 놓여 있으면 `copyFileSync`가 그걸 따라가 폴더 밖에 쓴다.
 *     읽기 쪽에 심링크 방어를 넣으면서 이쪽을 "같은 판정"이라고 적어 뒀는데,
 *     같지 않았다.
 */
export function copyAttachment(sourcePath: string, destName: string): string {
  assertWritable()
  const safeName = path.basename(destName)
  const destPath = path.resolve(attachmentsDir, safeName)
  if (!destPath.startsWith(attachmentsDir + path.sep) && destPath !== attachmentsDir) {
    throw new Error('Path traversal blocked in copyAttachment')
  }
  // **`lstatSync`로 링크 자체를 본다.** 여기 `existsSync`가 있었는데 그것은 링크를
  // **따라가므로**, 폴더 안에 놓인 *끊어진* 심링크에서 false를 돌려준다. 그러면
  // 아래 realpath 검사를 통째로 건너뛴 채 `copyFileSync`가 그 링크를 따라가
  // 폴더 밖에 쓴다 — 감사가 실제로 폴더 밖에 파일을 만들어 재현했다.
  // 끊어졌든 아니든 심링크 자리에는 쓰지 않는다: 링크가 어디를 가리키는지는
  // 우리 관심사가 아니고, 첨부 사본이 링크일 이유도 없다.
  const existing = lstatOrNull(destPath)
  if (existing?.isSymbolicLink()) {
    throw new Error('Attachment destination is a symlink')
  }
  if (existing && !isInsideAttachments(destPath)) {
    throw new Error('Attachment destination escapes the attachments directory')
  }
  // **`O_NOFOLLOW`로 연다.** 위 `lstat`과 아래 쓰기는 별개의 syscall이라 그 사이에
  // 심링크가 놓이면 검사를 통과한 뒤 링크를 따라간다(TOCTOU). 커널이 열기 시점에
  // 같은 판정을 하게 만들면 그 창이 사라진다 — 검사는 좋은 오류 메시지를 위해 남긴다.
  const payload = readFileSync(sourcePath)
  const fd = openSync(destPath, O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW, 0o600)
  try {
    writeFileSync(fd, payload)
  } finally {
    closeSync(fd)
  }
  return destPath
}

function lstatOrNull(target: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(target)
  } catch {
    return null
  }
}

/**
 * 첨부 폴더에서 **아무 할일도 참조하지 않는** 파일 이름을 고른다. 순수 함수다.
 *
 * **지우지 않는 쪽으로 기운다.** 참조는 `이름|경로` 문자열로 저장되는데 파일명에
 * `|`가 들어갈 수 있어 어느 조각이 경로인지 확실하지 않다. 그래서 조각을 나누지
 * 않고 **컬럼 원문 전체에 파일 이름이 나타나는지**만 본다. 저장 이름이
 * `uuid-원본명`이라 우연히 겹칠 일이 없고, 과잉 보존은 디스크를 조금 낭비할 뿐인데
 * 과잉 삭제는 사용자의 파일을 없앤다.
 *
 * **휴지통의 할일도 참조로 센다** — 복원할 수 있기 때문이다. `data.tasks`는
 * 소프트 삭제된 행을 그대로 들고 있으므로 그것을 통째로 넘기면 된다.
 */
export function unreferencedAttachments(fileNames: string[], taskRows: Record<string, unknown>[]): string[] {
  const referenced = new Set<string>()
  /** 읽지 못한 행의 원문. 여기 이름이 **나타나기만 해도** 참조로 친다. */
  const unparsed: string[] = []

  for (const row of taskRows) {
    const raw = row.attachments
    if (raw === undefined || raw === null || raw === '') continue
    const text = String(raw)
    let entries: unknown
    try {
      entries = JSON.parse(text)
    } catch {
      unparsed.push(text)
      continue
    }
    if (!Array.isArray(entries)) {
      unparsed.push(text)
      continue
    }
    for (const entry of entries) {
      if (typeof entry !== 'string') {
        unparsed.push(text)
        continue
      }
      for (const candidate of attachmentNameCandidates(entry)) referenced.add(candidate)
    }
  }

  return fileNames.filter(
    (name) => name !== '' && !referenced.has(name) && !unparsed.some((text) => text.includes(name))
  )
}

/**
 * 한 참조 문자열이 가리킬 수 있는 파일 이름들.
 *
 * 인코딩이 `이름|경로`인데 파일명에 `|`가 들어갈 수 있어 어느 조각이 경로인지
 * 확실하지 않다. 그래서 **가능한 조각을 전부** 이름으로 환산해 둔다.
 *
 * 예전에는 컬럼 원문에 파일 이름이 부분 문자열로 나타나는지만 봤는데, 그러면
 * 참조가 `long-a.txt` 하나뿐일 때 고아인 `a.txt`도 살아남았다(검증이 실측).
 * 이제는 **이름 단위로 정확히** 맞춘다 — 못 읽은 행에 대해서만 옛 부분 문자열
 * 규칙으로 떨어진다. 그쪽은 여전히 지우지 않는 쪽으로 기운다.
 */
function attachmentNameCandidates(entry: string): string[] {
  const pieces = new Set<string>([entry])
  const first = entry.indexOf('|')
  if (first >= 0) pieces.add(entry.slice(first + 1))
  const last = entry.lastIndexOf('|')
  if (last >= 0) pieces.add(entry.slice(last + 1))
  // 경로 구분자는 양쪽 플랫폼 것을 다 본다 — 백업이 기기를 건너온다.
  return [...pieces].map((piece) => piece.split(/[\\/]/).pop() || piece)
}

/** 첨부 폴더의 이름들. 못 읽으면 빈 목록 — 아무것도 지우지 않는 쪽으로 떨어진다. */
function listAttachmentNames(): string[] {
  if (!attachmentsDir) return []
  try {
    return readdirSync(attachmentsDir)
  } catch {
    return []
  }
}

/**
 * 참조가 사라진 첨부 사본을 지운다. 지운 개수를 돌려준다.
 *
 * 행이 실제로 없어지는 자리(`permanentDeleteTask`·`emptyTrash`)와 시작 시점에
 * 돈다. 시작 시점이 필요한 이유: 참조만 떼는 경로(`updateTask`로 목록에서 제거)는
 * 행을 지우지 않으므로 그때는 아직 "휴지통에서 되돌릴 수 있는" 상태이고,
 * 다음 부팅이 그 판정이 확정되는 첫 지점이다.
 */
export function gcAttachments(onlyNames?: readonly string[] | null): number {
  if (dbReadFailed || !attachmentsDir) return 0
  // **붙들려 있으면 한 개도 지우지 않는다.** unlink는 `save()`를 지나지 않으므로
  // `holdSaves()`가 막지 못했고, 첫 실행에서는 그 때문에 전환 전 백업이 만들어지기
  // 전에 첨부가 사라졌다 — `.bak`이 낡아 그 할일을 모르면 아직 살아 있는 사진·PDF가
  // "참조 없음"으로 보인다. 미루면 백업이 원본 폴더를 통째로 담은 뒤에 걷는다.
  if (savesHeld) {
    gcAttachmentsWhenReleased = true
    return 0
  }
  let names = listAttachmentNames()
  // **예약된 스윕은 예약 시점의 스냅샷 안에서만 지운다** — `gcArmedNames` 주석 참고.
  // 부팅 스윕은 아무것도 넘기지 않아 예전 그대로 전부 본다.
  if (onlyNames) {
    const armed = new Set(onlyNames)
    names = names.filter((name) => armed.has(name))
  }
  let removed = 0
  for (const name of unreferencedAttachments(names, data.tasks)) {
    try {
      // `unlinkSync`는 링크를 따라가지 않는다 — 링크 자체만 지운다.
      unlinkSync(path.join(attachmentsDir, name))
      removed++
    } catch {
      // 디렉터리이거나 권한이 없다. 남긴다.
    }
  }
  return removed
}

// === AI Config ===
let aiConfigPath: string
let chatHistoryPath: string
let calendarConfigPath: string

/** 캘린더 설정 파일 경로. initDatabase 전에는 빈 문자열. */
export function getCalendarConfigPath(): string {
  return calendarConfigPath ?? ''
}

export interface KeyCrypto {
  available(): boolean
  encrypt(s: string): string
  decrypt(b64: string): string
}

export const realCrypto: KeyCrypto = {
  available: () => {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  },
  encrypt: (s) => safeStorage.encryptString(s).toString('base64'),
  decrypt: (b64) => safeStorage.decryptString(Buffer.from(b64, 'base64'))
}

export function encodeApiKey(config: Record<string, unknown>, crypto: KeyCrypto): Record<string, unknown> {
  const out = { ...config }
  if (typeof out.apiKey === 'string' && out.apiKey && crypto.available()) {
    try {
      out.apiKey_enc = crypto.encrypt(out.apiKey)
      out.apiKey = null
    } catch {
      // 암호화 실패: 평문 키를 절대 저장하지 않는다. 기존 apiKey_enc가 있으면 그대로 보존됨.
      out.apiKey = null
    }
  }
  return out
}

export function decodeApiKey(raw: Record<string, unknown>, crypto: KeyCrypto): Record<string, unknown> {
  const out = { ...raw }
  if (typeof out.apiKey_enc === 'string' && out.apiKey_enc) {
    if (crypto.available()) {
      try {
        out.apiKey = crypto.decrypt(out.apiKey_enc)
      } catch {
        out.apiKey = null
      }
      // 복호화(또는 손상 확인)를 마친 경우에만 암호문 제거
      delete out.apiKey_enc
    }
    // crypto 불가 시: apiKey_enc 보존 → 이후 정상 세션에서 키 복구 가능
  }
  return out
}

export function getAiConfig(): Record<string, unknown> | null {
  if (!aiConfigPath) return null
  if (!existsSync(aiConfigPath)) return null
  try {
    return decodeApiKey(JSON.parse(readFileSync(aiConfigPath, 'utf-8')), realCrypto)
  } catch {
    return null
  }
}

export function saveAiConfig(config: Record<string, unknown>): void {
  if (!aiConfigPath) return
  try {
    // 보호 모드(Keychain 거부)에서는 파일의 기존 암호문을 되살린다 — 새 앱이 키를 못
    // 읽은 채 저장해도 원본이 사라지지 않는다(migration/secrets-gate.ts).
    const encoded = preserveCiphertext(encodeApiKey(config, realCrypto), aiConfigPath, 'apiKey_enc')
    writeFileSync(aiConfigPath, JSON.stringify(encoded, null, 2), 'utf-8')
  } catch (err) {
    console.error('AI config 저장 실패:', err)
  }
}

// === Export ===

/**
 * 데이터만 담은 예전 형식. 첨부도 대화도 없다 — `createBackupArchive`가 후속이다.
 *
 * **읽기 실패 세션에서는 던진다.** 그때 `data`는 빈 기본값이라, 사용자가 고른
 * 경로에 `{"lists":[],"tasks":[]…}`를 쓰게 된다. 하필 기존 백업 위에 저장하면
 * 진짜 백업까지 덮인다 — "내보내기는 잠겨도 열어 둔다"는 약속이 사용자의 마지막
 * 사본을 지우는 도구가 되는 자리다.
 */
export function exportData(): string {
  assertWritable()
  return JSON.stringify(data, null, 2)
}

// === 백업 아카이브 (스키마 버전이 있는 복원 가능한 형식) ===

/** 낯선 JSON이 우리 아카이브인지 알아보는 표식. */
export const BACKUP_FORMAT = 'greenday-backup'
/** 형식이 바뀌면 올린다. 읽는 쪽은 **모르는 버전을 거절한다** — 짐작해서 복원하지 않는다. */
export const BACKUP_SCHEMA_VERSION = 1

export interface BackupAttachment {
  /** 첨부 폴더 안의 파일 이름. 경로가 아니다 — 복원할 때 이 기기의 폴더에 붙인다. */
  name: string
  /** base64 내용. */
  data: string
}

export interface BackupArchive {
  format: typeof BACKUP_FORMAT
  schemaVersion: number
  createdAt: string
  appVersion: string
  /**
   * 아카이브를 만든 기기의 첨부 폴더 절대경로.
   *
   * 할일의 `attachments` 컬럼은 절대경로를 품고 있는데, 복원하는 기기의 폴더는
   * 사용자 이름부터 다르다. 이 접두사를 남겨 두면 복원할 때 통째로 갈아끼울 수
   * 있다 — 없으면 "복원은 됐는데 첨부가 전부 깨진" 상태가 된다.
   */
  attachmentsDir: string
  data: DbData
  chat: Record<string, unknown>[]
  attachments: BackupAttachment[]
}

/** 순수 조립. electron 없이 테스트할 수 있게 조각을 인자로 받는다. */
export function buildArchive(parts: {
  data: DbData
  chat: Record<string, unknown>[]
  attachments: BackupAttachment[]
  attachmentsDir: string
  appVersion: string
  createdAt: string
}): BackupArchive {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt: parts.createdAt,
    appVersion: parts.appVersion,
    attachmentsDir: parts.attachmentsDir,
    data: parts.data,
    chat: parts.chat,
    attachments: parts.attachments
  }
}

/**
 * 낯선 파일을 아카이브로 받아들일 수 있는가. 아니면 **이유와 함께 던진다.**
 *
 * 복원은 사용자의 현재 데이터를 통째로 갈아치우는 조작이라, 절반만 맞는 파일을
 * 받아 절반만 복원하면 원래 있던 것도 잃는다. 그래서 쓰기를 시작하기 전에
 * 여기서 전부 확인한다.
 */
export function parseArchive(raw: unknown): BackupArchive {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('백업 파일이 아닙니다.')
  }
  const o = raw as Record<string, unknown>
  if (o.format !== BACKUP_FORMAT) {
    throw new Error('greenday 백업 파일이 아닙니다.')
  }
  if (o.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    // 앞으로 만들어질 형식은 우리가 모르는 필드를 가질 수 있다. 짐작해서 복원하면
    // 그 필드가 조용히 사라진 채 "복원됐다"고 말하게 된다.
    throw new Error(`지원하지 않는 백업 버전입니다 (${String(o.schemaVersion)}).`)
  }

  const data = strictData(o.data)

  if (!Array.isArray(o.chat)) throw new Error('백업의 대화 기록이 손상됐습니다.')
  for (const message of o.chat) {
    if (typeof message !== 'object' || message === null || Array.isArray(message)) {
      throw new Error('백업의 대화 기록이 손상됐습니다.')
    }
  }

  if (!Array.isArray(o.attachments)) throw new Error('백업의 첨부 목록이 손상됐습니다.')
  const attachments: BackupAttachment[] = []
  const seen = new Set<string>()
  for (const entry of o.attachments) {
    if (typeof entry !== 'object' || entry === null) throw new Error('백업의 첨부 항목이 손상됐습니다.')
    const a = entry as Record<string, unknown>
    if (typeof a.name !== 'string' || typeof a.data !== 'string') {
      throw new Error('백업의 첨부 항목이 손상됐습니다.')
    }
    // **이름만 받는다.** 경로 조각이 섞여 있으면 복원이 첨부 폴더 밖에 쓴다.
    if (a.name !== path.basename(a.name) || a.name === '' || a.name === '.' || a.name === '..') {
      throw new Error(`백업의 첨부 이름이 올바르지 않습니다: ${a.name}`)
    }
    if (seen.has(a.name)) throw new Error(`백업에 같은 첨부가 두 번 있습니다: ${a.name}`)
    seen.add(a.name)
    // **base64를 지금 확인한다.** `Buffer.from`은 잘못된 글자를 조용히 버리므로,
    // 쓰기 시점에 확인하면 "복원 성공"이라 답하면서 내용이 잘린 파일이 남는다.
    if (!isBase64(a.data)) throw new Error(`백업의 첨부 내용이 손상됐습니다: ${a.name}`)
    attachments.push({ name: a.name, data: a.data })
  }

  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : '',
    appVersion: typeof o.appVersion === 'string' ? o.appVersion : '',
    attachmentsDir: typeof o.attachmentsDir === 'string' ? o.attachmentsDir : '',
    data,
    chat: o.chat as Record<string, unknown>[],
    attachments
  }
}

/** base64 문자만 있고 길이가 4의 배수인가. `Buffer.from`이 조용히 버리는 것을 먼저 잡는다. */
function isBase64(value: string): boolean {
  if (value.length % 4 !== 0) return false
  return /^[A-Za-z0-9+/]*={0,2}$/.test(value)
}

/** 컬렉션 이름과 그 안의 행이 반드시 가져야 할 키. */
type CollectionKey = Exclude<keyof DbData, 'score'>
const REQUIRED_COLLECTIONS: { key: CollectionKey; requires: string[] }[] = [
  { key: 'lists', requires: ['id'] },
  { key: 'tasks', requires: ['id'] },
  { key: 'habits', requires: ['id'] },
  { key: 'habitLogs', requires: ['id'] },
  { key: 'folders', requires: ['id'] },
  { key: 'pomodoroSessions', requires: ['id'] }
]

/**
 * 복원할 데이터를 **엄격하게** 확인한다. `shapeData`와 갈라 두는 것이 요점이다.
 *
 * 디스크에서 읽을 때는 관대한 것이 맞다 — 빠진 컬렉션을 빈 배열로 채우면 앱이
 * 스스로 회복한다. 그런데 그 관대함을 복원에 그대로 쓰면 `{ "data": {} }` 한 줄이
 * **유효한 백업**이 되고, 복원하면 사용자의 모든 것이 빈 배열로 교체된 뒤 디스크에
 * 커밋된다(검증이 실측). 복구하려고 만든 기능이 데이터를 지우는 도구가 되는 자리다.
 *
 * 그래서 여기서는 채우지 않는다. 없으면 그 파일은 백업이 아니다.
 */
function strictData(raw: unknown): DbData {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('백업에 데이터가 없습니다.')
  }
  const o = raw as Record<string, unknown>
  const out = emptyData()

  for (const { key, requires } of REQUIRED_COLLECTIONS) {
    const value = o[key]
    if (!Array.isArray(value)) throw new Error(`백업에 ${key}가 없습니다.`)
    for (const row of value) {
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        throw new Error(`백업의 ${key} 행이 손상됐습니다.`)
      }
      for (const field of requires) {
        const cell = (row as Record<string, unknown>)[field]
        if (typeof cell !== 'string' || cell === '') {
          throw new Error(`백업의 ${key} 행에 ${field}가 없습니다.`)
        }
      }
    }
    out[key] = value as Record<string, unknown>[]
  }

  const score = normalizeScore(o.score)
  if (!score) throw new Error('백업에 점수가 없습니다.')
  out.score = score

  return out
}

/**
 * 할일이 품은 첨부 절대경로의 접두사를 갈아끼운다.
 *
 * 조각을 나누지 않고 **문자열 치환**으로 한다. 참조가 `이름|경로` 인코딩인데
 * 파일명에 `|`가 들어갈 수 있어 어느 조각이 경로인지 확실하지 않기 때문이다.
 * 접두사는 절대경로라 우연히 다른 데서 나타날 일이 없다.
 */
export function rebaseAttachmentPaths(
  tasks: Record<string, unknown>[],
  fromDir: string,
  toDir: string
): Record<string, unknown>[] {
  if (!fromDir || fromDir === toDir) return tasks
  return tasks.map((t) => {
    const raw = t.attachments
    if (typeof raw !== 'string' || !raw.includes(fromDir)) return t
    return { ...t, attachments: raw.split(fromDir).join(toDir) }
  })
}

/**
 * 지금 상태 전체를 하나의 복원 가능한 아카이브로.
 *
 * 형식은 **base64를 품은 단일 JSON**이다. zip이 아닌 이유는 새 의존성을 들이지
 * 않기 위해서다 — 백업은 복구 경로라, 그 경로가 서드파티 압축 라이브러리의
 * 버전에 묶이면 정작 필요한 날 못 여는 위험이 생긴다. 대가는 첨부가 약 33%
 * 커지는 것인데, 할일 앱의 첨부 크기에서는 받아들일 만하다.
 */
export function createBackupArchive(): string {
  assertWritable()

  // **하나라도 못 담으면 전체를 실패시킨다.** 예전에는 첨부 읽기 실패를 로그로
  // 넘기고 부분 아카이브를 정상 반환했다. 사용자는 "백업했다"는 답을 받고 원본을
  // 지울 수 있는데, 그 파일에는 첨부가 빠져 있다 — 백업의 유일한 약속을 어기는
  // 실패 모드이고, 정직하게 실패하는 것보다 나쁘다.
  const attachments: BackupAttachment[] = []
  let names: string[]
  try {
    names = readdirSync(attachmentsDir)
  } catch (error) {
    throw new Error(`첨부 폴더를 읽지 못해 백업을 만들 수 없습니다: ${describe(error)}`)
  }
  for (const name of names) {
    const full = path.join(attachmentsDir, name)
    const stat = lstatOrNull(full)
    // 심링크·하위 폴더는 담지 않는다 — 복원하는 기기에서 그 대상이 있을 리 없고,
    // 따라가면 첨부 폴더 밖의 파일을 백업에 실어 나르게 된다. 앱이 만들지 않는
    // 모양이므로 건너뛰는 것이지, 읽기 실패를 넘기는 것이 아니다.
    if (!stat?.isFile()) continue
    try {
      attachments.push({ name, data: readFileSync(full).toString('base64') })
    } catch (error) {
      throw new Error(`첨부 ${name}을(를) 읽지 못해 백업을 만들 수 없습니다: ${describe(error)}`)
    }
  }

  return JSON.stringify(
    buildArchive({
      data,
      chat: readChatForBackup(),
      attachments,
      attachmentsDir,
      appVersion: appVersion(),
      createdAt: new Date().toISOString()
    })
  )
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 백업에 담을 대화 기록. **읽기 실패를 빈 기록으로 바꾸지 않는다.**
 *
 * `getChatHistory()`는 화면용이라 못 읽으면 `[]`로 떨어지는 것이 맞다 — 대화가
 * 안 보이는 것과 앱이 안 뜨는 것 중 앞엣것이 낫다. 그런데 백업에서는 같은 관대함이
 * `chat: []`인 "성공" 아카이브를 만든다(검증이 손상된 `ai-chat.json`으로 실측).
 * 사용자는 대화까지 담겼다고 믿고 원본을 지운다.
 */
function readChatForBackup(): Record<string, unknown>[] {
  if (!chatHistoryPath || !existsSync(chatHistoryPath)) return []
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(chatHistoryPath, 'utf-8'))
  } catch (error) {
    throw new Error(`대화 기록을 읽지 못해 백업을 만들 수 없습니다: ${describe(error)}`)
  }
  const messages = (raw as { messages?: unknown })?.messages
  if (!Array.isArray(messages)) {
    throw new Error('대화 기록 파일의 모양이 올바르지 않아 백업을 만들 수 없습니다.')
  }
  return messages as Record<string, unknown>[]
}

function appVersion(): string {
  try {
    return app.getVersion()
  } catch {
    return ''
  }
}

export interface RestoreSummary {
  tasks: number
  lists: number
  attachments: number
}

/** 복원 중에만 존재하는 스테이징 폴더. 승격 전에는 아무것도 제자리에 없다. */
function stagingDir(): string {
  return `${attachmentsDir}.restoring`
}

function removeTree(target: string): void {
  try {
    rmSync(target, { recursive: true, force: true })
  } catch (error) {
    console.error(`[db] ${target} 정리 실패`, error)
  }
}

/**
 * 아카이브로 현재 상태를 통째로 대체한다.
 *
 * **읽기 실패 세션에서도 돈다.** 데이터 파일이 깨진 그 순간이 사용자가 백업을
 * 꺼내는 순간이라, 여기에 `assertWritable()`을 걸면 복구 경로가 고장의 대상에
 * 묶인다. 성공하면 읽기 전용 상태를 푼다.
 *
 * **트랜잭션이어야 한다.** 예전에는 첨부를 현재 폴더에 하나씩 덮어쓰다가 중간에
 * 실패하면 DB는 그대로인데 앞선 첨부만 바뀐 상태가 남았고, DB 플러시가 실패해도
 * `flushSave()`가 오류를 삼켜 "복원 성공"을 답한 뒤 GC까지 돌았다. 그래서 순서를
 * 셋으로 나눈다:
 *
 *   1. **검증** — `parseArchive`가 쓰기 전에 전부 확인한다.
 *   2. **스테이징** — 첨부는 옆 폴더에, DB는 임시 파일에 완성하고 fsync한다.
 *      여기까지 어디서 실패해도 제자리의 것은 하나도 바뀌지 않았다.
 *   3. **승격** — 준비된 것을 rename으로 갈아끼운다. 각 rename은 원자적이고,
 *      사이의 창은 마이크로초 단위이며, 실패하면 옛 첨부 폴더를 되돌린다.
 */
export function restoreBackupArchive(text: string): RestoreSummary {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('백업 파일을 읽을 수 없습니다.')
  }
  const archive = parseArchive(parsed)

  // ── 2. 스테이징 ───────────────────────────────────────────────────────────
  const staging = stagingDir()
  removeTree(staging)
  const nextData: DbData = {
    ...archive.data,
    tasks: rebaseAttachmentPaths(archive.data.tasks, archive.attachmentsDir, attachmentsDir)
  }
  const dbTemp = `${dbPath}.restore-tmp`
  try {
    mkdirSync(staging, { recursive: true })
    for (const attachment of archive.attachments) {
      // 이름은 `parseArchive`가 이미 basename으로 못 박았다.
      writeFileSync(path.join(staging, attachment.name), Buffer.from(attachment.data, 'base64'))
    }
    writeFileWithSync(dbTemp, JSON.stringify(nextData))
  } catch (error) {
    removeTree(staging)
    discardTemp(dbTemp)
    throw new Error(`백업을 준비하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`)
  }

  // ── 3. 승격 ───────────────────────────────────────────────────────────────
  const displaced = `${attachmentsDir}.replaced-${Date.now()}`
  let movedAside = false
  try {
    if (existsSync(attachmentsDir)) {
      renameSync(attachmentsDir, displaced)
      movedAside = true
    }
    renameSync(staging, attachmentsDir)
    // DB를 마지막에 올린다. 여기가 "복원됐다"가 참이 되는 순간이다.
    revision += 1
    commitTemp(dbPath, dbTemp, revision)
  } catch (error) {
    // 첨부만 바뀌고 DB는 안 바뀐 상태로 두지 않는다.
    if (movedAside) {
      removeTree(attachmentsDir)
      try {
        renameSync(displaced, attachmentsDir)
      } catch (undoError) {
        console.error('[db] 복원 실패 후 첨부 폴더를 되돌리지 못했다', undoError)
      }
    }
    removeTree(staging)
    discardTemp(dbTemp)
    throw new Error(`백업을 복원하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`)
  }

  data = nextData
  dbReadFailed = false
  primaryTrusted = true
  noteSaveSucceeded()
  removeTree(displaced)

  // 대화는 별도 파일이라 위 승격에 실려 오지 않는다. 실패해도 이미 복원된 DB를
  // 되돌리지는 않지만, **조용히 넘기지도 않는다** — 사용자는 대화가 함께 돌아올
  // 것이라고 안내받았다.
  try {
    saveChatHistory(archive.chat)
  } catch (error) {
    throw new Error(`할일은 복원했지만 대화 기록을 쓰지 못했습니다: ${error instanceof Error ? error.message : String(error)}`)
  }

  return { tasks: data.tasks.length, lists: data.lists.length, attachments: archive.attachments.length }
}

/** 내용을 쓰고 fsync까지 마친다. 실패는 던진다. */
function writeFileWithSync(target: string, contents: string): void {
  const fd = openSync(target, 'w')
  try {
    writeFileSync(fd, contents, 'utf-8')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/**
 * 종료 플러시. **디스크에 확정됐으면 true.**
 *
 * 판정을 돌려주는 것이 요점이다 — 마지막 편집을 잃은 종료와 정상 종료를 호출처가
 * 구별할 수 있어야 한다. 무엇을 할지(종료를 막을지, 사용자에게 알릴지)는 셸이
 * 정한다(`main/index.ts` — 이 워크트리 밖).
 */
export function closeDatabase(): boolean {
  return flushSave()
}
