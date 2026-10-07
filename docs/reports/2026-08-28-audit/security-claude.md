# 보안 감사 — 신뢰 경계와 라이선스 암호 (2026-08-28)

대상: `supaicy/coordinate` 워크트리 (Electron 40 + React + TS).
범위: (1) 메인↔렌더러 IPC 노출, (2) ed25519 검증과 제품 격리, (3) 토큰 저장·기기 식별·경로 봉쇄,
(4) OAuth/PKCE·CalDAV 자격증명, (5) "앱의 JS를 고치는 것보다 싼" 우회.

코드를 고치지 않았다. 각 항목은 `file:line`으로 근거를 대고, 실측한 것은 그렇게 적었다.
`IS_ENFORCED = false`(의도된 출하 상태)와 "설정 폴더를 지우면 트라이얼이 리셋된다"(의도된
트레이드오프)는 지적하지 않았다.

---

## 먼저: 통과한 것들

거짓 안심을 막기 위해, 확인해서 **문제없던** 것을 먼저 적는다.

- **ed25519 검증은 디코드된 원바이트 위에서 한다.** `activationToken.ts:96-107` — `verify(null, body, …)`의
  `body`가 `Buffer.from(parts[0],'base64url')` 그 자체이고, 페이로드는 **같은 바이트**를 파싱한다
  (`:109`). 재직렬화 후 검증하는 흔한 실수가 없다.
- **제품 격리가 실제로 작동한다.** `activationToken.ts:121`의 `payload.prod !== PRODUCT_SLUG` 검사가
  있고, 서버는 `prod: result.license.product_slug`로 서명한다(`bicmac-license/src/index.ts:192`).
  키 접두사 검사(`licenseKey.ts:12`)가 다른 제품 키를 네트워크 전에 걸러 이중으로 막는다.
- **기기·키 결속**(`activationToken.ts:112-118`)과 **타입 고정 파싱**(`:134-153`, `exp`/`iat`가
  숫자가 아니면 거절)이 다 있다.
- **서버가 준 `expiresAt`(서명 밖 숫자)은 권한 계산에 쓰이지 않는다.** `licenseClient.ts:122`가
  실어 오지만 `licenseManager.activate/refresh` 어디서도 읽지 않고, 마감은 토큰의 `exp`에서만 나온다.
- **`testTokens.ts`에 임베드된 개인키가 없다.** `generateKeyPairSync`로 실행 시 만든다(`:22`).
- **PKCE**: `randomBytes(48)` verifier + S256(`google/oauth.ts:33-37`), `state` 검증
  (`:105`, 빈 기대값도 거절), 임베디드 웹뷰가 아닌 기본 브라우저(`google-auth-flow.ts:74`).
- **하드웨어 조회 서브프로세스**는 절대 경로 + `SystemRoot` 형태 검증(`deviceIdentity.ts:59,64,99-102`),
  `shell:false`, 5초 타임아웃(`service.ts:166`).
- **CalDAV `redirect: 'manual'` + 동일 출처 검사**(`caldav/client.ts:152-161`), 라이선스 클라이언트는
  `redirect: 'error'`(`licenseClient.ts:97`) — 리다이렉트로 키가 새는 길은 닫혀 있다.
- **XXE 없음**: `dav-xml.ts`는 DOCTYPE/PI를 건너뛰고(`:83`) 외부 엔티티를 해석하지 않는다.
- **Google 경로의 URL 조립은 안전하다**: `calendarId`는 `encodeURIComponent`, 이벤트 id는 base32
  인코딩(`google/calendar.ts:80-95,182,196`), `API_BASE`는 고정 상수.
- **자격증명은 렌더러로 내려가지 않는다**: `toPublicConfig`(비밀번호 제거), `toPublicGoogleConfig`
  (토큰 제거), `PublicLicenseState`(키·토큰 없음), `getAiConfig`(API 키 마스킹).
- **렌더러에 HTML 주입 싱크가 없다**: `dangerouslySetInnerHTML`/`innerHTML` 0건. AI 응답도 React가
  이스케이프한다.
- **`safeOpenExternal`**(`ipc-handlers.ts:42-50`)이 `http`/`https` 외 스킴을 막는다 —
  `AtomicCodeMirrorEditor`의 `onLinkClick`이 임의 URL을 넘겨도 `javascript:`/`file:`은 안 열린다.

