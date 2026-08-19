import { describe, it, expect, vi } from 'vitest'

/**
 * `service.ts`는 얇은 어댑터지만, 여기 있는 두 값이 틀리면 출시 당일에 드러난다:
 * 출하 스위치와 "어떤 빌드가 잠그는가".
 */

let mas = false
let windowsStore = false

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/greenday-service-test' },
  BrowserWindow: { getAllWindows: () => [] }
}))

vi.mock('../capabilities', async () => {
  const { capabilitiesFor } = await import('../../shared/capabilities')
  return {
    currentCapabilities: () =>
      capabilitiesFor({ isDev: false, isMas: mas, isWindowsStore: windowsStore })
  }
})

const { IS_ENFORCED, publicLicenseState, licensing, disposeLicensing } = await import('./service')

describe('출하 스위치', () => {
  it('enforcement가 꺼진 채로 나간다', () => {
    // 켜진 채로 나가면 출시 당일 전원이 잠긴다. 켜는 것은 의도적인 커밋이어야 한다.
    expect(IS_ENFORCED).toBe(false)
  })
})

describe('publicLicenseState', () => {
  it('초기화 전이면 아무도 잠그지 않는다', () => {
    // 우리 실수로 돈 낸 사람을 막는 것보다, 못 막는 편이 낫다.
    disposeLicensing()
    expect(licensing()).toBeNull()
    expect(publicLicenseState()).toEqual({
      status: 'unlicensed',
      untilMs: null,
      allowsPaidFeatures: true,
      enforced: false,
      maskedKey: null,
      deviceName: null
    })
  })

  it('스토어 빌드는 enforcement를 보고하지 않는다', () => {
    // 켜지면 Apple로 결제한 사람이 우리 키가 없다는 이유로 잠기고, 잠금 화면에
    // 외부 구매 링크가 뜬다 — 가이드라인 3.1.1 위반이다.
    for (const build of [{ mas: true, store: false }, { mas: false, store: true }]) {
      mas = build.mas
      windowsStore = build.store
      expect(publicLicenseState().enforced).toBe(false)
    }
    mas = false
    windowsStore = false
  })
})
