# 기능 완결성 감사 — Greenday (supaicy/coordinate)

- 대상: `/Users/supermicrosoft/orca/workspaces/ticktick/coordinate` @ `1ccf433`
- 기준선 실측: `npx tsc --build` 0 · `npx biome lint src electron.vite.config.ts` 0 · `npx vitest run` **915 passed / 59 files**
- 서버는 읽기 전용 레퍼런스(`~/Code/services/bicmac-license`)로만 대조했고 수정하지 않았다.
- 질문은 "앱이 표방하는 것을 실제로 하는가"다. 코드가 **맞게 도는데 닿을 수 없는 것**, **문서가 약속했는데 없는 것**, **반쯤 배선된 것**을 찾았다.
- "설정을 지우면 트라이얼이 리셋된다"는 지시대로 지적하지 않았다.
- `TODOS.md`가 이미 적어 둔 항목은 그렇게 표시했다 — 알려져 있다는 것이 닫혔다는 뜻은 아니므로 빼지 않았다.

---

## critical

### [critical] `.github/workflows/release.yml:58` — 출하되는 모든 빌드에서 Google 캘린더 연동이 죽어 있다
**문제.** 릴리스 워크플로의 `run: npx electron-vite build`에 `GOOGLE_OAUTH_CLIENT_ID`가 없다. `electron.vite.config.ts:11`이 그 값을 `__GOOGLE_CLIENT_ID__`로 주입하므로 빈 문자열이 박히고, `ipc-handlers.ts:386`의 폴백 `process.env.GOOGLE_OAUTH_CLIENT_ID`는 Finder/Dock으로 띄운 macOS 앱에 셸 환경이 상속되지 않아 역시 빈 값이다. 실측: `npx electron-vite build` 후 `out/main/index.js:3372`가 `const resolveClientId = () => String(process.env.GOOGLE_OAUTH_CLIENT_ID ?? "")` — 빌드타임 상수는 이미 접혀 사라졌다.
**왜.** `google:get-config`의 `clientIdConfigured`가 false가 되어 `GoogleSyncSection.tsx:136-137`이 화면 전체를 `googleSync.notConfigured`("이 빌드에는 Google 연동이 설정되어 있지 않습니다") 한 줄로 대체한다. 버튼도, 안내도, 다음 걸음도 없는 완전한 막다른 골목이다. OAuth·PKCE·토큰 갱신·동기화 계획은 전부 구현돼 있고 유닛테스트도 통과하는데, **사용자가 그 코드에 닿을 방법이 하나도 없다.** 그런데 `TODOS.md:226-234`의 확정 가격 정책은 "iCloud와 Google 캘린더 모두 지원, 추가 결제 없음"을 **판매 문구로 쓴다**고 못 박았다. 파는 것과 출하하는 것이 다르다.
**고치는 법.** ① Google Cloud Console에서 데스크톱 앱 OAuth 클라이언트 ID를 발급하고(리디렉션에 번들 ID `com.supaicy.haru` — 앱 이름 `Greenday`와 다르다) `secrets.GOOGLE_OAUTH_CLIENT_ID`로 등록, `release.yml`의 Build 스텝에 `env:`로 건다. ② 그때까지는 `mas-preflight.sh`류의 프리플라이트에 "클라이언트 ID가 비면 실패" 검사를 넣어 조용히 죽은 기능이 또 릴리스에 실리지 않게 한다. ③ `googleSync.notConfigured` 문구에 최소한 "다음 버전에서 제공됩니다" 같은 정직한 종결을 준다 — 지금 문구는 사용자가 뭘 해야 하는지 말하지 않는다. (`TODOS.md:156-160` [U-1]에 3주 넘게 열려 있음.)

### [critical] `docs/privacy.html:60,69,78,249` — 공개된 개인정보처리방침이 라이선스 서버를 부정한다
**문제.** 심사에 제출된 방침(`docs/app-store-submission.md:162` — `https://supaicy.github.io/haru/privacy.html`, 최종 수정 2026-07-29)이 "서버가 없고, 계정도 없고"(:60), "Greenday는 개발자가 운영하는 서버가 없습니다"(:69), 영문 "There is no server"(:249)라고 적고, **하지 않는 것** 목록에 "기기 지문(fingerprinting)"(:78)을 명시한다. 실제로는 2026-08-18에 들어온 `src/main/licensing/`이 개발자가 운영하는 `pay.begreen.dev`(`endpoints.ts:27`)로 **라이선스 키 원문**, `IOPlatformUUID`에서 파생한 기기 해시(`deviceIdentity.ts:29-31,58-61`), `os.hostname()`(`service.ts:227`)을 보낸다. `grep -c "pay.begreen\|라이선스 키" docs/privacy.html` = **0** — 방침 어디에도 언급이 없다.
**왜.** 방침은 CalDAV·Google·외부 AI는 성실하게 적어 뒀다(:115-171). 빠진 것은 정확히 **개발자 자신의 서버**다. 그리고 `os.hostname()`은 macOS에서 대개 소유자 실명을 담고("철수의 MacBook Pro"), 앱은 그 사실을 화면에 고지까지 한다(`license.deviceNameNotice`) — 앱이 사용자에게 말하는 것과 법적 문서가 말하는 것이 정면으로 다르다. 지금 `IS_ENFORCED=false`라 활성화를 누르지 않으면 트래픽이 안 나가지만, 키 입력 UI는 직판·개발 빌드에서 이미 살아 있어(`Settings.tsx:412`) **오늘도 도달 가능한 경로**다. Apple App Privacy 신고와도 어긋난다.
**고치는 법.** 방침에 "라이선스 활성화" 절을 추가한다: 무엇이(키·기기 해시·기기 이름), 어디로(`pay.begreen.dev`), 언제(활성화·30일 재검증·해제), 왜, 보관 기간. "서버가 없습니다"를 "할일 데이터는 어떤 서버로도 가지 않습니다"로 좁히고, "기기 지문" 항목은 "광고·추적 목적의 기기 지문"으로 한정하거나 라이선스 해시를 예외로 명시한다. `docs/app-store-submission.md:367`의 절차대로 `gh-pages`에도 복사한다. (`TODOS.md:261-262`가 "고쳐야 한다"고만 적어 두고 멈춰 있다.)

