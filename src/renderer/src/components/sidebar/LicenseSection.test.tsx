// @vitest-environment jsdom

/**
 * 설정의 라이선스 칸. **기기 해제 버튼이 이 화면의 존재 이유 절반**인데
 * 테스트가 하나도 없었다.
 *
 * 여기서 틀리면 조용하다: 상태 문구가 어긋나도 화면은 그려지고, 해제 버튼이
 * 안 보여도 오류는 안 난다. 기기 한도에 걸린 사람만 벽을 만난다.
 */

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { LicenseSection } from './LicenseSection'
import type { PublicLicenseState } from '../../../../shared/license'

beforeAll(async () => {
  await i18n.changeLanguage('ko')
})
afterEach(() => cleanup())

const DAY = 86_400_000
const MASKED = 'GREENDAY-••••-••••-••••-G8H9'

// 스타일 prop 묶음은 이 화면의 관례다(CalendarSyncSection과 같은 7개).
const style = {
  isDark: false,
  focusRing: '',
  fieldSurface: '',
  labelText: '',
  hintText: '',
  successText: '',
  errorText: ''
}

const BASE: PublicLicenseState = {
  status: 'unlicensed',
  untilMs: null,
  allowsPaidFeatures: true,
  enforced: false,
  maskedKey: null,
  deviceName: 'supaicy의 MacBook'
}

function mountWith(state: Partial<PublicLicenseState>, api: Record<string, unknown> = {}): void {
  ;(window as unknown as Record<string, unknown>).api = {
    licenseGetState: vi.fn(async () => ({ ...BASE, ...state })),
    licenseActivate: vi.fn(async () => null),
    licenseDeactivate: vi.fn(async () => null),
    licenseOpenPurchase: vi.fn(),
    licenseOpenRecover: vi.fn(),
    onLicenseChanged: vi.fn(() => () => {}),
    ...api
  }
  render(<LicenseSection {...style} />)
}

describe('상태 문구', () => {
  it('enforcement 전에는 없는 마감을 만들어내지 않는다', async () => {
    // 아직 아무것도 타들어가지 않는데 "n일 남음"이라고 쓰면 거짓말이다.
    mountWith({ enforced: false, status: 'unlicensed' })
    await screen.findByText(i18n.t('license.free'))
    expect(screen.queryByText(/체험판/)).not.toBeInTheDocument()
  })

  it('마지막 날은 "0일 남음"이 아니라 전용 문구다', async () => {
    mountWith({ enforced: true, status: 'trial', untilMs: Date.now() + DAY - 60_000 })
    await screen.findByText(i18n.t('license.trialLastDay'))
  })

  it('남은 날짜를 그대로 보여 준다', async () => {
    mountWith({ enforced: true, status: 'trial', untilMs: Date.now() + 12 * DAY + 1000 })
    await screen.findByText(i18n.t('license.trial', { days: 12 }))
  })

  it('유예 중이면 인터넷 연결을 안내한다', async () => {
    mountWith({ enforced: true, status: 'grace', untilMs: Date.now() + 3 * DAY + 1000 })
    await screen.findByText(i18n.t('license.grace', { days: 3 }))
  })
})