---

## 발견

### HIGH

**[high] `src/main/caldav/client.ts:112-114` — 서버(또는 렌더러)가 고른 href가 그대로 요청 URL이 되고, 그 요청에 사용자의 iCloud 앱 암호가 Basic 헤더로 실린다.**

*왜.* `absolute()`는 `href.startsWith('http') ? href : new URL(href, this.origin)`이다. 두 갈래가 **둘 다**
출처를 벗어난다 — 실측:

```
"https://evil.example/steal" -> https://evil.example/steal   (절대 URL 그대로)
"http://evil.example/steal"  -> http://evil.example/steal    (평문 HTTP까지)
"//evil.example/x"           -> https://evil.example/x       (프로토콜 상대)
```

이 결과가 `request()`로 들어가고, `request()`는 URL이 무엇이든 `Authorization: this.authHeader()`를
붙인다(`:131`). 생성자의 https 강제(`:101-105`)는 **최초 `serverUrl`에만** 걸리고, 3xx 방어(`:152-161`)는
리다이렉트에만 걸린다 — 본문 안의 href는 어느 쪽도 지나지 않는다.

도달 경로가 둘이다.

1. **원격 서버.** `discoverCalendars`가 `current-user-principal`(`:179`) → `calendar-home-set`(`:185`) →
   컬렉션 href(`:206`)를 전부 서버 응답에서 읽어 `absolute()`에 넣는다. 악의적이거나 침해된 CalDAV
   서버는 첫 PROPFIND 응답 한 번으로 다음 요청을 자기가 고른 호스트로 보낸다. 그 href가
   `calendar-config.json`의 `syncState`에 저장되므로(`calendar-sync.ts:57-62`) 오염이 지속된다.
2. **렌더러.** `calendar:select`(`ipc-handlers.ts:319-333`)는 `calendarUrl: String(url)` — 스킴도
   출처도 검사하지 않는다. 다음 `calendar:sync-now`가 `runSync → planSync → eventHref → putEvent`로
   그 URL에 PUT을 보낸다(`caldav/sync.ts:64-66`, `calendar-sync.ts:56`). 즉 렌더러 한 줄로
   Apple 앱 암호를 임의 호스트에 흘릴 수 있다.

iCloud 앱 암호는 사용자의 캘린더·연락처 전체에 대한 자격증명이다. 이 파일은 자격증명이 다른
출처로 새지 않게 하려고 이미 두 군데(`redirect: 'manual'`, https 강제)를 막아 뒀는데, 정작 가장 넓은
입구가 열려 있다.

*고치는 법.* `absolute()`가 **항상** `new URL(href, this.origin)`로 해석하게 하고(절대 URL 분기 제거),
그 결과의 `origin !== this.origin`이면 던진다. 같은 검사를 `request()` 진입부에 한 번 더 둬서
`listEvents(calendarUrl)`·`putEvent(href)`처럼 밖에서 들어오는 URL도 걸리게 한다. 더불어
`calendar:select`에서 `url`이 저장된 `serverUrl`과 같은 출처인지 확인하고 아니면 거절한다.

---

**[high] `src/main/index.ts:36-74` — 창에 네비게이션 가드가 없고 문서 수준 drop 가드도 없다. 창에 파일이나 링크를 떨어뜨리면 그 페이지가 `window.api` 전부를 물려받는다.**

*왜.* `createWindow()`에는 `setWindowOpenHandler`(`:57`)만 있고 `will-navigate`/`will-frame-navigate`
핸들러가 없다(`grep -rn "will-navigate" src/` → 0건). Electron의 기본 동작은 창에 떨어진 파일/URL로
webContents를 **네비게이트**하는 것인데, 렌더러의 drop 핸들러는 할일 목록·캘린더 셀 같은 특정
요소에만 붙어 있고(`TaskList.tsx:130,136`, `CalendarView.tsx:118,124`, `TimeBlock.tsx:130`)
`document`/`window` 수준에서 `dragover`+`drop`을 `preventDefault` 하는 곳이 없다
(`grep -rn "addEventListener('drop'" src/renderer/src` → 0건). 사이드바·헤더·설정 패널·빈 공간 등
드롭존이 아닌 곳에 떨어뜨리면 기본 동작이 그대로 산다.