### [critical] `src/main/licensing/endpoints.ts:30` — 앱이 서버에 없는 제품 slug를 가리킨다 (교차 저장소, 서버는 읽기 전용)
**문제.** 앱은 `PRODUCT_SLUG = 'greenday'`로 구매 URL(`:40`)을 만들고 토큰의 `prod` 클레임을 검사한다(`activationToken.ts:121`). 레퍼런스 서버의 유일한 마이그레이션 `bicmac-license/migrations/0001_initial.sql:29-34`는 `products`에 `bicmac` 한 줄만 INSERT한다 — `greenday` 행이 없다.
**왜.** `GET /v1/products/greenday`는 `src/index.ts:144`에서 404 `not_found`가 되고, 구매 페이지 `web/buy.html:112-122`가 그 응답으로 이름·가격·결제 레일을 채우므로 **`/buy?product=greenday`가 렌더되지 않는다.** 키 발급도 `products.key_prefix`에 묶여 있어 `GREENDAY-` 키 자체가 존재할 수 없다. 즉 지금 상태에서 앱의 구매→활성화 왕복은 첫 걸음에서 끊긴다 — enforcement를 켜는 날 "결제하러 갔더니 빈 페이지"가 된다.
**고치는 법.** 서버 쪽에서 `products`에 `greenday` 행(슬러그·이름·`key_prefix='GREENDAY'`·가격·`max_activations`)을 넣고 `GET /v1/products/greenday` 200과 `/buy?product=greenday` 렌더를 실거래 전에 확인한다. 앱 쪽에는 할 일이 없다. 다만 이 검증을 `service.ts:31`의 "켜는 시점: 서버 배포가 끝나고 실거래로 활성화까지 확인한 뒤"에 명시적으로 포함시켜야 한다 — 지금 그 주석은 "배포"만 말하고 "제품 행"은 말하지 않는다.

---

## high

### [high] `src/main/licensing/licenseManager.ts:442,613` — 로컬 시계가 30일 넘게 앞서면 라이선스가 영영 복구되지 않는다 (실측)
**문제.** `activate()`와 `refresh()`는 서버가 방금 서명한 토큰을 **생 벽시계**(`deps.now()`)로 검증한다. `activationToken.ts:124`가 `exp <= nowMs`면 `expired`를 내므로, 시계가 토큰 TTL(30일)보다 크게 앞선 기기에서는 **정상 토큰이 항상 만료로 판정된다.** `activate`는 `:444`에서 이를 `badToken`으로 뭉개고, `refresh`는 `:615`에서 `settled`를 돌려주며 새 토큰을 **조용히 버린다**(`record.token` 불변).
**왜.** 이 파일의 `clockSafeNow` 주석(`:150-157`)이 회복 경로를 "유료 사용자: 온라인에서 재활성화 (서버가 바닥을 내려 준다)"라고 못 박는데, 그 경로가 바로 이 조건에서 막힌다 — `anchorClockToServerTime`은 검증 성공 뒤에만 불리기 때문이다. 임시 테스트로 실증했다(작성 후 삭제, 트리 클린 확인): 로컬 시계 `SERVER_NOW+60일`에서 `manager.activate(KEY)` → `'badToken'`, `record.token`은 여전히 `null`. 같은 조건 `+29일`은 정상 활성화 → 경계가 정확히 토큰 TTL이다. `clockAttacks.test.ts`는 `lastSeenMs`만 미래로 오염시키고 `now()`는 정상값으로 두므로(`:270,:296`) 이 경우를 한 번도 밟지 않는다. 그동안 화면에는 "서버 응답을 검증하지 못했습니다"만 뜬다 — 시계 얘기는 어디에도 없다.
**고치는 법.** 검증 시각을 서버가 준 사실 쪽으로 옮긴다: 활성화·갱신 경로에서는 `payload.iat`과 `deps.now()`의 차가 임계(예: TTL/2)를 넘으면 `expired` 대신 **`clockSkew`**를 새 실패 코드로 내고, 그 코드에 "이 Mac의 날짜·시각이 실제와 다릅니다. 시스템 설정에서 자동으로 맞춘 뒤 다시 시도하세요."를 ko·en 양쪽에 넣는다. 아니면 최소한 `verifyToken`의 `expired` 판정을 갓 받은 토큰에 대해서만 `payload.iat` 기준으로 바꾸고, `refresh`가 `unreachable`을 돌려 물러서며 재시도하게 한다(지금은 `settled`라 6시간마다 같은 실패를 반복한다).

### [high] `src/main/ipc-handlers.ts:273,383` — CalDAV·Google 오류 문구가 한국어 하드코딩이라 영어 사용자에게 그대로 나간다
**문제.** `describeError`(:273)·`describeGoogleError`(:383)와 그 주변 리터럴(`:300` "계정과 앱 암호를 먼저 입력하세요.", `:338` "연동 설정을 먼저 마치세요.", `:427` "구글 OAuth 클라이언트 ID가 설정되지 않았습니다…", `:472` "구글 계정과 캘린더를 먼저 선택하세요.")과 예외 메시지 전부(`caldav/client.ts:104,181,187`, `google/calendar.ts:46-54,151`, `google/oauth.ts:90-213`, `google-auth-flow.ts:54,67,77,114`)가 한국어 문자열이다. 렌더러는 이 값을 그대로 그린다 — `GoogleSyncSection.tsx:76,92,117` → `:174 <span>{message}</span>`, `CalendarSyncSection.tsx:92,116`.
**왜.** 앱에는 이미 이 문제의 해법이 있다: `shared/main-strings.ts`가 메인 프로세스 문구 표를 들고 `ui-language.ts`가 렌더러가 알려 준 언어로 조회한다. 그런데 표에 든 것은 리마인더·권한 프로브·메뉴·DB 실패 6개뿐이고, **동기화 오류 20여 개는 그 체계를 통째로 지나친다.** 결과적으로 영어 사용자가 iCloud 연결에 실패하면 "사용자 정보를 찾지 못했습니다. 서버 주소를 확인하세요."를 본다. `locales.test.ts`가 ko/en 대칭을 아주 엄격하게 지키고 있는데(`:47-63`, 라이선스 실패 코드는 타입으로까지 못 박는다) 그 검사가 닿지 않는 자리다.
**고치는 법.** 실패를 문자열이 아니라 **코드**로 올린다 — `CalDavError.code`·`GoogleApiError.code`·`OAuthError.code`가 이미 있으니 IPC 응답을 `{ ok, code, detail? }`로 바꾸고 렌더러가 `t('calendarSync.error.' + code)`로 그린다. 라이선스 쪽이 정확히 그 모양이고(`shared/license.ts`의 `ClientError` + `license.error.*`), `locales.test.ts:166-209`가 이미 "코드마다 ko·en 문구가 있다"를 강제하는 틀을 갖고 있어 그대로 확장하면 된다.

