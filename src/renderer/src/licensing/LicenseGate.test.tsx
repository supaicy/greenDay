// @vitest-environment jsdom

/**
 * 잠금 화면이 **언제 뜨는가**를 못 박는다.
 *
 * 여기서 틀리면 두 방향 모두 최악이다: 안 떠야 할 때 뜨면 출시 당일 전원이
 * 잠기고, 떠야 할 때 안 뜨면 유료 전환이 아무 일도 하지 않는다. 순수 로직이
 * 아니라 "실제로 그려지는가"라서 컴포넌트 테스트로 잡는다.
 */

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { useStore } from '../store/useStore'
import { LicenseGate } from './LicenseGate'
import type { PublicLicenseState } from '../../../shared/license'

beforeAll(async () => {
  await i18n.changeLanguage('ko')
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView = () => {}
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
})

const LICENSED: PublicLicenseState = {
  status: 'licensed',
  untilMs: null,
  allowsPaidFeatures: true,
  enforced: true,
  maskedKey: 'GREENDAY-••••-••••-••••-G8H9',
  deviceName: 'test-machine',
  blockedReason: null
}

let exportData: ReturnType<typeof vi.fn>
let storedExportData: unknown

const escapeKeyEvent = (): KeyboardEvent =>
  new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })

function mountWith(state: Partial<PublicLicenseState>, api: Record<string, unknown> = {}): void {
  ;(window as unknown as Record<string, unknown>).api = {
    licenseGetState: vi.fn(async () => ({ ...LICENSED, ...state })),
    licenseActivate: vi.fn(async () => null),
    licenseDeactivate: vi.fn(async () => null),
    licenseOpenPurchase: vi.fn(),
    licenseOpenRecover: vi.fn(),
    // 구독 해제 함수를 돌려주는 형태 — 안 돌려주면 언마운트가 터진다.
    onLicenseChanged: vi.fn(() => () => {}),
    ...api
  }
  render(<LicenseGate />)
}

beforeEach(() => {
  exportData = vi.fn()
  const s = useStore.getState() as unknown as Record<string, unknown>
  storedExportData = s.exportData
  useStore.setState({ exportData } as never)
})

afterEach(() => {
  cleanup()
  useStore.setState({ exportData: storedExportData } as never)
})

describe('LicenseGate — 안 떠야 할 때', () => {
  it('enforcement가 꺼져 있으면 아무것도 그리지 않는다', async () => {
    // 출하 시점이 이 상태다. 여기서 뜨면 출시 당일 모든 사용자가 잠긴다.
    mountWith({ enforced: false, allowsPaidFeatures: false, status: 'trialExpired' })
    await waitFor(() => expect(window.api.licenseGetState).toHaveBeenCalled())
    expect(screen.queryByText(i18n.t('license.lockedTitle'))).not.toBeInTheDocument()
  })

  it('유료 기능이 열려 있으면 그리지 않는다', async () => {
    mountWith({ enforced: true, allowsPaidFeatures: true, status: 'trial' })
    await waitFor(() => expect(window.api.licenseGetState).toHaveBeenCalled())
    expect(screen.queryByText(i18n.t('license.lockedTitle'))).not.toBeInTheDocument()
  })

  it('상태가 아직 안 왔으면 그리지 않는다', () => {
    // 첫 프레임은 IPC 응답 전이다. 여기서 잠그면 실행할 때마다 잠금 화면이
    // 한 번 번쩍인다.
    mountWith({ enforced: true, allowsPaidFeatures: false, status: 'trialExpired' })
    expect(screen.queryByText(i18n.t('license.lockedTitle'))).not.toBeInTheDocument()
  })

  it('게이트가 없으면 Escape는 그냥 지나간다', async () => {
    // 아래 "Escape가 뒤로 새지 않는다"가 공짜로 참이 아님을 보이는 대조군이다.
    // 이게 없으면 그 단언은 jsdom이 원래 그런 것인지 게이트가 막은 것인지 모른다.
    mountWith({ enforced: false, allowsPaidFeatures: true, status: 'licensed' })
    await waitFor(() => expect(window.api.licenseGetState).toHaveBeenCalled())
    const esc = escapeKeyEvent()
    document.dispatchEvent(esc)
    expect(esc.defaultPrevented).toBe(false)
  })
})

