# 하우투 — Google OAuth 클라이언트 만들고 빌드에 넣기

Google 캘린더 연동에는 Google Cloud 의 OAuth 클라이언트 ID 가 필요하다. 이 값은 **빌드 시점에** 앱에 박히고(`__GOOGLE_CLIENT_ID__`), 없이 나간 릴리스는 연동이 "이 빌드에는 설정되어 있지 않습니다" 로 통째로 죽는다. 그래서 릴리스 빌드는 값이 비면 실패하도록 돼 있다(2026-08 감사 U-1).

## 1. 앱이 실제로 하는 것 — 콘솔 설정은 여기에 맞춘다

`src/main/google-auth-flow.ts` + `src/main/google/oauth.ts`:

| 항목 | 값 | 어디에 |
|---|---|---|
| 클라이언트 종류 | **공개 클라이언트, PKCE(S256)**. 클라이언트 시크릿 없음 | `createPkcePair`, `buildAuthUrl` |
| 리디렉션 URI | `http://127.0.0.1:<임시 포트>/oauth2redirect` — 포트는 OS 가 고른다(`listen(0)`) | `src/shared/app-id.ts` `loopbackRedirectUri` |
| 브라우저 | 시스템 기본 브라우저(`shell.openExternal`). 임베디드 웹뷰 아님 | `startGoogleAuth` |
| 요청 범위 | `https://www.googleapis.com/auth/calendar.app.created` 하나 | `SCOPES` |
| 쓰는 캘린더 | 연결 직후 계정 안에 **`Greenday` 보조 캘린더를 만들고** 거기에만 쓴다. 사용자가 고르는 단계가 없다 | `src/main/google/app-calendar.ts` `ensureAppCalendar` |
| `access_type=offline`, `prompt=consent` | 리프레시 토큰을 매번 받는다 | `buildAuthUrl` |
| 리스너 | `127.0.0.1` 에만 바인드, 콜백 하나 받고 닫는다, 5분 타임아웃 | `listenOnLoopback`, `FLOW_TIMEOUT_MS` |
| 토큰 저장 | `google-config.json` 의 `tokens_enc` — safeStorage 로 봉인(`purpose: google.tokens`) | `src/main/google-config.ts` |

**범위에 대해 알아 둘 것.** `calendar.app.created` 는 "앱이 만든 보조 캘린더" 에만 닿는다 — 만들기(`calendars.insert`)·확인(`calendars.get`)·그 안의 일정 읽기/쓰기. 사용자의 기존 캘린더에는 **목록조차** 닿지 않는다(`calendarList.list` 는 이 범위를 받지 않아 403). 그래서 앱은 캘린더를 고르게 하지 않고, 만든 캘린더의 **id 를 `google-config.json` 에 저장**해 두고 `calendars.get` 으로 되묻는다. id 가 죽었으면(사용자가 지웠거나 다른 계정) 새로 만들고 동기화 상태를 비운다. 연결 해제도 토큰만 지우고 id 는 남긴다 — 목록으로 되찾을 수 없어, 지우면 재연결 때 같은 이름의 캘린더가 하나 더 생기기 때문이다.

한때(2026-08~09) `calendarlist.readonly` + `calendar.events` 를 받아 기존 캘린더를 고르게 했다. `calendar.events` 는 Google 이 **민감(sensitive) 범위**로 분류해 production 클라이언트에 심사가 필요하고 심사 전에는 테스트 사용자만 로그인됐다. 2026-09-09 제품 결정으로 `app.created` 하나로 돌아왔고, 이제 `CHANGELOG.md`·`app-store-submission.md` 4-B·`privacy.html`·로케일 `googleSync.scopeNote` 가 말하는 것과 코드가 같다.

## 2. Google Cloud 콘솔에서

1. 프로젝트를 하나 만들거나 고른다.
2. **API 및 서비스 → 라이브러리 → Google Calendar API → 사용 설정.**
3. **OAuth 동의 화면** — 외부(External) 사용자 유형. 앱 이름 `Greenday`, 지원 이메일, 개인정보처리방침 `https://begreen.dev/privacy`. **범위 추가**에서 `.../auth/calendar.app.created` 하나를 넣는다. 게시 상태가 "테스트" 인 동안은 테스트 사용자 목록에 있는 계정만 로그인된다 — 본인 계정을 넣는다.
4. **사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID → 애플리케이션 유형: 데스크톱 앱.** 이름은 자유. **번들 ID 를 묻는 iOS 유형이 아니다** — 옛 문서가 iOS 유형으로 등록하는 우회를 적어 둔 적이 있는데, Electron macOS 앱을 iOS 클라이언트로 등록하는 것은 지원되는 구성이 아니다(`app-id.ts` 주석).
5. 만들어진 **클라이언트 ID**(`…​.apps.googleusercontent.com`)를 복사한다. 클라이언트 보안 비밀은 데스크톱 앱에도 표시되지만 **쓰지 않는다** — 코드가 보내지 않는다.

