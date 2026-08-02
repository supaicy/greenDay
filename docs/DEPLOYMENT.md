# Greenday 배포 가이드 — 당신이 직접 설정할 것들

이 문서는 Greenday를 **① 웹사이트 직접 다운로드(Developer ID + 공증)** 와 **② Mac App Store** 로 실제 출시하기 위해 **당신(계정 소유자)** 이 직접 준비/설정해야 하는 항목을 정리합니다. 코드/설정(electron-builder.yml, entitlements, updater 가드, 랜딩 페이지)은 이미 리포지토리에 준비돼 있습니다. 여기 있는 것은 **비밀키·인증서·계정** 처럼 코드에 넣으면 안 되는 것들입니다.

> ⚠️ 이 환경 특이사항: 이 머신은 IPv6 경로가 막혀 있어 `npm`/electron 다운로드가 멈춥니다. 빌드/설치 명령 앞에
> `NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection"` 를 붙이세요. (오프라인 도구 tsc/biome/vitest는 불필요.)

---

## 0. 공통 선행조건

- [ ] **Apple Developer Program 가입** ($99/년) — 공증과 App Store 둘 다 필수. https://developer.apple.com/programs/
- [ ] **Team ID** 확인 (Apple Developer → Membership). 예: `A1B2C3D4E5`.
- [ ] Xcode 또는 Command Line Tools 설치 (`xcode-select --install`) — 서명·공증 도구용.

---

## 1. 직접 다운로드 채널 (DMG, 웹사이트 배포)

### 1-1. 인증서
- [ ] **Developer ID Application** 인증서 발급 (Apple Developer → Certificates → "+"). 로컬 키체인에 설치하거나 `.p12`로 내보내기.

### 1-2. 서명·공증 자격 (환경변수로 주입 — 저장소에 넣지 말 것)
로컬 키체인에 Developer ID 인증서가 있으면 electron-builder가 자동으로 찾습니다. CI라면 `.p12`를 base64로:
- [ ] `CSC_LINK` = `.p12` 파일 경로 또는 base64 문자열
- [ ] `CSC_KEY_PASSWORD` = `.p12` 암호

공증(notarization)용 — 아래 중 **하나**:
- [ ] (간단) `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`
  - App-specific password는 https://account.apple.com → 로그인 및 보안 → 앱 암호에서 생성.
- [ ] (권장, CI) App Store Connect API 키: `APPLE_API_KEY`(.p8 경로) + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER`

> 이 값들이 환경에 있으면 electron-builder가 **자동으로 서명 후 공증**합니다. 없으면 공증을 건너뛰고 미서명 빌드가 나옵니다(로컬 테스트용).

### 1-3. 빌드 & 배포
- [ ] 빌드: `NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection" npm run package`
  - 결과: `dist/Greenday-2.0.0-arm64.dmg` (+ zip, blockmap, `latest-mac.yml`).
- [ ] GitHub Releases 발행(자동 업데이트 피드): `GH_TOKEN` 환경변수(repo 권한) 설정 후 `electron-builder`가 publish. 또는 `dist/`의 dmg·zip·`latest-mac.yml`·blockmap을 릴리스에 수동 업로드.
  - electron-updater가 `latest-mac.yml`을 읽어 자동 업데이트합니다. **dmg/zip/yml/blockmap을 반드시 함께 업로드**하세요.
- [ ] (선택) Intel(x64)도 지원하려면 `--x64`도 빌드해 universal 또는 아키텍처별 아티팩트 제공.

---

## 2. Mac App Store 채널 (MAS)

### 2-1. 인증서 (직접 다운로드와 **다른** 인증서)
- [ ] **Apple Distribution** 인증서 (앱 서명용)
- [ ] **3rd Party Mac Developer Installer** 인증서 (`.pkg` 서명용) — 없으면 MAS 빌드가 실패합니다.

### 2-2. App Store Connect
- [ ] https://appstoreconnect.apple.com 에서 **새 앱 등록**, Bundle ID = `com.supaicy.haru` (Apple Developer → Identifiers에 먼저 등록 필요).
- [ ] **프로비저닝 프로파일**(Mac App Store 배포용) 생성 후 다운로드.
  - 파일을 `resources/embedded.provisionprofile` 로 두면 electron-builder가 자동 인식(또는 `electron-builder.yml`의 `mas.provisioningProfile`에 경로 지정).

### 2-3. 빌드 & 제출
- [ ] MAS 빌드: `NODE_OPTIONS="..." npm run package:mas`
  - `mac.target`은 dmg/zip이라 일반 `package`는 MAS를 만들지 않습니다. **반드시 `package:mas`** 사용(내부적으로 `electron-builder --mac mas`).
  - 결과: `dist/mas/Greenday-2.0.0.pkg` (Apple Distribution + Installer 인증서로 서명됨).
- [ ] **Transporter**(Mac App Store 앱) 또는 `xcrun altool`/`notarytool`로 `.pkg`를 App Store Connect에 업로드 → 심사 제출.

### 2-4. MAS 참고
- MAS 빌드에서는 electron-updater가 **자동 비활성**(App Store가 업데이트 담당). 코드에 `process.mas` 가드가 이미 들어있습니다.
- 전역 단축키(Quick Add `Cmd+Shift+A`)는 샌드박스에서 동작하지 않아 MAS 빌드에서 **자동 비활성**됩니다(직접 다운로드 버전에서는 정상 동작).
- 샌드박스 entitlements(`resources/entitlements.mas.plist`)는 네트워크(AI)·사용자 선택 파일(첨부/내보내기)만 허용합니다. 새 시스템 접근을 추가하면 해당 entitlement도 추가하세요.

---

## 3. 웹사이트 (랜딩 페이지)

- [ ] `docs/index.html` 정적 랜딩 페이지가 준비돼 있습니다(다운로드 버튼·기능 소개).
- [ ] GitHub 저장소 → **Settings → Pages → Source: "Deploy from a branch" → `main` / `/docs`** 선택.
  - 게시 후 `https://supaicy.github.io/haru/` 에서 랜딩이 열립니다. (커스텀 도메인은 Pages 설정에서 추가.)
- [ ] 다운로드 버튼은 `releases/latest/download/Greenday.dmg` 를 가리킵니다 — 릴리스 아티팩트 파일명이 `Greenday.dmg`를 포함하거나, 릴리스에 `Greenday.dmg`라는 이름의 에셋을 함께 올려두면 항상 최신을 받습니다.

---

## 4. (선택) Homebrew Cask

README와 랜딩이 `brew install --cask supaicy/haru/Greenday` 를 안내합니다.
- [ ] `homebrew-Greenday` 탭 저장소의 cask 수식을 새 버전(2.0.0)·SHA256으로 갱신(릴리스 dmg 기준).

---

## 필요한 비밀값 요약 (환경변수)

| 변수 | 용도 | 채널 |
|---|---|---|
| `CSC_LINK` / `CSC_KEY_PASSWORD` | Developer ID 서명 | 직접 |
| `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` | 공증 | 직접 |
| (또는) `APPLE_API_KEY` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER` | 공증(API 키) | 직접 |
| `GH_TOKEN` | GitHub Releases 발행 | 직접 |
| Apple Distribution / 3rd Party Installer 인증서 + `.provisionprofile` | MAS 서명 | App Store |

**절대 저장소에 커밋하지 마세요.** CI라면 GitHub Actions Secrets에 넣으세요.