### [high] `src/main/ipc-gate.test.ts:98-99` — "잠겨도 자격증명은 지울 수 있다"는 정책에 UI 경로가 없다
**문제.** `calendar:disconnect`·`google:disconnect`를 일부러 `free`로 열어 두고(`ipc-handlers.ts:370,498`, 테스트가 `:95-99`에서 이유까지 적어 뒀다) "잠겼다고 저장된 비밀번호를 못 지우게 하면 유료화가 자격증명을 인질로 잡는 것"이라고 선언한다. 그런데 두 버튼은 설정 화면 안에만 있고(`CalendarSyncSection`·`GoogleSyncSection`은 `Settings.tsx:430,444`에서만 마운트), 설정은 잠금 화면 뒤에 있다.
**왜.** `LicenseGate.tsx:41`은 `<Dialog open>`을 `modal` 기본값(true)으로 연다 — Radix가 바깥 클릭·포커스·`aria-hidden`을 통째로 막고, `useKeyboardShortcuts.ts:69-75`가 `[role="dialog"][data-state="open"]`을 보고 나머지 단축키를 전부 쉬게 한다. 즉 잠긴 사용자는 사이드바의 설정 버튼을 누를 수 없고 단축키로도 갈 수 없다. 게이트가 직접 주는 것은 내보내기(`:100`)·구매·키 복구뿐이다. **정책은 IPC 층에만 존재하고 제품에는 존재하지 않는다** — 무료로 열어 둔 두 채널을 부를 수 있는 화면이 0개다.
**고치는 법.** 게이트의 내보내기 블록(`LicenseGate.tsx:97-112`) 옆에 "연동 해제" 항목을 둔다. 연결된 것이 있을 때만 그리면 되고(두 `get-config`도 `free`다), 문구는 기존 `calendarSync.disconnect`·`googleSync.disconnect`를 그대로 쓴다. 대안으로 잠금 상태에서 설정의 데이터·연동 섹션만 여는 축소 모드를 두는 방법도 있으나, 게이트 한 곳에 붙이는 쪽이 "게이트는 앱 전체에서 한 곳"이라는 이 파일의 설계를 지킨다.

### [high] `src/renderer/src/licensing/useActivation.ts:42` · `components/sidebar/LicenseSection.tsx:70` — IPC가 거절하면 잠금 해제 버튼이 영구히 비활성화된다
**문제.** 두 곳 모두 `await window.api.license*()`를 `try`로 감싸지 않는다. `activate`는 `setBusy(true)` → `await` → `setBusy(false)` 순서라 그 `await`가 reject하면 **`setBusy(false)`에 도달하지 못한다.** `canSubmit = !busy && …`(`:38`)이므로 버튼은 그때부터 영원히 disabled다. `LicenseSection.deactivate`(`:68-75`)의 `releasing`도 같은 모양이고, 그쪽은 `busy = activation.busy || releasing`(`:53`)이라 **활성화 버튼까지 같이 잠긴다.**
**왜.** 잠긴 사용자에게 이 입력칸은 유일한 출구다. 그 출구가 "다시 눌러도 아무 일이 없다"로 죽으면 남는 선택지는 앱 재시작뿐인데, 화면에는 실패했다는 표시조차 없다(`error`는 null인 채다). `licenseActivate`는 `free` 채널이라 게이트가 던지지는 않지만, 메인 핸들러의 예외·직렬화 실패·창 파괴 중 호출은 전부 reject로 온다. `useLicense.ts:30-33`은 같은 위험을 알아보고 `.catch`를 달아 두었다 — 활성화 경로만 빠졌다.
**고치는 법.** 두 함수의 `await`를 `try { … } catch { setError('network') } finally { setBusy(false) }`로 감싼다. `network` 문구("라이선스 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.")가 이 경우에도 정직하고, 무엇보다 버튼이 다시 눌린다.

### [high] `src/main/licensing/licenseManager.ts:645` — 취소·한도로 잠긴 사람에게 "체험 기간이 끝났습니다"가 뜬다
**문제.** `refresh()`가 `revoked`를 받으면 `clearLocalLicense(true)` → `settle()` → `evaluateTrial()`로 떨어져 상태가 `trialExpired`가 된다. 거부 이유는 그 자리에서 버려지고 `PublicLicenseState`(`shared/license.ts:27-45`)에 실리지 않으므로, `LicenseGate.tsx:45,47`이 `license.lockedTitle`("체험 기간이 끝났습니다")과 `lockedBody`("계속 쓰려면 라이선스가 필요합니다")를 그린다.
**왜.** 돈을 낸 사람이 **왜** 잠겼는지 못 보는 유일한 경로다. 환불로 취소된 키든, 관리자 조치든, 화면은 "체험판을 다 썼다"고 말한다. 사용자가 취할 수 있는 행동이 정반대로 갈리는데(환불이면 문의, 한도면 다른 기기 해제, 진짜 트라이얼 만료면 구매) 화면은 셋을 구분하지 않는다. (`TODOS.md:191-193`이 같은 결론을 적어 두었다.)
**고치는 법.** `LicenseState`에 `lockedReason?: 'revoked' | 'deviceLimit' | 'trial'`를 실어 `PublicLicenseState`까지 올리고, 게이트의 제목·본문을 그 값으로 가른다. `clearLocalLicense`가 이유를 인자로 받게 하면 저장 없이도 이번 세션 동안은 정확하고, 디스크에 남기면 재시작 뒤에도 유지된다(권한을 만들지 않는 값이라 서명 규칙을 깨지 않는다).

### [high] `src/renderer/src/i18n/locales/en.json:480,484,487` — "문의해 주세요"가 세 번 나오는데 앱에 문의 수단이 없다
**문제.** `license.error.incomplete`·`deactivationLimit`·`refused`가 "Please contact support" / "문의해 주세요"로 끝난다. `grep -rn "mailto\|supportUrl\|support@" src/` 결과 0건이고, 앱 메뉴(`app-menu.ts:47-58`)에는 Help 항목이 아예 없다. `endpoints.ts`가 여는 외부 URL은 `/buy`와 `/recover` 둘뿐이며 `/recover`는 키 재발송 메일만 한다(`bicmac-license/src/index.ts:210-233`).
**왜.** 이 셋은 **사용자가 스스로 풀 수 없는** 실패에 붙는 문구다. 즉 앱은 자기가 못 고치는 상황에서 존재하지 않는 창구를 가리킨다. `deactivationLimit`은 서버 기준 30일 3회 제한(`index.ts:245`)이라 정상 사용자도 밟을 수 있다.
**고치는 법.** `endpoints.ts`에 `supportUrl()`(메일 폼이나 `mailto:`)을 추가하고 `license:support` IPC(`free`)로 열되, 잠금 화면(`LicenseGate.tsx:78`)과 설정(`LicenseSection.tsx:133`)의 오류 블록 아래에 링크를 건다. 주소가 아직 없다면 문구에서 "문의해 주세요"를 빼고 실제로 가능한 다음 걸음(예: `deactivationLimit` → "30일 뒤 다시 시도할 수 있습니다")으로 바꾼다 — 없는 창구를 가리키는 것보다 낫다.

