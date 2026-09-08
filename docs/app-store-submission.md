# App Store 제출 체크리스트 & 메타데이터

Greenday를 Mac App Store에 올리기 위해 필요한 것 전부. 아래 텍스트는 App Store Connect에
**그대로 복사해 넣을 수 있게** 작성했습니다.

> 일반 배포 가이드는 `docs/DEPLOYMENT.md`. 이 문서는 App Store 제출에만 집중합니다.
> 상태 표기: ✅ 완료 · ⬜ 사장님이 하실 것 · 🤖 코드/문서로 준비됨

---

## 재확인 — 2026-09-07 · 번들 ID 변경

**번들 ID를 `com.supaicy.haru` → `com.begreen.greenday` 로 바꿨다**(사용자 결정, 근거는
`docs/reports/2026-09-07-v1.4.1-shipped-build.md` — 실제로 배포된 v1.4.1 은 `com.haru.app` 이었고
`com.supaicy.haru` 는 한 번도 나간 적이 없다). 이 문서의 Bundle ID 는 전부 새 값으로 바꿨다.
이 변경으로 **8-29 재확인 표의 세 항목이 다시 ⬜ 로 돌아간다:**

| 항목 | 상태 | 할 일 |
|---|---|---|
| Bundle ID 등록 | ⬜ | Identifiers 에 `com.begreen.greenday` 등록 |
| 프로비저닝 프로파일 | ⬜ | `haru MAS`(`32R6RHXU36.com.supaicy.haru`)는 **다른 앱 것이 됐다.** 새 ID 로 재발급해 `resources/embedded.provisionprofile` 교체. 그 전까지 `npm run mas:preflight` 2/6 이 실패하는 것이 정상이다 |
| App Store Connect 앱 레코드 | ⬜ | 새 Bundle ID 로 생성. **레코드를 만든 뒤에는 ID를 못 바꾼다** |
| 개인정보처리방침 URL | 변경 | 정본이 **`https://begreen.dev/privacy`**(한국어 `/ko/privacy`)로 옮겨졌다. 앱 안의 링크도 그 주소다. GitHub Pages 의 옛 주소는 그리로 리디렉션한다 |
| Google OAuth | 변경 | 콜백이 커스텀 스킴 → **루프백(127.0.0.1)+PKCE**. 클라이언트는 **데스크톱 앱** 유형(번들 ID 입력 없음). 릴리스 빌드는 `GOOGLE_OAUTH_CLIENT_ID` 가 비면 실패한다 |

---

## 재확인 — 2026-08-29

한 달 전 상태로 적혀 있던 것을 오늘 전부 다시 쟀다. **네 항목이 바뀌었다.**

| 항목 | 문서에 적힌 상태 | 오늘 실측 |
|---|---|---|
| 인증서 2종 | ⬜ 미발급 (`Apple Development`·`Developer ID`뿐) | ✅ **발급됨** — `Apple Distribution: MINSEOK SHIN (32R6RHXU36)` + 설치 패키지 서명 인증서 |
| 프로비저닝 프로파일 | ⬜ 미발급 | ✅ **있음** — `haru MAS`, App ID `32R6RHXU36.com.supaicy.haru`, macOS, 2027-07-30까지 |
| Bundle ID 등록 | ⬜ | ✅ 프로파일이 그 App ID로 발급됐으므로 등록돼 있다 |
| 개인정보처리방침 URL | ✅ 200 확인 | ⚠️ **지금 404다** — 저장소 이름이 `haru` → `greenDay`로 바뀌면서 Pages 주소가 옮겨졌다 |

### 개인정보처리방침 URL이 바뀌었다 — 제출 전 반드시 고칠 것

```
옛 주소  https://supaicy.github.io/haru/privacy.html      → 404
새 주소  https://supaicy.github.io/greenDay/privacy.html  → 200 (2026-09-07부터 begreen.dev/privacy 로 리디렉션)
```

