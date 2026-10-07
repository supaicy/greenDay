# 레퍼런스 — npm 스크립트, 빌드 플래그, electron-builder 설정, 워크플로 시크릿

2026-09-08 `ebf40d6` 기준(2026-10-07 `5894ea5` 에서 `verify`·`mas:build`·`mas:upload`·`test` 프로젝트·`mas.artifactName`·`updaterCacheDirName`·워크플로 Node 를 다시 맞췄다). 출처는 `package.json`, `electron.vite.config.ts`, `electron-builder.yml`, `electron-builder.bridge.cjs`, `dev-app-update.yml`, `.github/workflows/release.yml`, `scripts/*.sh`.

## npm 스크립트

| 스크립트 | 명령 | 비고 |
|---|---|---|
| `dev` | `electron-vite dev` | main·preload 빌드 + 렌더러 dev 서버(`localhost:5173`) + Electron 실행. `npm run dev -- --user-data-dir=<dir>` 로 데이터 폴더 격리 |
| `build` | `electron-vite build` | `out/{main,preload,renderer}`. `NODE_ENV=production` → `__IS_DEV_BUILD__ = false` |
| `preview` | `electron-vite preview` | 빌드 산출물로 Electron 실행 |
| `package` | `electron-vite build && electron-builder --mac --config` | 직접 배포용 dmg·zip (`electron-builder.yml`). 서명은 Keychain 인증서가 있을 때만 |
| `package:mas` | `electron-vite build && electron-builder --mac mas --config` | **쓰지 말 것** — `--config` 뒤에 값이 없고 preflight·universal 이 없다. `mas:build` 를 쓴다 |
| `package:bridge` | `BRIDGE_BUILD=1 GREENDAY_RELEASE=1 electron-vite build && electron-builder --mac --arm64 --x64 --config electron-builder.bridge.cjs` | 옛 번들 ID v1.5.0. 게시 안 함 |
| `test` | `vitest run` | `src/**/*.test.{ts,tsx}`. 프로젝트 둘 — `seoul`(전부, TZ `Asia/Seoul`)과 `west`(시간대에 민감한 파일 목록 `TZ_SENSITIVE` 만, TZ `America/New_York`) (`vitest.config.ts`) |
| `test:watch` | `vitest` | |
| `lint` | `biome lint src electron.vite.config.ts` | |
| `lint:fix` | `biome check --write src electron.vite.config.ts` | 린트+포맷 자동 수정 |
| `format` | `biome format --write src electron.vite.config.ts` | |
| `typecheck` | `tsc --build` | `tsconfig.node.json`(main·preload·shared) + `tsconfig.web.json`(renderer·shared). 산출물은 `out/src/**` 로 가며 asar 에 들어가지 않는다 |
| `verify` | `npm run typecheck && npm run lint && npm test` | 헬스 스택 한 번에. `release.sh`·`mas:build`·`release.yml` 이 빌드 **앞에서** 이것을 부른다 — 정의는 여기 한 곳 |
| `release` | `bash scripts/release.sh` | 로컬 서명·공증·draft 게시. 2/5 단계에서 `npm run verify` 를 빌드보다 먼저 돈다. 요구: Developer ID 인증서, `notarytool` 프로파일, `gh` 토큰, `GOOGLE_OAUTH_CLIENT_ID` |
| `mas:preflight` | `bash scripts/mas-preflight.sh` | 6항목 점검 |
| `mas:build` | `bash scripts/mas-preflight.sh && npm run verify && GREENDAY_RELEASE=1 electron-vite build && electron-builder --mac mas --universal` | 결과 `dist/mas-universal/Greenday-<version>-universal.pkg` (`mas.artifactName`) |
| `mas:upload` | `bash scripts/mas-upload.sh` | `altool --validate-app` 뒤 `--upload-app`. 그 전에 멈추는 경우: pkg 가 0개·2개 이상, pkg 가 마지막 커밋보다 오래됨(git 을 못 돌려도 멈춘다), pkg 옆 실행 파일이 없거나 유니버설이 아님. 암호는 `-p @env:APPLE_APP_PASSWORD` 로 넘긴다(argv 에 싣지 않는다) |

