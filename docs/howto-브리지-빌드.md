# 하우투 — 브리지 v1.5.0 빌드와 배포

옛 번들 ID `com.haru.app` 로 나가는 **마지막** 버전을 만들어 올리는 절차. 이 빌드는 옛 사용자(v1.4.1)에게 자동 업데이트로 도달해, 백업을 만들고 Keychain sentinel 을 심고 "새 Greenday 를 받으세요" 안내를 띄운다. 그 뒤 새 앱 v2.0.0 이 같은 데이터 폴더를 이어받는다.

왜 이런 릴리스가 필요한지와 feed 분리의 원리는 [2026-09-07-브리지-릴리스.md](2026-09-07-브리지-릴리스.md)(결정 기록)과 [explanation-번들-ID-마이그레이션.md](explanation-번들-ID-마이그레이션.md). 이 문서는 **손으로 하는 순서**다.

## 0. 순서를 먼저 — 이걸 어기면 laggard 가 생긴다

```
① v1.5.0 브리지를 supaicy/greenDay 에 릴리스하고 Latest 로 표시
② 2~4주 대기
③ v2.0.0 태그 푸시 → release.yml 이 Latest 를 v2.0.0 으로 옮긴다
```

electron-updater(GitHub provider)는 저장소의 **Latest 릴리스**에서 `<channel>-mac.yml` 을 읽는다. 옛 앱은 채널이 없어 `latest-mac.yml` 을 찾는다. ③ 뒤로 Latest 는 v2.0.0 이고 거기엔 `greenday-mac.yml` 만 있으므로, 아직 v1.4.1 인 사람은 **영영** 브리지를 못 받는다. ②의 대기는 그 사람들에게 시간을 주는 것이다. 대기를 없애는 대안(새 앱 릴리스를 별도 저장소로)은 결정 기록 문서에 있고 아직 채택하지 않았다.

## 1. 준비물

`npm run release` 와 같다 — 이 빌드도 Developer ID 로 서명·공증돼야 옛 사용자의 Gatekeeper 를 지난다:

- Keychain 의 **Developer ID Application** 인증서
- 공증 자격증명: `xcrun notarytool store-credentials "haru" --apple-id <ID> --team-id <TEAM> --password <앱 암호>` (프로파일 이름은 자유, 아래에서 `APPLE_KEYCHAIN_PROFILE` 로 넘긴다)
- `GOOGLE_OAUTH_CLIENT_ID` — 브리지도 `GREENDAY_RELEASE=1` 이라 없으면 빌드가 멈춘다
- `gh auth login`

## 2. 빌드 — `npm run package:bridge`

```bash
GOOGLE_OAUTH_CLIENT_ID=<id> APPLE_KEYCHAIN_PROFILE=haru npm run package:bridge
```

스크립트(`package.json`):

```
BRIDGE_BUILD=1 GREENDAY_RELEASE=1 electron-vite build
&& electron-builder --mac --arm64 --x64 --config electron-builder.bridge.cjs
```

무엇이 달라지는가:

| | 어디서 | 값 |
|---|---|---|
| `__BRIDGE_BUILD__` | `electron.vite.config.ts` (`BRIDGE_BUILD=1`) | `true` — 런타임이 `capabilities.isBridge` 로 안다 |
| `__APP_VERSION__` | 같은 파일 | `'1.5.0'` (`BRIDGE_VERSION` 리터럴; `package.json` 은 2.0.0 그대로) |
| `appId` | `electron-builder.bridge.cjs` | `com.haru.app` (`LEGACY_BUNDLE_ID`) |
| `extraMetadata.version` | 같은 파일 | `1.5.0` |
| `artifactName` | 같은 파일 | `Greenday-1.5.0-bridge-${arch}.${ext}` — 사이트가 쓰는 고정 이름 `Greenday-<arch>.dmg` 와 겹치지 않게 |
| `mac.protocols` | 같은 파일 | 스킴 `com.haru.app` 하나만 (YAML `extends` 는 배열을 합쳐 스킴이 둘 들어갔다 — 그래서 JS 설정이다) |
| `publish.channel` | 같은 파일 | `latest` → `latest-mac.yml` 을 만든다 |
| `publish.updaterCacheDirName` | 같은 파일 | `ticktick-updater` (옛 그대로) |

