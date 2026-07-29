# App Store 제출 체크리스트 & 메타데이터

haru를 Mac App Store에 올리기 위해 필요한 것 전부. 아래 텍스트는 App Store Connect에
**그대로 복사해 넣을 수 있게** 작성했습니다.

> 일반 배포 가이드는 `docs/DEPLOYMENT.md`. 이 문서는 App Store 제출에만 집중합니다.
> 상태 표기: ✅ 완료 · ⬜ 사장님이 하실 것 · 🤖 코드/문서로 준비됨

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
  - Bundle ID: `com.haru.app` (Explicit)
  - Capabilities: 추가할 것 없음 (haru는 iCloud·푸시·인앱결제 미사용)

- ⬜ **인증서 2종 발급** — [Certificates](https://developer.apple.com/account/resources/certificates/list) → `+`
  - **Apple Distribution** — 앱 서명용
  - **Mac Installer Distribution** (`3rd Party Mac Developer Installer`) — `.pkg` 서명용.
    **이게 없으면 MAS 빌드가 실패합니다.**
  - 두 개 다 발급 후 더블클릭해서 이 맥 Keychain에 설치

  > 현재 보유: `Apple Development`, `Developer ID Application` — **둘 다 App Store에는 못 씁니다.**
  > `Developer ID Application`은 웹사이트 직접 배포 전용입니다.

- ⬜ **프로비저닝 프로파일** — [Profiles](https://developer.apple.com/account/resources/profiles/list) → `+` → **Mac App Store Connect**
  - App ID: `com.haru.app`, 인증서: 방금 만든 Apple Distribution
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
| 이름 | `haru` |
| 기본 언어 | 한국어 |
| Bundle ID | `com.haru.app` |
| SKU | `haru-macos-001` (내부 식별용, 아무 값이나 가능) |
| 사용자 액세스 | 전체 액세스 |

> 이름 `haru`가 이미 선점됐다면 `haru - 할 일 관리` 같은 변형이 필요합니다.
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
데이터가 기기를 벗어나지 않는 할 일 관리 앱. 캘린더, 칸반, 타임라인, 아이젠하워, 포모도로, 습관 추적까지 한 앱에 담았습니다. AI 어시스턴트도 내 맥에서 돌릴 수 있습니다.
```

**설명 (4000자 이내)**
```
haru는 맥을 위한 할 일 관리 앱입니다. 할 일, 일정, 습관을 한 곳에서 관리하면서도 데이터는 내 기기에만 둡니다.

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

haru에는 계정이 없습니다. 가입도, 로그인도 없습니다.
할 일과 메모는 맥 안에만 저장되고, 개발자가 운영하는 서버로 전송되지 않습니다.
분석 도구나 추적 코드도 넣지 않았습니다.

■ 내 맥에서 도는 AI 어시스턴트

Ollama를 설치하면 AI가 내 컴퓨터 안에서 돕니다. 인터넷으로 나가는 데이터가 없습니다.
"내일 오후 3시까지 보고서" 같은 자연어로 할 일을 만들고, 일정에 대해 물어볼 수 있습니다.

외부 AI(OpenAI 등)를 쓰고 싶으면 직접 설정할 수 있고, 그때는 무엇이 전송되는지
앱에서 미리 확인할 수 있습니다. '로컬 전용' 잠금을 켜면 외부 선택 자체가 막힙니다.

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
할일,투두,todo,일정관리,캘린더,포모도로,습관,생산성,GTD,태스크,체크리스트,아이젠하워,칸반
```

**지원 URL**
```
https://github.com/supaicy/haru/issues
```

**마케팅 URL** (선택)
```
https://supaicy.github.io/haru/
```

**개인정보처리방침 URL** (필수)
```
https://supaicy.github.io/haru/privacy.html
```
> 🤖 문서는 `docs/privacy.html`에 작성 완료. **GitHub Pages를 켜야 이 URL이 열립니다** (아래 5절).

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
A task manager that keeps your data on your Mac. Calendar, kanban, timeline, Eisenhower matrix, pomodoro, and habit tracking in one app. The AI assistant can run entirely on your machine.
```

**Description**
```
haru is a task manager for macOS. It brings your tasks, schedule, and habits together while keeping your data on your own device.

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

haru has no accounts. No sign-up, no login.
Your tasks and notes are stored on your Mac and never sent to a developer-operated server.
There is no analytics or tracking code in the app.

■ An AI assistant that runs on your Mac

Install Ollama and the AI runs entirely on your computer, with nothing leaving over the internet.
Create tasks in natural language and ask questions about your schedule.

You can configure an external provider such as OpenAI if you prefer. In that case the app shows you
exactly what will be sent before it goes. Turning on "Local only" locks external providers out entirely.

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
todo,task,tasks,calendar,pomodoro,habit,productivity,GTD,checklist,kanban,eisenhower,planner,local
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
haru stores all user data locally on the device. There is no developer-operated server,
no user account, and no analytics or tracking SDK of any kind.

The app includes an optional AI assistant. By default it targets Ollama on localhost, so no
data leaves the machine. If the user explicitly configures a third-party endpoint (e.g. OpenAI)
in Settings, task titles/dates/priorities/tags and the user's chat messages are sent directly
from the user's device to that endpoint the user chose. The developer neither receives nor
relays that data. The app also provides a "Local only" lock that prevents selecting any
external provider.

In the Mac App Store build, the in-app updater and global shortcuts are disabled via a
process.mas guard, since the App Store handles updates and the sandbox does not permit
global shortcuts.

Privacy policy: https://supaicy.github.io/haru/privacy.html
```

---

## 5. GitHub Pages 활성화 (개인정보처리방침 URL용)

⬜ 현재 **비활성**입니다. 켜지 않으면 개인정보처리방침 URL이 404가 되고 **심사가 반려됩니다.**

Settings → Pages → Source: `Deploy from a branch` → Branch: `main` / 폴더: `/docs` → Save

몇 분 뒤 아래가 열립니다:
- `https://supaicy.github.io/haru/` (랜딩)
- `https://supaicy.github.io/haru/privacy.html` (방침)

> ⚠️ `docs/` 전체가 공개 웹사이트가 됩니다. 설계 문서·리뷰 리포트도 포함됩니다.
> 저장소가 이미 공개라 내용 자체는 볼 수 있었지만, 웹으로 탐색 가능해진다는 점은 알고 계세요.
> 원치 않으면 방침 파일만 별도 브랜치나 다른 호스팅으로 올리면 됩니다.

---

## 6. 스크린샷

⬜ **최소 1장, 권장 4~6장.** 아래 해상도 중 하나로 통일해야 합니다.

| 허용 크기 | 비고 |
|---|---|
| 2880 × 1800 | 권장. 창을 1440×900으로 맞추고 Retina 캡처 |
| 2560 × 1600 | |
| 1440 × 900 | 비Retina |
| 1280 × 800 | |

**추천 구성**

1. 목록 뷰 — 할 일이 채워진 오늘 화면
2. 캘린더 (주) — 시간 블록이 배치된 상태
3. 칸반 또는 아이젠하워
4. AI 어시스턴트 — 로컬 모델로 대화하는 화면
5. 설정 — "로컬 전용" 프라이버시 강조
6. 포모도로 또는 습관

> 스크린샷에 **실제 개인 할 일이 보이지 않게** 주의하세요. 데모용 데이터를 따로 만드는 게 안전합니다.
> 격리 실행으로 빈 데이터에서 시작할 수 있습니다:
> `npx electron-vite dev -- --user-data-dir=/tmp/haru-demo`

---

## 7. 빌드 업로드 & 제출

- ⬜ 인증서 2종 + 프로파일이 준비된 뒤:
  ```
  NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection" npm run package:mas
  ```
  결과: `dist/mas/haru-<버전>.pkg`

- ⬜ **Transporter** 앱(App Store에서 무료)으로 `.pkg` 업로드
  또는 `xcrun altool --upload-app -f dist/mas/haru-*.pkg -t macos -u <Apple ID> -p <앱 암호>`

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
| 개인정보처리방침 | 🤖 `docs/privacy.html` (한/영) |
| 메타데이터 텍스트 | 🤖 이 문서 3절 |
| App Privacy 답안 + 심사 노트 | 🤖 이 문서 4절 |

---

*작성: 2026-07-29 · 근거는 당일 소스 코드 실측*