그 뒤가 문제다. preload는 그 webContents가 **어떤 페이지를 로드하든** 다시 실행되므로
`contextBridge.exposeInMainWorld('api', api)`(`preload/index.ts:190`)가 새 문서에도 걸린다.
`index.html`의 CSP(`:7-10`)는 옛 문서의 메타 태그라 새 문서에는 적용되지 않는다. 그리고
`ipc-gate.ts:70-82`의 `handle()`은 `event.senderFrame`을 보지 않는다 — 어떤 출처가 부르든 등급만 본다.

결과: 사용자가 받은 HTML 파일 하나(또는 링크)를 창에 떨어뜨리면 그 페이지가
`export-data`(디스크 저장 다이얼로그), `open-attachment`, `open-external`, `license:activate`,
`calendar:select`(→ 위 HIGH와 결합해 앱 암호 탈취), 그리고 라이선스가 살아 있는 동안 모든 `paid`
채널을 그대로 호출한다. 렌더러에 XSS 싱크가 없다는 사실이 여기서는 방어가 되지 않는다 — 코드
실행 발판이 필요 없고 드래그 한 번이면 된다.

*추측 표시.* 가드가 없다는 것은 코드로 확인했다. "떨어뜨리면 네비게이트한다"는 Electron의
문서화된 기본 동작이며, 이 감사에서 GUI를 띄워 재현하지는 않았다.

*고치는 법.* `createWindow()`에 `webContents.on('will-navigate', (e, url) => { if (url !== 시작 URL) e.preventDefault() })`와
`will-frame-navigate`를 건다(`will-navigate`는 하위 프레임 이동을 못 본다). 렌더러 진입점
(`main.tsx`)에서 `window.addEventListener('dragover'|'drop', e => e.preventDefault())`를 문서 수준에
걸어 드롭존 밖의 기본 동작을 죽인다. 그리고 `ipc-gate.ts`의 `handle()`에서
`event.senderFrame`의 URL이 우리 문서인지 확인하고 아니면 거절한다 — 세 겹 중 하나가 빠져도
나머지가 선다.

---

### MEDIUM

**[medium] `src/main/ipc-gate.ts:76-81` — `paid` 게이트가 호출자가 누구인지 묻지 않는다.**

*왜.* `ipcMain.handle(channel, (event, ...args) => …)`가 `event.senderFrame`/`event.sender`를 보지
않는다. 등급만 확인하므로, 이 webContents에 올라온 **어떤 문서·어떤 프레임**이든 같은 권한을
갖는다. 오늘 그것을 막고 있는 것은 CSP `default-src 'self'`(하위 프레임)와 `setWindowOpenHandler`
뿐인데, 위 HIGH가 성립하면 둘 다 우회된다. 이 파일의 전제가 "잠금 화면만으로는 게이트가 아니다"인
것과 같은 이유로, "우리 렌더러만 부를 것이다"도 전제가 아니라 검사여야 한다.

*고치는 법.* `handle()` 안에서 `event.senderFrame?.url`이 앱 문서(dev면 `ELECTRON_RENDERER_URL`,
아니면 번들 `index.html`의 `file://`)로 시작하는지 확인하고 아니면 `LICENSE_REQUIRED`가 아닌
별도의 거절을 던진다. `free`/`paid` 양쪽 모두에 걸어야 의미가 있다.

---

**[medium] `src/main/database.ts:565` — 첨부 폴더 안의 "끊어진" 심링크는 봉쇄를 통과하고, `copyFileSync`가 그걸 따라가 폴더 밖에 쓴다.**

*왜.* 가드가 `existsSync(destPath) && !isInsideAttachments(destPath)`다. `existsSync`는 심링크를
**따라가므로**, 링크 대상이 아직 없으면 `false`가 되어 realpath 검사 자체가 실행되지 않는다.
그 뒤 `copyFileSync`가 링크를 따라 대상 위치에 파일을 **새로 만든다**. 실측:

```
existsSync(attachments/trap.txt) = false     ← 끊어진 심링크
guard1 startsWith ok: true
guard2 existsSync(destPath): false           ← realpath 검사 건너뜀
outside dir now: [ 'pwned.command' ]         ← 폴더 밖에 생성됨
```

