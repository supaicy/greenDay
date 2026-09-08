# 하우투 — 태그를 밀어 직접 배포 릴리스 내기

직접 다운로드 채널(Developer ID 서명 + 공증 DMG)로 새 버전을 내는 절차. **v2 이상** 태그(`v2.0.0`, `v2.1.0`, … — 워크플로 필터는 `v[2-9]*` 와 `v[1-9][0-9]*`)를 푸시하면 `.github/workflows/release.yml` 이 빌드·서명·공증·검증·공개·Homebrew cask 갱신까지 한다. `v1.*` 태그는 무시된다 — 브리지 v1.5.0 은 옛 번들 ID 로 로컬에서 만들어 손으로 올리는 릴리스라, 이 워크플로가 거기에 새 앱을 얹으면 안 되기 때문이다. 사람이 하는 일은 **버전을 맞추고, CHANGELOG 를 쓰고, 시크릿이 있는지 확인하고, 태그를 미는 것**뿐이다.

MAS 는 [howto-MAS-빌드와-업로드.md](howto-MAS-빌드와-업로드.md), 옛 번들 ID 브리지는 [howto-브리지-빌드.md](howto-브리지-빌드.md). 스크립트·플래그의 정의는 [reference-스크립트와-플래그.md](reference-스크립트와-플래그.md).

> **2026-09-08 현재 이 절차는 끝까지 돌 수 없다.** `gh secret list -R supaicy/greenDay` 결과 저장소 시크릿은 `HOMEBREW_TAP_TOKEN` 하나뿐이다. 아래 3절의 7종이 등록되기 전에는 태그를 밀어도 워크플로가 첫 단계(preflight)에서 멈춘다 — 서명 없는 DMG 가 나가는 일은 없다.

## 1. 버전을 한 값으로 맞춘다

세 파일이 같은 값을 들어야 한다. 마지막 버전 정리 커밋(`a640ae7`)이 바꾼 파일이 정확히 이 셋과 CHANGELOG 다.

| 파일 | 누가 읽는가 |
|---|---|
| `package.json` `version` | `electron.vite.config.ts` 가 `__APP_VERSION__` 으로 박는다. `scripts/release.sh`·`mas-upload.sh` 가 `node -p` 로 읽는다. electron-builder 가 Info.plist 에 넣는다 |
| `package-lock.json` `version` | `npm ci` 가 대조한다 |
| `VERSION` | 저장소 관례(도구용). 빌드가 읽지는 않는다 — `grep` 으로 확인 |

```bash
npm version 2.0.0 --no-git-tag-version   # package.json + package-lock.json
echo 2.0.0 > VERSION
```

태그 이름은 `v<version>` 이다. 워크플로가 `${TAG#v}` 로 cask 버전을 만들고, `gh release edit ${{ github.ref_name }}` 로 공개한다. **태그와 package.json 이 다르면** 릴리스 페이지 이름과 앱 버전이 어긋난다 — 검사하는 곳은 없다.

## 2. CHANGELOG 에 절을 쓴다

`CHANGELOG.md` 맨 위 `## [2.0.0] - Unreleased` 를 날짜로 바꾸고 Added / Changed / Fixed 를 채운다. 워크플로는 이 파일을 읽지 않는다 — 릴리스 노트는 electron-builder 가 GitHub 릴리스를 만들 때 비어 있고, 공개 전에 사람이 `gh release edit v2.0.0 --notes-file …` 로 붙이거나 웹에서 붙인다.

2.0.0 은 특별하다. 번들 ID 가 바뀐 첫 버전이라 CHANGELOG 의 "⚠️ 번들 ID가 바뀌었습니다" 절을 최종 문구로 확정해야 한다(현재 "임시 문구" 표시가 있다). 순서는 브리지 v1.5.0 이 먼저다 — [howto-브리지-빌드.md](howto-브리지-빌드.md).

## 3. 시크릿 7종이 있는지 확인한다

워크플로 첫 단계 "Preflight — 서명·공증 시크릿 확인"이 아래 일곱을 전부 요구한다. 하나라도 비면 `::error::필수 시크릿 누락` 으로 멈춘다.

