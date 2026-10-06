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

import { cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../../store/useStore'

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