## 빌드 시점 define (`electron.vite.config.ts`)

`define` 으로 번들에 **리터럴로** 박힌다. 실행 방식(맨 Electron 으로 asar 열기 등)으로 바뀌지 않는다.

| 이름 | 어디 | 값 | 읽는 곳 |
|---|---|---|---|
| `__GOOGLE_CLIENT_ID__` | main | `process.env.GOOGLE_OAUTH_CLIENT_ID ?? ''` | `ipc-handlers.ts` `BUILTIN_GOOGLE_CLIENT_ID`. 비면 런타임 `process.env.GOOGLE_OAUTH_CLIENT_ID` 로 폴백 |
| `__IS_DEV_BUILD__` | main | `process.env.NODE_ENV !== 'production'` | `main/capabilities.ts` → `isDevBuild`. 주입 없는 환경(테스트)은 `true` |
| `__BRIDGE_BUILD__` | main, renderer | `process.env.BRIDGE_BUILD === '1'` | `main/capabilities.ts` `isBridgeBuild()` |
| `__APP_VERSION__` | renderer | 브리지면 `'1.5.0'`, 아니면 `package.json` `version` | `Settings.tsx` 버전 줄. 타입은 `env.d.ts` |

## 환경변수

| 변수 | 누가 읽는가 | 효과 |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | `electron.vite.config.ts`, `release.sh`, `mas-preflight.sh` 6/6, `ipc-handlers.ts`(런타임 폴백) | 빌드에 박힌다. 릴리스 빌드에서 비면 throw |
| `GREENDAY_RELEASE=1` | `electron.vite.config.ts` | "릴리스 빌드" 판정 → 클라이언트 ID 없으면 **throw**. `release.sh`·`mas:build`·`package:bridge` 가 켠다 |
| `GITHUB_ACTIONS=true` | `electron.vite.config.ts` | `GREENDAY_RELEASE=1` 과 같은 효과 (Actions 러너가 자동 설정) |
| `BRIDGE_BUILD=1` | `electron.vite.config.ts` | `__BRIDGE_BUILD__ = true`, `__APP_VERSION__ = '1.5.0'` |
| `NODE_ENV` | `electron.vite.config.ts` | electron-vite 가 `dev` 에서 development, `build` 에서 production 으로 설정 |
| `ELECTRON_RENDERER_URL` | `index.ts`, `ipc-gate.ts` | electron-vite dev 가 설정. 창이 로드하는 문서이자 발신자 검사의 기준 |
| `APPLE_KEYCHAIN_PROFILE` | `release.sh` (기본 `haru`), electron-builder 공증 | notarytool 에 저장한 자격증명 이름 |
| `APPLE_API_KEY` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER` / `APPLE_TEAM_ID` | electron-builder 공증 (워크플로) | 셋이 있으면 공증이 켜진다 |
| `CSC_LINK` / `CSC_KEY_PASSWORD` | electron-builder 서명 (워크플로) | `.p12` base64 와 암호 |
| `GH_TOKEN` | electron-builder GitHub publish, `release.sh`(없으면 `gh auth token`) | |
| `MAS_PROVISIONING_PROFILE` | `mas-preflight.sh` | 기본 `resources/embedded.provisionprofile` |
| `MAS_KEYCHAIN_SERVICE` | `mas-upload.sh` | 기본 `AC_PASSWORD` |
| `APPLE_ID` / `APPLE_APP_PASSWORD` | `mas-upload.sh` | 없으면 Keychain → 터미널 입력 |
| `TAP_DIR` | `bump-haru-cask.sh` | 기본 `homebrew-haru` (gitignored 클론) |

## `electron-builder.yml` — 의미 있는 키

| 키 | 값 | 왜 |
|---|---|---|
| `appId` | `com.begreen.greenday` | `CFBundleIdentifier`. `src/shared/app-id.ts` `APP_BUNDLE_ID` 와 같아야 한다(preflight 5/6) |
| `productName` | `Greenday` | `.app` 이름. `package.json` `name`(`ticktick`)은 **일부러** 다르다 |
| `files` | `out/main/**`, `out/preload/**`, `out/renderer/**`, `package.json` | 허용 목록. `out/src/**`(tsc 산출물·테스트)가 asar 에 딸려 들어가는 것을 막는다 |
| `mac.target` | `dmg`, `zip` | zip 은 electron-updater 가 받는 것 |
| `mac.artifactName` / `dmg.artifactName` | `${productName}-${arch}.${ext}` | **버전 없음** — `releases/latest/download/Greenday-arm64.dmg` 고정 주소 |
| `mac.hardenedRuntime` | `true` | 공증 요건 |
| `mac.entitlements` / `entitlementsInherit` | `resources/entitlements.mac.plist` | JIT·unsigned-executable-memory·disable-library-validation·network.client |
| `mac.minimumSystemVersion` | `'12.0'` | Electron 41 바이너리(`41.10.7`)의 값과 같다. README·사이트·cask(`>= :monterey`)가 같은 값을 본다 |
| `mac.extendInfo.ITSAppUsesNonExemptEncryption` | `false` | App Store Connect 수출 규정 설문 생략 |
| `mac.protocols[].schemes` | `[com.begreen.greenday]` | 커스텀 URL 스킴. OAuth 는 더 이상 안 쓰지만 `open-url`·`second-instance` 배선이 기댄다 |
| `mas.entitlements` / `entitlementsInherit` | `entitlements.mas.plist` / `entitlements.mas.inherit.plist` | app-sandbox, network.client, network.server, files.user-selected.read-write |
| `mas.hardenedRuntime` | `false` | MAS 는 샌드박스 |
| `mas.provisioningProfile` | `resources/embedded.provisionprofile` | gitignored. 옛 ID 용 파일은 치웠고 2026-10-06 현재 이 경로에 파일이 없다 — 새 ID 로 발급해 넣을 때까지 preflight 2/6 실패가 정상 |
| `mas.artifactName` | `${productName}-${version}-${arch}.${ext}` | MAS pkg 에만 버전을 넣는다. 안 적으면 `mac.artifactName`(버전 없음)을 물려받아 `mas-upload.sh` 가 찾는 `<productName>-<version>*.pkg` 와 어긋난다. `src/shared/masArtifactName.test.ts` |
| `publish.provider/owner/repo` | `github` / `supaicy` / `greenDay` | 정식 저장소 이름 |
| `publish.channel` | `greenday` | feed 파일 `greenday-mac.yml`. 옛 앱이 읽는 `latest-mac.yml` 과 분리 |
| `publish.updaterCacheDirName` | (적지 않는다) | electron-builder 가 적힌 값을 버리고 `package.json` `name` 에서 유도한다 → `~/Library/Caches/ticktick-updater`. 옛 앱과 나눌 수 없고, Homebrew cask `zap` 이 그 경로를 지운다. `src/shared/updaterCacheDir.test.ts` |
| `npmRebuild` | `true` | |

`dev-app-update.yml` 은 개발 중 electron-updater 가 읽는 같은 값(`provider/owner/repo/channel`)이다. 개발 빌드는 `canSelfUpdate: false` 라 실제로 확인하지는 않는다.

## `electron-builder.bridge.cjs` — 기본 설정에서 바꾸는 것

`js-yaml` 로 `electron-builder.yml` 을 읽어 스프레드한 뒤 아래만 덮는다. YAML `extends` 는 배열(`mac.protocols`)을 **합쳐서** 스킴이 둘 들어갔기 때문에 JS 다.

| 키 | 값 |
|---|---|
| `appId` | `com.haru.app` (`LEGACY_BUNDLE_ID`) |
| `extraMetadata.version` | `1.5.0` (`BRIDGE_VERSION`) |
| `mac.artifactName`, `dmg.artifactName` | `Greenday-1.5.0-bridge-${arch}.${ext}` |
| `mac.protocols` | `[{ name: 'Greenday', schemes: ['com.haru.app'] }]` |
| `publish.channel` | `latest` → `latest-mac.yml` |
| `publish.updaterCacheDirName` | 적지 않는다 — 어차피 `ticktick-updater` 로 유도된다(위 표) |

같은 상수가 사는 다른 자리: `src/shared/app-id.ts`(`LEGACY_BUNDLE_ID`, `BRIDGE_VERSION`), `electron.vite.config.ts`(`BRIDGE_VERSION`).

## 릴리스 워크플로 시크릿 (`.github/workflows/release.yml`)

| 시크릿 | 단계 | 없으면 |
|---|---|---|
| `CSC_LINK` | preflight, package | preflight 에서 멈춤 |
| `CSC_KEY_PASSWORD` | preflight, package | 〃 |
| `APPLE_API_KEY_B64` | preflight, API 키 파일 생성 | 〃. 디코드해 `BEGIN PRIVATE KEY` 로 형식 확인 |
| `APPLE_API_KEY_ID` | preflight, package | 〃 |
| `APPLE_API_ISSUER` | preflight, package | 〃 |
| `APPLE_TEAM_ID` | preflight, package | 〃 |
| `GOOGLE_OAUTH_CLIENT_ID` | preflight, build | 〃. 빌드 단계도 `GREENDAY_RELEASE=1` 로 재확인 |
| `GITHUB_TOKEN` | package(publish), publish release | 자동 제공. `permissions: contents: write` |
| `HOMEBREW_TAP_TOKEN` | bump-cask | 잡 실패(릴리스는 이미 공개됨) |

**2026-09-08 `gh secret list -R supaicy/greenDay`: `HOMEBREW_TAP_TOKEN` 만 등록돼 있다.** 나머지 7종은 없다.

트리거: `push.tags: ['v[2-9]*', 'v[1-9][0-9]*']` — v2 이상만. `v1.*`(브리지 v1.5.0)는 무시된다. 러너 `macos-latest`, Node 24(electron 41 이 Node 22.12 이상을 요구한다 — `src/shared/releaseGate.test.ts`). `npm ci` 바로 뒤 시크릿 확인보다 먼저 `npm run verify` 를 돈다. 단계 순서와 각 단계의 실패 조건은 [howto-태그-릴리스.md](howto-태그-릴리스.md) 5절.

## 스크립트가 읽는 파일

| 스크립트 | 읽는 것 |
|---|---|
| `release.sh` | `electron-builder.yml` `productName`(awk), `package.json` `version`(node), `dist/<productName>-*.dmg` |
| `mas-preflight.sh` | `electron-builder.yml` `appId`·`mac.protocols`, `src/shared/app-id.ts`, `resources/entitlements.mas.plist`, 프로파일, `src/main/{capabilities,index,ipc-handlers}.ts`, `src/shared/capabilities.ts` |
| `mas-upload.sh` | `electron-builder.yml` `productName`, `package.json` `version`, `dist/**/<productName>-<version>*.pkg`, 그 옆 `<productName>.app/Contents/MacOS/<productName>`(`lipo -archs`), `git log -1 --format=%ct`(실패하면 Command Line Tools 의 git 으로 한 번 더) |
| `bump-haru-cask.sh` | 릴리스 자산 `Greenday-1.5.0-bridge-{arm64,x64}.dmg` (또는 `--local` 로 `dist/`), 버전은 스크립트 안 리터럴 `1.5.0` |