### [high] `src/main/licensing/licenseStore.ts:140-149` — 라이선스 파일이 깨져도 사용자에게 아무 말도 하지 않는다
**문제.** `readRaw`가 파싱에 실패하면 원본을 `.corrupt-…`로 복사하고 `console.error`만 남긴 뒤 빈 레코드를 돌려준다. 다음 `commit()`이 그 빈 레코드를 디스크에 못 박는다.
**왜.** 같은 저장소의 할일 파일은 정확히 이 상황에서 다이얼로그를 띄운다 — `database.ts:177`이 `.corrupt-` 사본을 만들고 `index.ts:130`이 `dialog.showErrorBox(uiStrings().dbFailedTitle, …)`로 "사본을 남겼고 이번 실행에서는 아무것도 저장하지 않습니다"를 알린다. 라이선스는 **더 작고 더 되돌리기 어려운** 파일인데(재발급은 서버·슬롯·지원이 걸린다) 같은 배려가 없다. enforcement가 켜진 뒤 이 일이 나면 돈을 낸 사람이 아무 설명 없이 트라이얼/잠금으로 떨어지고, 콘솔을 열어 볼 이유가 없다.
**고치는 법.** `createFileStore`에 `onCorrupt` 콜백을 두고 `service.ts`의 배선이 `dialog.showErrorBox`를 띄운다(`shared/main-strings.ts`에 `licenseFailedTitle/Body` 추가 — ko·en 양쪽). 문구에 사본 경로와 "설정에서 키를 다시 입력하면 복구됩니다"를 넣는다. 재활성화가 실제 회복 경로이므로 이건 안내만으로 닫힌다.

---

## medium

### [medium] `src/main/calendar-config.ts:22` · `google-config.ts:23` — `enabled`는 아무도 읽지 않는다. 자동 동기화가 없다
**문제.** `calendar:select`(`ipc-handlers.ts:328`)와 `google:select`(`:462`)가 `enabled: true`를 쓰고, 디코더가 읽고(`calendar-config.ts:79`, `google-config.ts:82`), `toPublicConfig`가 렌더러로 보내고, 두 섹션의 타입에도 선언돼 있다(`CalendarSyncSection.tsx:14`, `GoogleSyncSection.tsx:9`). **그런데 그 값을 조건으로 쓰는 코드가 저장소 전체에 없다.** `runSync`/`runGoogleSync`를 부르는 곳은 `calendar:sync-now`·`google:sync-now` 두 IPC뿐이고, 그 둘을 부르는 곳은 "지금 동기화" 버튼 두 개뿐이다(`CalendarSyncSection.tsx:112`, `GoogleSyncSection.tsx:113`).
**왜.** `enabled`라는 이름은 켜고 끄는 스위치가 있고 그 스위치가 뭔가를 자동으로 돌린다는 뜻이다. 실제로는 **주기 동기화도, 변경 시 동기화도, 종료 시 동기화도 없다.** `calendarSync.desc`("iCloud 캘린더에 올립니다. iPhone·iPad의 캘린더 앱에서 그대로 보입니다")와 `googleSync.desc`는 지속적인 반영을 약속하는 현재형인데, 실제로는 사용자가 설정을 열어 버튼을 누른 그 순간의 스냅샷이다. `calendarSync.syncFailures`("실패 {{count}}건 — 다음 동기화에서 다시 시도합니다" / "will retry on the next sync")는 스스로 오지 않는 "다음 동기화"를 약속한다.
**고치는 법.** 둘 중 하나를 고른다. ① `enabled`를 실제 스위치로 만든다 — 메인에 주기 타이머(예: 15분)와 앱 시작 시 1회를 두고, `enabled && 자격증명 있음`일 때만 돈다. 유료 채널이므로 `licensing()?.allowsPaidFeatures()`를 함께 본다. ② 자동 동기화를 안 할 거면 `enabled`를 지우고 두 `desc`를 "버튼을 누를 때 올립니다"로, `syncFailures`를 "다시 동기화하면 재시도합니다"로 정직하게 고친다.

### [medium] `src/main/google-config.ts:22` — `account`는 어디서도 채워지지 않는다 (`googleSync.connectedAccount`는 죽은 문구)
**문제.** `GoogleConfig.account`가 선언되고 디코드되고(`:81`) 렌더러로 나가지만(`toPublicGoogleConfig`), **어디에서도 대입되지 않는다.** `google:connect`(`ipc-handlers.ts:429`)는 `storeGoogle({ ...config, tokens, lastError: null })`만 하고, `startGoogleAuth`는 `TokenSet`만 돌려준다. 요청 스코프도 `calendar.app.created` 하나뿐이라(`google/oauth.ts:25`) 이메일을 알 방법 자체가 없다.
**왜.** `GoogleSyncSection.tsx:165-167`이 `config.account ? t('googleSync.connectedAccount', …) : t('googleSync.connected', { name: calendarName ?? 'Google' })`로 갈라지는데 앞 가지가 **영원히 죽어 있다.** ko·en 양쪽의 `googleSync.connectedAccount`("계정: {{account}}" / "Account: {{account}}")는 절대 그려지지 않는다. 캘린더를 고르기 전에는 뒤 가지가 "Google에 연결됨"이라 어느 계정에 붙었는지 알 수 없고, 계정을 두 개 쓰는 사람은 잘못된 계정에 붙은 것을 확인할 방법이 없다.
**고치는 법.** 스코프에 `openid email`을 더해 `userinfo`로 이메일을 받고 `google:connect`에서 `account`를 채우거나(동의 화면 문구가 늘어난다), 그게 싫으면 `account` 필드와 `googleSync.connectedAccount` 키를 ko·en 양쪽에서 지운다. `GoogleCalendarClient.listCalendars()`의 `primary` 캘린더 id가 대개 계정 이메일이므로 그 값을 쓰는 절충도 가능하다.

### [medium] `src/renderer/src/components/sidebar/CalendarSyncSection.tsx:16` · `GoogleSyncSection.tsx:11` — `lastError`를 저장·전송하지만 그리지 않는다
**문제.** 두 메인 핸들러가 실패할 때마다 `lastError`를 파일에 적고(`ipc-handlers.ts:313-314,361-362,412,433,491`) `toPublicConfig`가 렌더러로 올려 보내며 두 컴포넌트의 타입에도 있다. **렌더링하는 코드는 없다** — 화면에 뜨는 것은 이번 세션의 로컬 `message` state뿐이라 설정을 닫았다 열면 사라진다.
**왜.** `lastError`의 존재 이유가 정확히 "다시 열었을 때도 지난 실패를 보여 주는 것"이다. 지금은 디스크만 채우고 사용자에게는 닿지 않아, 어제 동기화가 실패했다는 사실을 알 방법이 없다. `lastSyncAt`은 그려지므로("마지막 동기화: …") 사용자는 **오래된 성공 시각만 보고 조용히 실패 중인 연동을 정상이라 믿는다.**
**고치는 법.** `message`가 없을 때 `config.lastError`를 같은 자리에 그린다(색은 `errorText`, 앞에 `lastSyncAt` 대비를 위해 "마지막 시도" 라벨). 성공 시 `lastError: null`이 이미 기록되므로 자동으로 사라진다. 위 [high] 항목의 코드화와 함께 하면 문구도 번역된다.