describe('LicenseGate — 떠야 할 때', () => {
  beforeEach(async () => {
    mountWith({ enforced: true, allowsPaidFeatures: false, status: 'trialExpired', maskedKey: null })
    await screen.findByText(i18n.t('license.lockedTitle'))
  })

  it('데이터를 인질로 잡지 않는다 — 잠긴 화면에서 바로 내보낼 수 있다', async () => {
    await userEvent.click(screen.getByRole('button', { name: i18n.t('license.lockedExport') }))
    expect(exportData).toHaveBeenCalled()
  })

  it('Escape가 뒤로 새지 않고, 게이트도 닫히지 않는다', () => {
    // Radix 다이얼로그라면 캡처 단계에서 Escape를 소비한다. 손수 만든 div로
    // 바꾸면 여기가 빨개진다 — 그때는 잠금 화면 위에서 누른 Escape가
    // useKeyboardShortcuts로 흘러가 뒤에 있는 목록의 선택을 지운다.
    const esc = escapeKeyEvent()
    document.dispatchEvent(esc)
    expect(esc.defaultPrevented).toBe(true)
    // 그리고 게이트는 그대로 있다 — `open`이 고정이라 Radix가 닫을 길이 없다.
    expect(screen.getByText(i18n.t('license.lockedTitle'))).toBeInTheDocument()
  })

  it('키를 넣지 않으면 활성화 버튼이 눌리지 않는다', () => {
    expect(screen.getByRole('button', { name: i18n.t('license.activate') })).toBeDisabled()
  })

  it('구매 링크는 어느 화면에서 왔는지 남긴다', async () => {
    await userEvent.click(screen.getByRole('button', { name: new RegExp(i18n.t('license.buy')) }))
    expect(window.api.licenseOpenPurchase).toHaveBeenCalledWith('locked')
  })
})

describe('LicenseGate — 활성화 IPC가 거절될 때', () => {
  it('버튼이 다시 열리고, 왜 실패했는지 말한다', async () => {
    // **이 화면에서는 그게 유일한 탈출구다.** `busy`가 참으로 굳으면
    // `canSubmit`이 영영 false가 되어, 잠긴 유료 사용자가 키를 넣어 풀 방법이
    // 사라진다 — 앱을 다시 켜는 것 말고는.
    mountWith(
      { enforced: true, allowsPaidFeatures: false, status: 'trialExpired', maskedKey: null },
      { licenseActivate: vi.fn(() => Promise.reject(new Error('Error invoking remote method'))) }
    )
    await screen.findByText(i18n.t('license.lockedTitle'))
    await userEvent.type(screen.getByLabelText(i18n.t('license.keyLabel')), 'GREENDAY-A2B3-C4D5-E6F7-G8H9')
    await userEvent.click(screen.getByRole('button', { name: i18n.t('license.activate') }))

    await screen.findByText(i18n.t('license.error.network'))
    expect(screen.getByRole('button', { name: i18n.t('license.activate') })).toBeEnabled()
  })
})

describe('LicenseGate — IPC가 이상한 값을 줄 때', () => {
  it('allowsPaidFeatures가 없으면 잠그지 않는다', async () => {
    // undefined면 `!allows`가 참이 되어 멀쩡한 유료 사용자가 잠긴다.
    // 모르면 잠그지 않는 쪽으로 기운다.
    ;(window as unknown as Record<string, unknown>).api = {
      licenseGetState: vi.fn(async () => ({ status: 'licensed', enforced: true })),
      onLicenseChanged: vi.fn(() => () => {})
    }
    render(<LicenseGate />)
    await waitFor(() => expect(window.api.licenseGetState).toHaveBeenCalled())
    expect(screen.queryByText(i18n.t('license.lockedTitle'))).not.toBeInTheDocument()
  })

  it('모르는 상태 이름이 오면 잠그지 않는다', async () => {
    ;(window as unknown as Record<string, unknown>).api = {
      licenseGetState: vi.fn(async () => ({ status: 'somethingNew', enforced: true, allowsPaidFeatures: false })),
      onLicenseChanged: vi.fn(() => () => {})
    }
    render(<LicenseGate />)
    await waitFor(() => expect(window.api.licenseGetState).toHaveBeenCalled())
    expect(screen.queryByText(i18n.t('license.lockedTitle'))).not.toBeInTheDocument()
  })
})

describe('LicenseGate — 왜 잠겼는지', () => {
  it('취소된 키에는 제목이 "체험 기간이 끝났습니다"가 아니다', async () => {
    // 이 화면에서 확실히 읽히는 줄은 제목이다. 돈을 낸 사람에게 구매를 권하면
    // 같은 것을 두 번 사게 만든다.
    mountWith({
      enforced: true,
      allowsPaidFeatures: false,
      status: 'trialExpired',
      maskedKey: null,
      blockedReason: 'revoked'
    })
    await screen.findByText(i18n.t('license.error.revoked'))
    expect(screen.queryByText(i18n.t('license.lockedTitle'))).not.toBeInTheDocument()
  })

  it('이유가 없으면 원래 제목이다 — 위 단언이 공짜로 참이 아니다', async () => {
    mountWith({ enforced: true, allowsPaidFeatures: false, status: 'trialExpired', maskedKey: null })
    await screen.findByText(i18n.t('license.lockedTitle'))
  })
})