`attachmentContainment.test.ts:50-61`은 "그 자리에 **이미 파일이 있는**" 심링크만 시험한다 —
끊어진 링크가 정확히 그 틈이다. 오늘 유일한 호출처(`ipc-handlers.ts:135`)가 `${uuid()}-`를 앞에
붙여 이름을 예측 불가로 만들기 때문에 IPC로는 도달하지 않는다. 하지만 봉쇄 함수의 계약은
"이 폴더 밖에 쓰지 않는다"이고, 그 계약이 호출처의 uuid에 의존하고 있다.

*고치는 법.* `existsSync` 대신 `lstatSync`로 **링크 자체**의 존재를 보고, 링크면 무조건 거절한다
(또는 `openSync(destPath, 'wx' | O_NOFOLLOW)`로 열어 쓰기). 테스트에 끊어진 심링크 케이스를 추가한다.

---

**[medium] `src/main/caldav/ical.ts:123` (+ `src/main/validate.ts:85-87`) — `UID:`가 이스케이프되지 않는데, 그 값의 재료인 task id는 "빈 문자열이 아닌 문자열"만 검사된다.**

*왜.* `serializeEvent`는 `SUMMARY`/`DESCRIPTION`에는 `escapeText()`를 쓰지만(`:126,137`) `UID`에는
쓰지 않는다(`:123`). `event.uid = eventUid(task.id) = \`greenday-${taskId}@supaicy.github.io\``
(`caldav/sync.ts:59-61,94`). 그리고 `validateTaskInput`/`validateTaskUpdate`는 `id`에 대해
`typeof === 'string' && length > 0`만 본다(`validate.ts:7-9,85-87`). `foldLine`은 75옥텟에서 접을 뿐
줄바꿈을 지우지 않는다(`ical.ts:57-73`).

따라서 `create-task`에 `id: "x\r\nATTENDEE:mailto:…\r\nX-Y:z"`를 주면 사용자의 CalDAV 캘린더에
임의 iCalendar 속성이 들어간다. 이건 새로운 위협 종류가 아니라 **이 저장소가 이미 막기로 한**
위협이다 — `validate.ts:30-38`의 주석이 날짜를 검증하는 이유로 "개행이 섞인 날짜 하나면 사용자의
캘린더에 임의 속성을 끼워 넣을 수 있다"를 든다. `id`는 같은 부류의 값인데 그 방어에서 빠졌다.
(`RRULE`은 `sync.ts:97`에서 항상 `null`이라 무해하고, `eventHref`는 `encodeURIComponent`라 URL
쪽은 안전하다.)

*고치는 법.* 두 곳 다 고친다 — `serializeEvent`에서 `UID:${escapeText(event.uid)}`(또는 UID에 허용할
문자 집합으로 제한), 그리고 `validate.ts`에서 `id`를 `/^[A-Za-z0-9_-]{1,128}$/`(실제로 발급하는
uuid 모양) 정도로 못 박는다. 값 검증은 신뢰 경계에 있어야 한다는 그 파일의 원칙 그대로다.

---

**[medium] `src/main/ai-service.ts:53-70` — 내부망 차단 목록이 IPv6와 DNS 이름을 전혀 보지 않고, 검사가 **저장할 때만** 걸린다.**

*왜.* `isAllowedUrl`은 `hostname` 문자열의 리터럴 접두사만 본다. WHATWG `URL`이 숫자형 IPv4를
정규화해 주므로(`http://0xA000005/` → `10.0.0.5`, 실측) 십진/16진 우회는 우연히 막히지만, 나머지가
남는다 — 실측:

```
http://[fd00::1]/                 -> true   (IPv6 ULA, 사설망)
http://[::ffff:10.0.0.5]/         -> true   (IPv4 매핑 IPv6 → 10.0.0.5)
http://metadata.google.internal/  -> true   (DNS 이름 → 169.254.169.254)
http://169.254.169.253/           -> true   (링크로컬 — .254 하나만 막혀 있다)
http://localhost.evil.com/        -> true
```

이름 기반은 통째로 무방비다(`169.254.169.254` 리터럴 하나만 막는데, 메타데이터 엔드포인트에
닿는 표준적인 방법이 바로 그 DNS 이름이다).