### [medium] `src/main/calendar-config.ts:112` · `google-config.ts:115` — `syncedCount`를 계산해 보내지만 아무도 그리지 않는다
**문제.** `toPublicConfig`/`toPublicGoogleConfig`가 `Object.keys(syncState).length`를 `syncedCount`로 실어 보내고 두 컴포넌트 타입에도 선언돼 있는데(`CalendarSyncSection.tsx:17`, `GoogleSyncSection.tsx:13`) 참조가 없다.
**왜.** "지금 몇 개가 올라가 있는가"는 단방향 동기화에서 사용자가 확인할 수 있는 유일한 상태다. 이게 없으면 `syncResult`(이번 회차 증분)만 보이므로, 두 번째 동기화 이후에는 항상 "올림 0 · 갱신 0 · 삭제 0"이라 **아무 일도 안 일어난 것처럼 보인다.**
**고치는 법.** `lastSync` 줄 옆에 "현재 {{count}}건 반영됨"을 ko·en에 추가해 그린다. 배관은 이미 끝까지 와 있다.

### [medium] `src/renderer/src/i18n/locales/ko.json` `calendarSync.provider*`·`serverUrl` — CalDAV 제공자 선택이 문구만 있고 UI가 없다
**문제.** `calendarSync.provider`("서비스"), `providerIcloud`, `providerCustom`("직접 입력 (CalDAV)" / "Custom (CalDAV)"), `serverUrl`("서버 주소") 네 키가 ko·en 양쪽에 있는데 `t()` 호출이 한 건도 없다(전 소스 스캔으로 확인). `CalendarConfig.provider`(`calendar-config.ts:14`)도 디코드만 되고 어디서도 설정되지 않으며, `CalendarSyncSection.tsx:80`은 언제나 `config.serverUrl`을 그대로 되돌려 보내 결국 `DEFAULT_CONFIG.serverUrl`(iCloud) 고정이다.
**왜.** `CalDavClient`는 임의 서버를 다루도록 만들어져 있고(`client.ts:104`의 https 강제 등) `discoverCalendars`도 범용인데, **사용자가 iCloud 말고 다른 CalDAV 서버를 넣을 입구가 없다.** 섹션 제목이 "캘린더 동기화"라 Fastmail·Nextcloud 사용자는 되는 줄 알고 들어왔다가 Apple ID 칸만 본다.
**고치는 법.** 제공자 라디오(iCloud / 직접 입력)와 서버 주소 입력칸을 붙이고 `calendar:save-credentials`에 `provider`를 함께 넘긴다 — 핸들러(`ipc-handlers.ts:278-296`)는 이미 `serverUrl`을 받도록 돼 있어 필드 하나만 늘리면 된다. 지원하지 않기로 정했다면 네 키와 `provider` 필드를 지우고 섹션 제목을 "iCloud 캘린더"로 좁힌다.

### [medium] `src/main/index.ts:162-207` — 업데이트 확인이 실패하면 화면이 "확인 중…"에서 영원히 멈춘다
**문제.** `autoUpdater`에 `update-available`·`update-not-available`·`download-progress`·`update-downloaded` 네 이벤트만 붙어 있고 **`error`가 없다.** 렌더러의 `updateChecked`는 앞의 두 이벤트로만 true가 되므로(`App.tsx:67-72`), 피드에 못 닿거나 `latest-mac.yml`이 없거나 서명 검증이 실패하면 `Settings.tsx:681-684`가 `settings.checkingUpdate`("업데이트 확인 중…")를 무기한 그린다.
**왜.** 같은 증상이 정상 경로에서도 난다 — `canSelfUpdate`가 false인 개발 빌드에서는 `autoUpdater` 블록 자체가 안 돌아 이벤트가 하나도 오지 않는다(스토어 빌드는 `updatesViaStore` 가지가 먼저 잡아 준다). 그리고 README가 "**DMG:** Open Settings → Check for Updates in-app"이라고 안내하는데(`README.md:89`) 그런 컨트롤은 존재하지 않는다 — 확인은 시작 시 1회 + 1시간마다 자동이고 사용자가 누를 버튼이 없다. 즉 문서가 시킨 대로 하러 간 사용자가 영원히 도는 스피너 문구를 만난다.
**고치는 법.** ① `autoUpdater.on('error', …)`를 추가해 `update-error`를 보내고 렌더러가 `updateChecked=true` + 실패 문구를 그린다(ko·en 신규 키). ② "지금 확인" 버튼과 `check-update` IPC(`free`)를 추가하거나, README의 그 줄을 실제 동작("앱이 자동으로 확인하고, 새 버전이 있으면 설정에 알림이 뜹니다")으로 고친다.

### [medium] `src/renderer/src/i18n/locales/en.json` `settings.updateDownload` — 버튼은 앱 안에서 받는데 문구는 "다운로드 페이지 열기"라고 말한다
**문제.** ko "Greenday v{{version}} — 클릭하여 다운로드 페이지 열기", en "…click to open the download page". 그런데 그 아래 버튼(`Settings.tsx:720-724`)은 `window.api.downloadUpdate()`를 불러 **앱 안에서 받고**, 문구도 `settings.updateDownloadNow`("지금 다운로드")다. 진행률 바(`:706-716`)와 "재시작하여 설치"까지 인앱 흐름이다.
**왜.** 인앱 다운로드가 나중에 붙으면서(`Settings.tsx:702-703` 주석이 그 전환을 기록한다) 설명 문구만 예전 상태로 남았다. 사용자는 브라우저가 열릴 줄 알고 누르고, 아무 창도 안 뜨는 대신 진행률이 도는 것을 본다.
**고치는 법.** ko·en의 `settings.updateDownload`를 "Greenday v{{version}}을(를) 받을 수 있습니다" / "Greenday v{{version}} is available"로 고친다. 릴리스 노트는 이미 `settings.updateViewRelease` 링크가 따로 있다.

### [medium] `README.md:36-53` · `docs/README.ko.md:40-50` — 캘린더 동기화 두 기능이 문서에 아예 없다
**문제.** 기능 표에 Task/AI/Calendar/Kanban/Pomodoro/Habits/Eisenhower/Timeline/Stats까지 다 있는데 **iCloud(CalDAV) 동기화와 Google 캘린더 동기화가 없다.** 두 README 어디에도 "sync"라는 말이 없다(ko는 "캘린더 동기화" 0건).
**왜.** 같은 저장소의 `TODOS.md:226-234`는 이 둘을 가격 정책의 핵심 판매 문구("iCloud와 Google 캘린더 모두 지원, 추가 결제 없음 — TickTick 대비 현재 가진 유일한 가격 무기")로 삼는다. 랜딩과 저장소 첫 화면이 그 무기를 언급하지 않는다. 설정을 끝까지 스크롤해야 발견할 수 있는 기능이다.
**고치는 법.** 두 README의 기능 표에 두 줄을 추가하고(각각 한 방향임을 명시 — `calendarSync.oneWayNote`와 같은 말), Google 쪽은 위 [critical] 항목이 닫히기 전까지는 "빌드에 OAuth 클라이언트 ID가 있는 경우"라는 단서를 단다.

