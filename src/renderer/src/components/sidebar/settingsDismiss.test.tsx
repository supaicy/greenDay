// @vitest-environment jsdom

/**
 * 설정 다이얼로그의 닫힘 신호가 **이미 닫힌 뒤에 한 번 더 와도 다시 열지 않는지**.
 *
 * `onOpenChange(false)`가 `toggleSettings()`(인자 없는 토글)를 불렀다. Radix는 닫힘
 * 애니메이션(150ms) 동안 콘텐츠를 남겨 두고 그동안 Escape·바깥 클릭을 계속 받으므로,
 * 그 사이에 닫힘 신호가 또 오면 토글이 한 번 더 뒤집혀 **다이얼로그가 다시 열렸다.**
 * 2026-10-06 패키징한 앱에서 실측: 가려진 창에서는 애니메이션이 멈춰 Escape를 누를
 * 때마다 열림·닫힘이 번갈았다. 보이는 창에서는 150ms 안에 두 번 누르면 같다.
 *
 * jsdom에는 애니메이션이 없어 Presence가 즉시 언마운트하므로 실제 두 번 누르기는
 * 재현되지 않는다. 그래서 다이얼로그를 대역으로 바꿔 Settings가 Radix에 건네는
 * `onOpenChange`를 직접 잡고, "닫힌 상태에서 받은 닫힘 신호"라는 계약을 본다.
 */

import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../../store/useStore'
import en from '../../i18n/locales/en.json'

let lastOnOpenChange: ((open: boolean) => void) | undefined

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({
    open,
    onOpenChange,
    children
  }: {
    open: boolean
    onOpenChange: (o: boolean) => void
    children: ReactNode
  }) => {
    lastOnOpenChange = onOpenChange
    return open ? <div>{children}</div> : null
  },
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>
}))
// 하위 섹션은 각자 테스트가 있다. 여기서는 IPC를 부르지 않게 비운다.
vi.mock('./CalendarSyncSection', () => ({ CalendarSyncSection: () => null }))
vi.mock('./GoogleSyncSection', () => ({ GoogleSyncSection: () => null }))
vi.mock('./LicenseSection', () => ({ LicenseSection: () => null }))

// electron-vite가 빌드 때 심는 상수. 테스트에는 없다.
vi.stubGlobal('__APP_VERSION__', '0.0.0-test')

import { Settings } from './Settings'

beforeEach(() => {
  ;(window as unknown as Record<string, unknown>).api = { capabilities: vi.fn(async () => null) }
  useStore.setState({
    showSettings: false,
    aiConfig: { provider: 'ollama' } as never,
    aiLoadConfig: vi.fn(async () => {}),
    aiCheckConnection: vi.fn(async () => {})
  })
})
afterEach(() => cleanup())

describe('설정 다이얼로그 닫힘 신호', () => {
  it('이미 닫힌 상태에서 받은 닫힘 신호는 다이얼로그를 다시 열지 않는다', () => {
    render(<Settings />)
    expect(lastOnOpenChange).toBeDefined()
    lastOnOpenChange?.(false)
    expect(useStore.getState().showSettings).toBe(false)
  })

  it('열린 상태의 닫힘 신호는 닫는다', () => {
    useStore.setState({ showSettings: true })
    render(<Settings />)
    lastOnOpenChange?.(false)
    expect(useStore.getState().showSettings).toBe(false)
  })
})

/**
 * Value: protects=업데이트 확인이 실패한 상태(`updateFailed`)를 설정이 실패로 말하는 것 — 실패
 *   가지가 '최신' 가지보다 먼저 온다; fails_when=Settings.tsx에서 `updateFailed` 가지를 빼거나
 *   `updateChecked && !updateAvailable` 뒤로 옮기면(App.tsx가 실패에도 `updateChecked: true`를
 *   세우므로 한 번도 못 물어본 채 "최신 버전입니다"라고 거짓말한다); why_new=updaterError.test.ts는
 *   main이 'update-error'를 보내는 데서 멈추고, 그 상태를 그리는 렌더러 가지는 어느 테스트도
 *   그리지 않는다; seam=none (같은 다이얼로그 대역을 재사용한다. Settings가 i18n을 영어로 띄우므로
 *   문구는 en.json에서 읽는다)
 */
describe('업데이트 확인 실패 표시', () => {
  it('확인이 실패하면 "최신 버전" 대신 실패를 말한다', () => {
    useStore.setState({
      showSettings: true,
      updateChecked: true,
      updateFailed: true,
      updateAvailable: null
    })
    render(<Settings />)
    expect(screen.getByText(en.settings.updateCheckFailed)).toBeTruthy()
    expect(screen.queryByText(en.settings.upToDate)).toBeNull()
  })
})
