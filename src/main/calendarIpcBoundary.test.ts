/**
 * C1·M1의 **IPC 진입점 절반** — 렌더러가 준 값이 자격증명의 목적지를 정하던 것.
 *
 * wt-sync가 `caldav/client.ts`(응답 안의 href 출처 강제)와 `calendar-config.ts`
 * (암호문 안쪽 결속)를 닫았다. 여기는 그 앞단이다 — 렌더러가 IPC로 직접 제출하는 값.
 * 두 겹 다 필요하다: 안쪽 겹은 파일에 쓰인 값을 못 믿게 하고, 이 바깥 겹은 애초에
 * 그 값이 파일에 들어가지 못하게 한다.
 *
 * 핸들러를 실제로 등록시키고 불러 본다(`ipc-gate.test.ts`와 같은 하네스). 정책이 옳은
 * 것과 배선이 된 것은 따로 깨진다.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import type { CalendarConfig } from './calendar-config'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false }, electronApp: {}, optimizer: {} }))
vi.mock('electron-updater', () => ({ autoUpdater: { downloadUpdate: vi.fn(), quitAndInstall: vi.fn() } }))
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, listener: Handler) => handlers.set(channel, listener) },
  app: { getPath: () => '/tmp/greenday-calendar-ipc-test', getVersion: () => '0.0.0-test' },
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

/** 디스크 대신 여기에 든다. 핸들러가 실제로 무엇을 저장하는지가 이 파일의 관심사다. */
let stored: CalendarConfig
vi.mock('./calendar-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./calendar-config')>()
  return {
    ...actual,
    readConfigFile: () => ({ ...stored }),
    writeConfigFile: (_path: string, config: CalendarConfig) => {
      stored = { ...config }
    }
  }
})

const { setupIpcHandlers } = await import('./ipc-handlers')
setupIpcHandlers()

/* 앱 문서 URL을 **이 테스트가 아는 값**으로 고정한다. 번들 경로에 기대면
   실행 위치에 따라 답이 달라진다(ipc-gate.test.ts와 같은 방식). */
const APP_ORIGIN = 'http://localhost:5173'
const APP_DOCUMENT = `${APP_ORIGIN}/index.html`
const previousRendererUrl = process.env.ELECTRON_RENDERER_URL
beforeAll(() => {
  process.env.ELECTRON_RENDERER_URL = APP_ORIGIN
})

/* 우리 문서에서 온 호출. **발신자 검사가 생긴 뒤로 `{}`는 통과하지 않는다** —
   C2가 창을 앱 문서에 묶으면서, 넘어간 페이지가 window.api를 물려받던 경로를
   닫았다. 여기 테스트는 그 검사 이후 화면(calendar:select의 오리진 검사)을
   보는 것이므로, 신뢰된 발신자로 들어가야 그 자리까지 닿는다. */
function invoke(channel: string, ...args: unknown[]): unknown {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`등록되지 않은 채널: ${channel}`)
  return handler({ senderFrame: { url: APP_DOCUMENT } }, ...args)
}

const ICLOUD = 'https://caldav.icloud.com'
const CONNECTED: CalendarConfig = {
  provider: 'icloud',
  serverUrl: ICLOUD,
  username: 'me@icloud.com',
  password: 'app-specific-password',
  /* 저장된 비밀번호는 **어느 오리진·계정에 대한 것인지** 함께 봉인된다(M3).
     이 필드 없이 만든 설정은 "새로 입력한 값"으로 읽혀서, 서버나 계정이 바뀌어도
     옛 암호를 재사용하던 바로 그 경로로 되돌아간다. 연결된 상태를 흉내 내려면
     실제 저장본과 같은 모양이어야 한다. */
  passwordBinding: {
    origin: new URL(ICLOUD).origin,
    username: 'me@icloud.com',
    password: 'app-specific-password',
  },
  calendarUrl: `${ICLOUD}/123/calendars/home/`,
  calendarName: '집',
  enabled: true,
  lastSyncAt: null,
  lastError: null,
  syncState: {
    'task-1': { href: `${ICLOUD}/123/calendars/home/a.ics`, etag: '"1"', fingerprint: 'x', sequence: 0 }
  }
}

beforeEach(() => {
  stored = { ...CONNECTED }
})

