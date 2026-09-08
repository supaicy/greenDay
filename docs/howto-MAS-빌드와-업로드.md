# 하우투 — Mac App Store 빌드와 업로드

샌드박스 `.pkg` 를 만들어 App Store Connect 에 올리는 절차. 메타데이터·심사 노트·App Privacy 답안은 [app-store-submission.md](app-store-submission.md) 에 붙여 넣을 형태로 있다 — 이 문서는 **빌드와 업로드**만 다룬다.

> **2026-09-08 현재 막힌 곳 하나.** `resources/embedded.provisionprofile` 은 옛 App ID(`com.supaicy.haru`)용이다. 번들 ID 가 `com.begreen.greenday` 로 바뀌었으므로 사람이 새로 발급해 교체해야 한다(4절). 그 전까지 `npm run mas:preflight` 2/6 이 실패하는 것이 **정상**이고, 그 상태로는 `mas:build` 가 preflight 에서 멈춘다.

## 1. 준비물

| 것 | 확인 방법 |
|---|---|
| **Apple Distribution** 인증서 (앱 서명) | `security find-identity -v -p codesigning \| grep "Apple Distribution"` |
| **Mac Installer Distribution** 인증서 (`.pkg` 서명) | `security find-identity -v \| grep -E "Installer\|Apple Distribution"` |
| `com.begreen.greenday` 용 **Mac App Store Connect** 프로비저닝 프로파일 | 4절 |
| `GOOGLE_OAUTH_CLIENT_ID` | [howto-Google-OAuth-클라이언트.md](howto-Google-OAuth-클라이언트.md) |
| App Store Connect 앱 레코드 (Bundle ID = `com.begreen.greenday`) | [app-store-submission.md](app-store-submission.md) 2절 |

Developer ID 인증서(직접 배포용)는 여기 쓸 수 없다 — preflight 가 종류를 가른다.

## 2. `npm run mas:preflight` — 6 항목

`scripts/mas-preflight.sh` 가 빌드는 되는데 업로드·심사에서야 터지는 문제를 먼저 잡는다. 번들 ID 는 `electron-builder.yml` 의 `appId` 를 권위로 읽는다.

| # | 항목 | 통과 조건 |
|---|---|---|
| 1/6 | 인증서 | `Apple Distribution` 또는 `3rd Party Mac Developer Application` + 설치 패키지 서명 인증서 |
| 2/6 | 프로비저닝 프로파일 | `security cms -D` 로 열어 `com.apple.application-identifier`(또는 `application-identifier`)가 `<TEAM>.com.begreen.greenday` 로 끝나고 `Platform` 이 `OSX`. 옛 `com.supaicy.haru` 프로파일이면 "예상된 실패" 안내가 붙는다 |
| 3/6 | 샌드박스 권한 | `resources/entitlements.mas.plist` 에 `app-sandbox`, `network.client`, **`network.server`** 가 있다 |
| 4/6 | MAS 에서 꺼져야 하는 기능 | `process.mas` 를 직접 읽는 파일이 `src/main/capabilities.ts` 하나뿐, `index.ts` 가 `canSelfUpdate` 로, `ipc-handlers.ts` 가 `hasGlobalShortcuts` 로 분기한다(주석 줄은 제외하고 검사) |
| 5/6 | 번들 ID 일관성 | `electron-builder.yml` 의 `mac.protocols[].schemes` 와 `src/shared/app-id.ts` 의 `APP_BUNDLE_ID` 가 `appId` 와 같다 |
| 6/6 | Google OAuth 클라이언트 ID | `GOOGLE_OAUTH_CLIENT_ID` 환경변수가 비어 있지 않다 |

프로파일 경로는 `MAS_PROVISIONING_PROFILE` 환경변수로 바꿀 수 있다(기본 `resources/embedded.provisionprofile`).

## 3. 빌드 — `npm run mas:build`

```bash
GOOGLE_OAUTH_CLIENT_ID=<id> npm run mas:build
```

스크립트는 세 가지를 순서대로 한다(`package.json`):

```
bash scripts/mas-preflight.sh
&& GREENDAY_RELEASE=1 electron-vite build
&& electron-builder --mac mas --universal
```

- `GREENDAY_RELEASE=1` 이라 클라이언트 ID 가 비면 `electron.vite.config.ts` 가 빌드를 **멈춘다**(preflight 6/6 과 이중).
- `--universal` — App Store Connect 는 버전당 빌드 하나만 받으므로 arm64+x64 를 한 `.pkg` 로 만든다. 아키텍처별로 나뉘어 있으면 `mas:upload` 가 거절한다.
- `electron-builder.yml` 의 `mas:` 블록이 적용된다: `entitlements.mas.plist` / `entitlements.mas.inherit.plist`, `hardenedRuntime: false`, `provisioningProfile`, `ITSAppUsesNonExemptEncryption: false`(수출 규정 설문 생략 — 표준 TLS 와 OS Keychain 만 쓴다).
- 결과: `dist/` 아래 `Greenday-2.0.0*.pkg` (`mas:upload` 가 `find dist -name "Greenday-2.0.0*.pkg"` 로 찾는다).

`package:mas` 라는 스크립트도 있지만 **쓰지 말 것** — 끝이 `--config` 로 잘려 값이 비어 있고 preflight 도 universal 도 없다(`app-store-submission.md` 가 같은 지적을 한다).

## 4. 프로비저닝 프로파일 교체 (사람이 한다)

