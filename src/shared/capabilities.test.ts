import { describe, it, expect } from 'vitest'
import { capabilitiesFor, type PlatformFacts } from './capabilities'

/**
 * 2026-08-06 plan-eng-review에서 만든 테스트.
 *
 * 이 규칙들은 전에 네 파일에 흩어진 `if (process.mas)` 로만 존재했고 어디에도
 * 테스트가 없었다. Windows와 라이선스 게이트를 얹기 전에 여기서 고정한다.
 */

const facts = (over: Partial<PlatformFacts> = {}): PlatformFacts => ({
  isDev: false,
  isMas: false,
  isWindowsStore: false,
  ...over
})

describe('canSelfUpdate', () => {
  it('is on for a plain packaged build', () => {
    expect(capabilitiesFor(facts()).canSelfUpdate).toBe(true)
  })

  // 스토어가 업데이트를 담당한다. 자체 업데이터를 켜면 정책 위반이고
  // 샌드박스에서는 어차피 실패한다.
  it('is off for store builds', () => {
    expect(capabilitiesFor(facts({ isMas: true })).canSelfUpdate).toBe(false)
    expect(capabilitiesFor(facts({ isWindowsStore: true })).canSelfUpdate).toBe(false)
  })

  // 개발 빌드가 릴리스를 받아 자기를 덮어쓰면 곤란하다.
  it('is off in dev', () => {
    expect(capabilitiesFor(facts({ isDev: true })).canSelfUpdate).toBe(false)
  })
})

describe('hasGlobalShortcuts', () => {
  it('is off only under the MAS sandbox', () => {
    expect(capabilitiesFor(facts({ isMas: true })).hasGlobalShortcuts).toBe(false)
    expect(capabilitiesFor(facts()).hasGlobalShortcuts).toBe(true)
    // Microsoft Store는 이 제약이 없다 — MAS 샌드박스만의 문제다.
    expect(capabilitiesFor(facts({ isWindowsStore: true })).hasGlobalShortcuts).toBe(true)
  })

  // 개발 중에는 켜져 있어야 QA로 확인할 수 있다.
  it('stays on in dev', () => {
    expect(capabilitiesFor(facts({ isDev: true })).hasGlobalShortcuts).toBe(true)
  })
})

describe('needsLicenseKey', () => {
  // 판정 기준은 플랫폼이 아니라 판매 채널이다. 예전에는 `platform === 'win32'`로
  // 근사돼 있었는데, 그건 "맥은 App Store로만 판다"는 당시 계획의 흔적이었다.
  // 지금 macOS는 직접 다운로드와 Homebrew로 나가므로, 그대로 뒀으면 Mac 구매자에게
  // 키를 넣을 곳이 없었다. 이제 `PlatformFacts`에 platform 자체가 없어서,
  // 플랫폼으로 근사하는 것이 **표현 불가능**하다 — 테스트가 아니라 타입이 막는다.
  it('is on for every direct-sale build', () => {
    expect(capabilitiesFor(facts()).needsLicenseKey).toBe(true)
    expect(capabilitiesFor(facts({ isDev: true })).needsLicenseKey).toBe(true)
  })

  // 여기가 핵심이다. 스토어 빌드에 키 입력 칸이 남으면
  // Apple 가이드라인 3.1.1(외부 결제 유도) 위반으로 심사에서 거절된다.
  it('is off for every store build — a key field there is a review rejection', () => {
    expect(capabilitiesFor(facts({ isMas: true })).needsLicenseKey).toBe(false)
    expect(capabilitiesFor(facts({ isWindowsStore: true })).needsLicenseKey).toBe(false)
  })
})

describe('updatesViaStore', () => {
  it('mirrors store builds', () => {
    expect(capabilitiesFor(facts({ isMas: true })).updatesViaStore).toBe(true)
    expect(capabilitiesFor(facts({ isWindowsStore: true })).updatesViaStore).toBe(true)
    expect(capabilitiesFor(facts()).updatesViaStore).toBe(false)
  })

  // 스토어 빌드는 "스토어를 통해 업데이트" 안내를 보이고 자체 업데이트는 꺼야 한다.
  // 이 둘이 동시에 켜지면 사용자가 두 경로를 다 보게 된다.
  it('never coexists with canSelfUpdate', () => {
    for (const f of [facts(), facts({ isMas: true }), facts({ isDev: true }), facts({ isWindowsStore: true })]) {
      const c = capabilitiesFor(f)
      expect(c.updatesViaStore && c.canSelfUpdate).toBe(false)
    }
  })
})