describe('calendar:select — 설정된 서버 밖은 고를 수 없다 (C1의 렌더러 절반)', () => {
  it('같은 서버 안의 캘린더는 고를 수 있다', () => {
    invoke('calendar:select', `${ICLOUD}/123/calendars/work/`, '일')
    expect(stored.calendarUrl).toBe(`${ICLOUD}/123/calendars/work/`)
    expect(stored.enabled).toBe(true)
  })

  /**
   * 이게 공격이다. 저장된 `calendarUrl`은 `calendar:sync-now`가 `Authorization: Basic`을
   * 붙여 요청하는 주소가 되므로, 이 한 줄이 iCloud 앱 암호를 임의 호스트로 보낸다.
   */
  it('다른 오리진은 거절하고 저장된 값을 바꾸지 않는다', () => {
    expect(() => invoke('calendar:select', 'https://evil.example/calendars/x/', '훔치기')).toThrow(
      'outside the configured CalDAV server'
    )
    expect(stored.calendarUrl).toBe(CONNECTED.calendarUrl)
  })

  it.each([
    ['평문 HTTP 다운그레이드', 'http://caldav.icloud.com/123/calendars/home/'],
    ['다른 포트', 'https://caldav.icloud.com:8443/123/calendars/home/'],
    ['서브도메인 흉내', 'https://caldav.icloud.com.evil.example/x/'],
    ['프로토콜 상대', '//evil.example/x/'],
    ['프래그먼트로 감추기', 'https://evil.example/#https://caldav.icloud.com/'],
    ['자격증명 자리에 숨기기', 'https://caldav.icloud.com@evil.example/x/'],
    ['file 스킴', 'file:///etc/passwd'],
    ['빈 문자열', ''],
    ['URL이 아닌 것', 'not a url']
  ])('%s 도 거절한다', (_label, url) => {
    expect(() => invoke('calendar:select', url, 'x')).toThrow()
    expect(stored.calendarUrl).toBe(CONNECTED.calendarUrl)
  })

  it('호스트 대소문자와 기본 포트는 같은 오리진이다', () => {
    invoke('calendar:select', 'https://CalDAV.iCloud.com:443/123/calendars/home/', '집')
    expect(stored.calendarUrl).toBe('https://CalDAV.iCloud.com:443/123/calendars/home/')
  })
})

describe('calendar:save-credentials — 자격증명이 오리진을 따라가지 않는다 (M1의 IPC 절반)', () => {
  it('같은 서버·계정이면 저장된 비밀번호를 유지한다', () => {
    invoke('calendar:save-credentials', { serverUrl: ICLOUD, username: 'me@icloud.com' })
    expect(stored.password).toBe('app-specific-password')
    expect(stored.calendarUrl).toBe(CONNECTED.calendarUrl)
  })

  /**
   * 핸들러가 하는 일이 정확히 `{...config, serverUrl: 새것}` 스프레드였다 —
   * 이전 서버의 비밀번호가 그대로 딸려 갔고, 다음 동기화에서 새 오리진으로 나갔다.
   */
  it('serverUrl만 바꿔치기하면 비밀번호를 버린다', () => {
    invoke('calendar:save-credentials', { serverUrl: 'https://evil.example' })
    expect(stored.password).toBeNull()
  })

  it('username만 바꿔도 버린다', () => {
    invoke('calendar:save-credentials', { username: 'someone-else@icloud.com' })
    expect(stored.password).toBeNull()
  })

  /**
   * 비밀번호만 지우면 `calendarUrl`이 예전 서버를 가리킨 채 남는다. 그 상태에서
   * 사용자가 새 비밀번호를 넣으면 `calendar:sync-now`가 **새 자격증명을 들고 예전
   * 주소로** 간다 — `calendar:select`의 오리진 검사를 순서만 바꿔 우회하는 길이다.
   */
  it('결속이 끊기면 고른 캘린더와 동기화 상태도 함께 버린다', () => {
    invoke('calendar:save-credentials', { serverUrl: 'https://other.example' })
    expect(stored.calendarUrl).toBeNull()
    expect(stored.calendarName).toBeNull()
    expect(stored.enabled).toBe(false)
    expect(stored.syncState).toEqual({})
  })

  it('서버를 옮기며 새 비밀번호를 함께 주면 그것으로 저장된다', () => {
    invoke('calendar:save-credentials', {
      serverUrl: 'https://dav.fastmail.com',
      username: 'me@fastmail.com',
      password: 'new-app-password'
    })
    expect(stored.password).toBe('new-app-password')
    expect(stored.serverUrl).toBe('https://dav.fastmail.com')
    // 캘린더는 이전 서버의 것이라 그대로 둘 수 없다.
    expect(stored.calendarUrl).toBeNull()
  })

  it('호스트 대소문자와 기본 포트만 다른 것은 이전이 아니다', () => {
    invoke('calendar:save-credentials', { serverUrl: 'https://CalDAV.iCloud.com:443/' })
    expect(stored.password).toBe('app-specific-password')
    expect(stored.calendarUrl).toBe(CONNECTED.calendarUrl)
  })

  it('빈 비밀번호는 "건드리지 않는다"는 뜻이다 (되채우지 않는 UI)', () => {
    invoke('calendar:save-credentials', { serverUrl: ICLOUD, username: 'me@icloud.com', password: '' })
    expect(stored.password).toBe('app-specific-password')
  })

  it('비밀번호는 렌더러로 돌아가지 않는다', () => {
    const result = invoke('calendar:save-credentials', { serverUrl: ICLOUD }) as Record<string, unknown>
    expect(result).not.toHaveProperty('password')
    expect(result.hasPassword).toBe(true)
  })
})
