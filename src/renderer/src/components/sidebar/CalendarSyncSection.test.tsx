// @vitest-environment jsdom

/**
 * H16c — "직접 입력 (CalDAV)"이 문구로만 존재하던 것.
 *
 * `CalendarConfig.provider`·`serverUrl` 모델과 `calendarSync.provider*`·`serverUrl`
 * 번역 키는 처음부터 있었는데 **입력 자리가 없었다.** 화면은 언제나 저장된
 * `config.serverUrl`(=iCloud 기본값)을 되돌려 보냈으므로, Fastmail·Nextcloud 같은
 * 서버로는 갈 방법이 없었다.
 *
 * 순수 로직이 아니라 "실제로 눌렀을 때 무엇이 나가는가"라서 컴포넌트 테스트로 잡는다.
 */

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { CalendarSyncSection, type CalendarPublicConfig } from './CalendarSyncSection'

const ICLOUD = 'https://caldav.icloud.com'

const style = {
  isDark: false,
  focusRing: 'ring',
  fieldSurface: 'field',
  labelText: 'label',
  hintText: 'hint',
  successText: 'ok',
  errorText: 'err'
}

function config(overrides: Partial<CalendarPublicConfig> = {}): CalendarPublicConfig {
  return {
    provider: 'icloud',
    serverUrl: ICLOUD,
    username: 'user@icloud.com',
    hasPassword: false,
    calendarUrl: null,
    calendarName: null,
    enabled: false,
    lastSyncAt: null,
    lastError: null,
    syncedCount: 0,
    ...overrides
  }
}

let saveCredentials: ReturnType<typeof vi.fn>

function mountWith(loaded: CalendarPublicConfig): void {
  saveCredentials = vi.fn(async () => loaded)
  ;(window as unknown as Record<string, unknown>).api = {
    calendarGetConfig: vi.fn(async () => loaded),
    calendarSaveCredentials: saveCredentials,
    calendarTestConnection: vi.fn(async () => ({ ok: true, message: null, calendars: [] })),
    calendarSelect: vi.fn(),
    calendarSyncNow: vi.fn(),
    calendarDisconnect: vi.fn(),
    openExternal: vi.fn()
  }
  render(<CalendarSyncSection {...style} />)
}

beforeAll(async () => {
  await i18n.changeLanguage('ko')
})

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(cleanup)

/** 로케일 파일이 원본이다 — 문구를 여기 다시 적으면 바뀔 때 조용히 어긋난다. */
const label = (key: string): string => i18n.t(key)

describe('서비스 선택', () => {
  it('iCloud가 기본이고 서버 주소 칸은 보이지 않는다', async () => {
    mountWith(config())
    await screen.findByText(label('calendarSync.provider'))
    expect(screen.queryByLabelText(label('calendarSync.serverUrl'))).not.toBeInTheDocument()
  })

  it('직접 입력을 고르면 서버 주소 칸이 나온다', async () => {
    mountWith(config())
    await userEvent.click(await screen.findByRole('button', { name: label('calendarSync.providerCustom') }))
    expect(screen.getByLabelText(label('calendarSync.serverUrl'))).toBeInTheDocument()
  })

  it('직접 입력에서는 애플 앱 암호 안내를 보여 주지 않는다', async () => {
    mountWith(config())
    expect(await screen.findByText(label('calendarSync.appPasswordLink'))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: label('calendarSync.providerCustom') }))
    // account.apple.com으로 보내는 링크는 직접 넣은 서버에서 틀린 안내다.
    expect(screen.queryByText(label('calendarSync.appPasswordLink'))).not.toBeInTheDocument()
  })

  it('저장된 서버가 iCloud가 아니면 직접 입력으로 열린다', async () => {
    mountWith(config({ provider: 'caldav', serverUrl: 'https://cloud.example/remote.php/dav' }))
    const input = await screen.findByLabelText(label('calendarSync.serverUrl'))
    expect(input).toHaveValue('https://cloud.example/remote.php/dav')
  })

  it('직접 입력으로 바꾸면 iCloud 주소를 남겨 두지 않는다', async () => {
    mountWith(config())
    await userEvent.click(await screen.findByRole('button', { name: label('calendarSync.providerCustom') }))
    expect(screen.getByLabelText(label('calendarSync.serverUrl'))).toHaveValue('')
  })

  it('선택 상태를 aria-pressed로 알린다', async () => {
    mountWith(config())
    const icloud = await screen.findByRole('button', { name: label('calendarSync.providerIcloud') })
    const custom = screen.getByRole('button', { name: label('calendarSync.providerCustom') })
    expect(icloud).toHaveAttribute('aria-pressed', 'true')
    expect(custom).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(custom)
    expect(screen.getByRole('button', { name: label('calendarSync.providerCustom') })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })
})

describe('연결', () => {
  it('입력한 서버 주소가 실제로 저장 요청에 실린다', async () => {
    // 예전에는 화면이 언제나 `config.serverUrl`을 되돌려 보내서, 무엇을 입력하든
    // iCloud로 갔다.
    mountWith(config())
    await userEvent.click(await screen.findByRole('button', { name: label('calendarSync.providerCustom') }))
    await userEvent.type(
      screen.getByLabelText(label('calendarSync.serverUrl')),
      'https://cloud.example/remote.php/dav'
    )
    await userEvent.type(screen.getByLabelText(label('calendarSync.appPassword')), 'app-pass')
    await userEvent.click(screen.getByRole('button', { name: label('calendarSync.connect') }))

    await waitFor(() => expect(saveCredentials).toHaveBeenCalled())
    expect(saveCredentials.mock.calls[0][0]).toMatchObject({
      serverUrl: 'https://cloud.example/remote.php/dav',
      username: 'user@icloud.com',
      password: 'app-pass'
    })
  })

  it('iCloud를 고르면 iCloud 주소가 나간다', async () => {
    mountWith(config({ provider: 'caldav', serverUrl: 'https://cloud.example/remote.php/dav' }))
    await userEvent.click(await screen.findByRole('button', { name: label('calendarSync.providerIcloud') }))
    await userEvent.click(screen.getByRole('button', { name: label('calendarSync.connect') }))
    await waitFor(() => expect(saveCredentials).toHaveBeenCalled())
    expect(saveCredentials.mock.calls[0][0]).toMatchObject({ serverUrl: ICLOUD })
  })

  it('직접 입력인데 주소가 비어 있으면 연결을 시도하지 않는다', async () => {
    mountWith(config())
    await userEvent.click(await screen.findByRole('button', { name: label('calendarSync.providerCustom') }))
    expect(screen.getByRole('button', { name: label('calendarSync.connect') })).toBeDisabled()
  })
})