describe('키 입력과 해제', () => {
  it('활성화되면 키 칸을 감추고 해제 버튼을 준다', async () => {
    mountWith({ enforced: true, status: 'licensed', maskedKey: MASKED })
    await screen.findByText(i18n.t('license.licensed'))
    expect(screen.queryByLabelText(i18n.t('license.keyLabel'))).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: new RegExp(i18n.t('license.deactivate')) })).toBeInTheDocument()
    expect(screen.getByText(MASKED)).toBeInTheDocument()
  })

  it('키가 없으면 해제 버튼도 없다', async () => {
    mountWith({ enforced: true, status: 'trialExpired', maskedKey: null })
    await screen.findByText(i18n.t('license.trialExpired'))
    expect(screen.queryByRole('button', { name: new RegExp(i18n.t('license.deactivate')) })).not.toBeInTheDocument()
  })

  it('해제 실패는 코드에 맞는 문구로 보인다', async () => {
    // 기기를 너무 자주 옮긴 경우다. "다시 시도"로 뭉뚱그리면 사용자는 될 때까지
    // 누르는데, 그건 사람이 풀어줘야 하는 상황이다.
    mountWith(
      { enforced: true, status: 'licensed', maskedKey: MASKED },
      { licenseDeactivate: vi.fn(async () => 'deactivationLimit') }
    )
    await screen.findByText(i18n.t('license.licensed'))
    await userEvent.click(screen.getByRole('button', { name: new RegExp(i18n.t('license.deactivate')) }))
    await screen.findByText(i18n.t('license.error.deactivationLimit'))
  })

  it('활성화 실패 문구도 코드별로 다르다', async () => {
    mountWith({ enforced: true, status: 'trialExpired' }, { licenseActivate: vi.fn(async () => 'deviceLimit') })
    await screen.findByLabelText(i18n.t('license.keyLabel'))
    await userEvent.type(screen.getByLabelText(i18n.t('license.keyLabel')), 'GREENDAY-A2B3-C4D5-E6F7-G8H9')
    await userEvent.click(screen.getByRole('button', { name: i18n.t('license.activate') }))
    await screen.findByText(i18n.t('license.error.deviceLimit'))
  })
})

describe('사용자에게 숨기지 않는 것', () => {
  it('서버로 가는 기기 이름을 활성화 전에 보여 준다', async () => {
    // 기기 목록에서 골라 해제하려면 이 값이 필요하지만, 뭐가 나가는지
    // 모르게 두지는 않는다.
    mountWith({ enforced: true, status: 'trialExpired' })
    await screen.findByText('supaicy의 MacBook')
  })

  it('이미 활성화된 뒤에는 다시 말하지 않는다', async () => {
    mountWith({ enforced: true, status: 'licensed', maskedKey: MASKED })
    await screen.findByText(i18n.t('license.licensed'))
    expect(screen.queryByText('supaicy의 MacBook')).not.toBeInTheDocument()
  })

  it('구매는 설정 화면에서 왔다고 표시된다', async () => {
    mountWith({ enforced: false })
    await screen.findByText(i18n.t('license.free'))
    await userEvent.click(screen.getByRole('button', { name: new RegExp(i18n.t('license.buy')) }))
    expect(window.api.licenseOpenPurchase).toHaveBeenCalledWith('settings')
  })

  it('키 분실 안내가 있다', async () => {
    mountWith({ enforced: true, status: 'trialExpired' })
    await waitFor(() => expect(window.api.licenseGetState).toHaveBeenCalled())
    await userEvent.click(screen.getByRole('button', { name: new RegExp(i18n.t('license.lost')) }))
    expect(window.api.licenseOpenRecover).toHaveBeenCalled()
  })
})

