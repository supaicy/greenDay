/**
 * 내보낸 파일의 **바이트**를 본다 — 인코딩은 문자열 비교로는 보이지 않는다.
 *
 * `.csv`에는 인코딩을 선언할 자리가 없다. 스프레드시트는 앞 바이트만 보고
 * 짐작하고, BOM이 없으면 엑셀은 시스템 코드페이지로 읽는다(한국어 윈도우는
 * CP949) — 한글 제목이 통째로 깨진다. 헤더가 전부 ASCII라 단서조차 없다.
 * 내보내기는 잠긴 화면에서도 열어 두는 길이라(데이터를 인질로 잡지 않는다),
 * 못 읽는 파일을 돌려주면 그 약속이 말뿐이 된다.
 *
 * JSON 쪽은 **반대로** 못 박는다. `JSON.parse`는 앞선 U+FEFF에서 그대로 터지고
 * 우리 복원 경로가 바로 그 파서다 — 양쪽에 같은 처리를 하면 백업이 안 열린다.
 *
 * 핸들러를 실제로 등록해서 부른다. CSV 조립은 `export-data` 안에만 있어서
 * 따로 부를 함수가 없고, 발신자 검사까지 지나야 실제 쓰기에 닿는다.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BOM = Buffer.from([0xef, 0xbb, 0xbf])
const root = mkdtempSync(join(tmpdir(), 'greenday-export-'))
const csvPath = join(root, 'export.csv')
const jsonPath = join(root, 'export.json')

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false }, electronApp: {}, optimizer: {} }))
vi.mock('electron-updater', () => ({ autoUpdater: { downloadUpdate: vi.fn(), quitAndInstall: vi.fn() } }))

// 저장 다이얼로그가 돌려주는 경로를 테스트가 갈아끼운다 — 같은 핸들러를
// csv/json 두 번 태워 두 갈래를 한 파일에서 본다.
let savePath = csvPath
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, listener: Handler) => handlers.set(channel, listener) },
  app: { getPath: () => root, getVersion: () => '0.0.0-test' },
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: savePath }))
  },
  Notification: Object.assign(
    vi.fn(() => ({ show: vi.fn() })),
    { isSupported: () => false }
  ),
  globalShortcut: { register: vi.fn(), unregisterAll: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openPath: vi.fn(), openExternal: vi.fn() },
  Menu: { buildFromTemplate: (t: unknown) => t, setApplicationMenu: vi.fn() }
}))

const db = await import('./database')
const { setupIpcHandlers } = await import('./ipc-handlers')

// 게이트의 발신자 검사를 지나려면 창이 실제로 여는 문서와 같은 오리진이어야 한다.
const APP_ORIGIN = 'http://localhost:5173'
const TITLE = '장보기 — 김치찌개 재료'
const previousRendererUrl = process.env.ELECTRON_RENDERER_URL

beforeAll(async () => {
  process.env.ELECTRON_RENDERER_URL = APP_ORIGIN
  db.initDatabase()
  db.createTask({ id: 't1', title: TITLE, description: '두부·대파', listId: 'inbox' })
  setupIpcHandlers()
  const handler = handlers.get('export-data')
  if (!handler) throw new Error('등록되지 않은 채널: export-data')
  const event = { senderFrame: { url: `${APP_ORIGIN}/index.html` } }
  savePath = csvPath
  await handler(event)
  savePath = jsonPath
  await handler(event)
})

afterAll(() => {
  if (previousRendererUrl === undefined) delete process.env.ELECTRON_RENDERER_URL
  else process.env.ELECTRON_RENDERER_URL = previousRendererUrl
})

describe('export-data — 내보낸 파일의 인코딩', () => {
  it('CSV는 UTF-8 BOM으로 시작한다 — 없으면 엑셀이 한글을 코드페이지로 읽어 깨뜨린다', () => {
    expect(readFileSync(csvPath).subarray(0, 3)).toEqual(BOM)
  })

  it('CSV 본문은 그대로다 — BOM은 앞에 붙기만 하고 헤더·행을 건드리지 않는다', () => {
    const text = readFileSync(csvPath, 'utf-8')
    expect(text.slice(1)).toMatch(/^Title,Description,/)
    expect(text).toContain(TITLE)
  })

  it('JSON에는 BOM을 붙이지 않는다 — `JSON.parse`가 BOM에서 터지고 복원이 그 파서다', () => {
    const bytes = readFileSync(jsonPath)
    expect(bytes.subarray(0, 3)).not.toEqual(BOM)
    expect(() => JSON.parse(bytes.toString('utf-8'))).not.toThrow()
  })
})