더 큰 문제는 **적용 지점**이다. `setAiConfig`는 `updates.baseUrl`이 있을 때만 검사하고(`:73`),
요청을 실제로 보내는 자리에서는 다시 보지 않는다 — `checkConnection`(`:97,106`),
`warmupModel`(`:120`), `callLlm`(`:363`), `streamChat`(`:571`) 중 어느 것도 `isAllowedUrl`을 부르지
않는다(`pullModel`만 부른다, `:175`). 그리고 응답 본문이 렌더러로 돌아간다
(`checkConnection`은 모델 목록, `callLlm`/`streamChat`은 텍스트) — 읽기까지 되는 SSRF다.

*고치는 법.* 차단을 호스트 문자열이 아니라 **해석된 주소**로 판정한다: `dns.lookup`으로 얻은 IP가
사설/루프백/링크로컬/ULA/IPv4매핑이면 거절하고, 그 검사를 `setAiConfig`가 아니라 요청을 보내는
공통 지점(`getChatUrl` 옆의 얇은 `assertAllowed(baseUrl)`)에 둔다. `localOnly` 검사가 이미
요청 시점에 있으니(`:335,520`) 같은 자리에 붙이면 된다.

---

**[medium] `resources/entitlements.mac.plist:9` — `com.apple.security.cs.disable-library-validation`이 켜져 있는데, 이 앱은 그것이 필요하지 않다.**

*왜.* 이 앱의 런타임 의존성은 `electron-updater`와 `uuid` 둘뿐이고(`package.json:22-25`) 네이티브
모듈이 없다. Electron이 실제로 요구하는 것은 `allow-jit`과 `allow-unsigned-executable-memory`
(`:5,7`)이고, `disable-library-validation`은 서명 팀이 다른(또는 서명되지 않은) dylib을 프로세스에
싣기 위한 항목이다. 켜 두면 hardened runtime이 주는 "이 프로세스에는 우리 팀이 서명한 코드만
들어온다"는 보장이 사라진다. 이 설계가 지키기로 한 축이 "우회 비용을 앱의 JS를 고치는 것보다
비싸게 만든다"인데, 이 한 줄이 그 축의 반대 방향이다.

*완화 요인(정직하게).* `com.apple.security.cs.allow-dyld-environment-variables`는 **없으므로**
`DYLD_INSERT_LIBRARIES` 주입은 여전히 막힌다. 실제 악용은 "앱이 스스로 dlopen하는 경로에
공격자 dylib을 놓을 수 있는" 상황으로 제한된다.

*고치는 법.* `disable-library-validation` 항목을 지우고 서명·공증·실행을 확인한다
(`npm run release`의 4/4 검증 단계가 그대로 잡아 준다). 깨지면 그때 무엇이 그것을 요구했는지
적어 두고 되돌린다.

---

### LOW

**[low] `src/main/ipc-handlers.ts:147-151` — `open-attachment`는 무료 채널이고, 첨부 폴더 안이라면 `.command`/`.app`도 그대로 실행한다.**

*왜.* 봉쇄 자체는 제대로 있다(`database.ts:530-545`가 양쪽을 realpath로 푼다 — 형제 폴더,
상위 이동, 폴더 안 심링크까지 테스트가 못 박는다). 남는 것은 "폴더 안"의 정의다. 첨부 선택
다이얼로그가 확장자 `*`를 허용하므로(`:121-125`) `copyAttachment`가 확장자를 보존한 채
실행 가능한 파일을 그 폴더에 들여놓고, 무료 채널이 `shell.openPath`로 그것을 연다(= Finder
더블클릭 = 실행). 잠긴 앱에서도 열려 있는 채널이 OS 실행 원시연산을 그대로 내주는 셈이다.
사용자가 스스로 고른 파일이라는 점에서 오늘의 위험은 낮지만, 봉쇄가 "어디에 있는가"만 보고
"무엇인가"는 안 본다.

*고치는 법.* `shell.openPath` 전에 확장자를 확인해 실행 가능 유형(`.app`, `.command`, `.scpt`,
`.sh`, `.pkg`, `.workflow`, `.terminal` 등)이면 거절하거나 대신 `shell.showItemInFolder`로 떨어뜨린다.
선택 다이얼로그에서도 같은 유형을 걸러 애초에 들어오지 않게 한다.

---

**[low] `src/main/licensing/licenseStore.ts:91-121`, `src/main/licensing/service.ts:203` — 라이선스 원본 키와 기기 대체 id가 평문·기본 퍼미션으로 저장된다. 이 앱의 다른 모든 자격증명은 safeStorage로 암호화된다.**

