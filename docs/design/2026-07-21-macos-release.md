# haru macOS 정식 출시 (직접 다운로드 + Mac App Store) — 설계

- **상태:** 승인 (설계 단계)
- **작성일:** 2026-07-21
- **관련:** `TODOS.md` → [P2] 클릭 div 접근성, Follow-up(LLM 한국어 출력), `electron-builder.yml`, `src/main/index.ts`(updater)

## 문제

haru는 현재 v1.4.1의 로컬 전용 macOS(Electron) 앱이다. 데이터는 `userData`의
단일 JSON 파일 하나에 저장되고, 백엔드·인증·동기화는 없다. 목표는 이 앱을
**공개 배포 가능한 정식 릴리스(v2.0.0)** 로 완성하는 것이다. 배포 채널은 둘:

1. **직접 다운로드** — 웹사이트에서 DMG 내려받기. Developer ID 서명 + Apple
   공증 + electron-updater 자동 업데이트.
2. **Mac App Store(MAS)** — App Store 설치. 앱 샌드박스 + MAS 서명, 자체
   업데이트 없음(스토어가 담당).

공개 + 심사 배포이므로, 릴리스 준비와 함께 **보안·성능·유지보수·기능 완성도
감사**를 함께 수행한다.

## 목표

- macOS 앱을 서명·공증된 DMG로 웹에서 직접 배포할 수 있게 한다.
- 동일 앱을 App Store 심사에 제출할 수 있는 MAS 빌드로도 만든다.
- 두 채널의 빌드/서명/업데이트 차이를 **설정과 단일 런타임 분기**로 처리하고,
  기능 코드는 공유한다.
- 릴리스 전 코드 감사(보안 하드닝 + 성능 + 유지보수 + 완성도)를 수행하고,
  릴리스 필수 항목은 이번에 수정한다.
- `tsc --build` / `biome lint` / `vitest run` 그린 상태로 릴리스한다.

## 비목표 (이번 사이클에서 안 함 — 다음 단계로 명시적 보류)

- **iOS 앱 / 아이폰 지원.** 사용자와 논의 결과, 아이폰은 네이티브 SwiftUI로
  별도 개발하기로 했으나 이번 스코프에서 제외. (Electron은 iOS 불가.)
- **웹앱 / 브라우저 클라이언트.** 랜딩 페이지는 만들되, 앱 자체의 웹 버전은
  범위 밖.
- **다기기 동기화 / 백엔드(인증·DB).** 아이폰·웹이 생길 때 함께 설계.
- **기능 신규 개발.** 감사 E4는 "미완/엣지케이스 정리"이지 새 기능 추가가
  아니다. 대규모 리팩토링(E2·E3)은 리포트 후 사용자와 "지금 vs 보류" 판단.

## 결정 사항 (확정)

| 항목 | 결정 |
|---|---|
| 이번 스코프 | macOS 전용 (iOS/웹/동기화 보류) |
| 배포 채널 | 직접 다운로드 **+** Mac App Store (둘 다) |
| 버전 | **2.0.0** (첫 정식 공개, 메이저 승격) |
| 랜딩 페이지 | **GitHub Pages 정적 1장** (스크린샷 + 다운로드 + 특징) |
| 감사 범위 | **전체(E1~E4)** — 보안·기능·컴플라이언스는 지금 수정, 성능·리팩토링은 리포트 후 판단 |

## 현재 상태 (재사용 자산)

- `electron-builder.yml`: `appId: com.haru.app`, `productName: haru`, mac
  `dmg`+`zip` 타깃, GitHub 배포(`supaicy/haru`), `entitlementsInherit`,
  category productivity.
- `src/main/index.ts`: **electron-updater 완전 배선** — 시작 시 + 1시간 간격
  `checkForUpdates`, `update-available`/`download-progress`/
  `update-downloaded` 이벤트, `download-update`/`install-update` IPC.
- `resources/`: `icon.icns`, `icon.png`, `entitlements.mac.plist`(현재
  `allow-jit`만).
- 보안 기본기: `sandbox: true` + `contextIsolation: true`, preload는
  contextBridge/`ipcRenderer.invoke`만 노출, `index.html`에 CSP,
  `ai-service.ts`의 `isAllowedUrl`(http/https 검증) + API 키 마스킹,
  `open-external`/`setWindowOpenHandler`로 외부 링크 통제.

## 설계

작업을 A~E로 나눈다. 순서는
**A → E1 → B → C → E2·E3·E4 → D**.

### A. 코드 헬스 마무리