데스크톱 앱 유형은 루프백 리디렉션을 자동으로 허용하므로 리디렉션 URI 를 따로 등록할 것이 없다. Google 은 루프백에 한해 포트를 대조하지 않는다.

## 3. ID 를 넣는 자리

| 어디 | 어떻게 | 누가 읽는가 |
|---|---|---|
| **GitHub Actions 시크릿 `GOOGLE_OAUTH_CLIENT_ID`** | Settings → Secrets → Actions | `release.yml` preflight 와 Build 단계. 오늘은 **등록돼 있지 않다**(`gh secret list`) |
| **로컬 릴리스·MAS·브리지** | `GOOGLE_OAUTH_CLIENT_ID=<id> npm run release` (또는 `mas:build`, `package:bridge`) | `scripts/release.sh`·`mas-preflight.sh` 6/6, 그리고 `electron.vite.config.ts` |
| **개발 중 (`npm run dev`)** | 셸에 `export GOOGLE_OAUTH_CLIENT_ID=<id>` 하고 띄운다 | `ipc-handlers.ts` 의 `resolveClientId()` 가 빌드 값이 비면 `process.env.GOOGLE_OAUTH_CLIENT_ID` 를 **런타임에** 읽는다 — 개발 서버를 다시 띄우지 않아도 된다 |

이 값은 비밀이 아니다(공개 클라이언트, PKCE 가 인가 코드를 지킨다). 시크릿에 두는 이유는 저장소에 리터럴로 박아 두지 않으려는 것뿐이다.

빌드 동작(`electron.vite.config.ts`):

- `GREENDAY_RELEASE=1` 또는 `GITHUB_ACTIONS=true` 이고 값이 비면 → **throw**. 릴리스는 이 상태로 나갈 수 없다.
- 그 외(`npm run build`, `npm run package`)에서 비면 → 경고만. 개발 빌드를 약하게 만들지 않는다.

## 4. 확인

개발 모드에서:

```bash
export GOOGLE_OAUTH_CLIENT_ID=<id>
npm run dev -- --user-data-dir=/tmp/greenday-oauth
```

설정 → 캘린더 연동 → Google → 연결. 브라우저가 열리고 로그인 뒤 "연결됐습니다 — Greenday 로 돌아가세요" 페이지가 뜨면 콜백이 도착한 것이다. "'Greenday' 캘린더에 연결됨" 이 뜨면 `calendars.insert`(또는 저장된 id 의 `calendars.get`)까지 통과한 것이다 — Google 캘린더 웹에서 **내 캘린더** 아래 `Greenday` 가 생겼는지 본다.

`google:get-config` IPC 가 돌려주는 `clientIdConfigured` 가 `false` 면 값이 어디에도 없는 것이다.

실패 코드는 `OAuthError.code` 로 온다: `listen_failed`(루프백을 못 열었다 — MAS 에서 `network.server` 가 없으면 여기), `open_failed`(브라우저), `timeout`(5분), `cancelled`, `invalid_callback`/`state` 불일치.

## 5. MAS 빌드에서 — `network.server`

샌드박스 앱은 리스닝 소켓을 열려면 `com.apple.security.network.server` 가 필요하다. `resources/entitlements.mas.plist` 에 들어 있고 `mas:preflight` 3/6 이 확인한다. 로그인하는 동안만 `127.0.0.1` 에 열리고 콜백 하나를 받으면 닫힌다 — 심사 노트에 이 설명이 있다([app-store-submission.md](app-store-submission.md) 4절). 직접 배포판(Hardened Runtime)에는 이 제약이 없다.

## 관련

- 왜 커스텀 스킴이 아니라 루프백인가: [explanation-라이선스-게이트와-MAS.md](explanation-라이선스-게이트와-MAS.md)
- IPC 채널 `google:*`: [reference-IPC-채널.md](reference-IPC-채널.md)
- 토큰이 저장되는 파일과 보호 모드: [reference-마이그레이션-파일.md](reference-마이그레이션-파일.md)