세 파일의 상수가 같아야 한다: `src/shared/app-id.ts` 의 `LEGACY_BUNDLE_ID`·`BRIDGE_VERSION`, `electron.vite.config.ts` 의 `BRIDGE_VERSION`, `electron-builder.bridge.cjs` 의 둘. `app-id.test.ts` 가 소스 쪽을 본다.

서명·공증: electron-builder 는 Keychain 에 Developer ID 인증서가 있으면 서명하고, `APPLE_KEYCHAIN_PROFILE`(또는 `APPLE_API_KEY`/`_ID`/`_ISSUER`, 또는 `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`)이 있으면 공증한다. `scripts/release.sh` 3/4 단계가 `APPLE_KEYCHAIN_PROFILE` 을 export 한 채 electron-builder 를 부르는 것과 같은 메커니즘이다. `package:bridge` 는 `--publish` 가 없으므로 GitHub 에 올리지 않고 `dist/` 에만 남긴다.

결과물(`dist/`):

```
Greenday-1.5.0-bridge-arm64.dmg   Greenday-1.5.0-bridge-arm64.zip   (+ .blockmap)
Greenday-1.5.0-bridge-x64.dmg     Greenday-1.5.0-bridge-x64.zip     (+ .blockmap)
latest-mac.yml
```

macOS electron-updater 는 **zip** 을 받아 설치한다. dmg 는 사람이 받는 것이다. 둘 다 올려야 한다.

## 3. 검증 — release.sh 4/4 와 같은 검사를 손으로

`release.sh` 는 기본 설정(`Greenday-*.dmg`)만 보므로 브리지에는 쓸 수 없다. 같은 검사를 직접 한다:

```bash
for dmg in dist/Greenday-1.5.0-bridge-*.dmg; do
  mnt=$(mktemp -d); hdiutil attach "$dmg" -nobrowse -quiet -mountpoint "$mnt"
  app="$mnt/Greenday.app"
  /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist"   # com.haru.app
  /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist"   # 1.5.0
  /usr/libexec/PlistBuddy -c 'Print :CFBundleURLTypes:0:CFBundleURLSchemes' "$app/Contents/Info.plist"  # com.haru.app 하나
  codesign --verify --deep --strict "$app" && echo 서명 OK
  xcrun stapler validate "$app" && echo 스테이플 OK
  spctl -a -vvv -t exec "$app" 2>&1 | grep -q "Notarized Developer ID" && echo Gatekeeper OK
  hdiutil detach "$mnt" -quiet; rmdir "$mnt"
done
cat dist/latest-mac.yml     # version: 1.5.0, files 에 두 zip
```

브리지 첫 실행이 하는 일(백업·sentinel·안내 모달)은 `--user-data-dir` 를 준 사본으로 확인할 수 있다. 실제 Keychain 프롬프트 매트릭스(항상 허용/허용/거부/잠김/항목 삭제 × 두 앱 동시 실행 × Intel/Apple Silicon)는 **서명된 빌드로 사람이** 해야 하는 일로 결정 기록에 남아 있다.

## 4. 올리기 — 릴리스를 만들고 Latest 로

```bash
gh release create v1.5.0 -R supaicy/greenDay \
  --title "Greenday 1.5.0 — 옛 번들 ID의 마지막 버전" \
  --notes-file <노트> \
  --latest \
  dist/Greenday-1.5.0-bridge-arm64.dmg dist/Greenday-1.5.0-bridge-arm64.zip dist/Greenday-1.5.0-bridge-arm64.zip.blockmap \
  dist/Greenday-1.5.0-bridge-x64.dmg   dist/Greenday-1.5.0-bridge-x64.zip   dist/Greenday-1.5.0-bridge-x64.zip.blockmap \
  dist/latest-mac.yml
```

`latest-mac.yml` 이 자산에 있어야 옛 앱이 업데이트를 본다. `--latest` 가 빠지면 GitHub 이 최신 태그를 Latest 로 잡긴 하지만, 명시하는 편이 안전하다.