1. **[P2] 클릭 가능 div 접근성 (~50 biome 에러).** `<div onClick>`을
   (a) 가능하면 `<button type="button">`으로, (b) 불가하면
   `role="button" + tabIndex={0} + onKeyDown`(Enter/Space) 추가. 최대 사용처
   `Sidebar.tsx`, `Settings.tsx`, `HabitTracker.tsx`. **파일별 수동 판단**
   (자동화 위험). 목표: `biome lint` 그린.
2. **LLM 한국어 출력 강제.** `ai-service.ts` 시스템 프롬프트에 "한국어로만
   답하라" 가드를 추가해 3B 모델의 언어 혼용을 완화.

### E1. 보안 하드닝 (릴리스 필수)

스캔에서 확인한 손볼 지점을 처리한다. 기본기는 이미 양호하므로 하드닝 성격.

1. **API 키 저장.** 현재 `ai-config.json` 평문 저장 → Electron
   `safeStorage`(macOS Keychain 백엔드)로 암호화 저장. 복호화 실패/미지원 시
   graceful 폴백. 마스킹 표시 로직은 유지.
2. **IPC 입력 검증.** `create-task`/`update-task`/`ai:set-config` 등
   `unknown`·`Record<string,unknown>`을 DB로 그대로 넘기는 핸들러에 최소
   런타임 검증(필수 필드·타입·화이트리스트 키)을 추가. 잘못된 페이로드는
   조용히 무시하지 말고 거부.
3. **SSRF 명시.** `isAllowedUrl`은 로컬/사설 IP를 막지 않는다(Ollama
   localhost 및 임의 OpenAI 호환 엔드포인트 허용이 **설계 의도**). 이 의도를
   코드 주석 + 설정 UI 문구로 명시하고, 그 외 스킴/자격증명 URL은 계속 차단.
4. **Electron/CSP 재점검.** `index.html` CSP가 개발/프로덕션 모두에서 인라인
   스크립트·원격 로드를 적절히 제한하는지 확인, `webSecurity` 유지, MAS
   샌드박스와 정합.

### B. 직접 다운로드 채널 (Developer ID + 공증)

1. `electron-builder.yml`의 `mac`에 추가: `hardenedRuntime: true`,
   `gatekeeperAssess: false`, `notarize: true`, `entitlements:
   resources/entitlements.mac.plist`.
2. `entitlements.mac.plist` 확장(하드닝 런타임용):
   `com.apple.security.cs.allow-jit`(유지),
   `com.apple.security.cs.allow-unsigned-executable-memory`(Electron/V8),
   `com.apple.security.network.client`(AI 호출). 필요 시
   `com.apple.security.cs.disable-library-validation`.
3. 서명·공증 자격은 **환경변수**로 주입(코드/저장소에 넣지 않음):
   `CSC_LINK`/`CSC_KEY_PASSWORD`(Developer ID Application),
   `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`(notarytool 공증).
4. GitHub Releases 발행은 기존 `publish` 설정 사용(`GH_TOKEN` 필요).
5. `dev-app-update.yml` 추가(로컬 업데이트 테스트용).

### C. Mac App Store 채널 (샌드박스 + MAS)

1. `electron-builder.yml`에 `mas` 설정 블록 + 타깃 추가.
2. **MAS 전용 entitlements 신규:**
   - `resources/entitlements.mas.plist`: `com.apple.security.app-sandbox`
     `true`, `com.apple.security.network.client` `true`,
     `com.apple.security.files.user-selected.read-write` `true`.
   - `resources/entitlements.mas.inherit.plist`: 상속 + 샌드박스(자식
     프로세스용).
   - 필요 시 `entitlements.mas.loginhelper.plist`.
3. **electron-updater를 MAS 빌드에서 무력화(유일한 소스 분기).**
   `src/main/index.ts`에서 `if (process.mas === true) return` 가드로 updater
   배선을 전체 스킵. (Electron이 MAS 빌드에 `process.mas`를 설정.) App
   Store는 자체 업데이트를 금지하므로 필수.
4. **샌드박스 영향 점검:**
   - `userData` JSON·`attachments`는 앱 컨테이너 내부라 문제 없음.
   - AI/Ollama 아웃바운드 → `network.client`로 커버(localhost 포함).
   - 첨부 가져오기(`pick-attachment`)·내보내기(`export-data`)는 표준
     open/save 패널 경유이므로 `files.user-selected.read-write`로 허용.
   - 컨테이너 밖 절대경로 직접 접근이 없는지 확인.
5. MAS 서명 자격(환경/키체인): "Apple Distribution", "3rd Party Mac Developer
   Installer", `.provisionprofile`.

### E2. 성능 · E3. 유지보수 · E4. 기능 완성도 (리포트 우선)