**대소문자가 맞아야 한다.** `greenday`(소문자 d)는 404다. GitHub Pages 경로는
저장소 이름을 그대로 쓰고, 저장소는 `greenDay`다.

개인정보처리방침 URL이 안 열리면 심사에서 바로 반려된다 — 이 문서 8절이 "자주
걸리는 지점" 1번으로 꼽아 둔 바로 그것이다.

### MAS 빌드 사전 점검은 이제 자동이다

`scripts/mas-preflight.sh`가 인증서·프로파일·샌드박스 권한·MAS에서 꺼져야 하는
기능·번들 ID 일관성 다섯 가지를 확인한다. **오늘 실행 결과 전부 통과.**

```
npm run mas:preflight
```

빌드 명령은 이 문서 7절이 `npm run package:mas`라고 적어 뒀는데, **`mas:build`를
쓰는 편이 낫다** — 그쪽이 preflight를 먼저 돌리고 universal로 빌드한다.
(`package:mas`는 끝이 `--config`로 잘려 있어 값이 비어 있다.)

---

## 0. 진행 순서 (의존 관계 순)

```
① Bundle ID 등록 ──┬── ② 인증서 2종 발급 ──┬── ④ 프로비저닝 프로파일
                   │                        │
                   └── ③ App Store Connect  │
                       앱 레코드 생성 ───────┘
                                │
                                ├── ⑤ 메타데이터 입력 (아래 텍스트 복붙)
                                ├── ⑥ 스크린샷 업로드
                                ├── ⑦ App Privacy 설문 (아래 답안)
                                │
                                └── ⑧ 빌드 업로드 → 제출 → 심사
```

---

## 1. Apple Developer 포털에서