### [medium] `src/renderer/src/i18n/locales/en.json:478,479` — `noDevice`·`badToken`에 사용자가 할 수 있는 일이 없다
**문제.** "Could not identify this device." / "The server's reply failed verification."로 끝난다. 같은 표의 `incomplete`·`deactivationLimit`·`refused`는 문의를, `deviceLimit`은 다른 기기 해제를, `saveFailed`는 디스크 확인을, `network`는 재시도를 안내한다 — 이 둘만 진단으로 끝난다.
**왜.** `noDevice`는 `activate`·`deactivate` 양쪽에서 나오고(`licenseManager.ts:431,486`), 후자는 "슬롯은 잡혀 있는데 이 기기가 자기 이름을 못 댄다"는 정확히 사용자가 막히는 상황이다. `badToken`은 위 [high]에서 본 대로 **시계 문제일 때도** 여기로 온다. 둘 다 다음 걸음이 실제로 있다(재시작 / 시계 확인 / 문의).
**고치는 법.** `noDevice` → "이 기기를 식별하지 못했습니다. 앱을 다시 시작한 뒤 시도해 주세요. 계속되면 문의해 주세요." (`readDeviceId`가 실패해도 다음 호출이 재시도하므로 사실이다). `badToken` → "서버 응답을 검증하지 못했습니다. 이 Mac의 날짜·시각이 정확한지 확인한 뒤 다시 시도해 주세요." — 위 항목의 `clockSkew` 코드를 넣기 전까지의 최소 조치다.

### [medium] `src/renderer/src/licensing/LicenseGate.tsx:50` · `LicenseSection.tsx:98` — 키 입력칸에서 Enter가 아무것도 하지 않는다
**문제.** 두 `<input>` 모두 `<form>` 밖에 있고 `onKeyDown`이 없다. 키를 붙여넣고 Enter를 눌러도 활성화가 시작되지 않는다 — 마우스로 옆 버튼을 눌러야 한다.
**왜.** `useActivation.ts:8-10`의 주석이 "앞으로 붙일 것들(붙여넣기 시 공백 제거, **Enter 제출**, 재입력하면 오류 지우기…)"이라고 스스로 미완임을 적어 두었고, 셋 중 오류 지우기만 구현됐다. 잠금 화면은 사용자가 키 하나 넣으려고 오는 화면이라, 가장 흔한 동작이 무반응인 것은 "고장 났나" 하고 다시 붙여넣게 만든다. 붙여넣기 정규화도 같이 빠져 있어 메일에서 줄바꿈이 딸려 온 키는 `looksValidKey`(`licenseKey.ts:19`)를 통과하지 못하고 "키 형식이 맞지 않습니다"로 튕긴다 — 사용자 눈에는 멀쩡한 키다.
**고치는 법.** `useActivation`에 `onKeyDown`(Enter이고 `canSubmit`이면 `activate()`)을 함께 노출해 두 화면이 같은 것을 쓰게 한다. 같은 자리에서 `setKey`가 `value.replace(/\s+/g, '')`로 공백·줄바꿈을 걷어내면 붙여넣기 문제도 닫힌다(대문자화는 `normalizeKey`가 이미 한다).

### [medium] `src/renderer/src/components/sidebar/LicenseSection.tsx:142-152` — "이 기기 해제"에 확인도 경고도 없다
**문제.** 버튼 한 번에 `window.api.licenseDeactivate()`가 나가고 서버 슬롯이 풀린다. 확인 다이얼로그가 없고, 설명(`license.deactivateDesc` — "다른 기기에서 쓰려면 여기서 먼저 해제하세요")은 **이 앱이 그 즉시 잠긴다는 말을 하지 않는다.**
**왜.** enforcement가 켜진 뒤 이 버튼을 누르면 `clearLocalLicense(false)` → `settle()` → `trialExpired` → `LicenseGate`가 설정 위로 덮인다. 되돌리려면 키를 다시 넣어야 하고, 서버는 30일에 3회만 해제를 허용하므로(`bicmac-license/src/index.ts:245`) 실수로 누른 한 번이 한도의 1/3을 태운다. 저장소에는 이런 파괴적 동작을 위한 `ConfirmDialog`가 이미 있고 휴지통 비우기 등에 쓰인다.
**고치는 법.** `ConfirmDialog`로 감싸고 본문에 두 가지를 적는다 — "이 Mac에서 라이선스가 해제되어 앱이 잠깁니다"와 "해제는 30일에 3회까지 가능합니다". `license.confirmDeactivateTitle/Body`를 ko·en에 추가한다.

### [medium] `src/renderer/src/store/useStore.ts:999-1001` · `components/tasks/TaskDetail.tsx:415` — 첨부 추가 실패가 조용히 사라지거나 unhandled rejection이 된다
**문제.** `pickAttachment`는 `paid` 채널이라 잠기면 `LICENSE_REQUIRED`로 reject하고, 파일 복사 실패로도 던질 수 있다. 스토어 액션은 `persist()`를 거치지 않아 `report()`(`:360`)의 라이선스 감지도 타지 않는다. `TaskDetail.tsx:415`는 `await pickAttachment()`를 그대로 두어 **unhandled rejection**이 되고, `AttachmentList.tsx:33-42`는 `catch`하지만 주석이 "사용자가 파일 선택을 취소한 경우"라고 적혀 있다 — 취소는 `ipc-handlers.ts:127`에서 `[]`를 돌려주므로 던지지 않는다. 즉 그 `catch`가 실제로 삼키는 것은 **진짜 실패뿐**이다.
**왜.** 사용자는 "파일 추가"를 눌렀는데 아무 일도 일어나지 않는 것을 본다. 잠금 화면이 덮여 있으면 애초에 못 누르지만, `pickAttachment`는 다이얼로그가 열려 있는 동안 트라이얼이 끝날 수 있어 핸들러가 **선택 후에 다시** 판정한다(`ipc-handlers.ts:132`) — 정확히 그 경로가 여기로 온다.
**고치는 법.** 스토어의 `pickAttachment`를 `persist`와 같은 실패 보고 경로에 태우거나(최소한 `report('pickAttachment', e)` 후 `[]` 반환), 두 호출처가 같은 `try/catch`를 갖게 한다. `AttachmentList`의 주석은 사실과 다르므로 함께 고친다.

### [medium] `src/main/index.ts:152-159` — 잠긴 앱이 계속 리마인더 알림을 띄운다
**문제.** 리마인더 폴러가 `Notification.isSupported()`만 보고 60초마다 `getTasks()`를 직접 읽어 알림을 띄운다. 라이선스 판정이 전혀 없다.
**왜.** `license.lockedBody`는 "계속 쓰려면 라이선스가 필요합니다"라고 말하는데 앱은 계속 알림을 보낸다. 둘 중 하나가 거짓말이다 — 잠금이 진짜라면 알림이 나가면 안 되고, "이미 만든 것에 대한 접근은 막지 않는다"(내보내기·연동 해제를 무료로 둔 원칙)가 맞다면 잠금 문구가 그 예외를 말해야 한다. 어느 쪽이든 제품 결정이 필요하고, 지금은 결정 없이 양쪽을 다 하고 있다. (`TODOS.md:210-213`이 같은 결론.)
**고치는 법.** 결정에 따라 ① 폴러 앞에 `licensing()?.allowsPaidFeatures() === false`면 건너뛰기(단, `lastReminderCheck`는 전진시키지 말 것 — 그 구간의 리마인더가 영영 소모된다), 또는 ② `license.lockedBody`에 "이미 설정한 리마인더는 계속 도착합니다"를 명시. 코드로 몰래 정하지 말고 하나를 고른다.

