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
  isDevBuild: false,
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

  // 브리지(옛 번들 ID의 마지막 버전)는 종점이다. 업데이터가 새 앱을 받아 덮어쓰면
  // 번들 ID가 다른 파일이 옛 자리에 앉는다 — 안내로만 옮긴다.
  it('is off for the bridge release', () => {
    const caps = capabilitiesFor(facts({ isBridgeBuild: true }))
    expect(caps.canSelfUpdate).toBe(false)
    expect(caps.isBridge).toBe(true)
    expect(capabilitiesFor(facts()).isBridge).toBe(false)
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

describe('enforcesLicense — 잠그는가', () => {
  it('개발 빌드는 키 입력을 보여 주지만 잠그지는 않는다', () => {
    // 두 질문이다. 한 술어에 맡기면 enforcement를 켜는 날 `npm run dev`가
    // 진짜 트라이얼을 시작하고 30일 뒤 개발 환경이 스스로 잠긴다 — 넣을 키도 없이.
    const dev = capabilitiesFor(facts({ isDevBuild: true, isDev: true }))
    expect(dev.needsLicenseKey).toBe(true)
    expect(dev.enforcesLicense).toBe(false)
  })

  it('**런타임 `isDev`로는 잠금이 풀리지 않는다** — 빌드 시점 값만 본다', () => {
    // `is.dev`는 `!app.isPackaged`라, 출하한 asar를 맨 Electron으로 열면 참이 된다.
    // 그걸로 잠금을 끄면 앱의 JS를 고치는 것보다 싼 우회가 생긴다 — 이 설계가
    // 넘지 않기로 한 선이다. 출하 빌드는 실행 방식과 무관하게 잠근다.
    const shippedButUnpackaged = capabilitiesFor(facts({ isDev: true, isDevBuild: false }))
    expect(shippedButUnpackaged.enforcesLicense).toBe(true)
  })

  it('직판 출하 빌드는 잠근다', () => {
    const shipped = capabilitiesFor(facts({}))
    expect(shipped.enforcesLicense).toBe(true)
  })

  it('스토어 빌드는 키도 안 받고 잠그지도 않는다 — Apple 3.1.1', () => {
    for (const store of [facts({ isMas: true }), facts({ isWindowsStore: true })]) {
      const c = capabilitiesFor(store)
      expect(c.needsLicenseKey).toBe(false)
      expect(c.enforcesLicense).toBe(false)
    }
  })
})

describe('inheritsLegacyData', () => {
  // MAS 는 샌드박스 컨테이너라 옛 userData 를 아예 못 읽는다. 그런데 컨테이너에는
  // 자기 데이터가 쌓여 무결성 검사가 'ok' 가 되므로, 이 술어가 없으면 마이그레이션
  // 배너가 "haru 데이터를 정상적으로 읽었다 — 지워도 된다"를 거짓으로 말한다.
  it('is off under the MAS sandbox', () => {
    expect(capabilitiesFor(facts({ isMas: true })).inheritsLegacyData).toBe(false)
  })

  // 직접 배포판은 옛 앱과 같은 userData 를 본다 — 여기가 실제 이전 경로다.
  it('is on for a direct-download build', () => {
    expect(capabilitiesFor(facts()).inheritsLegacyData).toBe(true)
    expect(capabilitiesFor(facts({ isDev: true })).inheritsLegacyData).toBe(true)
  })

  // 옛 haru 는 macOS 전용이었다 — Microsoft Store 와는 무관한 제약이다.
  it('is unrelated to the Microsoft Store', () => {
    expect(capabilitiesFor(facts({ isWindowsStore: true })).inheritsLegacyData).toBe(true)
  })
})
