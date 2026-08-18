/**
 * 이 빌드가 무엇을 할 수 있는가 — 단일 출처.
 *
 * 전에는 "MAS 빌드는 자체 업데이트를 하지 않는다" 같은 규칙이 세 파일에 각각
 * `if (process.mas)` 로 하드코딩돼 있었다(index.ts 업데이터·업데이트 IPC 2곳,
 * ipc-handlers.ts 전역 단축키, Settings.tsx 화면 분기). 규칙이 어디에도 적혀 있지 않아서
 * "MAS에서 뭐가 꺼지는가"를 알려면 네 파일을 읽어야 했다.
 *
 * Windows(웹사이트 직접 판매 + 오프라인 라이선스 키)를 얹으면 판정 축이 5개가 되고
 * 분기 자리는 12곳쯤 된다. 그래서 얹기 전에 여기로 모았다.
 *
 * main 프로세스가 사실(facts)을 모아 넘기고, 렌더러는 `app:capabilities` IPC로 결과만
 * 받는다. 이 파일은 shared라 electron을 import하지 않는다 — 그래서 테스트가 싸다.
 */

export interface PlatformFacts {
  /** electron-vite 개발 서버로 띄운 상태인가. */
  isDev: boolean
  /** Mac App Store(샌드박스) 빌드인가. Electron의 `process.mas`. */
  isMas: boolean
  /** Microsoft Store(AppX) 빌드인가. Electron의 `process.windowsStore`. */
  isWindowsStore: boolean
}

export interface Capabilities {
  /**
   * 앱이 스스로 업데이트를 확인·다운로드·설치하는가.
   * 스토어 빌드는 스토어가 담당하므로 꺼야 한다(정책 위반 + 샌드박스에서 실패).
   * 개발 중에도 끈다 — 개발 빌드가 릴리스로 자기를 덮어쓰면 곤란하다.
   */
  canSelfUpdate: boolean

  /**
   * 앱 외부에서 전역 단축키(Cmd/Ctrl+Shift+A)를 잡을 수 있는가.
   * MAS 샌드박스에서는 등록이 조용히 실패하므로 아예 시도하지 않는다.
   */
  hasGlobalShortcuts: boolean

  /**
   * 설정에 라이선스 키 입력 칸을 보여야 하는가.
   *
   * 웹사이트에서 직접 판매하는 빌드만 true다. **스토어 빌드에 이 UI가 있으면
   * 심사에서 거절된다** — Apple 가이드라인 3.1.1은 앱 안에서 외부 결제로 유도하는
   * 것을 금지한다. 그래서 규칙을 문서가 아니라 여기 코드로 두고 테스트로 고정한다.
   *
   * 기준은 플랫폼이 아니라 **판매 채널**이다. 한동안 `platform === 'win32'`로
   * 적혀 있었는데 그건 "맥은 App Store로만 판다"는 옛 계획을 플랫폼으로 근사한
   * 것이었고, macOS를 직접 다운로드로 팔기 시작한 순간 Mac 구매자에게 키를 넣을
   * 곳이 사라지는 버그가 됐다.
   */
  needsLicenseKey: boolean

  /** 업데이트 UI 대신 "스토어를 통해 업데이트됩니다" 안내를 보여야 하는가. */
  updatesViaStore: boolean
}

export function capabilitiesFor(facts: PlatformFacts): Capabilities {
  const isStoreBuild = facts.isMas || facts.isWindowsStore

  return {
    canSelfUpdate: !facts.isDev && !isStoreBuild,
    hasGlobalShortcuts: !facts.isMas,
    needsLicenseKey: !isStoreBuild,
    updatesViaStore: isStoreBuild
  }
}