- ⬜ **Bundle ID 등록** — [Identifiers](https://developer.apple.com/account/resources/identifiers/list) → `+` → App IDs → App
  - Bundle ID: `com.begreen.greenday` (Explicit)
  - Capabilities: 추가할 것 없음 (Greenday는 iCloud·푸시·인앱결제 미사용)

- ⬜ **인증서 2종 발급** — [Certificates](https://developer.apple.com/account/resources/certificates/list) → `+`
  - **Apple Distribution** — 앱 서명용
  - **Mac Installer Distribution** (`3rd Party Mac Developer Installer`) — `.pkg` 서명용.
    **이게 없으면 MAS 빌드가 실패합니다.**
  - 두 개 다 발급 후 더블클릭해서 이 맥 Keychain에 설치

  > **2026-08-29 기준 둘 다 발급 완료.** `Apple Distribution: MINSEOK SHIN (32R6RHXU36)`과
  > 설치 패키지 서명 인증서가 이 맥 Keychain에 있다(`npm run mas:preflight`로 확인).
  > `Developer ID Application`도 있지만 그건 웹사이트 직접 배포 전용이라 별개다.

- ⬜ **프로비저닝 프로파일** — [Profiles](https://developer.apple.com/account/resources/profiles/list) → `+` → **Mac App Store Connect**
  - App ID: `com.begreen.greenday`, 인증서: 방금 만든 Apple Distribution
  - 다운로드 후 저장소에 배치:
    ```
    cp ~/Downloads/*.provisionprofile resources/embedded.provisionprofile
    ```
    electron-builder가 이 경로를 자동으로 인식합니다.

---

## 2. App Store Connect — 앱 레코드

- ⬜ [App Store Connect](https://appstoreconnect.apple.com) → **My Apps** → `+` → **New App**

| 항목 | 값 |
|---|---|
| 플랫폼 | macOS |
| 이름 | `Greenday` |
| 기본 언어 | 한국어 |
| Bundle ID | `com.begreen.greenday` |
| SKU | `Greenday-macos-001` (내부 식별용, 아무 값이나 가능) |
| 사용자 액세스 | 전체 액세스 |

> 이름 `Greenday`가 이미 선점됐다면 `Greenday - 할 일 관리` 같은 변형이 필요합니다.
> 표시 이름과 Bundle ID는 별개라 앱 자체는 그대로 둬도 됩니다.

---

## 3. 메타데이터 — 복사해서 붙여넣기

### 3-1. 한국어 (기본)

**부제 (30자 이내)**
```
할 일·캘린더·습관을 한 곳에
```

**프로모션 텍스트 (170자 이내, 심사 없이 수시 변경 가능)**
```
데이터가 기기를 벗어나지 않는 할 일 관리 앱. 캘린더, 칸반, 타임라인, 아이젠하워, 포모도로, 습관까지 한 앱에. iCloud·Google 캘린더로 폰에서도 보고, AI는 내 맥에서 돌립니다.
```

**설명 (4000자 이내)**
```
Greenday는 맥을 위한 할 일 관리 앱입니다. 할 일, 일정, 습관을 한 곳에서 관리하면서도 데이터는 내 기기에만 둡니다.

■ 하나의 앱, 여섯 가지 시선

같은 할 일을 목적에 맞는 방식으로 봅니다.
· 목록 — 오늘, 내일, 다음 7일, 기본함으로 자동 정리
· 캘린더 — 월·주·일 단위. 시간 블록으로 일정 배치
· 칸반 보드 — 진행 상태로 관리
· 타임라인 — 기간이 있는 작업을 한눈에
· 아이젠하워 매트릭스 — 중요도와 긴급도로 분류
· 통계 — 완료 추이와 점수

■ 집중과 습관

· 포모도로 타이머 — 집중 시간을 기록하고 할 일과 연결
· 습관 추적 — 반복하고 싶은 일을 매일 체크

■ 데이터가 기기를 벗어나지 않습니다

Greenday에는 계정이 없습니다. 가입도, 로그인도 없습니다.
할 일과 메모는 맥 안에만 저장되고, 개발자가 운영하는 서버로 전송되지 않습니다.
분석 도구나 추적 코드도 넣지 않았습니다.

■ 내 맥에서 도는 AI 어시스턴트

Ollama를 설치하면 AI가 내 컴퓨터 안에서 돕니다. 인터넷으로 나가는 데이터가 없습니다.
"내일 오후 3시까지 보고서" 같은 자연어로 할 일을 만들고, 일정에 대해 물어볼 수 있습니다.

외부 AI(OpenAI 등)를 쓰고 싶으면 직접 설정할 수 있고, 그때는 무엇이 전송되는지
앱에서 미리 확인할 수 있습니다. '로컬 전용' 잠금을 켜면 외부 선택 자체가 막힙니다.

■ iPhone·안드로이드에서도 보기

할 일을 iCloud 또는 Google 캘린더에 올리면 폰의 캘린더 앱에서 그대로 보입니다.
계정 연결은 선택이고 기본은 꺼져 있습니다. Greenday가 만든 일정만 다루므로
기존 캘린더 일정은 읽지도, 건드리지도 않습니다.

■ 한국어와 영어

앱 전체가 두 언어를 지원합니다. "내일 오후 3시" 처럼 한국어로 적어도,
"tomorrow 3pm" 처럼 영어로 적어도 날짜를 알아듣습니다.

■ 그 밖에

· 반복 일정 — 매일·매주·매월·매년
· 알림 — 지정한 시각에 시스템 알림
· 하위 작업, 태그, 우선순위, 첨부파일
· 마크다운 메모 — 실시간 미리보기
· 다크 모드
· 데이터 내보내기 — JSON 또는 CSV. 언제든 내 데이터를 가져갈 수 있습니다
· 키보드 중심 조작

■ 한국어를 제대로 지원합니다

메뉴부터 AI 답변까지 한국어로 동작합니다.
로컬 AI를 쓸 때는 한국어에 강한 모델을 앱에서 바로 설치할 수 있습니다.
```

**키워드 (100자 이내, 쉼표 구분, 공백 없이)**
```
할일,투두,todo,일정관리,캘린더,동기화,아이클라우드,구글캘린더,포모도로,습관,생산성,GTD,태스크,칸반
```

**지원 URL**
```
https://github.com/supaicy/greenDay/issues
```

**마케팅 URL** (선택)
```
https://supaicy.github.io/greenDay/
```

**개인정보처리방침 URL** (필수)
```
https://begreen.dev/privacy        (영어 · 기본)
https://begreen.dev/ko/privacy     (한국어 — App Store Connect 의 현지화 URL 에)
```
> 2026-09-07: 정본이 회사 사이트로 옮겨졌다(앱 설정의 링크와 같은 주소). 옛
> `https://supaicy.github.io/greenDay/privacy.html` 은 살아 있되 위 주소로 리디렉션한다.
> **옛 `/haru/` 주소는 404이니 어딘가에 남아 있으면 같이 고칠 것.**

**저작권**
```
2026 supaicy
```

**카테고리**
- 기본: 생산성 (Productivity)
- 보조: 유틸리티 (Utilities)

---

### 3-2. English (권장 — 추가 언어)

**Subtitle (30자)**
```
Tasks, calendar, habits in one
```

**Promotional Text (170자)**
```
A task manager that keeps your data on your Mac. Calendar, kanban, timeline, Eisenhower, pomodoro, habits. Publish to iCloud or Google Calendar. Run the AI locally.
```

**Description**
```
Greenday is a task manager for macOS. It brings your tasks, schedule, and habits together while keeping your data on your own device.

■ One app, six ways to look at your work

· Lists — automatic Today, Tomorrow, Next 7 Days, and Inbox
· Calendar — month, week, and day views with time blocking
· Kanban board — manage by status
· Timeline — see work that spans days at a glance
· Eisenhower matrix — sort by importance and urgency
· Stats — completion trends and score

■ Focus and habits

· Pomodoro timer — track focus sessions, link them to tasks
· Habit tracking — check off what you want to repeat

■ Your data stays on your device

Greenday has no accounts. No sign-up, no login.
Your tasks and notes are stored on your Mac and never sent to a developer-operated server.
There is no analytics or tracking code in the app.

■ An AI assistant that runs on your Mac

Install Ollama and the AI runs entirely on your computer, with nothing leaving over the internet.
Create tasks in natural language and ask questions about your schedule.

You can configure an external provider such as OpenAI if you prefer. In that case the app shows you
exactly what will be sent before it goes. Turning on "Local only" locks external providers out entirely.

■ See your tasks on iPhone and Android

Publish dated tasks to iCloud or Google Calendar and they show up in the calendar app on your
phone. Connecting an account is optional and off by default. Greenday only manages the events it
creates — it never reads or touches your existing calendar entries.

■ Korean and English

The whole app speaks both. Type "tomorrow 3pm" or "내일 오후 3시" and Greenday understands the date
either way.

■ Also included

· Recurring tasks — daily, weekly, monthly, yearly
· Reminders — system notifications at the time you set
· Subtasks, tags, priorities, attachments
· Markdown notes with live preview
· Dark mode
· Export — JSON or CSV, so your data is always yours
· Keyboard-driven
```

**Keywords**
```
todo,task,calendar,sync,icloud,pomodoro,habit,productivity,GTD,kanban,eisenhower,planner,local
```

---

## 4. App Privacy 설문 — 답안

App Store Connect → App Privacy → **"Do you or your third-party partners collect data from this app?"**

### ⬜ 답: **No, we do not collect data from this app**

근거 (2026-07-29 소스 코드 기준):

| 확인 항목 | 결과 |
|---|---|
| 분석·텔레메트리 SDK | 없음 (Sentry·GA·Mixpanel·Amplitude·PostHog 전부 0건) |
| 광고 SDK / 광고 식별자 | 없음 |
| 개발자 서버로의 전송 | 없음 (서버 자체가 없음) |
| 계정·로그인 | 없음 |
| 위치·연락처·기기 지문 | 없음 |

> **왜 "No"가 맞는가.** Apple의 정의에서 "collect"는 *개발자 또는 개발자의 서드파티 파트너가*
> 기기 밖으로 데이터를 가져가는 것을 뜻합니다. 사용자가 직접 설정한 외부 AI 제공자로 나가는 통신은
> **사용자가 선택한 제3자와 사용자 사이의 통신**이며, 개발자는 그 데이터를 받지도 중계하지도 않습니다.
>
> 다만 이 부분이 심사에서 질문으로 돌아올 수 있으니, **심사 노트(App Review Notes)에 아래를 적어두세요.**

### ⬜ App Review Notes에 넣을 문구

```
Greenday stores all user data locally on the device. There is no developer-operated server,
no user account, and no analytics or tracking SDK of any kind.

OPTIONAL AI ASSISTANT
By default it targets Ollama on localhost, so no data leaves the machine. If the user
explicitly configures a third-party endpoint (e.g. OpenAI) in Settings, task
titles/dates/priorities/tags and the user's chat messages are sent directly from the
user's device to that endpoint the user chose. The developer neither receives nor relays
that data. A "Local only" lock prevents selecting any external provider.

OPTIONAL CALENDAR SYNC (off by default, one-way: Greenday -> calendar)
Two providers, both connecting directly from the user's device with no developer server
in between:

- iCloud: CalDAV over HTTPS to caldav.icloud.com, authenticated with the user's Apple ID
  and an app-specific password that the user creates and enters. The password is stored
  encrypted via Electron safeStorage (macOS keychain) and never leaves the device.
- Google: standard OAuth 2.0 with PKCE opened in the user's default browser (not an
  embedded web view). The app is a public client with no client secret. The callback
  arrives on a loopback redirect (http://127.0.0.1:<ephemeral port>/oauth2redirect), which is
  the flow Google requires for installed apps; the listener is bound to 127.0.0.1 only and is
  closed as soon as the single callback arrives (this is why the sandboxed build declares
  com.apple.security.network.server). The only scope requested is
  https://www.googleapis.com/auth/calendar.app.created, which limits access to calendars the
  app itself created: on connect Greenday creates a secondary calendar named "Greenday" in the
  user's account and writes only there. Greenday cannot list, read or modify the user's
  existing calendars.

Only tasks that have a date are published, carrying title, date/time, note body, and
completion state. Disconnecting deletes stored credentials (and revokes the Google grant)
but intentionally leaves already-published events in the user's calendar rather than
deleting data the user may want to keep.

REVIEWING WITHOUT AN ACCOUNT
No sign-in is required to use the app. Every feature except the two optional integrations
above works with no account. If you would like to exercise calendar sync, please request
test credentials and we will supply them.

MAC APP STORE BUILD DIFFERENCES
The in-app updater and global shortcuts are disabled via a process.mas guard, since the
App Store handles updates and the sandbox does not permit global shortcuts.
The com.apple.security.network.server entitlement exists only for the Google OAuth loopback
redirect described above: a listener bound to 127.0.0.1 on an ephemeral port, opened for the
duration of one sign-in and closed as soon as the single callback arrives. Nothing else listens.

Privacy policy: https://begreen.dev/privacy (Korean: https://begreen.dev/ko/privacy)
```

### ⬜ 캘린더 동기화가 App Privacy 답안을 바꾸는가 — 아니오 (근거)

| 질문 | 답 |
|---|---|
| 개발자 서버로 가는가? | 아니오. 기기 → Apple/Google 직접 연결. 중계 서버 없음 |
| 개발자가 데이터를 받는가? | 아니오 |
| 추적·광고에 쓰는가? | 아니오 |
| 데이터 브로커와 공유하는가? | 아니오 |
| 사용자 선택인가? | 예. 기본 꺼짐이고 계정 연결이 필요 |

Apple의 "collect"는 *개발자 또는 개발자의 서드파티 파트너가* 데이터를 가져가는 것을 뜻합니다.
사용자가 자기 iCloud/Google 계정에 자기 데이터를 쓰는 것은 여기에 해당하지 않습니다.

> **심사에서 되물어올 경우의 대비책.** 심사관이 "User Content를 신고하라"고 요구하면 다투지 말고
> 아래로 신고하면 됩니다 — 답안이 바뀌어도 앱 동작이나 문구를 고칠 필요는 없습니다.
>
> - Data Type: **Other User Content**
> - Purpose: **App Functionality**
> - Linked to identity: **No**
> - Used for tracking: **No**

---

## 4-B. Google OAuth 심사 (Apple과 별개, 병행 진행)

Google 캘린더 연동은 Google Cloud 콘솔에서 별도 심사를 받습니다. **다만 Greenday가 쓰는
`calendar.app.created` 범위는 민감(sensitive) 범위가 아니라 심사 부담이 훨씬 작습니다.**

| 항목 | 값 |
|---|---|
| 요청 범위 | `https://www.googleapis.com/auth/calendar.app.created` |
| 범위 등급 | 콘솔에서 확인 필요 — 앱이 만든 보조 캘린더(`Greenday`)에만 닿는 가장 좁은 범위. 사용자의 기존 캘린더는 목록조차 읽지 못한다 |
| 앱 유형 | 데스크톱 앱 (공개 클라이언트, PKCE) |
| 리디렉션 | `http://127.0.0.1:<임의 포트>/oauth2redirect` (루프백, 데스크톱 앱 유형) |

> `calendar.events`나 `calendar`(전체)를 요청했다면 사용자의 기존 일정까지 읽을 수 있어
> 훨씬 무거운 심사를 받았을 것입니다. 앱이 만든 일정만 다루면 되므로 그 범위를 요청하지
> 않았습니다. 실제 등급(민감/제한/일반)은 콘솔에서 범위를 추가할 때 표시되므로 그때 확인합니다.

---

## 5. GitHub Pages ✅ 완료

`gh-pages` 브랜치에 **공개용 파일만** 담아 서빙합니다 (`index.html`, `privacy.html`, `icon-128.png`).
`main:docs/`의 설계 문서·리뷰 리포트·가격 계획은 **웹사이트로 노출되지 않습니다** (404 확인 완료).

| URL | 상태 |
|---|---|
| `https://supaicy.github.io/greenDay/` | ✅ 200 (2026-08-29 재확인) |
| `https://supaicy.github.io/greenDay/privacy.html` | ✅ 200 ← **이 주소를 심사에 제출** |
| ~~`https://supaicy.github.io/haru/privacy.html`~~ | ❌ 404 — 저장소 개명으로 죽은 주소 |

> 방침을 고치면 `main:docs/privacy.html`을 먼저 고치고 `gh-pages` 브랜치로 복사하세요.

---

## 6. 스크린샷 ✅ 6장 준비됨

`docs/app-store/screenshots/` 에 **2880×1800** 6장이 있습니다. 그대로 업로드하시면 됩니다.

| 파일 | 화면 |
|---|---|
| `01-오늘.png` | 마감·우선순위·태그가 붙은 할 일 목록 |
| `02-캘린더-주.png` | 시간 블록 배치 |
| `03-칸반보드.png` | 할 일 / 진행 중 / 완료 |
| `04-아이젠하워.png` | 중요도·긴급도 4분면 |
| `05-습관.png` | 주간 체크와 연속 기록 |
| `06-설정-프라이버시.png` | 로컬 전용 잠금 · 로컬 AI |

실제 개인 할 일이 들어가지 않도록 격리된 데모 데이터로 촬영했습니다.
재촬영 절차는 `docs/app-store/README.md` 참조.

<details><summary>허용 해상도 (참고)</summary>

| 허용 크기 | 비고 |
|---|---|
| 2880 × 1800 | 권장. 창을 1440×900으로 맞추고 Retina 캡처 |
| 2560 × 1600 | |
| 1440 × 900 | 비Retina |
| 1280 × 800 | |

</details>

<details><summary>원래 추천했던 구성 (참고)</summary>

1. 목록 뷰 — 할 일이 채워진 오늘 화면
2. 캘린더 (주) — 시간 블록이 배치된 상태
3. 칸반 또는 아이젠하워
4. AI 어시스턴트 — 로컬 모델로 대화하는 화면
5. 설정 — "로컬 전용" 프라이버시 강조
6. 포모도로 또는 습관

> 스크린샷에 **실제 개인 할 일이 보이지 않게** 주의하세요. 데모용 데이터를 따로 만드는 게 안전합니다.
> 격리 실행으로 빈 데이터에서 시작할 수 있습니다:
> `npx electron-vite dev -- --user-data-dir=/tmp/Greenday-demo`

</details>

---

## 7. 빌드 업로드 & 제출

- ⬜ 인증서 2종 + 프로파일이 준비된 뒤:
  ```
  npm run mas:build
  ```
  (preflight를 먼저 돌리고 universal로 빌드한다. 문서 초판이 적어 둔 `package:mas`는
   끝이 `--config`로 잘려 있으니 쓰지 말 것.)
  결과: `dist/mas/Greenday-<버전>.pkg`

- ⬜ **Transporter** 앱(App Store에서 무료)으로 `.pkg` 업로드
  또는 `xcrun altool --upload-app -f dist/mas/Greenday-*.pkg -t macos -u <Apple ID> -p <앱 암호>`

- ⬜ App Store Connect에서 업로드된 빌드 선택 → **심사 제출**

---

## 8. 예상 소요

| 단계 | 시간 |
|---|---|
| 인증서 2종 + Bundle ID + 프로파일 | 1시간 |
| 앱 레코드 + 메타데이터 입력 | 1시간 (이 문서에서 복붙) |
| GitHub Pages 활성화 | 10분 |
| 스크린샷 촬영·정리 | 2~3시간 |
| App Privacy + 심사 노트 | 30분 (이 문서에서 복붙) |
| 빌드·업로드·제출 | 1시간 |
| **준비 소계** | **1~2일** |
| Apple 심사 | 1~3일 |
| 반려 시 수정·재심사 | +2~3일 |

**첫 제출 반려는 흔합니다.** 자주 걸리는 지점:
- 개인정보처리방침 URL이 안 열림 → GitHub Pages 확인
- App Privacy 신고와 실제 동작 불일치 → 심사 노트로 미리 설명
- 스크린샷 해상도 불일치
- 샌드박스 권한과 실제 기능 불일치 → `entitlements.mas.plist`는 이미 최소 권한으로 맞춰져 있음

---

## 부록 — 이미 준비된 것

| 항목 | 상태 |
|---|---|
| 샌드박스 호환성 | ✅ 정적 스캔 + MAS dry-run 통과 (2026-07-27) |
| `entitlements.mas.plist` | ✅ app-sandbox + network.client + user-selected.read-write |
| MAS에서 updater/전역단축키 비활성 | ✅ `process.mas` 가드 |
| 아이콘 | ✅ 원본 1920×1920 (1024 요구 충족) |
| 카테고리 | ✅ `public.app-category.productivity` |
| 개인정보처리방침 | ✅ 게시됨 https://begreen.dev/privacy (GitHub Pages 옛 주소는 리디렉션) |
| 메타데이터 텍스트 | 🤖 이 문서 3절 |
| App Privacy 답안 + 심사 노트 | 🤖 이 문서 4절 |
| 스크린샷 6장 (2880×1800) | ✅ `docs/app-store/screenshots/` |

---

*작성: 2026-07-29 · 근거는 당일 소스 코드 실측*