1. developer.apple.com → **Identifiers** → `+` → App IDs → App → Bundle ID `com.begreen.greenday` (Explicit). Capabilities 추가 없음.
2. **Profiles** → `+` → **Mac App Store Connect** → 방금 만든 App ID, Apple Distribution 인증서 선택 → 다운로드.
3. 저장소에 배치. 이 파일은 `.gitignore` 에 있다 — 커밋되지 않는다:
   ```bash
   cp ~/Downloads/*.provisionprofile resources/embedded.provisionprofile
   npm run mas:preflight     # 2/6 이 "프로파일 App ID 일치" 로 바뀌어야 한다
   ```

한 번 만든 App Store Connect 앱 레코드의 Bundle ID 는 못 바꾼다. 레코드를 새 ID 로 만들기 전에 이 ID 가 최종인지 다시 확인한다.

## 5. Entitlements — 무엇이 왜 있는가

`resources/entitlements.mas.plist`:

| 키 | 이유 |
|---|---|
| `com.apple.security.app-sandbox` | App Store 필수 |
| `com.apple.security.network.client` | CalDAV·Google·AI 엔드포인트로 나가는 HTTPS |
| `com.apple.security.files.user-selected.read-write` | 첨부 고르기·내보내기 대화상자 |
| `com.apple.security.network.server` | **Google OAuth 루프백 콜백.** 로그인하는 동안만 `127.0.0.1` 의 임시 포트에 리스너를 연다(`src/main/google-auth-flow.ts`). 샌드박스에서 리스닝 소켓을 열려면 이 권한이 필요하다 — 없으면 브라우저 로그인은 성공하는데 앱이 콜백을 영영 못 받는다 |

`entitlements.mas.inherit.plist` 는 헬퍼 프로세스용(`app-sandbox` + `inherit`). 직접 배포용 `entitlements.mac.plist` 는 다른 파일이다(JIT·라이브러리 검증 해제·`network.client`, 샌드박스 없음).

심사 노트에 `network.server` 의 사유를 적어 둔 문구가 [app-store-submission.md](app-store-submission.md) 4절에 있다. 샌드박스 안에서 리스너가 실제로 열리는지는 **MAS 서명 빌드로 사람이 확인**해야 한다 — `TODOS.md` U-5, 아직 미검증.

## 6. 업로드 — `npm run mas:upload` 또는 Transporter

```bash
npm run mas:upload
```

`scripts/mas-upload.sh`:

1. `dist` 에서 `Greenday-<version>*.pkg` 를 찾는다. 0개면 빌드부터, 2개 이상이면 `rm -rf dist/mas* && npm run mas:build` 를 안내한다. `lipo -archs` 로 유니버설인지 본다.
2. 자격증명 — `APPLE_ID`/`APPLE_APP_PASSWORD` 환경변수 → 없으면 Keychain 항목 `AC_PASSWORD`(`MAS_KEYCHAIN_SERVICE` 로 변경 가능) → 없으면 터미널에서 묻는다. 한 번 저장해 두면 다시 묻지 않는다:
   ```bash
   security add-generic-password -s AC_PASSWORD -a '<Apple ID>' -w
   ```
   앱 암호는 appleid.apple.com 에서 발급한 `xxxx-xxxx-xxxx-xxxx` 형식.
3. `xcrun altool --validate-app` 을 먼저 돌린다(몇 초). `VERIFY SUCCEEDED` 가 없거나 `ERROR ITMS-` 가 있으면 업로드하지 않는다.
4. `xcrun altool --upload-app -f <pkg> -t macos`. 끝나면 App Store Connect 처리에 5~30분.

**Transporter** 앱(Mac App Store 무료)으로 같은 `.pkg` 를 끌어다 놓아도 된다. 결과는 같다.

## 7. App Store Connect 에서 볼 것

- **빌드** 탭에 처리 끝난 빌드가 나타나는지(수출 규정 설문이 뜨면 `ITSAppUsesNonExemptEncryption` 이 안 들어간 것이다).
- 버전 페이지에서 그 빌드를 선택하고, [app-store-submission.md](app-store-submission.md) 3절 메타데이터·6절 스크린샷(2880×1800 6장, `docs/app-store/screenshots/` 다크 또는 `screenshots-light/`)·4절 App Privacy("수집하지 않음") 와 심사 노트.
- 개인정보처리방침 URL `https://begreen.dev/privacy` 가 열리는지.

## MAS 빌드가 다른 점 (코드로 고정된 것)

`src/shared/capabilities.ts` 의 `capabilitiesFor({ isMas: true })`:

| 능력 | 값 | 결과 |
|---|---|---|
| `canSelfUpdate` | false | electron-updater 배선 자체를 걸지 않는다. 설정에 "App Store 를 통해 업데이트됩니다" |
| `hasGlobalShortcuts` | false | `Cmd+Shift+A` 전역 단축키 등록 안 함(샌드박스에서 조용히 실패한다) |
| `needsLicenseKey` | false | 설정에 라이선스 칸이 없다 — Apple 3.1.1 |
| `enforcesLicense` | false | 아무것도 잠그지 않는다 |
| `updatesViaStore` | true | |

왜 이렇게 나눴는지는 [explanation-라이선스-게이트와-MAS.md](explanation-라이선스-게이트와-MAS.md). MAS 빌드는 샌드박스 컨테이너를 쓰므로 `~/Library/Application Support/ticktick` 의 기존 데이터를 읽지 못한다 — 직접 배포판에서 넘어오는 사용자에게는 새 설치다([2026-09-07-브리지-릴리스.md](2026-09-07-브리지-릴리스.md) 마지막 항목).
