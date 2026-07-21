# Dual-channel Packaging (Plan 2) — 구현 계획

> 실행: 컨트롤러 인라인 편집(설정 저작) + 로컬 미서명 빌드 검증 + 리뷰 서브에이전트. 설계 근거: `docs/design/2026-07-21-macos-release.md` §B, §C.

**Goal:** haru를 두 채널로 패키징 가능하게 설정한다 — ① 직접 다운로드(Developer ID + 공증 + electron-updater), ② Mac App Store(샌드박스 + MAS). 기능 코드는 공유, 차이는 설정 + 단일 런타임 분기(`process.mas`).

**Tech:** electron-builder 25, electron-updater 6, macOS entitlements(plist).

## Global Constraints

- co-author 트레일러 없음. 브랜치 `supaicy/coordinate`.
- 실서명·공증·MAS 프로비저닝은 **사용자 Apple 자격 필요** → 코드/저장소엔 시크릿 없음, 환경변수로만. 로컬 검증은 **미서명 빌드**(`CSC_IDENTITY_AUTO_DISCOVERY=false`)로 한다.
- 네트워크 명령은 `NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection"` 필요(IPv6 블랙홀 회피).
- 검증: `tsc --build` clean, `biome lint` 0, `vitest run` 유지, `electron-vite build` 성공, `plutil -lint` 통과, 미서명 dmg 아티팩트 생성.

## Task 1 — MAS updater 런타임 가드 (유일한 소스 분기)

App Store는 자체 업데이트 금지. `src/main/index.ts:60`의 `if (!is.dev)`를 `if (!is.dev && !process.mas)`로 바꾸고, `download-update`/`install-update` IPC 핸들러 본문을 `if (process.mas) return`으로 가드.

- `process.mas`는 Electron이 MAS 빌드에서만 `true`로 세팅(그 외 undefined). Electron 타입에 포함됨 — tsc가 불평하면 `process.mas` 접근을 `(process as typeof process & { mas?: boolean }).mas`로 좁힌다.
- 검증: `tsc --build` clean, `biome lint` 0. (런타임 `process.mas`는 MAS 빌드에서만 참이라 단위테스트 불가 → 코드 리뷰로 검증.)

## Task 2 — 직접 다운로드 entitlements (하드닝 런타임)

`resources/entitlements.mac.plist`를 확장:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.security.cs.allow-jit</key><true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
    <key>com.apple.security.cs.disable-library-validation</key><true/>
    <key>com.apple.security.network.client</key><true/>
  </dict>
</plist>
```
(Electron/V8은 하드닝 런타임에서 JIT·비서명 실행메모리·라이브러리 검증 완화가 필요. `network.client`는 AI 호출용.)

## Task 3 — MAS entitlements (샌드박스)

신규 `resources/entitlements.mas.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.security.app-sandbox</key><true/>
    <key>com.apple.security.network.client</key><true/>
    <key>com.apple.security.files.user-selected.read-write</key><true/>
  </dict>
</plist>
```
신규 `resources/entitlements.mas.inherit.plist` (자식 프로세스):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.security.app-sandbox</key><true/>
    <key>com.apple.security.inherit</key><true/>
  </dict>
</plist>
```
샌드박스 영향: userData JSON·attachments는 컨테이너 내부(OK), AI/Ollama 아웃바운드는 `network.client`, 첨부 가져오기/내보내기는 표준 open/save 패널→`files.user-selected.read-write`.

## Task 4 — electron-builder.yml (mac 하드닝 + mas 블록)

`mac`에 추가: `hardenedRuntime: true`, `gatekeeperAssess: false`, `entitlements: resources/entitlements.mac.plist`(entitlementsInherit는 유지). 신규 top-level `mas` 블록:
```yaml
mas:
  entitlements: resources/entitlements.mas.plist
  entitlementsInherit: resources/entitlements.mas.inherit.plist
  hardenedRuntime: false
  category: public.app-category.productivity
```
- `notarize` 키는 넣지 않는다 → 자격 없으면 자동 스킵, `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` 있으면 자동 공증.
- dmg/zip(직접)은 기본 `mac.target` 유지. MAS는 `electron-builder --mac mas`로 별도 트리거(자격 필요).

## Task 5 — dev-app-update.yml (로컬 업데이트 테스트)

신규 루트 `dev-app-update.yml`:
```yaml
provider: github
owner: supaicy
repo: haru
```

## 검증 순서

1. `tsc --build` / `biome lint` / `vitest run` 그린.
2. `for f in resources/*.plist; do plutil -lint "$f"; done` 전부 OK.
3. `NODE_OPTIONS=... CSC_IDENTITY_AUTO_DISCOVERY=false ./node_modules/.bin/electron-vite build` 성공.
4. `NODE_OPTIONS=... CSC_IDENTITY_AUTO_DISCOVERY=false ./node_modules/.bin/electron-builder --mac dmg` → dist에 미서명 `haru-*.dmg` 생성(설정 검증).
5. 커밋: `chore(release): dual-channel macOS packaging (Developer ID + MAS)`.

## 사용자 필요분 (실행 못 하는 것)

MAS pkg 실빌드·서명·공증은 Apple Developer 자격(Developer ID Application, Apple Distribution, 3rd Party Mac Developer Installer, 프로비저닝 프로파일, App Store Connect 앱 레코드)이 있어야 함 → 최종 체크리스트로 정리.