*왜.* CalDAV 비밀번호(`calendar-config.ts:47-59`), 구글 토큰(`google-config.ts:44-56`),
AI API 키(`database.ts:600-612`)는 전부 `safeStorage`(macOS는 키체인 ACL로 앱에 묶인다)를 거치는데,
`license.json`의 `key`와 `token`은 `JSON.stringify` 그대로 나간다. `writeFileSync`에 `mode`를 주지
않으므로 umask 기본값(대개 0644) — 같은 기기의 다른 사용자·다른 프로세스가 읽는다.

라이선스 키는 구매 자격증명이고, 유출되면 기기 한도 안에서 남이 그대로 쓸 수 있다. 파일 주석은
"여기 적힌 값 중 권한을 만드는 것은 없다"고 하는데 그건 **이 기기에서** 참인 문장이고, 유출의
피해는 다른 기기에서 발생한다.

*고치는 법.* `key`(와 `token`)를 `safeStorage`로 감싼다 — 다른 세 파일과 같은 인코드/디코드 쌍이면
된다. 복호화 실패는 이미 "다시 입력받는다"로 처리되는 패턴이 있다. 최소한 `writeFileSync`에
`{ mode: 0o600 }`를 준다(`device-id`도 같이).

---

**[low] `src/main/caldav/dav-xml.ts:29-42` — 범위를 벗어난 숫자 문자 참조가 `RangeError`를 던져 동기화 전체를 세운다.**

*왜.* `String.fromCodePoint(code)`는 `code > 0x10FFFF`에서 던지는데, `Number.isFinite(code)`는 그걸
걸러내지 못한다. 실측: `<a>&#x110000;</a>`를 이 `replace` 콜백에 넣으면 `RangeError`.
`parseMultistatus` → `discoverCalendars`/`listEvents` 위로 전파된다. 다행히 IPC 핸들러의
try/catch(`ipc-handlers.ts:312,360`)가 잡아 "알 수 없는 오류"로 바꾸므로 프로세스가 죽지는 않지만,
악의적이거나 그냥 이상한 서버 하나가 진단 불가능한 메시지로 동기화를 영구히 막을 수 있다.

*고치는 법.* `code <= 0x10FFFF && !(code >= 0xd800 && code <= 0xdfff)`일 때만 변환하고 아니면
원문(`match`)을 그대로 둔다. 어차피 이 함수의 다른 실패 경로가 이미 그렇게 한다.

---

**[low] `src/main/ai-service.ts:94-111` — `checkConnection`이 `localOnly` 잠금과 URL 허용 목록을 모두 건너뛰고, API 키를 그 주소로 보낸다.**

*왜.* `callLlm`(`:335`)과 `streamChat`(`:520`)에는 "런타임 방어: 잠금이 켜졌는데 비-로컬 구성이면
차단"이 있는데 `checkConnection`에는 없다. `provider !== 'ollama'`면 `Authorization: Bearer ${apiKey}`를
붙여 `${config.baseUrl}/v1/models`를 친다(`:105-106`). 설정 화면의 자물쇠 문구는
"외부 AI 제공자를 차단해 데이터가 기기를 벗어나지 않습니다"인데(`ko.json:350`), 연결 확인 버튼이
그 약속을 깬다. `warmupModel`(`:116-129`)도 허용 목록을 안 보지만 `provider === 'ollama'` 조건이
있어 피해가 작다.

*고치는 법.* `localOnly` 검사를 `callLlm`/`streamChat`/`checkConnection`/`warmupModel`이 공유하는
한 줄(예: `assertEgressAllowed()`)로 빼고 네 곳 모두 통과시킨다. 위 MEDIUM의 주소 검사도 같은 자리다.

---

**[low] `src/main/ipc-handlers.ts:60-66` — `license:activate`는 무료 채널이고 로컬 속도 제한이 없다.**

*왜.* `looksValidKey`가 형태만 보고(`licenseManager.ts:429`) 통과하면 곧장 `/v1/activate`로 나간다.
렌더러(또는 위 HIGH로 들어온 페이지)가 루프를 돌면 네트워크 속도로 키를 열거할 수 있다.
키 공간이 32^16이라 전수는 비현실적이지만, 서버의 이벤트 로그를 채우고 워커 비용을 태우는 데는
충분하다. 앱 쪽에는 어떤 제동도 없다.