| 시크릿 | 무엇 | 어디서 |
|---|---|---|
| `CSC_LINK` | Developer ID Application 인증서 `.p12` 의 base64 | Keychain 에서 내보내기 → `base64 -i cert.p12` |
| `CSC_KEY_PASSWORD` | 그 `.p12` 의 암호 | |
| `APPLE_API_KEY_B64` | App Store Connect API 키 `.p8` 의 base64 | App Store Connect → Users and Access → Integrations → App Store Connect API. 워크플로가 `$RUNNER_TEMP/private_keys/AuthKey.p8` 로 복원하고 `BEGIN PRIVATE KEY` 로 형식을 확인한다 |
| `APPLE_API_KEY_ID` | 그 키의 Key ID | 같은 화면 |
| `APPLE_API_ISSUER` | Issuer ID | 같은 화면 |
| `APPLE_TEAM_ID` | 팀 ID (`32R6RHXU36` — `docs/app-store-submission.md` 실측) | developer.apple.com → Membership |
| `GOOGLE_OAUTH_CLIENT_ID` | 데스크톱 앱 유형 OAuth 클라이언트 ID (비밀 아님) | [howto-Google-OAuth-클라이언트.md](howto-Google-OAuth-클라이언트.md) |

여기에 cask 갱신용 `HOMEBREW_TAP_TOKEN`(supaicy/homebrew-haru 에 push 할 수 있는 토큰)이 더 있어야 두 번째 잡이 돈다. **이것만 오늘 등록돼 있다.**

등록: GitHub → Settings → Secrets and variables → Actions. 확인: `gh secret list -R supaicy/greenDay`(이름만 보인다).

## 4. 태그를 민다

```bash
git tag v2.0.0
git push origin v2.0.0
```

이 저장소의 관례는 **사용자 신호 뒤에만 푸시**다(CLAUDE.md). 태그 푸시는 곧 CI 실행이다.

## 5. 워크플로가 하는 일 (순서대로)

`release.yml`, `macos-latest`, Node 20.

1. `npm ci`
2. **Preflight** — 시크릿 7종 존재 확인 (3절)
3. **API 키 파일 생성** — `APPLE_API_KEY_B64` 를 디코드해 `AuthKey.p8` 로
4. **Build app** — `GREENDAY_RELEASE=1 GOOGLE_OAUTH_CLIENT_ID=… npx electron-vite build`. `GREENDAY_RELEASE=1`(과 `GITHUB_ACTIONS=true`)이면 `electron.vite.config.ts` 가 클라이언트 ID 가 비었을 때 **throw** 한다 — preflight 와 이중 방어
5. **Package and publish (draft)** — `npx electron-builder --mac --arm64 --x64 --publish always`. `CSC_*` 로 서명, `APPLE_API_KEY`/`_ID`/`_ISSUER` 가 있으면 electron-builder 가 공증한다. GitHub 릴리스는 **draft** 로 만들어진다. 산출물 이름은 `electron-builder.yml` 의 `artifactName: ${productName}-${arch}.${ext}` — 버전이 없다:
   - `Greenday-arm64.dmg`, `Greenday-x64.dmg` (+ `.zip`, `.blockmap`)
   - `greenday-mac.yml` — `publish.channel: greenday` 라서 `latest-mac.yml` 이 아니다. 새 앱(2.0.0+)만 이 파일을 읽는다. 옛 앱은 `latest-mac.yml` 을 찾다가 못 찾고 조용히 멈춘다(→ [explanation-번들-ID-마이그레이션.md](explanation-번들-ID-마이그레이션.md) "feed 분리")
6. **서명·공증 검증** — `dist/mac*/*.app` 을 glob 으로 찾아(하나도 없으면 실패) 각각 `codesign --verify --deep --strict` 와 `spctl -a -vvv -t install` 에서 `Notarized Developer ID` 가 나오는지 본다. 실패하면 **draft 로 남고 공개되지 않는다**
7. **Publish release** — `gh release edit v2.0.0 --draft=false --latest`
8. **bump-cask** (별도 잡, ubuntu) — `https://github.com/supaicy/greenDay/releases/download/v2.0.0/Greenday-{arm64,x64}.dmg` 를 받아 SHA-256 을 내고(`curl -f`, 빈 파일·형식 검사) `supaicy/homebrew-haru` 의 `Casks/greenday.rb` 를 통째로 다시 써서 push 한다

