/**
 * `batch-update-tasks`가 형제 채널과 **같은 페이로드 검사를 받는가.**
 *
 * 할일 쓰기 채널 셋 중 둘만 validate.ts를 지나고, 일괄 수정만 렌더러가 준 객체를
 * 그대로 `database.ts`로 넘기고 있었다 — 같은 열(`due_date`), 같은 파일, 같은
 * CalDAV 출구인데 한쪽에만 문이 있었던 것이다. 실측하면 CRLF가 섞인 마감일은
 * .ics의 DTSTART 다음 줄에 ATTENDEE를 그대로 세우고, 문자열이 아닌 마감일은
 * `caldav/sync.ts`의 `addDays`에서 던져 — 그 호출이 `calendar-sync.ts`의 try
 * 바깥이라 — 동기화 전체를 세운다.
 *
 * 핸들러를 실제로 등록시키고 불러 본다(`calendarIpcBoundary.test.ts`와 같은 하네스).
 * 정책이 옳은 것과 배선이 된 것은 따로 깨진다 — 이 결함이 정확히 후자였다.
 */

import { describe, it, expect, vi, afterAll, beforeAll, beforeEach } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false }, electronApp: {}, optimizer: {} }))
vi.mock('electron-updater', () => ({ autoUpdater: { downloadUpdate: vi.fn(), quitAndInstall: vi.fn() } }))
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, listener: Handler) => handlers.set(channel, listener) },
  app: { getPath: () => '/tmp/greenday-batch-validate-test', getVersion: () => '0.0.0-test' },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  Notification: Object.assign(
    vi.fn(() => ({ show: vi.fn() })),
    { isSupported: () => false }
  ),
  globalShortcut: { register: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openPath: vi.fn(), openExternal: vi.fn() },
  Menu: { buildFromTemplate: (t: unknown) => t, setApplicationMenu: vi.fn() }
}))

/** 디스크는 건드리지 않는다 — 이 파일이 묻는 것은 "무엇이 db까지 내려가는가"다. */
const db = vi.hoisted(() => ({ updateTask: vi.fn(), batchUpdateTasks: vi.fn() }))
vi.mock('./database', () => db)

const { setupIpcHandlers } = await import('./ipc-handlers')

/* 앱 문서 URL을 이 테스트가 아는 값으로 고정한다(ipc-gate.test.ts와 같은 방식).
   발신자 검사가 생긴 뒤로 `{}`는 통과하지 않는다. */
const APP_ORIGIN = 'http://localhost:5173'
const APP_DOCUMENT = `${APP_ORIGIN}/index.html`
const previousRendererUrl = process.env.ELECTRON_RENDERER_URL
beforeAll(() => {
  process.env.ELECTRON_RENDERER_URL = APP_ORIGIN
  setupIpcHandlers()
})
// 저장만 하고 되돌리지 않으면 같은 워커의 다음 파일에 이 값이 샌다(calendarIpcBoundary.test.ts와 같은 방식).
afterAll(() => {
  if (previousRendererUrl === undefined) delete process.env.ELECTRON_RENDERER_URL
  else process.env.ELECTRON_RENDERER_URL = previousRendererUrl
})
beforeEach(() => {
  db.updateTask.mockClear()
  db.batchUpdateTasks.mockClear()
})

function invoke(channel: string, ...args: unknown[]): unknown {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`등록되지 않은 채널: ${channel}`)
  return handler({ senderFrame: { url: APP_DOCUMENT } }, ...args)
}

/* 개행이 섞인 마감일. `ical.ts`의 toDateStamp은 하이픈만 지우므로 이 값은 DTSTART
   줄을 끊고 그 뒤를 사용자의 캘린더에 **새 iCalendar 속성으로** 심는다. */
const CRLF_DATE = '2026-01-01\r\nATTENDEE;CN=x:mailto:x@evil.example'

describe('batch-update-tasks 페이로드 검증', () => {
  it('한 건 수정이 거절하는 마감일은 일괄 수정도 거절한다', () => {
    expect(() => invoke('update-task', { id: 't1', dueDate: CRLF_DATE })).toThrow('Invalid task payload')
    expect(db.updateTask).not.toHaveBeenCalled()

    expect(() => invoke('batch-update-tasks', ['t1'], { dueDate: CRLF_DATE })).toThrow('Invalid task payload')
    expect(db.batchUpdateTasks).not.toHaveBeenCalled()
  })

  it('문자열이 아닌 마감일도 막는다 — addDays가 던지면 동기화가 통째로 선다', () => {
    expect(() => invoke('batch-update-tasks', ['t1'], { dueDate: 20260101 })).toThrow('Invalid task payload')
    expect(db.batchUpdateTasks).not.toHaveBeenCalled()
  })

  it('달력에 없는 날짜는 막는다 — 서버가 거부해 그 할일만 조용히 안 올라간다', () => {
    expect(() => invoke('batch-update-tasks', ['t1'], { dueDate: '2026-13-45' })).toThrow('Invalid task payload')
    expect(db.batchUpdateTasks).not.toHaveBeenCalled()
  })

  it('객체가 아닌 페이로드는 db까지 가지 않는다', () => {
    expect(() => invoke('batch-update-tasks', ['t1'], null)).toThrow('Invalid task payload')
    expect(() => invoke('batch-update-tasks', ['t1'], 'completed')).toThrow('Invalid task payload')
    expect(db.batchUpdateTasks).not.toHaveBeenCalled()
  })

  it('렌더러가 실제로 보내는 모양은 그대로 통과한다', () => {
    for (const updates of [{ completed: true }, { deleted: true }, { listId: 'inbox' }, { priority: 2 }]) {
      invoke('batch-update-tasks', ['t1'], updates)
      expect(db.batchUpdateTasks).toHaveBeenLastCalledWith(['t1'], updates)
    }
    invoke('batch-update-tasks', ['t1'], { dueDate: '2026-01-01' })
    expect(db.batchUpdateTasks).toHaveBeenLastCalledWith(['t1'], { dueDate: '2026-01-01' })
    // 마감일 지우기는 정상 조작이다 — null은 통과해야 한다.
    invoke('batch-update-tasks', ['t1'], { dueDate: null })
    expect(db.batchUpdateTasks).toHaveBeenLastCalledWith(['t1'], { dueDate: null })
  })
})
