import { describe, it, expect, vi } from 'vitest'
import { ensureAppCalendar, APP_CALENDAR_NAME, type AppCalendarClient } from './app-calendar'
import { DEFAULT_GOOGLE_CONFIG, type GoogleConfig } from '../google-config'
import type { GoogleCalendar } from './calendar'

function fakeClient(existing: GoogleCalendar | null, made: GoogleCalendar = { id: 'new-id', summary: 'Greenday' }) {
  const client: AppCalendarClient = {
    getCalendar: vi.fn(async () => existing),
    createCalendar: vi.fn(async () => made)
  }
  return client
}

const base: GoogleConfig = {
  ...DEFAULT_GOOGLE_CONFIG,
  tokens: { accessToken: 'at', refreshToken: 'rt', expiresAt: '2099-01-01T00:00:00.000Z', scope: '' }
}

describe('ensureAppCalendar', () => {
  it('저장된 id가 없으면 Greenday 캘린더를 만든다', async () => {
    const client = fakeClient(null)
    const { config, created } = await ensureAppCalendar(client, base)
    expect(client.getCalendar).not.toHaveBeenCalled()
    expect(client.createCalendar).toHaveBeenCalledWith(APP_CALENDAR_NAME)
    expect(created).toBe(true)
    expect(config.calendarId).toBe('new-id')
    expect(config.calendarName).toBe('Greenday')
    expect(config.enabled).toBe(true)
  })

  it('저장된 id가 살아 있으면 그것을 다시 쓰고 만들지 않는다', async () => {
    const client = fakeClient({ id: 'kept', summary: 'Greenday' })
    const state = { t1: { href: 'kept', etag: null, fingerprint: 'f', sequence: 0 } }
    const { config, created } = await ensureAppCalendar(client, { ...base, calendarId: 'kept', syncState: state })
    expect(client.getCalendar).toHaveBeenCalledWith('kept')
    expect(client.createCalendar).not.toHaveBeenCalled()
    expect(created).toBe(false)
    expect(config.calendarId).toBe('kept')
    // 같은 캘린더 — 동기화 상태는 그대로 유효하다.
    expect(config.syncState).toEqual(state)
  })

  it('사용자가 구글에서 이름을 바꿨으면 화면 이름을 따라간다', async () => {
    const client = fakeClient({ id: 'kept', summary: '내 할일' })
    const { config } = await ensureAppCalendar(client, { ...base, calendarId: 'kept', calendarName: 'Greenday' })
    expect(config.calendarName).toBe('내 할일')
  })

  it('저장된 id가 죽었으면(지웠거나 다른 계정) 새로 만들고 동기화 상태를 비운다', async () => {
    const client = fakeClient(null)
    const state = { t1: { href: 'gone', etag: null, fingerprint: 'f', sequence: 0 } }
    const { config, created } = await ensureAppCalendar(client, { ...base, calendarId: 'gone', syncState: state })
    expect(client.getCalendar).toHaveBeenCalledWith('gone')
    expect(client.createCalendar).toHaveBeenCalledWith(APP_CALENDAR_NAME)
    expect(created).toBe(true)
    expect(config.calendarId).toBe('new-id')
    expect(config.syncState).toEqual({})
  })

  it('확인·생성 오류는 그대로 올린다 — 여기서 삼키면 "연결됨"인데 쓸 곳이 없다', async () => {
    const client: AppCalendarClient = {
      getCalendar: vi.fn(async () => {
        throw new Error('rate_limit')
      }),
      createCalendar: vi.fn()
    }
    await expect(ensureAppCalendar(client, { ...base, calendarId: 'x' })).rejects.toThrow('rate_limit')
    expect(client.createCalendar).not.toHaveBeenCalled()
  })
})