> **태그가 워크플로를 깨우지 않는다 (닫힘, 2026-09-09).** `gh release create v1.5.0` 는 태그 `v1.5.0` 을 만들어 푸시한다. `.github/workflows/release.yml` 은 이제 `v[2-9]*` 와 `v[1-9][0-9]*` 태그에만 반응한다 — **v2 이상만**. `v1.5.0` 은 둘째 글자가 `1`, 셋째가 `.` 라 어느 패턴에도 걸리지 않으므로, 시크릿 7종이 등록돼 있어도 워크플로가 새 앱을 빌드해 이 릴리스에 얹는 일은 없다. 브리지를 시크릿 등록 앞뒤 어느 쪽에 올려도 된다.

노트 문구는 `docs/reports/2026-09-07-bridge-copy.md` 와 `CHANGELOG.md` 의 "번들 ID 가 바뀌었습니다" 절에서 가져온다. 새 앱 다운로드 주소는 `https://begreen.dev/greenday` 하나다(`GREENDAY_DOWNLOAD_URL`, `src/shared/migration.ts`).

## 5. Homebrew — `scripts/bump-haru-cask.sh`

옛 cask `haru`(`supaicy/homebrew-haru` 의 `Casks/haru.rb`)로 설치한 사람이 `brew upgrade` 로 브리지를 받으려면 그 cask 가 v1.5.0 자산을 가리켜야 한다. 릴리스 워크플로의 bump-cask 잡은 새 `greenday` cask 만 만들므로 이 스크립트가 따로 있다.

```bash
scripts/bump-haru-cask.sh --local    # dist/ 의 dmg 로 SHA 를 내 미리 본다 (커밋 안 함)
scripts/bump-haru-cask.sh            # 릴리스가 공개된 뒤: 실제 자산에서 SHA → homebrew-haru/ 에 커밋
git -C homebrew-haru push            # 확인 뒤 사람이 민다
```

`homebrew-haru/` 는 별도 저장소의 로컬 클론이고 `.gitignore` 에 있다(없으면 스크립트가 클론한다, `TAP_DIR` 로 바꿀 수 있다). 스크립트가 쓰는 `haru.rb` 는 `Greenday.app` 을 설치하고(옛 설치는 `haru.app` 이었다 — brew 가 옛 앱을 지우고 새 이름으로 놓는다) `caveats` 로 새 cask 를 안내한다:

```
brew uninstall --cask haru
brew install --cask supaicy/haru/greenday
```

`--local` 의 SHA 는 로컬 dmg 것이라 공개된 자산과 다를 수 있다 — 그래서 커밋하지 않는다.

## 6. 그 다음 — 대기와 v2.0.0

- **2~4주 대기.** `latest-mac.yml` 요청 수는 폴링이라 설치 수 추정에 쓰지 않는다(결정 기록).
- 그 사이 사이트 `begreen.dev/greenday` 의 다운로드 버튼이 어디를 가리키는지 확인한다. 새 앱 릴리스가 아직 없으면 `releases/latest/download/Greenday-arm64.dmg` 는 404 다 — 사이트 쪽(`../begreen` 의 `site/build.ts`)이 그 기간을 어떻게 다룰지는 이 저장소 밖의 일이다.
- 대기가 끝나면 [howto-태그-릴리스.md](howto-태그-릴리스.md) 로 v2.0.0 을 낸다. 그 워크플로의 `gh release edit --latest` 가 Latest 를 옮긴다.
- `CHANGELOG.md` 2.0.0 절의 "임시 문구" 를 그때 확정한다.

## 브리지가 실제로 하는 일 (참고)

첫 실행에 `src/main/migration/bridge.ts` 가 돈다 — 무결성 판정 → `backup-before-greenday-2/` 백업(있으면 건드리지 않음) → `keycheck.sentinel` → `migration-state.json`. 그리고 `capabilities.isBridge` 가 `canSelfUpdate` 를 끄고(다음 버전은 다른 앱이다) 설정 → 버전 줄을 "이 버전은 마지막 업데이트입니다" 로 바꾼다. 안내 모달은 `BridgeNotice.tsx`, "나중에"는 3일 스누즈. 파일 형식은 [reference-마이그레이션-파일.md](reference-마이그레이션-파일.md).