### [medium] `src/main/ipc-handlers.ts:60-66` — 라이선스 모듈 초기화 실패가 "잠시 후 다시 시도해 주세요"로 나온다
**문제.** `license:activate`가 `if (!manager) return 'network'`를 돌려준다. `manager`가 null이 되는 유일한 길은 `service.ts:60-66` — 임베드된 공개키를 못 읽은 빌드다(상수 오타).
**왜.** `license.error.network`는 "라이선스 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요."다. 그런데 이건 **재시도로 절대 낫지 않는 빌드 결함**이고, 그 사실은 `service.ts:62-63`의 주석이 "증상이 '결제했는데 활성화가 안 된다'로만 나타나고, 그때는 이미 사람이 돈을 낸 뒤다"라고 이미 적어 두었다. 지금 코드가 그 증상을 정확히 만든다 — 무한 재시도 안내로.
**고치는 법.** `ActivateFailure`에 `notInitialized`를 추가하고 ko·en에 "이 빌드에 문제가 있어 활성화할 수 없습니다. 앱을 최신 버전으로 업데이트한 뒤 문의해 주세요."를 넣는다. `locales.test.ts:168-181`의 `Record<ActivateFailure, true>`가 코드를 추가하는 순간 문구를 강제하므로 빠뜨릴 수 없다.

### [medium] `src/main/licensing/licenseManager.ts:431` + `LicenseGate.tsx` — 기기 한도에 걸린 사용자에게 앱 안에도 웹에도 출구가 없다
**문제.** `license.error.deviceLimit`은 "쓰지 않는 기기에서 먼저 해제해 주세요"라고 말한다. 그 해제는 **그 다른 기기의 설정 화면**에서만 할 수 있다. 서버에는 기기 목록 엔드포인트가 없고(`bicmac-license/src/index.ts:55-77`의 라우트 표에 `/v1/devices` 없음), `/recover`는 키를 메일로 다시 보낼 뿐이다.
**왜.** 두 번째 기기가 고장·분실·초기화된 흔한 경우에 사용자가 스스로 할 수 있는 일이 0이다. `LicenseSection.tsx:21-24`의 주석이 "안내만 하고 푸는 방법을 주지 않으면 지원 메일함이 그 벽의 유일한 출구가 된다"고 스스로 적었는데, 정확히 그 상태이고 심지어 지원 메일함 주소도 없다(위 [high]).
**고치는 법.** `TODOS.md:321-346`이 이미 설계를 적어 두었다 — `POST /v1/devices { key }` 하나면 `admin.ts:145`의 쿼리를 키로 좁혀 재사용할 수 있고, 앱 쪽은 `licenseClient.listDevices` + `LicenseSection`의 버튼을 목록으로 교체하면 된다. 서버가 준비되기 전까지의 임시 조치로, `deviceLimit` 문구에 `/recover` 또는 문의 링크를 붙여 최소한 사람에게 닿는 길을 연다.

---

## low

### [low] `src/renderer/src/components/sidebar/Settings.tsx:259` — `capabilities()` 실패가 라이선스 섹션과 업데이트 UI를 통째로 지운다
**문제.** `window.api.capabilities?.().then(setCaps)` — `.catch`가 없다. reject하면 unhandled rejection이 되고 `caps`가 null에 머문다.
**왜.** `caps?.needsLicenseKey`(`:412`)가 falsy라 **라이선스 섹션이 아예 그려지지 않고**, `updatesViaStore`/`canSelfUpdate`도 false 폴백이라 버전 칸이 "확인 중…"에 갇힌다. 직판 빌드에서 키를 넣을 곳이 사라지는 결과다. `useLicense.ts:30-33`은 같은 위험에 `.catch`와 로그를 달아 두었다.
**고치는 법.** `.catch((e) => console.error('[capabilities] …', e))`를 붙인다. 실패 시 어느 쪽으로 기울지도 정한다 — 스토어 빌드에서 잘못 그리면 3.1.1 리젝이므로 지금의 "안 그림"이 안전한 기본값이고, 그렇다면 그 판단을 주석으로 남긴다.

### [low] `src/renderer/src/hooks/useKeyboardShortcuts.ts:56-59` — 잠금 화면 위에서 Cmd+Shift+A가 빠른 추가를 연다
**문제.** Cmd+Shift+A 분기가 오버레이 가드(`:69-75`)보다 **위**에 있어 의도적으로 그 가드를 우회한다. 전역 단축키 경로도 같다 — `register-global-shortcut`은 `free` 채널이고(`ipc-handlers.ts:509`) `App.tsx:81-83`이 `setShowQuickAdd(true)`를 부른다.
**왜.** 잠긴 상태에서 빠른 추가로 제목을 넣고 Enter를 누르면 `addTask`가 **낙관적으로 스토어에 먼저 쓰고** `create-task`(유료)가 거절당한다 — 화면에만 존재하는 유령 할일이 남는다(`TODOS.md:189-193`의 "낙관적 편집의 되돌리기가 없다"와 같은 계열). 실제로 QuickAdd 다이얼로그가 게이트 위에 그려지는지는 두 Radix 포털의 마운트 순서에 달려 있어 **추측이다**(둘 다 `z-overlayContent`로 같고, 나중에 열린 쪽이 body 뒤쪽에 붙어 위로 온다). 다만 단축키가 가드를 지나 스토어 플래그를 켠다는 것은 소스에서 확정적이다.
**고치는 법.** Cmd+Shift+A 분기 앞에서도 오버레이 가드를 보게 하되 QuickAdd 자신만 예외로 둔다(지금 위로 올린 이유가 그것이다). 또는 `QuickAdd`가 `useLicense()`를 보고 `allowsPaidFeatures`가 false면 열지 않는다.

### [low] `src/main/licensing/endpoints.ts:39-41` — 구매 유입 계측 `src` 파라미터를 아무도 받지 않는다
**문제.** `purchaseUrl`이 `?product=greenday&src=settings|locked`를 붙이고, 주석(`:16-17,34-37`)이 "어느 화면에서 구매 페이지로 갔는지. 나중에는 알아낼 방법이 없다"며 순수 함수+테스트로 못 박기까지 한다. 서버에서 `src`를 읽는 코드는 0건이다(`web/buy.html`·`web/success.html`·`src/purchase.ts`·`src/webhooks/*` 전수 확인 — `buy.html`의 `src`는 `<script>` 로더 지역변수다).
**왜.** 계측을 하고 있다고 믿게 만드는 반쪽 배선이다. 결제 레일로도 넘어가지 않으므로(`buy.html:171-177`의 `orderId`는 `${slug}-uuid`) 귀속은 어디에도 남지 않는다.
**고치는 법.** 서버 쪽에서 `buy.html`이 `src`를 읽어 결제 `custom_data`/`order_description`에 실어 보내고 `logEvent`가 남기게 하거나(서버는 사장님 몫), 그때까지는 앱 주석에서 "지금은 서버가 받지 않는다"를 명시한다 — 지금 주석은 계측이 동작한다고 읽힌다.