`--latest` 가 중요하다. electron-updater 는 저장소의 "Latest" 릴리스에서 채널 파일을 읽는다. 브리지 v1.5.0 이 Latest 여야 하는 기간에 v2.0.0 을 밀면 그 순간 v1.4.1 사용자는 브리지를 영영 못 받는다 — 순서는 [2026-09-07-브리지-릴리스.md](2026-09-07-브리지-릴리스.md).

## 6. 나간 것을 확인한다

```bash
gh release view v2.0.0 -R supaicy/greenDay          # draft 아님, Latest, 자산 목록
gh release download v2.0.0 -R supaicy/greenDay -p 'Greenday-arm64.dmg' -D /tmp/rel
hdiutil attach /tmp/rel/Greenday-arm64.dmg -nobrowse -mountpoint /tmp/rel/mnt
codesign --verify --deep --strict /tmp/rel/mnt/Greenday.app && echo 서명 OK
xcrun stapler validate /tmp/rel/mnt/Greenday.app && echo 스테이플 OK
spctl -a -vvv -t exec /tmp/rel/mnt/Greenday.app 2>&1 | grep Notarized
hdiutil detach /tmp/rel/mnt
```

이 넷은 `scripts/release.sh` 4/4 단계가 로컬 릴리스에서 하는 검사와 같다 — dmg 를 마운트해 **사용자가 받는 그 앱**을 본다(빌드 중간 산출물이 아니라).

고정 주소도 확인한다. 사이트(`begreen.dev`)와 README 가 이 주소를 쓴다:

```
https://github.com/supaicy/greenDay/releases/latest/download/Greenday-arm64.dmg
```

자동 업데이트는 새 앱을 이전 버전으로 띄워 설정 → 버전에서 "새 버전" 이 뜨는지로 본다. 개발 빌드는 `canSelfUpdate: false` 라 안 뜬다 — 패키징된 이전 버전이 필요하다.

## 7. Homebrew

cask 이름은 소문자 `greenday`, 탭은 `supaicy/homebrew-haru`(탭 이름은 옛 것이다):

```bash
brew install --cask supaicy/haru/greenday
brew upgrade --cask greenday
```

bump-cask 잡이 실패했으면(예: `HOMEBREW_TAP_TOKEN` 만료) 릴리스는 이미 공개된 상태다. 잡을 re-run 하면 된다 — SHA 는 공개된 자산에서 다시 계산한다. 옛 `Casks/haru.rb` 는 이 워크플로가 건드리지 않는다; 그쪽은 `scripts/bump-haru-cask.sh` 몫이다([howto-브리지-빌드.md](howto-브리지-빌드.md)).

## 로컬에서 내는 길 (`npm run release`)

CI 없이 내 맥에서 같은 일을 하는 `scripts/release.sh` 가 있다. 요구하는 것: Keychain 의 Developer ID Application 인증서, `xcrun notarytool store-credentials "haru"` 로 저장한 공증 자격증명(프로파일 이름은 `APPLE_KEYCHAIN_PROFILE` 로 바꿀 수 있다), `gh auth login`, 그리고 `GOOGLE_OAUTH_CLIENT_ID`:

```bash
GOOGLE_OAUTH_CLIENT_ID=<id> npm run release
gh release edit v2.0.0 --draft=false --latest     # 스크립트가 draft 까지만 한다
```

이 길은 cask 를 갱신하지 않는다. 그리고 태그를 만들지 않는다 — electron-builder 가 `package.json` 버전으로 릴리스를 만든다.

## 확인하지 못한 것

- 워크플로 5단계에서 electron-builder 가 실제로 공증에 성공하는지는 시크릿이 없어 이 문서에서 실측하지 못했다. 6단계 검증이 그것을 잡도록 돼 있다(6fc9c85 에서 "조용히 통과하던 검증"을 고쳤다).
- `GITHUB_TOKEN` 으로 draft 릴리스를 만드는 것과 `gh release edit --latest` 는 `permissions: contents: write` 에 기댄다.
