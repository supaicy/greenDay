import { app, safeStorage } from 'electron'
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
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { open as openFile } from 'node:fs/promises'
import path from 'node:path'

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

/**
 * 읽기 실패 세션에서 변경을 시도했을 때의 거절.
 *
 * **문자열을 여기서만 정한다.** 렌더러가 이 이유를 알아보고 "저장되지 않았다"를
 * 말해야 하는데(H1 롤백), 문구를 양쪽에 적으면 한쪽을 바꿨을 때 아무것도 안 깨진
 * 채로 그 분기만 조용히 죽는다 — `shared/license.ts`의 `LICENSE_REQUIRED`가
 * 같은 이유로 shared에 있다.
 */
export const DB_READ_ONLY = 'db_read_only'

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

function save(): void {
  // 호출처가 이미 `assertWritable()`로 걸러 주지만, 여기 한 겹을 더 둔다 —
  // 마이그레이션처럼 mutator를 거치지 않는 경로가 있다.
  if (dbReadFailed) return
  revision += 1
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
    while (revision > committedRevision) {
      const target = revision
      const json = JSON.stringify(data)
      try {
        await writeAtomicAsync(dbPath, json, target)
      } catch (error) {
        // 다음 `save()`나 종료 플러시가 다시 시도한다. 여기서 committedRevision을
        // 올리지 않으므로 밀린 변경은 그대로 밀린 채 남는다.
        console.error('DB 저장 실패:', error)
        return
      }
    }
  } finally {
    draining = false
  }
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
  const handle = await openFile(temp, 'w')
  try {
    await handle.writeFile(json, 'utf-8')
    // rename은 원자적 *교체*이지 내구성 있는 *커밋*이 아니다. 내용이 아직 페이지
    // 캐시에만 있으면 성공이라 답한 뒤 전원이 끊겼을 때 빈 파일이 제자리에 남는다.
    await handle.sync()
  } finally {
    await handle.close()
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
    try {
      unlinkSync(temp)
    } catch {
      /* 종료 플러시가 같은 이름을 이미 옮겼다 */
    }
    return
  }
  rotateBackup(file)
  renameSync(temp, file)
  committedRevision = target
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
  try {
    renameSync(file, `${file}.bak`)
  } catch (error) {
    // 백업을 못 만드는 것이 저장을 막을 이유는 아니다. 새 내용이 더 중요하다.
    console.error('DB 백업 회전 실패:', error)
  }
}

/**
 * 앱 종료 시의 동기 플러시.
 *
 * **`committedRevision`을 먼저 올린다.** 그래야 아직 날아가는 중인 구형 비동기
 * 쓰기가 `commitTemp`에서 자기가 낡았음을 보고 물러난다. 이 한 줄이 감사가 실측한
 * "종료 뒤 파일이 되돌아간다"를 닫는다.
 */
function flushSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (dbReadFailed) return
  if (revision <= committedRevision) return
  const target = revision
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
    commitTemp(dbPath, temp, target)
  } catch (error) {
    console.error('DB 종료 플러시 실패:', error)
    try {
      unlinkSync(temp)
    } catch {
      /* 애초에 안 만들어졌다 */
    }
  }
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
function load(): DbData {
  const primary = readDataFile(dbPath)
  if (primary.ok) return shapeData(primary.value)

  const backupPath = `${dbPath}.bak`
  const backup = readDataFile(backupPath)
  if (backup.ok) {
    if (primary.reason === 'corrupt') {
      console.error(`[db] ${dbPath}를 읽지 못해 ${backupPath}에서 복구했다`, primary.error)
    }
    return shapeData(backup.value)
  }

  // 대상도 백업도 **없는** 것은 새 설치다 — 실패가 아니다.
  if (primary.reason === 'missing' && backup.reason === 'missing') return emptyData()
  // 둘 중 하나는 깨진 것이다. 대상 쪽 이유를 우선한다 — 사용자가 잃은 것이 그쪽이다.
  if (primary.reason === 'corrupt') throw primary.error
  throw backup.reason === 'corrupt' ? backup.error : new Error(`${dbPath}를 읽을 수 없다`)
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
  sweepTempFiles()
  try {
    data = load()
    dbReadFailed = false
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
    if (t.deleted_with === undefined) {
      // 이 컬럼이 생기기 전에 버려진 행. 부모와 **같은 시각**에 내려갔으면 그때는
      // 캐스케이드였다고 본다 — 시계 근사이지만 마이그레이션에서 한 번만 쓰이고,
      // 틀려도 "부모 복원이 하위작업을 안 데려온다"는 예전 동작으로 떨어질 뿐이다.
      const parent = t.parent_id ? data.tasks.find((p) => p.id === t.parent_id) : undefined
      t.deleted_with = t.deleted_at && parent?.deleted_at === t.deleted_at ? t.parent_id : null
    }
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
  save()
}
export function permanentDeleteTask(id: string): void {
  assertWritable()
  data.tasks = data.tasks.filter((t) => t.id !== id && t.parent_id !== id)
  save()
  // 행이 실제로 사라지는 두 경로 중 하나다 — 첨부를 여기서 걷지 않으면
  // 아무도 참조하지 않는 사본이 폴더에 영원히 쌓인다.
  gcAttachments()
}
export function emptyTrash(): void {
  assertWritable()
  data.tasks = data.tasks.filter((t) => !t.deleted_at)
  save()
  gcAttachments()
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
        task.deleted_with = null
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
  copyFileSync(sourcePath, destPath)
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
  const blob = taskRows.map((t) => String(t.attachments ?? '')).join(' ')
  return fileNames.filter((name) => name !== '' && !blob.includes(name))
}

/**
 * 참조가 사라진 첨부 사본을 지운다. 지운 개수를 돌려준다.
 *
 * 행이 실제로 없어지는 자리(`permanentDeleteTask`·`emptyTrash`)와 시작 시점에
 * 돈다. 시작 시점이 필요한 이유: 참조만 떼는 경로(`updateTask`로 목록에서 제거)는
 * 행을 지우지 않으므로 그때는 아직 "휴지통에서 되돌릴 수 있는" 상태이고,
 * 다음 부팅이 그 판정이 확정되는 첫 지점이다.
 */
export function gcAttachments(): number {
  if (dbReadFailed || !attachmentsDir) return 0
  let names: string[]
  try {
    names = readdirSync(attachmentsDir)
  } catch {
    return 0
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
    writeFileSync(aiConfigPath, JSON.stringify(encodeApiKey(config, realCrypto), null, 2), 'utf-8')
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
  if (typeof o.data !== 'object' || o.data === null || Array.isArray(o.data)) {
    throw new Error('백업에 데이터가 없습니다.')
  }
  const shaped = shapeData(o.data as Record<string, unknown>)

  const attachments: BackupAttachment[] = []
  for (const entry of Array.isArray(o.attachments) ? o.attachments : []) {
    if (typeof entry !== 'object' || entry === null) throw new Error('백업의 첨부 항목이 손상됐습니다.')
    const a = entry as Record<string, unknown>
    if (typeof a.name !== 'string' || typeof a.data !== 'string') {
      throw new Error('백업의 첨부 항목이 손상됐습니다.')
    }
    // **이름만 받는다.** 경로 조각이 섞여 있으면 복원이 첨부 폴더 밖에 쓴다.
    if (a.name !== path.basename(a.name) || a.name === '' || a.name === '.' || a.name === '..') {
      throw new Error(`백업의 첨부 이름이 올바르지 않습니다: ${a.name}`)
    }
    attachments.push({ name: a.name, data: a.data })
  }

  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : '',
    appVersion: typeof o.appVersion === 'string' ? o.appVersion : '',
    attachmentsDir: typeof o.attachmentsDir === 'string' ? o.attachmentsDir : '',
    data: shaped,
    chat: Array.isArray(o.chat) ? (o.chat as Record<string, unknown>[]) : [],
    attachments
  }
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
  const attachments: BackupAttachment[] = []
  try {
    for (const name of readdirSync(attachmentsDir)) {
      const full = path.join(attachmentsDir, name)
      // 심링크는 담지 않는다 — 복원하는 기기에서 그 대상이 있을 리 없고,
      // 따라가면 첨부 폴더 밖의 파일을 백업에 실어 나르게 된다.
      if (lstatOrNull(full)?.isFile() !== true) continue
      attachments.push({ name, data: readFileSync(full).toString('base64') })
    }
  } catch (error) {
    console.error('[db] 첨부를 백업에 담지 못했다', error)
  }
  return JSON.stringify(
    buildArchive({
      data,
      chat: getChatHistory(),
      attachments,
      attachmentsDir,
      appVersion: appVersion(),
      createdAt: new Date().toISOString()
    })
  )
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

/**
 * 아카이브로 현재 상태를 통째로 대체한다.
 *
 * **읽기 실패 세션에서도 돈다.** 데이터 파일이 깨진 그 순간이 사용자가 백업을
 * 꺼내는 순간이라, 여기에 `assertWritable()`을 걸면 복구 경로가 고장의 대상에
 * 묶인다. 성공하면 읽기 전용 상태를 푼다 — 이제 디스크에 있는 것은 우리가 방금
 * 쓴 온전한 파일이다.
 *
 * 순서가 규칙이다: **먼저 전부 검증하고**(parseArchive), 첨부를 쓰고, 마지막에
 * 메모리를 바꾼 뒤 동기로 커밋한다. 사용자가 결과를 기다리고 있으므로 디바운스에
 * 맡기지 않는다.
 */
export function restoreBackupArchive(text: string): RestoreSummary {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('백업 파일을 읽을 수 없습니다.')
  }
  const archive = parseArchive(parsed)

  if (!existsSync(attachmentsDir)) mkdirSync(attachmentsDir, { recursive: true })
  let written = 0
  for (const attachment of archive.attachments) {
    const target = path.join(attachmentsDir, attachment.name)
    // 그 자리에 심링크가 놓여 있으면 `writeFileSync`가 따라가 폴더 밖에 쓴다.
    // `copyAttachment`와 같은 판정이다.
    if (lstatOrNull(target)?.isSymbolicLink()) unlinkSync(target)
    writeFileSync(target, Buffer.from(attachment.data, 'base64'))
    written++
  }

  data = {
    ...archive.data,
    tasks: rebaseAttachmentPaths(archive.data.tasks, archive.attachmentsDir, attachmentsDir)
  }
  dbReadFailed = false
  saveChatHistory(archive.chat)

  revision += 1
  flushSave()
  gcAttachments()
  return { tasks: data.tasks.length, lists: data.lists.length, attachments: written }
}

export function closeDatabase(): void {
  flushSave()
}
