# Greenday 코드베이스 감사 — 통합 리포트

- **대상**: `supaicy/coordinate` @ `1ccf433` (Electron 40 + React + TS, macOS 할일 앱)
- **일자**: 2026-08-28
- **감사자**: 8개 워커 — 관심사(보안·기능·버그·성능) × 엔진(claude·codex)
- **기준선**: `tsc --build` 0 · `biome lint` 0 · `vitest run` **915 passed / 59 files**
  — **아래 결함은 전부 그 초록불 아래에 있다.**
- **앱 코드는 고치지 않았다.** 이것은 감사다. 서버(`~/Code/services/bicmac-license`)는 읽기 전용 대조.

## 이 문서를 읽는 법

같은 결함을 두 엔진이 각각 찾은 경우가 많다. 각 항목에 출처를 달았다:

- **⚑ 교차 확인** — claude와 codex가 독립적으로 같은 결함에 도달했다. 오탐 가능성이 가장 낮다.
- **C** = claude만, **X** = codex만 찾았다. 단일 출처라고 덜 진짜인 것은 아니다 —
  아래 [단일 출처가 중요한 이유](#단일-출처가-중요한-이유)를 볼 것.

심각도는 **통합 심각도**다. 두 엔진의 평가가 갈린 경우 높은 쪽을 취하고
[심각도가 갈린 항목](#심각도가-갈린-항목)에 따로 적었다.

제외한 것(지시대로): `IS_ENFORCED = false` 자체, "설정 폴더를 지우면 트라이얼이 리셋된다".

---

# CRITICAL — 출하를 막는 것

## C1. CalDAV 응답 안의 href가 그대로 요청 URL이 되고, 그 요청에 iCloud 앱 암호가 실린다 ⚑

`src/main/caldav/client.ts:112-114` (claude) · `:128` (codex)

`absolute()`가 `href.startsWith('http') ? href : new URL(href, origin)`이다. **두 갈래가 둘 다
출처를 벗어난다.** claude 실측:

```
"https://evil.example/steal" -> https://evil.example/steal   (절대 URL 그대로)
"http://evil.example/steal"  -> http://evil.example/steal    (평문 HTTP까지)
"//evil.example/x"           -> https://evil.example/x       (프로토콜 상대)
```

그 결과가 `request()`로 들어가고, `request()`는 URL이 무엇이든 `Authorization` 헤더를 붙인다(`:131`).
생성자의 https 강제(`:101-105`)는 **최초 `serverUrl`에만** 걸리고, 3xx 방어(`:152-161`)는 리다이렉트에만
걸린다 — 본문 안의 href는 어느 쪽도 지나지 않는다.

도달 경로가 둘이다:
1. **원격 서버** — `discoverCalendars`가 principal → home-set → 컬렉션 href를 전부 서버 응답에서 읽어
   `absolute()`에 넣는다. 침해된 CalDAV 서버가 첫 PROPFIND 응답 한 번으로 다음 요청을 자기 호스트로 보낸다.
   그 href가 `calendar-config.json`에 저장되므로(`calendar-sync.ts:57-62`) **오염이 지속된다.**
2. **렌더러** — `calendar:select`(`ipc-handlers.ts:319-333`)는 `calendarUrl: String(url)`로 스킴도 출처도
   검사하지 않는다. 렌더러 한 줄로 앱 암호를 임의 호스트에 흘릴 수 있다.

iCloud 앱 암호는 사용자의 캘린더·연락처 전체에 대한 자격증명이다. 이 파일은 자격증명이 새지 않게
하려고 이미 두 군데를 막아 뒀는데, 정작 가장 넓은 입구가 열려 있다.

**고치는 법.** `absolute()`가 **항상** `new URL(href, this.origin)`로 해석하고 `origin !== this.origin`이면
던진다. 같은 검사를 `request()` 진입부에 한 번 더 둬 `listEvents`/`putEvent`처럼 밖에서 들어오는 URL도
걸리게 한다. `calendar:select`에서도 저장된 `serverUrl`과 같은 출처인지 확인한다.

## C2. 창에 파일을 떨어뜨리면 그 페이지가 `window.api` 전부를 물려받는다 (C)

`src/main/index.ts:36-74` + `src/main/ipc-gate.ts:70-82`

`createWindow()`에 `setWindowOpenHandler`만 있고 `will-navigate`/`will-frame-navigate`가 없다
(`grep` 0건). 렌더러의 drop 핸들러는 할일 목록·캘린더 셀 같은 특정 요소에만 붙어 있고
`document`/`window` 수준 `dragover`+`drop` `preventDefault`가 없다(`grep` 0건). 사이드바·헤더·빈 공간에
떨어뜨리면 Electron 기본 동작(그 파일로 네비게이트)이 그대로 산다.

그 뒤가 문제다. preload는 그 webContents가 **어떤 페이지를 로드하든** 다시 실행되므로
`exposeInMainWorld('api', api)`가 새 문서에도 걸린다. `index.html`의 CSP는 옛 문서의 메타 태그라
새 문서에 적용되지 않는다. 그리고 **`ipc-gate.ts`의 `handle()`이 `event.senderFrame`을 보지 않는다** —
어떤 출처가 부르든 등급만 본다(이 절반은 codex도 `ipc-gate.ts:70`에서 독립적으로 지적했다 ⚑).

결과: HTML 파일 하나를 창에 떨어뜨리면 그 페이지가 `export-data`, `open-attachment`, `open-external`,
`license:activate`, `calendar:select`(→ **C1과 결합해 앱 암호 탈취**), 그리고 라이선스가 살아 있는 동안
모든 `paid` 채널을 호출한다. 렌더러에 XSS 싱크가 없다는 사실이 방어가 되지 않는다 — 코드 실행 발판이
필요 없고 드래그 한 번이면 된다.

> *claude 표기*: 가드가 없다는 것은 코드로 확인. "떨어뜨리면 네비게이트한다"는 Electron 문서화된 기본
> 동작이며 이 감사에서 GUI로 재현하지는 않았다.

**고치는 법.** 세 겹으로 — ① `will-navigate`/`will-frame-navigate`에서 시작 URL 외 차단,
② `main.tsx`에서 문서 수준 `dragover`/`drop` `preventDefault`, ③ `ipc-gate.handle()`에서
`event.senderFrame.url`이 앱 문서(dev면 `ELECTRON_RENDERER_URL`, 아니면 번들 `file://`)인지 확인.
`free`/`paid` 양쪽 모두에 걸어야 의미가 있다.

## C3. 렌더러가 엔드포인트만 바꾸면 메인이 보관한 AI 키가 공격자 서버로 나간다 ⚑

`src/main/ai-service.ts:81` (codex) · `:53-70`, `:94-111` (claude)

**codex의 각도**: 마스킹된 API 키를 받으면 기존 원본 키를 유지하면서 `baseUrl`·`provider` 변경은
허용한다. 렌더러가 엔드포인트만 공격자 서버로 바꾼 뒤 연결 확인이나 AI 요청을 부르면 메인이 보관한
키가 `Bearer` 헤더로 유출된다.

**claude의 각도**: 차단 목록 `isAllowedUrl`이 IPv6와 DNS 이름을 전혀 보지 않고, 검사가 **저장할 때만**
걸린다. 실측:

```
http://[fd00::1]/                 -> true   (IPv6 ULA, 사설망)
http://[::ffff:10.0.0.5]/         -> true   (IPv4 매핑 → 10.0.0.5)
http://metadata.google.internal/  -> true   (DNS 이름 → 169.254.169.254)
http://169.254.169.253/           -> true   (링크로컬 — .254 하나만 막혀 있다)
```

더 큰 문제는 **적용 지점**이다. `setAiConfig`만 검사하고(`:73`), 요청을 실제로 보내는
`checkConnection`(`:97,106`) · `warmupModel`(`:120`) · `callLlm`(`:363`) · `streamChat`(`:571`) 중
어느 것도 `isAllowedUrl`을 부르지 않는다. 응답 본문이 렌더러로 돌아가므로 **읽기까지 되는 SSRF**다.

덧붙여 `checkConnection`은 `localOnly` 잠금도 건너뛴다 — 설정 화면의 자물쇠 문구는 "외부 AI 제공자를
차단해 데이터가 기기를 벗어나지 않습니다"인데(`ko.json:350`), 연결 확인 버튼이 그 약속을 깬다.

**고치는 법.** 키를 provider와 정규화한 오리진에 결속하고 둘이 바뀌면 기존 키를 지운다. 차단은 호스트
문자열이 아니라 **해석된 주소**로 판정하고(`dns.lookup` 결과가 사설/루프백/링크로컬/ULA/IPv4매핑이면 거절),
그 검사를 `setAiConfig`가 아니라 요청을 보내는 공통 지점에 둔다. `localOnly` 검사도 같은 자리로 합친다.

## C4. 저장이 원자적이지 않고 세대가 직렬화되지 않아, 조용한 데이터 손실 경로가 둘 있다 ⚑

`src/main/database.ts:81` · `:84` (codex critical) · `:81-102` (claude low) · perf-claude `:81` (low)

**⚠ 두 엔진의 심각도가 가장 크게 갈린 항목이다** — codex는 critical, claude는 low.
claude는 "느린 디스크에서만 나는 종류"로 봤고, codex는 **지연 주입으로 실제 재현**했다.

1. **세대 미직렬화** — A 저장 진행 중 B를 추가하고 `closeDatabase()`로 `[A,B]`를 쓴 뒤,
   A 콜백이 착륙하자 파일이 **`[A]`로 되돌아갔다**(codex 재현). 구형 콜백이 새 저장의 `savePending`까지
   `false`로 만들 수 있다. macOS는 `window-all-closed`에서 앱이 끝나지 않으므로(`index.ts:212-217`)
   이 창이 실제로 살아남는다.
2. **비원자적 전체 쓰기** — 유일한 할일 DB를 대상 파일에 직접 잘라 쓴다. 프로세스 종료·전원 손실·
   동시 `writeFile` 하나가 전체 JSON을 훼손하고, 되돌릴 이전 정상본이 없다. `license.json`은
   temp+rename을 쓰는데(`licenseStore.ts:108-110`) 훨씬 큰 `ticktick-data.json`은 안 쓴다 — **비대칭이다.**

**고치는 법.** revision을 가진 단일 저장 큐로 쓰기를 직렬화하고, 종료 시 in-flight 쓰기를 drain한 뒤
최신 revision만 커밋한다. 같은 볼륨 임시 파일에 완전히 쓰고 `fsync` 후 `rename`하며 이전 정상본을 보존한다.

## C5. 출하되는 모든 빌드에서 Google 캘린더 연동이 죽어 있다 ⚑

`.github/workflows/release.yml:58` (claude) · `electron.vite.config.ts:11` (codex)

릴리스 워크플로의 `npx electron-vite build`에 `GOOGLE_OAUTH_CLIENT_ID`가 없다. 빈 문자열이 박히고,
`ipc-handlers.ts:386`의 폴백 `process.env.*`도 Finder/Dock으로 띄운 macOS 앱에 셸 환경이 상속되지
않아 역시 빈 값이다. claude 실측: 빌드 산출물 `out/main/index.js:3372`에서 빌드타임 상수가 이미 접혀
사라졌다. codex는 `scripts/release.sh:49`와 `scripts/mas-preflight.sh:184` 어느 쪽도 값을 요구하지
않음을 확인했다.

결과: `GoogleSyncSection.tsx:136-137`이 화면 전체를 "이 빌드에는 Google 연동이 설정되어 있지 않습니다"
한 줄로 대체한다. 버튼도 안내도 없는 완전한 막다른 골목이다. OAuth·PKCE·토큰 갱신·동기화 계획은 전부
구현돼 있고 유닛테스트도 통과하는데 **사용자가 그 코드에 닿을 방법이 없다.** 그런데
`TODOS.md:226-234`의 확정 가격 정책은 "iCloud와 Google 캘린더 모두 지원"을 **판매 문구로 쓴다**고
못 박았고, `docs/app-store-submission.md:120`은 심사에도 그렇게 답했다. 파는 것과 출하하는 것이 다르다.

## C6. 클라이언트 ID를 넣어도 Google 로그인은 끝까지 갈 수 없다 (X)

`src/shared/app-id.ts:27` · `src/main/google/oauth.ts:25`

**C5를 고쳐도 남는 결함이다.** codex만 잡았고, 외부 계약 문서를 대조해 확인했다.

1. **redirect 방식** — 코드는 `com.supaicy.haru:/oauth2redirect` custom URL scheme에 전적으로
   의존하는데, Google의 현행 native-app redirect 계약은 custom URI scheme을 **더 이상 지원하지 않는다**고
   명시하고 macOS desktop에는 loopback IP를 권장한다. 저장소는 이를 "iOS bundle ID"로 우회하려 하지만
   (`app-id.ts:7`) Electron macOS 앱을 iOS client로 등록하는 것은 지원되는 구성이 아니며, 새 production
   client에서는 동의 뒤 callback 전에 막힐 수 있다.
2. **scope 불일치** — 앱은 `calendar.app.created` 하나만 요청한 뒤 `google/calendar.ts:162`에서
   `GET /users/me/calendarList`를 호출하는데, Google의 CalendarList.list 계약은 이 scope를 허용하지
   않아 **403**이 난다. 게다가 그 scope는 앱이 만든 보조 캘린더에 한정되는데, 코드는 보조 캘린더를
   만들지 않고 사용자의 기존 캘린더를 고르게 한다.

**고치는 법.** Desktop client + PKCE + 임의 포트 `127.0.0.1` listener로 바꾸고 MAS에는
`network.server` entitlement와 심사 설명을 추가한다. scope는 목록용 + 의도한 범위의 events scope를
함께 받거나, 최소 scope를 유지하려면 앱 전용 보조 캘린더를 만들어 그 ID만 쓰도록 흐름을 다시 설계한다.

## C7. 공개된 개인정보처리방침이 라이선스 서버를 부정한다 ⚑

`docs/privacy.html:60,69,78,249` (claude) · `:58` (codex)

심사에 제출된 방침(`app-store-submission.md:162`, 최종 수정 2026-07-29)이 "서버가 없고, 계정도 없고"(:60),
"개발자가 운영하는 서버가 없습니다"(:69), 영문 "There is no server"(:249)라고 적고, **하지 않는 것**
목록에 "기기 지문"(:78)을 명시한다.

실제로는 2026-08-18에 들어온 `src/main/licensing/`이 `pay.begreen.dev`로 **라이선스 키 원문**,
`IOPlatformUUID`에서 파생한 기기 해시(`deviceIdentity.ts:29-31`), `os.hostname()`(`service.ts:227`)을
보낸다. claude 실측: `grep -c "pay.begreen\|라이선스 키" docs/privacy.html` = **0**.

`os.hostname()`은 macOS에서 대개 소유자 실명을 담고("철수의 MacBook Pro"), 앱은 그 사실을 화면에
고지까지 한다(`license.deviceNameNotice`) — **앱이 사용자에게 말하는 것과 법적 문서가 말하는 것이
정면으로 다르다.** 지금 `IS_ENFORCED=false`라 활성화를 누르지 않으면 트래픽이 안 나가지만, 키 입력
UI는 직판·개발 빌드에서 이미 살아 있어(`Settings.tsx:412`) **오늘도 도달 가능한 경로**다.
Apple App Privacy 신고와도 어긋난다. (`TODOS.md:261-262`가 인정만 하고 멈춰 있다.)

## C8. 앱이 서버에 없는 제품 slug를 가리킨다 ⚑

`src/main/licensing/endpoints.ts:30` (claude) · `bicmac-license/migrations/0001_initial.sql:28` (codex)

앱은 `PRODUCT_SLUG = 'greenday'`로 구매 URL을 만들고 토큰의 `prod` 클레임을 검사한다.
레퍼런스 서버의 유일한 마이그레이션은 `products`에 **`bicmac` 한 줄만** INSERT한다 — `greenday` 행이 없다.

`GET /v1/products/greenday`는 404가 되고, 구매 페이지 `web/buy.html:112-122`가 그 응답으로 이름·가격·
결제 레일을 채우므로 **`/buy?product=greenday`가 렌더되지 않는다.** 키 발급도 `products.key_prefix`에
묶여 있어 `GREENDAY-` 키 자체가 존재할 수 없다. enforcement를 켜는 날 "결제하러 갔더니 빈 페이지"가 된다.

codex가 덧붙인 것: README의 수동 INSERT 예시는 확정 가격 `TODOS.md:225`의 ₩19,000과 달리
**₩9,000/$5.99**이고, `wrangler.toml:37`의 D1 ID도 placeholder다.

> **주의**: 서버는 읽기 전용 레퍼런스이고 운영 D1에는 올바르게 들어가 있을 수 있다. 단정할 수 없지만,
> **저장소 기준 배포는 product lookup·가격·`GREENDAY-` 활성화 중 최소 하나가 어긋난다.**
> 실결제 → 키 메일 → activate → validate → deactivate 왕복을 live smoke-test하기 전에는 enforcement를
> 켜면 안 된다. CLAUDE.md가 "`greenday` slug는 출시 후 못 바꾼다"고 못 박은 그 값이다.

---

# HIGH

## H1. 거절된 낙관적 편집이 되돌려지지 않는다 ⚑ (3중 확인)

`useStore.ts:333-365` (bug-claude) · `:333` (bug-codex) · `:356` (feature-codex)

모든 변경 액션이 `set(...)`으로 화면을 먼저 바꾸고 `persist(...)`로 IPC를 쏜다. `persist`는 거절을
`report`로 넘기고, `report`는 **로그 + `refreshLicense()`가 전부다.** 낙관적 변경은 그대로 남는다.
주석(342-358)이 이 사실을 인정하며 롤백을 TODO로 미뤄 뒀다.

codex 재현: `updateTask`를 `license_required`로 거절시켰더니 제목은 계속 `ghost`였고 라이선스 상태만
새로고침됐다.

`IS_ENFORCED`를 켜는 날, 트라이얼이 닫힌 사용자의 **첫 편집**이 이 경로다 — 모든 사용자가 반드시 한 번은
지난다. 사용자가 보는 것은 "할일이 만들어졌다 / 완료됐다 / 삭제됐다"이고, 재시작하면 전부 없다.

점수는 더 나쁘다 — `addScore`는 `score.total`을 렌더러에서 직접 계산해 올리므로 게이트가 거절하면
화면 총점이 디스크와 **그 세션 내내 영구히** 갈린다.

## H2. 시계 되돌리기로 트라이얼·만료·재검증을 무기한 피할 수 있다 ⚑

`licenseManager.ts:677` (bug-codex) · `:413` (security-codex) · `:442,613` (feature-claude) · `:599,618-624` (bug-claude)

네 워커가 각각 다른 각도에서 같은 뿌리에 도달했다: **단조 시간의 경과가 내구성 있게 전진하지 않는다.**

- **codex 재현**: 5시간 경과 후 `allowsPaidFeatures()`를 불러도 디스크 `lastSeenMs`가 그대로였고,
  시계를 원래 값으로 되돌려 manager를 재생성하자 다시 `licensed`였다. 재실행은 `setTimeout`의 단조
  경과도 함께 버린다. 벽시계를 고정하고 마감 전에 반복 재시작하면 프로세스 단조 시계가 매번 0으로 돌아간다.
- **claude(bug)**: `refresh()`가 `before`를 **await 앞에서** 잡는다. 그 15초 동안 마감 타이머가 깨어
  `advanceClockFloor`가 래칫을 올리고 `persist()`하는데, 커밋이 실패하면 `:622`가 그 값을 await 이전으로
  **덮어써서 래칫을 내린다.** `activate()`는 같은 함정을 피해 간다(`before`를 await **뒤**에서 잡는다) —
  두 함수가 비대칭이다.
- **claude(feature)**: 반대 방향 — 로컬 시계가 30일 넘게 **앞서면** 라이선스가 영영 복구되지 않는다.

**고치는 법.** 프로세스 단조 시계와 OS 부팅 식별자·uptime을 체크포인트로 저장해 종료/재실행을 이어
계산한다. 유료 접근 및 종료 시 바닥을 내구성 있게 전진시키고, 롤백은 `record.token` 하나로 줄여
래칫은 `advanceClockFloor`로만 움직이게 한다.

## H3. 쓰기 불가 저장소에서 트라이얼이 무한히 갱신된다 ⚑ (codex 2중)

`licenseManager.ts:309` (bug-codex) · `:303` (feature-codex)

`evaluateTrial()`이 `persist()`의 boolean 결과를 버리고 trial을 반환한다. codex 재현:
`store.write=false`인 같은 빈 디스크 레코드로 manager를 두 번 만들자 **둘 다 새 30일 `trial`을 받았고**
`trialStartMs`는 계속 `null`이었다.

**이것은 제외하기로 한 "설정 파일을 지우는" 트레이드오프가 아니다** — 한 번 만든 권한/파일시스템
조건으로 계속 유지되는 우회다.

관련(X): `licenseManager.ts:282` — 라이선스로 먼저 시작한 설치는 trial 시계를 전혀 시작하지 않아,
token 만료 → 30일 grace 다음에 만료가 아니라 **새 30일 trial**로 넘어간다. 오프라인 사용이
서명 token 잔여 + 30일 grace + 30일 trial까지 늘어난다.

## H4. 활성화/해제 IPC가 거절되면 두 버튼이 영구히 잠긴다 ⚑ (4중 확인 — 최다 합의)

`useActivation.ts:39-51` + `LicenseSection.tsx:67-75`

네 워커 전부가 찾았다(bug-claude medium · feature-claude high · bug-codex medium · feature-codex low).
두 흐름 다 `finally`가 없다:

```ts
setBusy(true)
const failure = await window.api.licenseActivate(key)   // 여기서 reject되면
setBusy(false)                                          // 이 줄에 도달하지 못한다
```

`busy = activation.busy || releasing`(`LicenseSection.tsx:53`)이 **두 버튼을 모두** 잠그므로, 한 번의
거절로 사용자는 활성화도 해제도 못 하는 화면에 갇힌다. 잠금 화면(LicenseGate)에서는 `canSubmit`이
영영 false가 되어 **유일한 탈출구가 막힌다.** 게다가 호출처가 `void activate()`라 그 거절은 unhandled
rejection으로 사라진다.

codex가 실행 가능한 재현 테스트를 만들었다(`/private/tmp/greenday-audit-license-ui.test.tsx`):
IPC rejection이 그대로 escape하고 `busy === true`가 영구 유지됨을 확인.

**고치는 법.** 두 자리 모두 `try { … } finally { setBusy(false) }`로 감싸고, catch에서 사용자에게
보여 줄 실패 코드를 세운다.

## H5. 하위작업이 있는 할일을 삭제하고 되돌리면 하위작업이 영영 휴지통에 남는다 ⚑

`useStore.ts:687-693, 901-907` + `database.ts:402-408` (claude) · `database.ts:403` (codex)

삭제는 하위작업까지 함께 하는데(`t.id === id || t.parent_id === id`), 되돌리기는 부모 하나만 되살린다.
main의 `restoreTask`가 **그 한 행만** 찾아 `deleted_at = null`을 놓는다 — `deleteTask`와 대칭이 아니다.

codex 재현 테스트(`/private/tmp/greenday-audit-restore.test.ts`): `deleteTask(parent)` →
`restoreTask(parent)` 후 부모만 active로 돌아오고 child는 `getTrashTasks()`에 남음을 확인.

Cmd+Z 한 번이 "부모는 살아났는데 하위작업 셋은 휴지통에 남은" 상태를 만든다. 화면에서는 하위작업이
통째로 사라진 것으로 보인다. **같은 파일의 `batchDelete`는 이 함정을 이미 피해 간다**
(`allDeletedIds`를 undo 데이터로 싣는다) — 단건 경로만 빠졌다. 휴지통 화면의 개별 '복원'도 같은 비대칭.

## H6. 날짜를 UTC로 파싱해, 음수 오프셋 지역에서 모든 마감일 판정이 하루씩 앞당겨진다 (C)

`src/renderer/src/utils/date.ts:29,48,54,59,64,79`

`formatDueDate`·`isOverdue`·`isDueToday`·`isDueTomorrow`·`isDueInNext7Days`가 전부
`new Date('YYYY-MM-DD')`를 쓴다. ES 명세상 날짜만 있는 형식은 **UTC 자정**으로 파싱된다.
KST(+9)에서는 우연히 맞고, 음수 오프셋에서는 전날이 된다. 실측
(`TZ=America/New_York`): `2026-08-28` → `Thu Aug 27 2026 20:00:00 GMT-0400`.

**저장하는 쪽은 이미 로컬로 고쳐져 있다** — `shared/date.ts:9`의 `toLocalDateString`이 그 목적이고
`recurrence.ts:10`은 아예 "인수 없는 `new Date()` 금지"를 못 박는다. **읽는 쪽인 `date.ts`만 규약 밖이다.**
개발자 시간대가 KST라 테스트에서도 보이지 않는다.

뉴욕에서 오늘 마감인 할일 하나가 동시에: 빨간 '지연'으로 칠해지고, **"어제"**라고 쓰이고,
`next7days`·`summary` 스마트 리스트에서 **사라지고**, '내일' 뷰에는 모레 할일이 뜬다.

**고치는 법.** 로컬 파서를 하나 두고 여섯 자리가 전부 거치게 한다. 날짜 대 날짜 비교는 `todayString()`
과의 **문자열 비교**가 더 안전하다 — `smartLists.ts:55-59`가 이미 그 방식이다.
테스트는 `TZ=America/New_York`을 걸어야 재현된다.

## H7. AI 설정이 시작 시 하이드레이트되지 않아, 첫 연결 확인이 항상 localhost로 나간다 (C)

`src/main/ai-service.ts:30,94-110,333-342,511-535`

모듈 `config`는 `getAiConfig()`·`getAiConfigInternal()`·`setAiConfig()` **안에서만** 교체된다.
`checkConnection`·`callLlm`·`streamChat`·`getChatUrl`은 디스크를 읽지 않고 모듈 변수를 그대로 쓴다.
`warmupModel`과 `pullModel`만 `getAiConfigInternal()`을 부른다 — **같은 파일 안에서 규약이 갈려 있다.**

`App.tsx:65`가 마운트 직후 `aiCheckConnection()`을 부르는데 그 시점 `config`는 `DEFAULT_CONFIG`
(ollama, localhost)다. OpenAI/커스텀 사용자는 매 실행 첫 확인이 localhost를 두드리고 `connected:false`를
받는다. 그리고 `AiChatPanel.tsx:70-74`는 `aiConnected === null`일 때만 재확인하는데 이미 `false`가 박혀
있어 **AI 패널을 열어도 재확인되지 않는다.** `App.tsx:63-64` 주석이 "첫 실행에 AI 버튼이 안 보이던 것"을
고치려 넣은 호출인데, 정확히 그 증상이 남아 있다.

## H8. 읽기 실패 세션이 유령 데이터를 만들고, '내보내기'가 빈 백업을 덮어쓴다 ⚑

`database.ts:78` (codex) · `:60-65,651-653` + `ipc-handlers.ts:154-198` (claude)

`load()`가 던지면 `dbReadFailed = true`가 서고 `data`는 빈 기본값으로 남는다.

- **codex**: 쓰기는 `save()`가 막지만 **mutator는 메모리를 먼저 바꾸고** `save()`만 조용히 반환해
  IPC가 성공한 유령 데이터를 만든다. 사용자는 오류 대화상자 뒤 빈 앱에서 한 세션치 편집을 하고
  재시작 때 전부 잃는다.
- **claude**: `exportData()`는 그 빈 `data`를 그대로 직렬화하고 `export-data`는 **무료 채널이라
  잠금 화면에서도 눌린다.** 사용자가 경로를 고르면 `{"lists":[],"tasks":[],…}`가 그 경로에 쓰인다 —
  하필 기존 백업 위에 저장하면 **진짜 백업까지 덮인다.**
- `isDatabaseReadOnly()`는 주석에 "부팅이 사용자에게 알리는 데 쓴다"고 적혀 있지만
  **소비자가 하나도 없다**(테스트 밖 `grep` = 선언부만).

관련(codex): `database.ts:84` — 정상 세션의 디스크 쓰기 실패도 콘솔에만 기록되고 호출 IPC는 이미
성공한다. ENOSPC·EACCES 뒤 메모리와 렌더러는 변경됐지만 디스크는 옛 상태다.

## H9. 서버의 거절 사유가 버려져 유료 사용자에게 "체험 기간이 끝났습니다"가 뜬다 ⚑ (3중 확인)

`licenseManager.ts:645` (feature-claude high, bug-codex low) · `:629` (feature-codex medium)

revoked 계열은 토큰을 지우고 trial로 떨어뜨리며, device-limit은 이유를 버린다. `PublicLicenseState`에
원인 필드가 없고(`shared/license.ts:27`), UI의 최종 fallback은 `LicenseSection.tsx:226`의
"Your trial has ended"다. **취소·한도로 잠긴 사람이 자기 상태를 알 수도, 복구 행동을 안내받을 수도 없다.**

## H10. 기기 한도에 걸린 사용자에게 출구가 없고, 원격 해제가 지속되지 않는다 ⚑

`licenseClient.ts:49` (feature-codex) · `ipc-gate.test.ts:98-99`, `licenseManager.ts:431` (feature-claude)
· `bicmac-license/src/index.ts:68` (feature-codex)

클라이언트 계약은 activate/validate/**current-device** deactivate뿐이고 UI도 현재 기기만 해제한다.
서버 레퍼런스에도 `/v1/devices`가 없는데, 문구는 `en.json:492`에서 존재하지 않는 "your device list"를
약속한다. 접근 불가능한 예전 기기를 해제할 경로가 앱에도 웹에도 없다.

**더 나쁜 것**(codex): 서버에서 다른 기기를 해제해도 **그 기기가 켜져 있으면 다음 검증이 슬롯을 되찾는다.**
`/v1/validate`가 별도 검증이 아니라 `handleActivate`로 연결되고, `activateDevice()`는 활성 행이 없고
빈자리가 있으면 새 행을 INSERT한다(`db.ts:299-333`). 해제 대상 클라이언트는 키·토큰을 그대로 가진 채
6시간마다 validate한다. 기기별 tombstone이 없으므로 **분실·양도한 온라인 기기가 빈 슬롯을 되찾는다.**

같은 뿌리(bug-codex `licenseManager.ts:489`): 해제와 백그라운드 재검증이 반대 순서로 끝나면 앱은 해제
성공인데 서버 슬롯은 다시 점유된다 — 앱에는 유령 슬롯이 보이지 않는다.

## H11. 낡은 재검증 응답이 더 새 활성화를 취소한다 (X)

`licenseManager.ts:632`

codex 재현: 지연된 옛 `/validate`를 걸어 둔 뒤 같은 키로 새 토큰을 활성화하고 옛 `revoked` 응답을
착륙시키자 **키 비교가 통과해 새 토큰이 삭제되고 `trialExpired`가 됐다.** 키만 비교하고 generation을
보지 않는다.

## H12. 성능: 스토어 쓰기 1회가 O(N×M)이고, `memo`가 통째로 무력화돼 있다 ⚑ (둘 다 실측)

**H12a. `TaskItem`의 하위작업 카운트 셀렉터** — `TaskItem.tsx:26` (perf-claude critical) · `:25` (perf-codex high)

`useSubtaskCount`가 셀렉터 안에서 `s.tasks`를 **행마다 두 번** 완주한다. Zustand는 `useSyncExternalStore`
기반이라 **모든 `set()`마다 마운트된 모든 구독자의 셀렉터를 다시 실행한다** — 리렌더가 생략돼도
셀렉터는 돈다. 즉 쓰기 1회당 `2 × N × M` 순회다.

| 구성 | claude 측정(쓰기 1회) | codex 측정 |
|---|---|---|
| N=500, M=500 | 1.14 ms | — |
| N=1000, M=1000 | 4.43 ms | 5.25 ms (p95 13.31) |
| N=2000, M=2000 | **17.95 ms** | — |
| N=5000, M=5000 | — | **121.0 ms** |
| N=10000, M=50 | 1.96 ms | — |

두 엔진이 독립적으로 측정했고 **수치가 일치한다.** 화면에 50행만 보여도 N에 선형으로 비싸진다.
이 비용은 리렌더가 아니라 **구독 평가**라서 `memo`로도 `useMemo`로도 막히지 않는다.

**H12b. `handleDrop`이 `filteredTasks`에 묶여 있다** — `TaskList.tsx:112` (perf-claude critical) ·
`TaskItem.tsx:48` (perf-codex medium)

`useCallback` deps에 `filteredTasks`가 있어 `tasks`·`searchQuery`·`sortBy` 중 하나만 바뀌어도 새 함수가
되고, 그 함수가 모든 행에 `onDrop`으로 내려간다. `TaskItem`은 `memo`인데 **한 번도 적중하지 못한다.**

| 행 수 | `onDrop` 안정 | 현재 코드 |
|---|---|---|
| M=500 | 0.2 ms | **37.2 ms** |
| M=1000 | 0.2 ms | **73.0 ms** |
| M=2000 | 0.4 ms | **145.1 ms** |

체크박스 하나 토글, 검색창 한 타, 정렬 토글이 전부 이 경로다. 할일 1000개면 **체크박스 한 번에 73 ms**
(60fps 예산의 4.4배). 정렬이 걸려 있으면 `canReorder`가 false라 memo가 살아나므로 증상이
**기본 정렬에서만** 나타나 재현이 헷갈린다.

**두 항목은 서로를 증폭한다.** perf-claude 권고: 하나씩 재보지 말고 둘 다 고친 뒤 다시 잴 것.

## H13. 성능: 할일 하나를 고쳐도 데이터 파일 전체를 다시 쓴다 ⚑

`database.ts:71` (perf-claude high) · `:83` (perf-codex medium)

`save()`는 300 ms 배치 뒤 `JSON.stringify(data)` + 파일 전체 갈아엎기다. claude 측정: 20k 할일 =
10.15 MB, 저장 1회당 메인 스레드 **10.5 ms 블록** + 10.15 MB 쓰기. codex 측정: 합성 5만 태스크
stringify 중앙값 30.39 ms, 지속 변경 시 **약 3.3회/초** 직렬화·전체 쓰기.

가장 아픈 것은 **쓰기 증폭**: 상세 패널 메모는 렌더러에서 400 ms 디바운스되고 그 뒤 DB가 300 ms 배치를
건다 — 긴 메모를 타이핑하는 동안 **약 700 ms마다 10 MB가 SSD로 나간다**(≈14 MB/s 지속).

## H14. 성능: 첨부 복사가 메인 프로세스를 무제한으로 세운다 (X)

`database.ts:568`

`copyFileSync`로 한 개씩 복사하는데 `ipc-handlers.ts:120-136`이 **크기 제한 없는 복수 선택**을 허용한다.
대용량 파일이나 느린 볼륨에서는 복사 전체 시간 동안 창 이벤트와 모든 IPC가 정지하며 지연 상한이 없다.

## H15. "백업"이 복원 불가능하고 첨부·대화를 담지 않는다 (X)

`database.ts:651` · `ipc-handlers.ts:169`

JSON은 `DbData`만 직렬화하고 첨부는 절대 경로 문자열만 남으며, AI 대화는 별도 `ai-chat.json`이다.
**preload에 export만 있고 import가 없다**(`preload/index.ts:55`). 그런데 UI는 이를 "Back up",
방침은 `privacy.html:269`에서 "export everything"이라고 안내하므로 **사용자가 복구 가능하다고 믿고
원본을 지울 수 있다.**

CSV는 더 손실이 크다 — 휴지통·habits·pomodoro·score·폴더 정보와 task의 due time, reminder, tags,
attachments, parent 관계, 반복, scheduled override를 모두 버리는 9개 열이다.

## H16. CalDAV·Google 동기화의 구조적 결함 (X)

- **`calendar-sync.ts:82`** — ETag 충돌 시 ETag를 `null`로 만들지만 `caldav/client.ts:256`은 `null`을
  강제 update가 아니라 **신규 생성**으로 해석해 `If-None-Match: *`를 보낸다. 기존 href에는 다시 412가
  나며 영구 실패 상태가 된다. 연결 해제 후 재연결, 같은 캘린더 재선택도 같은 충돌을 만든다.
- **`caldav/sync.ts:11`** — 반복 할일과 회차 이동·리사이즈가 **단일 고정 일정 하나로** 나간다.
  동기화용 `TaskRow`에 `is_recurring`·`recurring_pattern`·`scheduled_overrides`가 없고 `rrule: null`이다.
  반면 실제 캘린더 화면은 회차별 override를 우선한다. Google도 같은 `planSync`를 공유한다.
- **`CalendarSyncSection.tsx:75`** ⚑ — "Custom (CalDAV)" 모델·번역 키는 있지만 **UI에 provider/server URL
  입력이 없어** iCloud 이외 서버로 갈 수 없다. `calendarSync.provider*`/`serverUrl` 키는 소스에서 한 번도
  참조되지 않는다(feature-claude도 같은 지적). 설령 외부에서 넣어도 `caldav/client.ts:178`이 `serverUrl`의
  **경로를 버리고** origin의 `/`부터 discovery해 Nextcloud 같은 경로 기반 endpoint가 깨진다.

## H17. enforcement 플래그 전환이 이미 설치된 앱에 도달하지 않는다 (X)

`licensing/service.ts:33`

enforcement는 **빌드에 박힌 상수**이고 direct updater도 `index.ts:163`에서 `autoDownload = false`라
사용자가 다운로드하지 않으면 현재 무료 판정이 **영구히** 남는다. 서버 배포나 새 버전의 플래그 변경만으로
기존 설치를 유료 상태 기계로 옮길 수 없다.

**기존 설치를 grandfather할지 지금 결정해야 한다.** 아니라면 이 빌드를 배포하기 **전에** 서명된
최소 지원 버전 정책과 실패 안전한 강제 업데이트 경로를 넣어야 한다.

## H18. 영어 사용자에게 한국어 오류 문구가 그대로 나간다 ⚑

`ipc-handlers.ts:273,383` (claude) · `:121` (codex)

`locales.test.ts`가 ko/en 키 대칭을 못 박고 있지만, **그 테스트가 보지 않는 경로**가 있다:
첨부 선택기의 native dialog filter 이름, CalDAV·Google이 IPC로 보내는 한국어 오류 문자열
(`:271-300`, `:383-428`), AI의 한국어 오류(`ai-service.ts:88`/`:172`/`:521`), `ai-config.ts:34`의 "알 수 없음".
렌더러는 그것을 영문 접두사에 그대로 붙인다.

## H19. 라이선스 파일이 깨져도 사용자에게 아무 말도 하지 않는다 (C)

`licenseStore.ts:140-149`

---

# MEDIUM

| # | 항목 | 위치 | 출처 |
|---|---|---|---|
| M1 | CalDAV serverUrl/사용자명이 바뀌어도 저장된 비밀번호를 재사용 — 공격자 오리진으로 Basic 전송 | `ipc-handlers.ts:289` / `:281` | ⚑ |
| M2 | 첨부 폴더 안 **끊어진** 심링크가 봉쇄를 통과하고 `copyFileSync`가 따라가 폴더 밖에 쓴다 | `database.ts:565` / `:540` | ⚑ |
| M3 | 무맥락 safeStorage 암호문을 AI 키·CalDAV 암호·Google 토큰이 **공용** — 파일을 옮겨 OAuth 토큰을 CalDAV 암호로 전송 가능(confused deputy) | `database.ts:596` | X |
| M4 | `UID:`가 이스케이프되지 않고 task id는 "빈 문자열 아님"만 검사 → 사용자 캘린더에 임의 iCalendar 속성 주입 | `caldav/ical.ts:123` + `validate.ts:85-87` | C |
| M5 | 라이선스 키·토큰을 평문 0644로 저장 (다른 모든 자격증명은 safeStorage) | `licenseStore.ts:91-121` / `:95` | ⚑ |
| M6 | `disable-library-validation` entitlement이 켜져 있는데 이 앱은 네이티브 모듈이 없다 | `entitlements.mac.plist:9` | C |
| M7 | Google 토큰 갱신의 **모든** 오류가 refresh token 삭제 — 일시적 네트워크 장애가 영구 로그아웃 | `ipc-handlers.ts:411` / `:399` | ⚑ |
| M8 | 완료 이벤트가 200개 창 밖으로 밀리면 완료 취소가 점수를 회수하지 못한다(순증, 반복 가능) | `useStore.ts:996` + `database.ts:496` | ⚑ |
| M9 | 내보내기 실패가 세 호출처 어디에서도 잡히지 않는다 (잠금 화면의 유일한 탈출구 포함) | `useStore.ts:1004-1006`, `Settings.tsx:392` | ⚑ |
| M10 | `autoUpdater`에 `error` 리스너가 없어 오프라인이면 **매시간 unhandled rejection** | `index.ts:197-198` + `app-ipc.ts:25-28` | ⚑ |
| M11 | 업데이트 확인 실패 시 화면이 "확인 중…"에서 영원히 멈춘다 (dev/error 구분 없음) | `index.ts:162-207`, `Settings.tsx:670` | ⚑ |
| M12 | 입력 필드 포커스 가드가 Cmd 단축키보다 **아래** — 타이핑 중 Cmd+Z가 네이티브 undo를 막고 삭제한 할일을 되살린다 | `useKeyboardShortcuts.ts:95-116` | C |
| M13 | `pick-attachment` 거절이 아무 데서도 안 잡힌다 → 무반응 + 잠금 화면도 안 뜬다 | `TaskDetail.tsx:414-417` | C |
| M14 | 벽시계가 앞으로 뛰면 게이트는 거절하는데 공개 `state`는 `licensed`로 남아 방송이 없다 | `licenseManager.ts:693` | X |
| M15 | 할일 완료 하나가 4개의 독립 유료 IPC로 쪼개져 절반짜리 결과가 남는다(완료됐는데 점수 없음 등) | `useStore.ts:656` | X |
| M16 | 일괄 완료가 미래 `scheduledOverrides`를 완료본과 spawn **양쪽에** 남긴다(단건 경로는 제거함) | `useStore.ts:817` | X |
| M17 | 첨부 복사본이 참조 제거·영구 삭제·휴지통 비우기 **어느 경로에서도** 삭제되지 않는다 | `database.ts:409` | X |
| M18 | 캘린더·Google 유료 IPC가 게이트 rejection을 잡지 않아 unhandled rejection | `CalendarSyncSection.tsx:79` | X |
| M19 | 포모도로 deadline·점수가 조정 가능한 벽시계에만 의존 — 되돌리면 음수 elapsed, 앞당기면 즉시 완료+점수 | `usePomodoroStore.ts:78` | X |
| M20 | safeStorage 불가 시 비밀번호를 조용히 버리면서 저장은 성공처럼 끝난다 | `calendar-config.ts:49` / `:4` | ⚑ |
| M21 | 계정 변경/재연결이 이전 계정의 calendar target·sync state를 보존해 "연결됨"과 실제 권한이 갈린다 | `ipc-handlers.ts:281` | X |
| M22 | CalDAV·Google 네트워크 요청에 **시간 제한이 없다**(라이선스 클라이언트는 15초를 이미 둔다) | `google/calendar.ts:139` | X |
| M23 | 동기화 실패 상세(taskId/message)를 계산해 놓고 UI는 건수만 보여 준다 | `CalendarSyncSection.tsx:271` | X |
| M24 | 날짜 있는 **하위** 할일을 알리지 않고 전부 제외(문서는 "날짜가 있는 할일"이라고만 말한다) | `caldav/sync.ts:153` | X |
| M25 | 완료 상태가 Calendar.app·Google에서 **보이지 않는** 사설 metadata로만 들어간다(문서는 게시된다고 약속) | `caldav/ical.ts:139` | X |
| M26 | 잠긴 앱이 계속 리마인더 알림을 띄운다("전면 잠금" 정책과 모순) | `index.ts:152-159` / `:150` | ⚑ |
| M27 | 라이선스 모듈 초기화 실패가 "잠시 후 다시 시도해 주세요"로 나온다 | `ipc-handlers.ts:60-66` | C |
| M28 | 실패 문구에 행동 경로가 없다(`noDevice`·`badToken`·`malformedKey`·`revoked`) / "문의해 주세요"인데 문의 수단이 없다 | `en.json:478`, `:480,484,487` | ⚑ |
| M29 | 키 입력칸에서 Enter가 아무것도 하지 않는다 / "이 기기 해제"에 확인도 경고도 없다 | `LicenseGate.tsx:50`, `LicenseSection.tsx:98,142-152` | C |
| M30 | `enabled`·`account`·`lastError`·`syncedCount`를 저장·전송하지만 **아무도 읽거나 그리지 않는다** | `calendar-config.ts:22`, `google-config.ts:22,23` | ⚑ |
| M31 | 캘린더 동기화 두 기능이 README에 아예 없다 | `README.md:36-53` | C |
| **성능** | | | |
| M32 | AI 스트리밍이 **토큰 하나당 스토어 쓰기 1회**(30–80 tok/s × H12a 비용) | `useStore.ts:1140` | ⚑ |
| M33 | 목록에 가상화가 없다 — M=1000 마운트 171 ms, M=2000 391 ms | `TaskList.tsx:229` | ⚑ |
| M34 | `electron-updater`를 최상단에서 무조건 로드 — 스토어/dev 빌드에서 완전한 사장 코드 | `index.ts:4` | ⚑ (33.7–35.9 / 37.29 ms) |
| M35 | `initDatabase()`가 무조건 `save()` — 아무것도 안 바뀐 실행에서도 전체 파일 재작성(20k=10.15 MB) | `database.ts:242` | ⚑ |
| M36 | CSV 내보내기가 **방금 자기가 만든 문자열을 다시 파싱한다**(20k에서 30.9 ms 낭비) | `ipc-handlers.ts:166` | ⚑ |
| M37 | 라이선스 초기화가 `ready-to-show`를 막는다(ioreg 17.7 ms + fsync 3 ms) | `index.ts:144` / `service.ts:166` | ⚑ |
| M38 | `reorder-tasks`·`batch-update-tasks`가 ID마다 전체 `find` → O(K×N) (1만에서 92 ms) | `database.ts:417` | X |
| M39 | `optimizer.watchWindowShortcuts`가 **모든 키 입력**을 메인으로 끌어온다(하는 일은 단축키 2개 차단) | `index.ts:110` | C |
| M40 | 즉시 청크 642.67 kB에 로케일 두 벌 + 안 쓰는 뷰 전부 | `App.tsx:6`, `electron.vite.config.ts:29` | ⚑ |
| M41 | 상세 패널도 셀렉터 안에서 전체 할일을 훑는다 | `TaskDetail.tsx:67` | C |
| M42 | Ollama 다운로드 진행률이 **줄 단위로** 스토어를 때린다(초당 수십~수백) | `useStore.ts:1046` | ⚑ |

---

# LOW

| # | 항목 | 위치 | 출처 |
|---|---|---|---|
| L1 | `open-attachment`가 **무료 채널**인데 첨부 폴더 안이면 `.command`/`.app`도 그대로 실행한다 | `ipc-handlers.ts:147-151` | C |
| L2 | `license:activate`가 무료 채널이고 로컬 속도 제한이 없다(키 열거 → 서버 로그·워커 비용) | `ipc-handlers.ts:60-66` | C |
| L3 | 토큰을 앱이 거절해도(`badToken`) 이미 소모된 활성화 슬롯을 되돌리지 않는다 | `licenseManager.ts:438-444` | C |
| L4 | CSP에 `base-uri`·`form-action`이 없고 `connect-src`의 `ws:`가 호스트 제한 없이 열려 있다 | `renderer/index.html:7-10` | C |
| L5 | 범위 밖 숫자 문자 참조가 `RangeError`를 던져 동기화 전체를 세운다 | `caldav/dav-xml.ts:29-42` | C |
| L6 | 같은-origin 리다이렉트 재귀에 hop 제한이 없다("한 번만 따른다"는 주석과 다르다) | `caldav/client.ts:157` | X |
| L7 | state가 틀린 콜백이 진행 중인 OAuth를 종료 — 외부에서 로그인 취소 DoS / 콜백 두 번이면 성공한 인증도 거절 | `google-auth-flow.ts:105` / `:88-108` | ⚑ |
| L8 | 저장된 키가 5조각이 아니면 `maskKey`가 **원문 전체**를 반환해 렌더러로 내려간다 | `licenseManager.ts:726` | X |
| L9 | 리마인더 watermark를 뒤로 간 벽시계로 갱신해 이미 보낸 알림을 다시 보낸다 | `index.ts:157` | X |
| L10 | 트라이얼 첫날에 "29일 남음"이라 쓴다(`Math.floor`) | `useLicense.ts:84-86` | ⚑ |
| L11 | `addScores`가 `get()`/`set()` 사이 동시 점수 쓰기를 덮어쓴다(같은 파일 `addScore`는 안 그런다) | `useStore.ts:980-991` | C |
| L12 | 파일명에 `\|`가 있으면 첨부를 영영 열 수 없다(`name\|path` 인코딩, 첫 구분자로 자름) | `AttachmentList.tsx:5-16` | ⚑ |
| L13 | 되돌리기 직후 토스트가 **이전** 항목으로 다시 뜬다 → 한 번 더 누르면 의도치 않은 것을 되돌린다 | `UndoToast.tsx:15-43` | C |
| L14 | `app.whenReady().then(...)`에 `.catch`가 없다 — 하나만 던지면 창도 IPC도 없이 조용히 멈춘다 | `index.ts:99-201` | C |
| L15 | `revalidateIfNeeded()`가 재진입에 무방비(겹치면 타이머 취소 + 백오프 어긋남) | `licenseManager.ts:529-540` | C |
| L16 | `capabilities()` 거절이 처리되지 않아 실패 시 **라이선스 칸이 통째로 사라진다** | `Settings.tsx:259` | C |
| L17 | 스토어 빌드에서 `licenseOpenPurchase` IPC가 살아 있다(렌더러 회귀 하나면 MAS에서 외부 결제 페이지) | `ipc-handlers.ts:72` | X |
| L18 | Google 캘린더 목록 pagination 무시 — 100개 넘는 계정은 뒤쪽을 못 고른다 | `google/calendar.ts:162` | X |
| L19 | 동기화 대상을 바꾸면 이전 캘린더 일정이 예고 없이 고아로 남고 새 캘린더에 중복 생성 | `ipc-handlers.ts:319` | X |
| L20 | 가드는 `\|\|`, 인자는 `??` — `refreshToken`이 빈 문자열이면 `''`를 그대로 보낸다 **[추측]** | `ipc-handlers.ts:501-502` | C |
| L21 | 영어 카피가 복수형·번역투·내부 용어를 노출("{{days}} day streak", "device slot") | `en.json:239` | X |
| L22 | 내보내기 기본 파일명이 아직 `ticktick-backup-*` | `ipc-handlers.ts:158` | X |
| L23 | AI 채팅 `taskAdds` Map이 trim/clear와 함께 제거되지 않고 앱 수명 동안 유지 | `AiChatPanel.tsx:28` | X |
| L24 | 사이드바가 태스크 변경마다 smart count 전체 스캔을 여러 번 O(N×L) | `Sidebar.tsx:101` | X |
| L25 | 초기 hydration이 8개 데이터셋을 한꺼번에 복제(20k=9.0 MB, 메인+렌더러 두 벌 상주) | `useStore.ts:411` | ⚑ |
| L26 | 검색 판별식이 할일마다 질의를 다시 정규화(병목은 아님 — 20k에서 1.83 ms) | `search.ts:8` | C |
| L27 | AI 채팅 전체를 응답 완료마다 pretty JSON으로 동기 쓰기(바이트 상한 없음) | `database.ts:25` | X |

---

# 심각도가 갈린 항목

두 엔진의 평가가 갈린 곳은 판단이 필요하다.

| 항목 | claude | codex | 이 문서 | 근거 |
|---|---|---|---|---|
| 저장 세대 미직렬화 (`database.ts:81`) | low | **critical** | **critical** | codex가 지연 주입으로 실제 손실을 재현했다. claude는 "느린 디스크에서만"으로 봤지만, macOS `window-all-closed`가 앱을 끝내지 않아 창이 실제로 열려 있다 |
| `handleDrop` 불안정 (`TaskList.tsx:112`) | **critical** | medium | **high** | claude가 측정(M=1000에서 73 ms)했고 한 줄 수정으로 0.2 ms가 된다. 가장 값싼 큰 이득이지만 데이터 손실은 아니다 |
| 활성화 UI 영구 잠금 | medium/**high** | medium/low | **high** | 잠금 화면에서 **유일한 탈출구**가 막힌다. 네 워커 전부가 찾은 최다 합의 항목 |
| 거절 사유 유실 (`licenseManager.ts:645`) | **high** | low/medium | **high** | 돈 낸 사용자가 "체험 기간이 끝났습니다"를 보는 것은 지원 부담이자 환불 사유다 |
| Google client ID 누락 | **critical** | high | **critical** | 판매 문구가 약속한 기능이 출하 빌드에서 100% 죽어 있다 |
| 트라이얼 시작 저장 실패 | — | **high** ×2 | **high** | codex 둘이 독립적으로 재현했다. 제외 대상인 "설정 폴더 삭제"와 다른 종류의 우회다 |

---

# 단일 출처가 중요한 이유

codex 리포트는 claude보다 짧지만(5.9k–43.6k vs 25k–48k), **claude가 전혀 못 본 결함군을 통째로
가져왔다.** 반대도 마찬가지다. 한쪽만 돌렸다면 아래를 놓쳤다.

**codex만 찾은 것 중 무거운 것**
- **C6** Google OAuth custom scheme + scope 불일치 — C5를 고쳐도 남는다. 외부 계약 문서를 대조해야 보인다
- **M3** safeStorage 암호문 공용 → confused deputy로 OAuth 토큰을 CalDAV 비밀번호로 전송
- **H10** 서버 `/v1/validate`가 `handleActivate`로 연결돼 원격 해제가 지속되지 않는다 — 교차 저장소 추적
- **H17** enforcement 플래그가 이미 설치된 앱에 도달하지 않는다 — 배포 정책의 문제
- **H11** 낡은 재검증 응답이 새 활성화를 취소 / **H3** 쓰기 불가 저장소의 무한 트라이얼
- **H16** ETag 충돌 영구 실패, 반복 할일이 단일 일정으로 나감
- **M19** 포모도로가 벽시계에만 의존

**claude만 찾은 것 중 무거운 것**
- **C2** 드롭 → `window.api` 탈취 (Electron 기본 동작 + preload 재실행 + 게이트의 sender 미검증 3단 결합)
- **H6** 날짜 UTC 파싱 — 음수 오프셋 지역 사용자 전원에게 매일 보이는 결함
- **H7** AI 설정 미하이드레이트 — 주석이 고치려던 증상이 그대로 남아 있다
- **M4** `UID:` 미이스케이프 iCalendar 주입 — 이 저장소가 **이미 막기로 한** 위협인데 `id`만 빠졌다
- **M6** 불필요한 `disable-library-validation`, **M12** 단축키 가드 순서, **L1** 무료 채널의 실행 원시연산

**두 엔진의 스타일 차이**: claude는 실측 표와 인용을 붙인 서술형(측정·재현 위주), codex는 한 줄에
증상/근거/수정을 압축한 목록형(외부 계약·교차 저장소·경합 재현 위주). **중복 제거 시 codex 항목이
claude의 긴 서술에 묻히기 쉬우므로**, 위 표에서 `X` 표시를 별도로 유지했다.

---

# 양쪽이 확인한 "문제 없음" (역행 방지용)

거짓 안심을 막되, 다시 파헤치는 낭비도 막기 위해 기록한다.

- **ed25519 검증은 디코드된 원바이트 위에서 한다**(`activationToken.ts:96-107`). 재직렬화 후 검증하는
  흔한 실수가 없다. 두 엔진 모두 확인.
- **제품 격리가 실제로 작동한다** — `payload.prod !== PRODUCT_SLUG` 검사가 있고 키 접두사 검사가
  네트워크 전에 이중으로 막는다. CLAUDE.md가 "`prod` 검사가 제품 격리의 전부"라고 한 그 검사가 살아 있다.
- **유료 IPC 핫패스에 ed25519 재검증이 없다** — `allowsPaidFeatures()` 하나만 부른다.
  claude 실측 34 µs/회, codex 실측 35.38 µs/회 — **주석의 판단이 정확하다.**
- **서버가 준 `expiresAt`(서명 밖 숫자)은 권한 계산에 쓰이지 않는다.** 마감은 토큰의 `exp`에서만 나온다.
- **`KNOWN_REFUSALS`와 서버 계약이 정확히 일치한다** — CLAUDE.md가 경고한 "409와 봉투 있는 404"로
  넓히는 실수가 없다.
- **PKCE·state 검증·기본 브라우저 사용**이 모두 올바르다. 임베디드 웹뷰가 아니다.
- **셀렉터 없는 `useStore()` 구독이 0건이다**(claude 202개 호출 전수, codex 정적 검색). CLAUDE.md의
  스토어 구독 규칙이 지켜지고 있다 — 문제는 셀렉터 **내부**의 O(N)이다.
- **자격증명은 렌더러로 내려가지 않는다** — `toPublicConfig`·`toPublicGoogleConfig`·`PublicLicenseState`·
  `getAiConfig` 전부 확인. (단 L8의 `maskKey` 예외가 있다.)
- **렌더러에 HTML 주입 싱크가 없다** — `dangerouslySetInnerHTML`/`innerHTML` 0건.
- **XXE 없음**, **Google URL 조립 안전**, **`safeOpenExternal`이 비-http 스킴 차단**.
- **`__IS_DEV_BUILD__` 주입은 안전하다** — `electron-vite build`가 설정 로드 **전에**
  `NODE_ENV='production'`을 세팅한다(claude가 electron-vite 내부까지 추적해 확인).
- **스토어 빌드에서 잠금 화면이 뜨지 않는다** — Apple 3.1.1 위험 없음. `capabilities.test.ts`의
  개발/직판/MAS/Windows Store 판정표가 코드와 일치.
- **`locales.test.ts`가 ko/en 키·보간 변수·모든 라이선스 실패 코드를 대칭으로 고정한다**
  (단 H18의 main 전용 문구는 이 테스트 밖이다).
- **기기 id는 지연 + 프로세스당 1회 캐시**. 트라이얼 설치는 `ioreg`를 한 번도 안 돌린다.
- **되돌리기 스택 20건 캡, 채팅 히스토리 캡, AI 컨텍스트 48건 캡** — 무한히 잡아 두는 클로저 없음.
- **캘린더 블록 리사이즈는 mousemove마다 스토어를 쓰지 않는다**(DOM만 만지고 mouseup에서 커밋).

---

# 권장 처리 순서

## 0. enforcement를 켜기 전에 반드시 (블로커)
C8(제품 slug·가격·D1) → C7(개인정보처리방침) → H17(플래그 전환 도달) → H1(낙관적 롤백) → H4(활성화 잠금)

> **C8과 C7은 코드 문제가 아니다.** 서버 운영과 문서 게시가 선행돼야 하고, 실결제 → 키 메일 →
> activate → validate → deactivate 왕복을 live smoke-test하기 전에는 `IS_ENFORCED`를 켤 수 없다.

## 1. 자격증명 유출 (즉시)
C1(CalDAV href) → C3(AI 키·SSRF) → C2(네비게이션·드롭·sender 검증) → M1 → M3

> C1과 C2는 **결합하면 더 나쁘다** — 드롭한 페이지가 `calendar:select`를 불러 앱 암호를 가져간다.
> 셋 다 "URL/호출자를 신뢰 경계에서 검사하지 않는다"는 같은 뿌리다.

## 2. 데이터 손실 (즉시)
C4(원자적 저장 + 저장 큐) → H8(읽기 실패 세션) → H5(하위작업 복원) → M17(첨부 고아) → H15(복원 가능한 백업)

## 3. 시계·라이선스 무결성
H2(단조 시계 체크포인트) → H3(트라이얼 저장 실패 fail-closed) → H11(generation 가드) → H10(기기 해제)

## 4. 성능 — 두 항목을 함께, 그 뒤 다시 측정
H12a + H12b를 **동시에** 고치고 재측정 → M32(AI 스트리밍 rAF 배칭) → M34·M35(스타트업 46 ms 회수)
→ M33(가상화)

> perf-claude의 권고: 두 critical은 서로를 증폭하므로 하나씩 재보지 말 것. 1·2를 먼저 하면 M32와
> M33의 우선순위가 내려갈 수 있으니, 그때 다시 재고 결정한다.

## 5. 출하 기능 완결
C5 → C6(둘은 같은 기능의 앞뒤다) → H16(CalDAV 동기화) → H18(한국어 문구) → H9·M28(실패 문구에 행동 경로)

---

## 부록 — 개별 리포트

| 파일 | 워커 | 크기 | 특징 |
|---|---|---|---|
| `security-claude.md` | gd-sec-cc | 25k | "통과한 것" 절을 먼저 둔 서술형. 실측 로그 다수 |
| `security-codex.md` | gd-sec-cx | 5.9k | 최단. 자격증명 유출 경로 3건을 새로 잡았다 |
| `feature-claude.md` | gd-feat-cc | 48k | 최장. 문서·정책·판매 문구와 코드를 대조 |
| `feature-codex.md` | gd-feat-cx | 30k | 외부 계약(Google·서버 레퍼런스) 대조가 강점 |
| `bug-claude.md` | gd-bug-cc | 27k | 인용 + 실측. "결함이 아니었던 것" 절 있음 |
| `bug-codex.md` | gd-bug-cx | 13k | 경합·순서 재현이 강점. 실행 가능한 테스트 3개 작성 |
| `perf-claude.md` | gd-perf-cc | 29k | 측정 표 + 권장 순서. 역행 방지 기록 상세 |
| `perf-codex.md` | gd-perf-cx | 15k | 측정 방법과 한계를 명시. 합성 벤치 위주 |

**codex가 작성한 재현 테스트**(리포 밖 스크래치, `/private/tmp/`):
`greenday-audit-license-ui.test.tsx`(H4) · `greenday-audit-attachment.test.ts`(M17) ·
`greenday-audit-restore.test.ts`(H5)

**감사 범위 밖이라 확인하지 못한 것**: 실제 Google OAuth client, iCloud 계정, 결제·활성화 운영 환경,
운영 D1의 실제 내용, 패키지 Electron에서의 시작 시간 실측, GUI 드롭 재현.