describe('공유된 활성화 흐름', () => {
  it('다시 입력하기 시작하면 옛 오류를 치운다', async () => {
    // 고친 것을 두고 빨간 줄이 계속 떠 있으면, 사용자는 자기가 뭘 잘못했는지
    // 모른 채 같은 키를 다시 넣는다.
    mountWith({ enforced: true, status: 'trialExpired' }, { licenseActivate: vi.fn(async () => 'unknownKey') })
    const field = await screen.findByLabelText(i18n.t('license.keyLabel'))
    await userEvent.type(field, 'GREENDAY-A2B3-C4D5-E6F7-G8H9')
    await userEvent.click(screen.getByRole('button', { name: i18n.t('license.activate') }))
    await screen.findByText(i18n.t('license.error.unknownKey'))

    await userEvent.type(field, 'X')
    expect(screen.queryByText(i18n.t('license.error.unknownKey'))).not.toBeInTheDocument()
  })

  it('해제 중에는 버튼이 잠긴다', async () => {
    let land: (v: string | null) => void = () => {}
    mountWith(
      { enforced: true, status: 'licensed', maskedKey: MASKED },
      { licenseDeactivate: vi.fn(() => new Promise((resolve) => (land = resolve))) }
    )
    await screen.findByText(i18n.t('license.licensed'))
    await userEvent.click(screen.getByRole('button', { name: new RegExp(i18n.t('license.deactivate')) }))
    expect(screen.getByRole('button', { name: new RegExp(i18n.t('license.deactivating')) })).toBeDisabled()
    land(null)
  })

  it('활성화 중에는 해제도 같이 잠긴다', async () => {
    // 두 요청이 동시에 나가면 서버 슬롯 상태와 로컬이 어긋난다. 전에는 이 이름의
    // 테스트가 **해제 버튼을 눌러** 해제가 잠기는 것만 봤다 — 이름이 말하는
    // 교차 잠금은 시험하지 않았고, 실제로 `activation.busy` 항을 지워도 통과했다.
    let land: (v: string | null) => void = () => {}
    mountWith(
      { enforced: true, status: 'trialExpired', maskedKey: MASKED },
      { licenseActivate: vi.fn(() => new Promise((resolve) => (land = resolve))) }
    )
    const field = await screen.findByLabelText(i18n.t('license.keyLabel'))
    await userEvent.type(field, 'GREENDAY-A2B3-C4D5-E6F7-G8H9')
    await userEvent.click(screen.getByRole('button', { name: i18n.t('license.activate') }))

    expect(screen.getByRole('button', { name: new RegExp(i18n.t('license.deactivate')) })).toBeDisabled()
    land(null)
  })

  it('해제 중에는 활성화도 같이 잠긴다 — 반대 방향', async () => {
    // 교차 잠금의 나머지 절반. `disabled={!canSubmit || releasing}`에서 `|| releasing`을
    // 지워도 테스트가 전부 통과했다. 그 방향이 바로 해제 응답이 지우려는 레코드
    // 위에 새 키가 내려앉는 경우다(licenseManager의 같은 이름 경합과 짝이다).
    // 키 입력과 해제 버튼이 **함께** 뜨는 상태를 쓴다 — 서버가 취소해 토큰만
    // 지워지고 키는 남은 설치(`clearLocalLicense(true)`가 남기는 그것)다.
    let land: (v: string | null) => void = () => {}
    mountWith(
      { enforced: true, status: 'trialExpired', maskedKey: MASKED },
      { licenseDeactivate: vi.fn(() => new Promise((resolve) => (land = resolve))) }
    )
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(i18n.t('license.deactivate')) }))

    const field = await screen.findByLabelText(i18n.t('license.keyLabel'))
    await userEvent.type(field, 'GREENDAY-A2B3-C4D5-E6F7-G8H9')
    expect(screen.getByRole('button', { name: i18n.t('license.activate') })).toBeDisabled()
    land(null)
  })

  it('새 시도를 시작하면 지난 결과가 사라진다', async () => {
    // `resetOutcome()`은 이번 라운드에 뽑아낸 것인데 두 호출처 중 어느 쪽을
    // 지워도 테스트가 전부 통과했다. 지우면 패널이 서로 다른 두 시도의 흔적을
    // 동시에 보여 준다 — "해제됨"과 "활성화됨"이 나란히.
    let land: (v: string | null) => void = () => {}
    mountWith(
      { enforced: true, status: 'trialExpired', maskedKey: MASKED },
      {
        licenseDeactivate: vi.fn(async () => 'network' as const),
        licenseActivate: vi.fn(() => new Promise((resolve) => (land = resolve)))
      }
    )
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(i18n.t('license.deactivate')) }))
    await screen.findByText(i18n.t('license.error.network'))

    const field = await screen.findByLabelText(i18n.t('license.keyLabel'))
    await userEvent.type(field, 'GREENDAY-A2B3-C4D5-E6F7-G8H9')
    await userEvent.click(screen.getByRole('button', { name: i18n.t('license.activate') }))
    expect(screen.queryByText(i18n.t('license.error.network'))).not.toBeInTheDocument()
    land(null)
  })
})
