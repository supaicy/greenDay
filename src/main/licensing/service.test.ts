import { describe, it, expect, vi } from 'vitest'

/**
 * `service.ts`는 얇은 어댑터지만, 여기 있는 두 값이 틀리면 출시 당일에 드러난다:
 * 출하 스위치와 "어떤 빌드가 잠그는가".
 */

let mas = false
let windowsStore = false
let hostname = 'mac-1'
let hostnameReads = 0

vi.mock('node:os', () => ({
  hostname: () => {
    hostnameReads += 1
    return hostname
  }
}))

/** 방송을 실제로 받아 보는 가짜 창. 창이 없으면 첫 방송이 무엇인지 볼 수 없다. */
const sent: { channel: string; payload: unknown }[] = []
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/greenday-service-test' },
  BrowserWindow: {
    getAllWindows: () => [
      { webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) } }
    ]
  }
}))

vi.mock('../capabilities', async () => {
  const { capabilitiesFor } = await import('../../shared/capabilities')
  return {
    currentCapabilities: () => capabilitiesFor({ isDev: false, isMas: mas, isWindowsStore: windowsStore })
  }
})

const { IS_ENFORCED, publicLicenseState, licensing, initLicensing, disposeLicensing } = await import('./service')

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
    for (const build of [
      { mas: true, store: false },
      { mas: false, store: true }
    ]) {
      mas = build.mas
      windowsStore = build.store
      expect(publicLicenseState().enforced).toBe(false)
    }
    mas = false
    windowsStore = false
  })
})

describe('기기 이름 캐시', () => {
  // 이 캐시는 성능이 아니라 **정직함**을 위한 것이다. 화면에 "이 이름이 서버로
  // 갑니다"라고 적어 두고 실제로는 다른 값을 보내면 그 고지가 거짓말이 된다.
  // 그런데 통째로 시험되지 않고 있었다 — dispose에서 `undefined` 대신 `null`을
  // 쓰는 것, 캐시 검사 자체를 지우는 것, 빈 문자열 정규화를 지우는 것이
  // 전부 테스트를 통과했다.
  /** 기기 이름은 매니저가 있을 때만 화면으로 나간다 — 그래서 매번 새로 세운다. */
  const boot = (host: string): void => {
    disposeLicensing()
    hostname = host
    initLicensing()
  }

  it('한 번만 읽는다 — 고지한 값과 보내는 값이 같아야 한다', () => {
    boot('mac-1')
    expect(publicLicenseState().deviceName).toBe('mac-1')
    const after = hostnameReads
    publicLicenseState()
    publicLicenseState()
    expect(hostnameReads).toBe(after)
  })

  it('dispose가 캐시를 비운다 — `null`을 쓰면 영영 null이 된다', () => {
    boot('mac-1')
    expect(publicLicenseState().deviceName).toBe('mac-1')
    boot('mac-2')
    expect(publicLicenseState().deviceName).toBe('mac-2')
  })

  it('빈 호스트네임은 null이다 — 화면에 빈 <code>가 뜨지 않게', () => {
    boot('')
    expect(publicLicenseState().deviceName).toBeNull()
    disposeLicensing()
  })
})

describe('첫 방송', () => {
  it('매니저가 대입된 뒤에 나간다 — 아니면 정반대 값이 나간다', () => {
    // `createLicenseManager`는 돌려주기 전에 `settle()`을 돈다. 그때 상태가
    // 움직이면 `onChange`가 불리는데, 그 시점에 `manager`는 아직 null이라
    // `publicLicenseState()`가 `UNKNOWN_LICENSE_STATE`(잠그지 않음, deviceName
    // null)를 내보낸다. 앱이 내보내는 **첫 방송이 정반대 값**이 되는 것이다.
    // 오늘 무해한 이유는 창이 아직 구독하지 않았다는 순서 하나뿐이다.
    disposeLicensing()
    hostname = 'mac-broadcast'
    sent.length = 0
    initLicensing()

    const changes = sent.filter((s) => s.channel === 'license:changed')
    expect(changes.length, '첫 방송이 아예 없다').toBeGreaterThan(0)
    // UNKNOWN_LICENSE_STATE는 deviceName이 null이다. 진짜 상태는 호스트네임을 싣는다.
    expect((changes[0].payload as { deviceName: string | null }).deviceName).toBe('mac-broadcast')
    disposeLicensing()
  })
})
