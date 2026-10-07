# 하우투 — 스크린샷 다시 찍기

App Store 용 **2880×1800** 세트(다크 `docs/app-store/screenshots/`, 라이트 `docs/app-store/screenshots-light/`, 각 6장)와 사이트용 **1440×900** 세트를 다시 만드는 두 가지 방법. 어느 쪽이든 **실제 데이터 폴더(`~/Library/Application Support/ticktick`)를 쓰지 않는다** — 개인 할일이 스크린샷에 들어가면 안 된다.

## 방법 A — headless (권장: 화면을 뺏지 않는다)

`docs/app-store/tools/headless-stub.js` 가 `window.api` 를 데모 데이터로 채워, Electron 없이 렌더러만 Chrome headless 로 찍는다. 라이트/다크·크기·배율을 URL 과 플래그로 고른다. 도구 README(`docs/app-store/tools/README.md`)와 `b63b6f0` 커밋이 원본.

```bash
npm run build                                   # out/renderer 생성 (electron-vite build)
rm -rf /tmp/appshot && cp -R out/renderer /tmp/appshot
cp docs/app-store/tools/headless-stub.js /tmp/appshot/stub.js
```

`/tmp/appshot/index.html` 을 열어 `<script type="module" …>` **바로 앞에** 한 줄을 넣는다(사본에만 — `out/renderer` 원본은 건드리지 않는다):

```html
<script src="./stub.js"></script>
```

정적 서버를 띄우고 찍는다:

```bash
cd /tmp/appshot && python3 -m http.server 8092 &
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# App Store 용 2880×1800 = 1440×900 × 배율 2
"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --window-size=1440,900 --force-device-scale-factor=2 \
  --screenshot=/tmp/01-오늘.png --virtual-time-budget=9000 \
  "http://127.0.0.1:8092/?theme=light&view=오늘"
```

| 쿼리 | 값 |
|---|---|
| `theme` | `light` \| `dark` — 스텁이 `localStorage['ticktick-theme']` 에 넣는다 |
| `view` | 사이드바 라벨 그대로. 스텁이 그 텍스트의 버튼/링크를 찾아 클릭한다(headless 는 클릭을 못 하므로) |

여섯 장의 `view` 값과 파일 이름(`docs/app-store/README.md` 표 기준):

| 파일 | `view` |
|---|---|
| `01-오늘.png` | `오늘` |
| `02-캘린더-주.png` | `캘린더` (주간 뷰가 기본이 아니면 스텁의 클릭 대상을 늘려야 한다 — 아래 "한계") |
| `03-칸반보드.png` | `칸반 보드` (URL 인코딩 `칸반%20보드`) |
| `04-아이젠하워.png` | `아이젠하워` |
| `05-습관.png` | `습관` |
| `06-설정-프라이버시.png` | `설정` |

사이트용 1440×900 은 배율만 1 로 바꾼다:

```bash
"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --window-size=1440,900 --force-device-scale-factor=1 \
  --screenshot=/tmp/shot-01.png --virtual-time-budget=9000 \
  "http://127.0.0.1:8092/?theme=light&view=오늘"
```

사이트가 쓰는 파일은 `docs/landing/shot-01.jpg … shot-06.jpg`(1440×900, JPEG). PNG → JPEG 변환은 `sips -s format jpeg /tmp/shot-01.png --out docs/landing/shot-01.jpg`. begreen 사이트(`../begreen/site/assets/`)에도 같은 세트가 들어간다 — `b63b6f0` 의 메시지에 따르면 사이트 배경(#FCFCFB)과 라이트 스크린샷의 명도차가 9 뿐이라 페이지 쪽은 아직 다크를 쓰고 있다. 어느 세트를 올릴지는 사이트 쪽 결정이다.

끝나면 서버를 내린다: `kill %1` 또는 `pkill -f "http.server 8092"`.

### 스텁이 지키는 규칙 (고칠 때 알아야 한다)

`headless-stub.js` 를 고치다 세 번 틀렸던 것들이 도구 README 에 있다:

- **행은 스네이크케이스.** 스토어가 `row.due_date → dueDate` 로 매핑한다(`useStore.mapTask`). 캐멀케이스로 주면 날짜·태그가 사라진다.
- **날짜는 로컬 시간 `yyyy-MM-dd`.** `toISOString()` 은 UTC 라 KST 새벽에 하루 전 날짜가 나와 "오늘" 이 빈다. 스텁의 `iso()`/`day(n)` 이 그렇게 만든다 — 촬영일 기준 상대 날짜라 언제 찍어도 오늘 뷰가 찬다.
- **데이터는 전부 IPC.** `getLists`·`getTasks`·`getHabits`·`getHabitLogs`·`getScore` 등을 스텁이 답해야 화면이 채워진다. `capabilities` 와 `licenseGetState` 도 답한다(잠금 화면이 뜨지 않게 `enforced: false`). 새 IPC 를 렌더러가 부팅 때 부르게 되면 스텁에 case 를 추가한다 — `default` 는 `undefined` 를 돌려주므로 대개 안 죽지만 화면이 빈다.

### 한계

- `view` 는 텍스트가 정확히 일치하거나 그 텍스트로 시작하는 첫 요소를 클릭한다. 두 번 클릭해야 도달하는 화면(예: 캘린더 → 주간 전환, 설정의 특정 섹션)은 스텁에 두 번째 클릭을 추가해야 한다.
- 데모 데이터는 `headless-stub.js` 안의 `TASKS`/`HABITS` 다. `docs/app-store/demo-data.json` 은 방법 B 용이라 서로 다르다. 같은 화면을 두 방법으로 찍으면 내용이 다르다.

## 방법 B — Electron 창 + 데모 데이터 (실제 앱을 찍는다)

`docs/app-store/README.md` 의 절차. 창이 뜨므로 그동안 화면을 쓸 수 없다.

```bash
DEMO=/tmp/greenday-demo && mkdir -p "$DEMO"
cp docs/app-store/demo-data.json "$DEMO/ticktick-data.json"
npx electron-vite dev -- --user-data-dir="$DEMO"

# 창을 1440×900 으로 (Retina 에서 캡처하면 2880×1800)
osascript -e 'tell application "System Events" to tell process "Electron" to set size of window 1 to {1440, 900}'
```

`Cmd+Shift+4` → `Space` → 창 클릭(그림자 없이 찍으려면 `Option` 을 누른 채). 테마는 설정에서 바꾼다.

`demo-data.json` 의 날짜는 **고정값**이다(2026-07-31 기준). 오늘과 어긋나면 "오늘" 뷰가 빈다 — `due_date`/`scheduled_*` 를 촬영일로 바꾼다.

## 규격

App Store Connect 가 받는 macOS 스크린샷 크기: 2880×1800 · 2560×1600 · 1440×900 · 1280×800. 어긋나면 업로드가 거부된다. 확인:

```bash
sips -g pixelWidth -g pixelHeight docs/app-store/screenshots-light/*.png
```

## 관련

- 어떤 장면을 왜 골랐는지: [app-store-submission.md](app-store-submission.md) 6절
- 사이트가 스크린샷을 어떻게 놓는지: `docs/landing/index.html`(GitHub Pages 랜딩) 과 `../begreen/site`
