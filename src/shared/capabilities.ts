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
  /**
   * **빌드 시점에** 개발 빌드였는가. `isDev`(런타임 `app.isPackaged`)와 다르다.
   *
   * 잠금 판정에는 이쪽만 쓴다. 런타임 탐지로 잠금을 끄면 출하한 asar를 맨
   * Electron으로 여는 것만으로 enforcement가 사라지고, 그건 앱의 JS를 고치는
   * 것보다 싼 우회다.
   */
  isDevBuild: boolean
  /** Mac App Store(샌드박스) 빌드인가. Electron의 `process.mas`. */
  isMas: boolean
  /** Microsoft Store(AppX) 빌드인가. Electron의 `process.windowsStore`. */
  isWindowsStore: boolean
  /**
   * 옛 번들 ID(com.haru.app)로 나가는 **브리지 릴리스**인가. `BRIDGE_BUILD=1`로
   * 빌드할 때 주입된다(electron.vite.config.ts). 없으면 false.
   */
  isBridgeBuild?: boolean
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

  /**
   * 이 빌드가 실제로 **잠그는가**.
   *
   * `needsLicenseKey`와 갈라 둔다. 그쪽은 "키 입력을 그려도 되는가"이고 개발
   * 빌드에서 참이다(개발 중에도 그 화면을 봐야 한다). 한 술어에 두 질문을
   * 맡기면 enforcement를 켜는 날 `npm run dev`가 진짜 트라이얼을 시작하고
   * 30일 뒤 개발 환경이 스스로 잠긴다 — 넣을 키도 없이.
   */
  enforcesLicense: boolean

  /** 업데이트 UI 대신 "스토어를 통해 업데이트됩니다" 안내를 보여야 하는가. */
  updatesViaStore: boolean

  /**
   * 옛 번들 ID로 나가는 마지막 릴리스인가. 이 빌드는 자체 업데이트를 하지 않고
   * (다음 버전은 다른 앱이다 — 업데이터가 설치해도 번들 ID가 달라 제자리에 앉지 못한다)
   * 대신 새 앱으로 옮겨가라는 안내를 띄운다.
   */
  isBridge: boolean

  /**
   * 옛 haru 설치의 데이터를 **이어받는** 빌드인가 — "옛 앱은 지워도 됩니다" 안내를
   * 해도 되는가의 답이다.
   *
   * 직접 배포판은 옛 앱과 같은 userData(`~/Library/Application Support/ticktick`)를
   * 보므로 이어받는다. MAS 판은 샌드박스 컨테이너라 그 폴더를 **아예 못 읽는다** —
   * 신규 사용자용이다(docs/explanation-번들-ID-마이그레이션.md). 그런데 컨테이너에는
   * 자기 데이터가 쌓이므로 무결성 검사는 'ok' 가 되고, `/Applications/haru.app` 이
   * 눈에 띄면 배너가 **자기가 만든** 데이터를 두고 "haru 데이터를 정상적으로 읽었다"고
   * 말한다. 그 말을 믿은 사용자는 옛 데이터를 열 수 있던 유일한 앱을 지운다.
   */
  inheritsLegacyData: boolean
}

export function capabilitiesFor(facts: PlatformFacts): Capabilities {
  const isStoreBuild = facts.isMas || facts.isWindowsStore
  const isBridge = facts.isBridgeBuild === true

  return {
    // 브리지는 종점이다. 업데이터가 새 앱(다른 번들 ID)을 받아 덮어쓰면 macOS가 다른
    // 앱으로 보는 파일이 옛 자리에 앉는다 — 안내 화면으로만 옮긴다.
    canSelfUpdate: !facts.isDev && !isStoreBuild && !isBridge,
    hasGlobalShortcuts: !facts.isMas,
    needsLicenseKey: !isStoreBuild,
    enforcesLicense: !facts.isDevBuild && !isStoreBuild,
    updatesViaStore: isStoreBuild,
    isBridge,
    // Windows Store 는 해당 없다 — 옛 haru 는 macOS 전용이었고, 제약은 MAS 샌드박스만의 것이다.
    inheritsLegacyData: !facts.isMas
  }
}