먼저 감사 리포트를 만들어 사용자와 "지금 vs 보류"를 판단한 뒤 착수한다.

- **E2 성능:** 매 변경마다 전체 JSON 재직렬화(`database.ts` `save()`,
  300ms 디바운스)의 대량 데이터 영향, 대형 태스크 리스트 렌더링(가상화
  필요성), Zustand 셀렉터/리렌더.
- **E3 유지보수:** `useStore.ts`(844줄) 도메인별 슬라이스 분리,
  `database.ts`의 `Record<string,unknown>` → 타입드 모델, 테스트 커버리지
  보강(현재 database/ai-service/trim만).
- **E4 완성도:** 미완 기능·엣지케이스 스윕(예: 반복 태스크, 리마인더 알림
  경로, 첨부 정합성).

### D. 릴리스 부속물

1. **버전 2.0.0.** `package.json` bump + `CHANGELOG.md` 항목.
2. **랜딩 페이지.** GitHub Pages 정적 1장(`docs/` 또는 `gh-pages`): 히어로,
   스크린샷, 다운로드 버튼(Releases 최신 DMG), 특징표. README 배지와 정합.
3. **릴리스 아티팩트 확인.** `electron-vite build` + `electron-builder`로
   DMG/zip(직접) 및 MAS pkg 로컬 생성까지 확인(실서명은 자격 필요).

## 빌드 분기 요약

| | 직접 다운로드 | Mac App Store |
|---|---|---|
| 타깃 | `dmg`, `zip` | `mas`(pkg) |
| 격리 | Hardened Runtime | App Sandbox |
| entitlements | `entitlements.mac.plist` | `entitlements.mas*.plist` |
| 서명 | Developer ID Application | Apple Distribution + 3rd Party Installer |
| 공증 | notarytool 필요 | 불필요(심사) |
| 자동 업데이트 | electron-updater | **비활성**(`process.mas` 가드) |

## 검증

- 각 단계 후 `tsc --build` / `biome lint src electron.vite.config.ts` /
  `vitest run` 그린.
- `electron-vite build` 성공 + `electron-builder`로 로컬 아티팩트 생성 확인.
- 로컬 실행 스모크: 앱 구동, 태스크 CRUD, AI 설정, 업데이트 경로(직접
  빌드에서만), MAS 빌드는 `process.mas` 가드로 updater 미배선 확인.

## 사용자가 직접 할 일 (최종 체크리스트는 릴리스 시점에 별도 정리)

- **Apple Developer Program** 가입($99/년) — 공증·App Store 공통 필수.
- 인증서: **Developer ID Application**(직접), **Apple Distribution** + **3rd
  Party Mac Developer Installer**(MAS).
- **App-specific password 또는 App Store Connect API 키**(공증).
- **App Store Connect**에서 앱 레코드 생성(`com.haru.app`) + 프로비저닝
  프로파일.
- **Team ID**, GitHub 릴리스 토큰(`GH_TOKEN`), GitHub Pages 활성화.
- 시크릿: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`,
  `CSC_LINK`, `CSC_KEY_PASSWORD`, `GH_TOKEN`.

## 엣지 케이스 / 리스크

- **MAS 샌드박스 회귀:** 샌드박스에서 파일/네트워크 접근이 막혀 기능이 조용히
  실패할 수 있음 → E1·C에서 entitlements 정합 확인, 로컬 MAS 빌드 스모크.
- **safeStorage 미가용:** 일부 환경에서 Keychain 백엔드 부재 → 폴백 경로 필요.
- **공증 지연:** notarytool 큐 대기 → 빌드 파이프라인에서 타임아웃 여유.
- **네트워크 불안정:** 의존성 설치가 타임아웃 다발(현재 관측) → 낮은 동시성 +
  긴 타임아웃으로 재개.

## 수정/생성 파일 목록 (예상)

- `electron-builder.yml` — mac 하드닝/공증, mas 블록.
- `resources/entitlements.mac.plist` — 확장.
- `resources/entitlements.mas.plist`, `entitlements.mas.inherit.plist` — 신규.
- `src/main/index.ts` — `process.mas` updater 가드.
- `src/main/ai-service.ts` — safeStorage 키 저장, 한국어 프롬프트, SSRF 주석.
- `src/main/ipc-handlers.ts` — IPC 입력 검증.
- `src/renderer/src/components/**` — a11y 수정(Sidebar/Settings/HabitTracker 등).
- `package.json` — 버전 2.0.0.
- `CHANGELOG.md`, `dev-app-update.yml`, 랜딩 페이지 파일 — 신규.
- (E2·E3 착수 시) `src/renderer/src/store/**`, `src/main/database.ts`.