### [low] `README.md:136` · `docs/README.ko.md:122` — "Apple Silicon 전용"이라고 쓰고 x64를 빌드해 배포한다
**문제.** 두 README가 "Apple Silicon only (M1/M2/M3/M4) — *Intel Macs are not supported*"라고 적는다. `.github/workflows/release.yml:72`는 `npx electron-builder --mac --arm64 --x64 --publish always`이고, `:105-110`의 cask 갱신이 `haru-${VERSION}-x64.dmg`의 SHA를 계산해 tap에 넣는다.
**왜.** Intel 사용자가 문서를 읽고 포기하거나, 반대로 릴리스 목록에서 x64 dmg를 받아 쓰면서 지원 대상인지 아닌지 알 수 없다.
**고치는 법.** 둘 중 하나로 맞춘다 — Intel을 지원한다면 문서에서 그 줄을 빼고, 아니라면 워크플로에서 `--x64`와 cask의 x64 항목을 뺀다.

### [low] `src/renderer/src/i18n/locales/*.json` — 쓰이지 않는 키 6개
**문제.** 전 소스 스캔에서 참조가 없는 키: `common.add`, `date.yearMonthDay`, `detail.addSubtaskPlaceholder`, `detail.listLabel`, `detail.notesLabel`, `detail.scheduled`. (`*_one`/`*_other`는 복수형이라 정상이고, `calendarSync.provider*`는 위 medium 항목에서 따로 다뤘다.)
**왜.** `locales.test.ts:78-95`가 "소스가 참조하는 키는 로케일에 있다"는 한 방향만 검사한다. 반대 방향이 없어 죽은 문구가 쌓이고, 다음 사람은 `detail.scheduled`를 보고 "예정 범위 표시가 있다"고 믿는다.
**고치는 법.** 지운다. 그리고 그 테스트에 역방향 검사를 추가하되, 템플릿 리터럴로 조회하는 접두사(`license.error.`, `nav.`, `shortcuts.` 등)는 화이트리스트로 예외 처리한다 — 라이선스 실패 코드 검사(`:166-209`)가 이미 그 예외를 개별적으로 메우는 선례다.

### [low] `src/renderer/src/i18n/locales/en.json` `settings.updateDownloading` · `settings.notifPermProbeSent` — 타이포그래피가 나머지와 다르다
**문제.** `updateDownloading`이 `'Downloading... {{percent}}%'`로 ASCII 마침표 셋을 쓴다(다른 진행 문구는 전부 `…` — `activating`, `connecting`, `syncing`, `pullPreparing`). `notifPermProbeSent`는 `'System Settings -> Notifications'`로 ASCII 화살표를 쓰는데 한국어 대응 문구는 `→`이고 `ai.destLocal`·`oneWayNote` 등도 `→`다.
**왜.** 영어가 번역투는 아니지만(전반적으로 자연스럽다), 이 둘만 다른 손이 쓴 것처럼 보인다.
**고치는 법.** `…`와 `→`로 통일한다.

### [low] `src/renderer/src/i18n/locales/*.json` `license.freeDesc` — 트라이얼 길이를 켜지기 전에 아무도 말하지 않는다
**문제.** enforcement 전 문구는 "아직 라이선스가 필요하지 않습니다. 유료 전환이 시작되면 여기에서 키를 넣게 됩니다."다. 30일이라는 숫자가 앱 어디에도 없고, 켜지는 순간 사용자는 예고 없이 "체험판 · 30일 남음"을 보게 된다.
**왜.** `service.ts:27-29`의 설계 의도는 "켜는 날 모두가 온전한 30일을 받는다"인데, 받는 사람은 그것이 30일짜리라는 것도 언제 시작됐는지도 미리 듣지 못한다.
**고치는 법.** `freeDesc`에 "유료 전환이 시작되면 30일 체험이 그때부터 시작됩니다"를 넣는다. 숫자는 `trialWindow.ts:10`의 `TRIAL_DURATION_MS`가 원본이므로, 문구에 `{{days}}`를 두고 그 상수에서 계산해 넘기면 둘이 어긋나지 않는다.

---

## 확인했고 문제 없었던 것 (참고)

닫힌 것을 다시 열지 않도록 남긴다.

- **IPC 등급 경계.** `ipc-gate.test.ts:133-140`의 런타임 대조(목킹된 `ipcMain.handle`이 본 채널 집합 == `registeredTiers()`)가 실제로 우회를 잡는다. `FREE_CHANNELS` 25개 통째 단언도 살아 있다.
- **`__IS_DEV_BUILD__` 주입.** `npx electron-vite build` 후 `out/main/index.js:2359-2365`에서 `enforcesLicense: !isStoreBuild`로 접혀 있다 — 빌드 시점에 `false`가 박혔다는 뜻이다. 런타임 탐지 우회는 닫혀 있다.
- **ko/en 키 대칭.** `locales.test.ts`가 키 집합·보간 변수·배열 길이·라이선스 실패 코드 문구를 전부 강제한다. 비대칭 0건.
- **영어 문구 품질.** 436개 키를 통독했다. 번역투로 읽히는 문장은 없다 — `license.buyDesc`("Pay once, keep it. Not a subscription."), `ai.actionUnclear`, `googleSync.scopeNote` 등은 영어로 먼저 쓴 것처럼 읽힌다. 위 low 두 건은 표기 통일 문제일 뿐이다.
- **capabilities 게이팅 자체.** `capabilitiesFor`(`shared/capabilities.ts:75-85`)의 다섯 술어는 스토어/개발/직판 세 축에서 의도대로 갈린다. `needsLicenseKey`(그릴 것인가)와 `enforcesLicense`(잠글 것인가)를 나눠 둔 것이 핵심이고 `service.ts:51-53`이 후자만 본다 — 개발 빌드가 30일 뒤 스스로 잠기는 사고는 닫혀 있다.
- **동기화 재시도 의미론.** `calendar-sync.ts:64-105`·`google-sync.ts:58-81`이 실패 항목의 `state`를 갱신하지 않아 다음 회차에 다시 시도되고, `not_found`는 상태에서 빼 무한 재시도를 막는다. href/uid가 taskId에서 결정적으로 파생되므로 치명적 오류로 중단된 뒤 재실행해도 중복 이벤트가 생기지 않는다.
- **`google:disconnect`의 "실패해도 로컬 토큰은 지운다".** `revokeToken`(`google/oauth.ts:231-242`)이 예외를 삼키고 boolean을 돌려주므로 주석대로 동작한다.