*고치는 법.* 매니저에 최소 간격/연속 실패 백오프를 둔다(재검증의 `unreachableStreak`과 같은 모양).
서버 측 IP 단위 제한과 함께 두 겹이면 충분하다.

---

**[low] `src/main/licensing/licenseManager.ts:438-444` — 서버가 발급한 토큰을 앱이 거절해도(`badToken`) 소모된 활성화 슬롯을 되돌리지 않는다.**

*왜.* 서버는 `activateDevice`가 성공한 뒤에야 토큰을 서명하므로(`bicmac-license/src/index.ts:178-197`),
`verified.ok === false`로 돌아오는 시점에는 이미 기기 행이 INSERT돼 있다. 앱은 `'badToken'`을
반환하고 끝낸다 — `/v1/deactivate`를 부르지 않는다. 사용자에게는 "활성화 실패"로 보이는데
슬롯은 하나 줄어 있고, 재시도할 때마다 같은 일이 반복되지는 않지만(같은 기기 해시라 멱등)
`wrongProduct`처럼 운영 실수로 이 경로가 열리면 사용자는 이유를 알 수 없는 상태에 갇힌다.

*고치는 법.* `'badToken'`을 반환하기 전에 `deps.client.deactivate(key, device)`를 한 번 시도하고
결과는 무시한다(실패해도 답은 그대로 `'badToken'`). 실패해도 손해가 없고, 성공하면 슬롯이 돌아온다.

---

**[low] `src/renderer/index.html:7-10` — CSP에 `base-uri`·`form-action`이 없고 `connect-src`의 `ws:`가 호스트 제한 없이 열려 있다.**

*왜.* `object-src`/`frame-src`는 `default-src 'self'`로 폴백되지만 `base-uri`와 `form-action`은
폴백되지 않는다. 스크립트 실행 없이도 `<base>` 주입이나 폼 제출로 외부 출처가 관여할 여지가
남고, `connect-src 'self' ws:`는 임의 호스트로의 WebSocket을 허용한다(dev HMR 때문으로 보이는데,
출하 번들에도 그대로 나간다).

*고치는 법.* `base-uri 'none'; form-action 'none'; object-src 'none'`을 추가하고 `ws:`는
`ws://localhost:*`로 좁힌다(또는 출하 빌드에서만 뺀다).

---

## 부록 — 확인했지만 발견으로 올리지 않은 것

- `__IS_DEV_BUILD__` 주입(`electron.vite.config.ts:18`)은 안전하다. `electron-vite build`가
  설정 파일을 로드하기 **전에** `NODE_ENV='production'`을 세팅한다
  (`electron-vite/dist/chunks/lib-BkLsMF4i.js:20` → `lib-q6ns0vZr.js:1516` → 그 뒤 `loadConfigFromFile`).
  런타임 탐지 우회는 실제로 닫혀 있다.
- `verifyToken`의 `opts.key == null` 분기(`activationToken.ts:116`)로 `lic` 검사를 건너뛸 수는 있지만
  (`license.json`에서 `key`만 지우면 된다), 그 상태에서도 **이 기기·이 제품용으로 서명된 진짜 토큰**이
  여전히 필요해 얻는 것이 없다.
- `licenseClient.KNOWN_REFUSALS`(`:74-83`)와 서버가 실제로 내는 코드
  (`bicmac-license/src/index.ts:162,166,182,238,246,249`)가 일치한다. `400:malformed_device`는 클라이언트에만
  있는데(서버는 `:169`에서 낸다 — 일치), 여분이 있어도 안전한 방향이다.
- `AttachmentList`의 `name|path` 인코딩(`AttachmentList.tsx:5-16`)은 파일 이름에 `|`가 들어가면
  경로를 잘못 자르지만, 잘린 경로는 메인의 `isInsideAttachments`에서 realpath 실패로 떨어진다 —
  데이터 정합성 문제이지 보안 경계 문제가 아니다.
- `setAiConfig`의 `{...config, ...updates}`(`ai-service.ts:84`)로 렌더러가 임의 키를 저장 파일에
  섞을 수 있고 `apiKey_enc`를 덮어 기존 키를 못 쓰게 만들 수 있다. 프로토타입 오염은 아니다
  (스프레드는 `__proto__`를 자체 속성으로 복사한다). 자기 키를 자기가 지우는 것이라 제외했다.
