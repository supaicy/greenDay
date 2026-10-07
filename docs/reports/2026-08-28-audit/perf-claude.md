# 성능 감사 — Greenday (supaicy/coordinate)

2026-08-28 · 코드는 고치지 않았다. 발견만 적는다.

## 측정 환경과 방법

- macOS 25.5.0 (Apple Silicon, APFS), Node v24.13.1, 프로덕션 모드(`NODE_ENV=production`).
- 렌더러 수치는 **실제 `TaskItem`·`useStore`·Radix 컨텍스트메뉴를 그대로 번들해** jsdom + `react-dom/client`(production) + `flushSync`로 잰 것이다. 스크래치 하네스는 리포 밖(scratchpad)에 두었고 소스는 건드리지 않았다.
- jsdom은 Chromium보다 DOM 조작이 느리다. 다만 아래 **리렌더** 수치는 대부분 DOM 변경이 없는 리렌더(=React 조정 + 컴포넌트 본문 실행 + 셀렉터 평가)라 엔진 바운드이고, 순수 JS 벤치와 오차 10% 안에서 일치했다(`N=M=2000`: 하네스 18.0ms vs 순수 루프 19.5ms). **최초 마운트** 수치만 jsdom 편향이 있으니 상대 비교로만 읽을 것.
- 기준 상태 확인: `npx tsc --build` 통과, `npx biome lint` 경고 7·정보 4(기존), `npx vitest run` **915 passed / 59 files**.
- 데이터 규모는 N = 할일 개수, M = 화면에 실제로 마운트된 `TaskItem` 행 수로 표기한다.

핵심 원자 비용(직접 측정):

| 연산 | 비용 |
|---|---|
| ed25519 `verify` 1회 | **0.034 ms** |
| `fsyncSync` 1회 (APFS) | **4.04 ms** (fsync 없는 쓰기 0.168 ms의 **24배**) |
| `writeFileSync(..., {flush:true})` | 0.168 ms — 배리어가 안 걸린다(코드 주석과 일치) |
| `execFileSync('/usr/sbin/ioreg', …)` | **17.3 ms** |
| `JSON.stringify(DB)` | 0.53 ms(1k) / 2.68 ms(5k) / **10.5 ms**(20k, 10.15 MB) |
| `JSON.parse(DB)` | 0.60 / 2.85 / **11.3 ms** |
| `v8.serialize(tasks)` (= `get-tasks` IPC) | 0.7 / 3.1 / **12.1 ms**, 페이로드 9.0 MB |
| `require('electron-updater')` | **33.7–35.9 ms**, 158 모듈, 소스 596 kB |

---

## critical

### [critical] src/renderer/src/components/tasks/TaskList.tsx:112 — `handleDrop`이 `filteredTasks`에 묶여 있어 `memo(TaskItem)`이 통째로 무력화된다

**문제.** `handleDrop`은 `useCallback(..., [dragTaskId, filteredTasks, reorderTasks, setDragTaskId])`이고, `filteredTasks`는 `tasks`·`selectedListId`·`searchQuery`·`sortBy`·`sortDir` 중 하나만 바뀌어도 새 배열이 된다(`TaskList.tsx:53-89`). 그 함수가 `TaskList.tsx:224·230·235·245`에서 `onDrop`으로 모든 행에 내려간다. `TaskItem`은 `memo`(`TaskItem.tsx:44`)인데, prop 하나가 매번 새 함수라 **memo가 한 번도 적중하지 못한다.**

**측정.**

| 행 수 | `onDrop` 안정(memo 적중) | 현재 코드(매번 새 함수) |
|---|---|---|
| M=500 | 0.2 ms | **37.2 ms** |
| M=1000 | 0.2 ms | **73.0 ms** |
| M=2000 | 0.4 ms | **145.1 ms** |

(같은 `task` 객체 정체성, 새 배열 정체성 — 즉 "할일 하나만 고쳤다"에 해당하는 상황.)

**왜 나쁜가.** 체크박스 하나 토글, 검색창 한 타, 정렬 토글, 드래그 시작/종료가 전부 이 경로다. 할일 1000개를 쓰는 사용자는 **체크박스 한 번에 73 ms**를 낸다 — 60fps 예산(16.7ms)의 4.4배다. 정렬이 걸려 있으면 `canReorder`가 false라 `undefined`가 내려가고 memo가 살아나므로(`TaskList.tsx:111`), 증상이 **기본 정렬에서만** 나타나 재현이 헷갈린다.

**고치는 법.** `handleDrop`이 `filteredTasks`를 클로저로 잡지 말고 ref로 읽게 한다(`const listRef = useRef(filteredTasks); listRef.current = filteredTasks`) — 그러면 deps는 `[reorderTasks, setDragTaskId]`뿐이라 참조가 고정된다. `dragTaskId`도 같은 방식으로 `useStore.getState().dragTaskId`에서 꺼내면 된다(`TaskItem`이 이미 `dragTaskId`를 직접 구독하므로 그쪽 리렌더는 따로 보장된다).

### [critical] src/renderer/src/components/tasks/TaskItem.tsx:26 — 행마다 전체 할일을 두 번 훑는 셀렉터가 붙어 있어, 스토어 쓰기 1회 비용이 O(N×M)이다

**문제.** `useSubtaskCount`는 `useStore` 셀렉터 안에서 `s.tasks`를 **행마다 두 번** 완주한다(`:27-33`, `:34-40`). Zustand는 `useSyncExternalStore` 기반이라 **모든 `set()`마다 마운트된 모든 구독자의 셀렉터를 다시 실행한다** — 값이 같아 리렌더가 생략되더라도 셀렉터 자체는 돈다. 즉 스토어 쓰기 1회당 `2 × N × M` 회 순회다.

**측정** (UI 전용 쓰기 = `searchQuery` 변경, 할일 배열 정체성 불변):

| 구성 | 쓰기 1회 | 같은 조건 빈 행 baseline |
|---|---|---|
| N=500, M=500 | 1.14 ms | 0.02 ms |
| N=1000, M=1000 | 4.43 ms | 0.03 ms |
| N=2000, M=2000 | **17.95 ms** | 0.07 ms |
| N=5000, M=50 | 0.95 ms | 0.02 ms |
| N=10000, M=50 | **1.96 ms** | — |

마지막 두 줄이 중요하다: 화면에 50행만 보여도 **N에 선형으로** 비싸진다. "오늘" 뷰처럼 몇 줄만 보이는 화면도 보관 중인 할일 전체를 행마다 스캔한다.

**왜 나쁜가.** 이 비용은 리렌더가 아니라 **구독 평가**라서 `memo`로도, `useMemo`로도 막히지 않는다. 아래의 AI 스트리밍(초당 30–80회 쓰기)과 곱해지면 그대로 락업이다.

**고치는 법.** 부모(`TaskList`)에서 `useMemo`로 `parentId → {total, completed}` 맵을 한 번 만들어 prop으로 내려준다(전체 1패스). 스토어에 두겠다면 파생 맵을 `tasks`가 바뀔 때만 다시 만들고 셀렉터는 `s.subtaskCounts[taskId]` 한 번 읽기로 끝내야 한다.

---

## high

### [high] src/renderer/src/store/useStore.ts:1140 — AI 스트리밍이 **토큰 하나당 스토어 쓰기 1회**를 일으킨다

**문제.** `onAiStreamToken` 콜백이 토큰마다 `set()`을 부르고, 그 안에서 `aiMessages` 전체를 `.map()`으로 다시 만든다(`:1141-1143`). 뒤를 따라가면 배칭이 한 군데도 없다: `ai-service.ts:554`가 SSE 델타마다 `onToken(token)`을 부르고 → `ipc-handlers.ts:237`이 델타마다 `sender.send('ai:stream-token', …)` IPC를 쏘고 → `preload/index.ts:125-129`가 그대로 렌더러 콜백으로 넘긴다.

**왜 나쁜가.** 로컬 Ollama 기준 대략 30–80 tok/s다. 그 각각이 위 두 critical 항목을 전부 지불한다:

- N=M=2000에서 셀렉터 churn 17.95 ms × 40 tok/s = **초당 718 ms의 CPU** — 응답 하나 받는 동안 UI가 사실상 정지한다.
- `aiMessages`는 최대 200개(`trim.ts` cap)라, 토큰마다 200개짜리 배열과 객체 하나를 새로 만든다 — GC 압력만 따로 있다.
- IPC도 토큰당 1건이다. 메인↔렌더러 왕복이 응답 하나에 수천 건 쌓인다.

**고치는 법.** 메인에서 `onToken`을 프레임 단위로 모아 보내거나(예: 16 ms 또는 N자 단위 플러시), 렌더러에서 토큰을 ref에 누적하고 `requestAnimationFrame`으로 한 번만 `set()` 한다. 후자가 IPC 계약을 안 건드려 싸다. 어느 쪽이든 위 두 critical을 먼저 고치면 이 항목의 체감이 크게 줄어든다.

### [high] src/renderer/src/components/tasks/TaskList.tsx:229 — 목록에 가상화가 없다. 필터된 할일 전부를 DOM에 그린다

**문제.** `filteredTasks.map(...)`(`:229`), `incompleteTasks.map(...)`(`:234`), `completedTasks.map(...)`(`:244`), `g.tasks.map(...)`(`:223`) — 모두 잘라내지 않는다. 리포 전체에 `react-window`류도, 수동 윈도잉도 없다(검색으로 확인).

**측정** (최초 마운트):

| 행 수 | 실제 `TaskItem` | 빈 `<div>` baseline |
|---|---|---|
| M=200 | 60 ms | — |
| M=500 | 91 ms | — |
| M=1000 | **171 ms** | 11 ms |
| M=2000 | **391 ms** | 11 ms |

행당 약 0.17–0.2 ms. baseline과의 16–35배 차이가 앱 자신의 비용이다: 행마다 lucide 아이콘 5개 + Radix `ContextMenu.Root`/`Trigger`/`Content` 엘리먼트 트리 + `useStore` 구독 11개.

**왜 나쁜가.** 뷰 전환·리스트 전환·검색 결과 변경이 전부 이 마운트를 다시 낸다. 그리고 M이 커지는 것이 위 두 critical 항목의 곱셈 인자다 — 가상화는 세 문제를 동시에 줄인다.

**고치는 법.** 목록 컨테이너에 윈도잉을 넣는다(행 높이가 균일하지 않으므로 가변 높이 지원 필요). 전면 도입 전이라도 `TaskItem`당 Radix 루트를 없애는 것만으로(컨텍스트 메뉴를 목록 레벨에 하나만 두고 우클릭한 행을 상태로 들기) 행당 비용이 크게 떨어진다 — 다만 `TaskContextMenu.tsx:15-25` 주석이 포커스 반환 때문에 지금 구조를 택했다고 밝히고 있으니, 그 트레이드오프를 다시 여는 결정이 먼저다.

### [high] src/main/database.ts:71 — 할일 하나를 고쳐도 데이터 파일 **전체**를 다시 쓴다

**문제.** `save()`는 300 ms 배치 뒤 `JSON.stringify(data)` + `writeFile(dbPath, json)`로 **파일 전체**를 갈아엎는다. 부분 갱신도, 증분 로그도 없다.

**측정.** 20k 할일 = 10.15 MB. 저장 1회당 메인 스레드 **10.5 ms 블록**(stringify) + 10.15 MB 디스크 쓰기. 5k에서는 2.7 ms / 2.53 MB.

**왜 나쁜가.** 세 방향으로 아프다.

1. **메인 스레드 블록.** `JSON.stringify`는 동기다. 최악의 경우 300 ms마다 10.5 ms — 그동안 유료 IPC도 리마인더도 서지 않는다.
2. **쓰기 증폭.** 상세 패널 메모는 렌더러에서 400 ms 디바운스(`TaskDetail.tsx:119-126`)되고 그 뒤 DB가 300 ms 배치를 건다. 즉 **긴 메모를 타이핑하는 동안 약 700 ms마다 10 MB가 SSD로 나간다**(≈14 MB/s 지속).
3. **전이 메모리.** 저장마다 UTF-16 문자열 **20.3 MB**(한글 제목이라 2바이트 표현) + Node가 만드는 Buffer 10.2 MB가 `writeFile` 콜백까지 살아 있다. 300 ms 주기 GC 압력이다.

**고치는 법.** 단기로는 배치 창을 늘리고(300 ms → 1–2 s) 유휴 시점에 쓰는 것으로 증폭을 줄인다. 근본은 전체 스냅샷을 버리는 것이다 — append-only 저널 + 주기적 컴팩션, 또는 SQLite(better-sqlite3)로 이동. 저장소 교체는 크지만, 이 파일 구조가 아래 `[medium] initDatabase의 무조건 save`와 `[low] 동시 writeFile` 둘의 뿌리이기도 하다.

---

## medium

### [medium] src/main/index.ts:4 — `electron-updater`를 최상단에서 무조건 로드한다. 스토어 빌드에서는 완전히 죽은 코드다

**문제.** `import { autoUpdater } from 'electron-updater'`가 `index.ts:4`와 `app-ipc.ts:14`에 있다. 빌드 산출물 `out/main/index.js:4`에서 확인: `const electronUpdater = require("electron-updater");` — 파일 최상단, 조건 없음. `app.whenReady()`보다 앞서 실행된다.

**측정.** 로드 **33.7–35.9 ms**, 158개 모듈, 소스 596 kB(electron-updater 119 + js-yaml 25 + graceful-fs 4 + …).

**왜 나쁜가.** `currentCapabilities().canSelfUpdate`는 개발 빌드와 스토어 빌드(MAS/Windows Store)에서 false다(`shared/capabilities.ts:79`). 그 빌드들에서는 이 36 ms가 **전부 낭비**다 — 창이 뜨기 전 예산에서 나간다. `app-ipc.ts:25-32`의 두 핸들러도 `canSelfUpdate`가 false면 즉시 return이므로 모듈이 필요 없다.

**고치는 법.** 최상단 import를 지우고 실제로 쓰는 자리에서 동적으로 가져온다 — `index.ts:162`의 `if (currentCapabilities().canSelfUpdate)` 블록 안, `app-ipc.ts`는 핸들러 몸통 안에서 `await import('electron-updater')`. 자체 업데이트 빌드에서도 창을 띄운 뒤로 미룰 수 있다.

### [medium] src/main/database.ts:242 — `initDatabase()`가 무조건 `save()`를 부른다. 아무것도 안 바뀐 실행에서도 파일 전체를 다시 쓴다

**문제.** 마이그레이션 루프와 inbox 보정이 끝나고 마지막 줄이 조건 없는 `save()`다. 위 마이그레이션은 전부 멱등이고, 대부분의 실행에서 아무것도 바꾸지 않는다.

**측정.** 20k 할일 기준 실행마다 stringify 10.5 ms + **10.15 MB 쓰기**. 5k에서 2.7 ms / 2.53 MB. 앱을 하루 다섯 번 켜면 아무 이유 없이 50 MB가 나간다.

**왜 나쁜가.** 부팅 직후 300 ms 지점의 메인 스레드 블록이라, 렌더러가 `loadData()`의 8개 IPC를 던지는 바로 그 구간과 겹친다.

**고치는 법.** 마이그레이션 루프가 실제로 필드를 건드렸는지 더티 플래그로 모아 두고, 더티일 때만 `save()`한다. 필드 기본값 채우기·`normalizeLegacyWeeklyPattern`·pomodoro 스네이크케이스 변환·inbox 생성/개명 — 다섯 자리 전부 같은 플래그를 세우면 된다.

### [medium] src/main/ipc-handlers.ts:166 — CSV 내보내기가 **방금 자기가 만든 문자열을 다시 파싱한다**

**문제.**
```
const exportedData = db.exportData()   // JSON.stringify(data, null, 2)
if (ext === 'csv') {
  const parsed = JSON.parse(exportedData)   // 방금 직렬화한 것을 되돌린다
```
`db.exportData()`(`database.ts:651`)는 `JSON.stringify(data, null, 2)`다. CSV 경로는 그 결과가 필요 없는데, 문자열로 만든 다음 다시 객체로 푼다. 원본 `data`는 같은 프로세스 메모리에 그대로 있다.

**측정** (메인 스레드 동기 블록):

| 규모 | pretty stringify | 되돌리는 parse | 합 |
|---|---|---|---|
| 5k | 4.9 ms | 3.7 ms | **8.6 ms** (3.5 MB 문자열) |
| 20k | 16.2 ms | 14.7 ms | **30.9 ms** (13.9 MB 문자열) |

**왜 나쁜가.** CSV 내보내기는 JSON 경로보다 **두 배 이상** 느리고, 13.9 MB 문자열을 아무 데도 안 쓰고 버린다. 그리고 이 채널은 `free`라 잠긴 앱에서도 열려 있다 — 데이터를 인질로 잡지 않는다는 원칙상 반드시 눌리는 경로다.

**고치는 법.** CSV 분기에서 `db.exportData()`를 부르지 않는다. `db.getTasks()`(이미 `deleted_at` 필터가 들어 있어 `:172`의 필터도 필요 없다)를 그대로 쓰고, `writeFileSync`도 스트리밍/청크로 나눌 여지가 있다. JSON 분기만 `exportData()`를 쓰면 된다.

### [medium] src/main/index.ts:110 — `optimizer.watchWindowShortcuts`가 **모든 키 입력**을 메인 프로세스로 끌어온다

**문제.** `app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))`. 번들된 구현(`out/main/index.js:46`)이 `webContents.on("before-input-event", …)`를 건다. Electron의 `before-input-event`는 렌더러가 키를 처리하기 **전에 메인 프로세스로 동기 디스패치**되는 이벤트다 — keyDown/keyUp/char 전부.

**왜 나쁜가.** 이 앱은 타이핑이 주 동작이다(제목·메모·검색·AI 입력). 모든 키가 메인 프로세스를 한 번 거치는데, 그 메인 프로세스는 같은 시간대에 300 ms마다 `JSON.stringify(10 MB)`로 10.5 ms씩 멈춰 있다(위 `[high] database.ts:71`). 두 개가 곱해져 타이핑 지연이 메인 프로세스 상태에 결합된다. 하는 일은 프로덕션에서 Cmd+R / Cmd+Alt+I 두 개 막는 것뿐이다.

**한계.** 키 이벤트 1건당 실제 왕복 비용은 **여기서 측정하지 못했다**(실행 중인 Electron이 필요하다). 메커니즘은 소스로 확인했고, 크기는 미측정이다.

**고치는 법.** `watchWindowShortcuts`를 걷어내고 필요한 두 단축키만 `webContents.on('before-input-event')` 대신 앱 메뉴 accelerator로 처리한다 — `app-menu.ts`가 이미 View 메뉴를 손으로 짓고 있어서 자리가 있다. 진짜 게이트는 메인의 `ipc-gate.ts`이므로(`CLAUDE.md`) DevTools 차단을 키 후킹으로까지 할 이유가 약하다.

### [medium] src/renderer/src/store/useStore.ts:1046 — Ollama 모델 다운로드 진행률이 줄 단위로 스토어를 때린다

**문제.** `ai-service.ts:193-197`의 `emitLine`이 `/api/pull` NDJSON **한 줄마다** `onProgress`를 부르고, `ipc-handlers.ts:253`이 그때마다 IPC를 쏘고, `useStore.ts:1046-1056`이 그때마다 `set()`을 한다. Ollama는 청크마다 진행률 줄을 낸다 — 초당 수십~수백 건이다.

**왜 나쁜가.** 위 `[critical] TaskItem.tsx:26`과 정확히 같은 곱셈이 걸린다. 수 GB 모델을 받는 동안 목록이 잠긴다.

**고치는 법.** 메인에서 `parsePullProgress` 결과의 `percent`가 정수 단위로 바뀔 때만 emit하거나, 렌더러에서 200 ms 스로틀을 건다. 표시 해상도가 퍼센트 정수라 정보 손실이 없다.

### [medium] src/renderer/src/components/tasks/TaskDetail.tsx:67 — 상세 패널도 셀렉터 안에서 전체 할일을 훑는다

**문제.** `useStore((s) => s.tasks.filter((x) => x.parentId === s.selectedTaskId).length)` — 하위작업 개수를 위해 매 스토어 쓰기마다 O(N) 필터 + 중간 배열 할당. 바로 위 `:53-54`에 "무선택자 `useStore()`는 아무 store 쓰기에도 리렌더된다"는 주석이 있는데, 정작 셀렉터 안에 O(N)을 넣어 같은 비용을 다른 형태로 내고 있다.

**왜 나쁜가.** 상세 패널은 한 개뿐이라 `TaskItem`처럼 M배가 붙지는 않지만, AI 스트리밍(초당 30–80회 쓰기) 중에는 그만큼 반복된다. `.filter().length`는 `.reduce`와 달리 배열까지 새로 만든다.

**고치는 법.** `TaskItem`과 같은 파생 맵을 공유하거나, 최소한 할당 없는 카운트로 바꾼다.

### [medium] electron.vite.config.ts:29 / src/renderer/src/App.tsx:6 — 즉시 청크 642.67 kB에 안 쓰는 것이 섞여 있다

**측정** (`npx electron-vite build`):

| 산출물 | raw | gzip |
|---|---|---|
| `index-*.js` (즉시) | **642,668 B** | 195,144 B |
| `TaskDetail-*.js` (lazy) | **618,937 B** | 208,007 B |
| `index-*.css` | 50,381 B | 9,270 B |
| `TaskDetail-*.css` | 14,652 B | 3,366 B |

esbuild metafile로 패키지별 귀속(minify 기준):

```
219,023 (16.7%) 앱 코드      181,010 (13.8%) react-dom
171,841 (13.1%) @codemirror/view    77,943 @lezer/javascript
 46,823 @codemirror/state   43,348 locales   43,287 i18next
 43,160 @atomic-editor/editor  36,924 date-fns  35,793 @lezer/markdown
 27,686 tailwind-merge   20,262 lucide-react   20,001 react-i18next
```

CodeMirror/lezer 계열은 Vite가 `TaskDetail` 청크로 잘 떼어냈다(즉시 청크에 `cubic-bezier` 등 에디터 마커 없음 — 확인함). 남은 문제는 둘이다.

1. **로케일 두 벌이 다 즉시 청크에 들어 있다.** `i18n/index.ts:3-4`가 `ko.json`(20.0 kB)과 `en.json`(17.5 kB)을 정적 import한다. 즉시 청크에서 두 파일의 문자열 표본 200개가 각각 200/200 검출됐다. 세션당 한 벌만 쓴다.
2. **App.tsx가 모든 뷰를 정적 import한다**(`:6-17`). Calendar 3종·Pomodoro·Habits·Kanban·Timeline·Eisenhower·Stats·AiChatPanel·Settings — `TaskDetail` 하나만 `lazy`다. `MainContent`는 한 번에 하나만 그린다.

**왜 나쁜가.** `file://` 로드라 gzip이 안 걸린다 — 최초 실행에서 파싱·평가되는 것은 **raw 642 kB**다. 그리고 `TaskDetail` 청크 618.94 kB는 사용자가 **할일을 처음 클릭하는 순간** 동기적으로 파싱된다(프리페치 없음). 첫 클릭이 눈에 띄게 느린 원인이다.

**고치는 법.** (a) 로케일을 `import()`로 지연 로드하고 감지된 언어만 받는다. (b) `MainContent`의 뷰들을 `lazy`로 돌린다 — 이미 `Suspense` 배선이 있다. (c) `TaskDetail` 청크를 앱 유휴 시점에 `requestIdleCallback`으로 프리페치한다(`import('./components/tasks/TaskDetail')`을 그냥 호출만 해 두면 된다).

---

## low

### [low] src/main/licensing/service.ts:166 — 라이선스 있는 설치는 부팅 때 17.3 ms짜리 동기 서브프로세스를 낸다

`execFileSync('/usr/sbin/ioreg', …)` = **17.3 ms** (n=10). `index.ts:139-144`의 주석이 밝히는 대로 `initLicensing()`은 `createWindow()` **뒤**로 밀려 있고, `deps.device`가 값이 아니라 함수라(`licenseManager.ts:46`) 토큰이 없으면 아예 안 불린다 — `verifyCurrent()`가 `if (!record.token) return null`로 먼저 빠진다(`licenseManager.ts:236`). `cachedDeviceId`(`service.ts:150`)로 프로세스당 1회다. **설계가 이미 맞다.**

남은 사실만 적는다: 토큰이 있는 설치에서는 `createWindow()` 직후 같은 매크로태스크에서 17.3 ms가 메인을 세운다. 렌더러 부팅이 수백 ms라 대개 흡수되지만, 그 구간의 IPC 응답이 그만큼 밀린다. 정말 신경 쓰인다면 `initLicensing()`을 `setImmediate`나 `ready-to-show` 뒤로 한 틱 더 미루면 된다. 현재 `IS_ENFORCED = false`에서는 이 경로 자체가 안 돈다.

### [low] src/main/licensing/licenseStore.ts:91 — fsync 정책은 측정과 일치한다. 다만 enforcement를 켜면 하루 4회 4 ms가 생긴다

주석(`:72-86`)의 수치를 직접 재확인했다: fsync **4.04 ms**, fsync 없는 쓰기 **0.168 ms**(24배 차 — 주석의 "22배"와 오차 내), `{flush:true}`는 **0.168 ms**로 배리어가 안 걸린다. 전부 맞다.

`persist()`가 `carriesCredentials`로 배리어 여부를 고르는 것도(`licenseManager.ts:211-214`) 옳다. 결과적으로 라이선스가 있는 설치는 6시간 폴마다 `runRevalidation()`의 `if (touchClock()) persist()`(`:553`)에서 **durable 쓰기 = 4 ms fsync**를 낸다 — `touchClock()`은 시각이 전진했으면 참이라 사실상 매번이다. **하루 4회 × 4 ms.** 노이즈 이하지만, "래칫 하나 올리자고 배리어를 친다"는 상황이 트라이얼 설치가 아니라 유료 설치에서 그대로 남아 있다는 점은 기록해 둔다. 현재(`IS_ENFORCED=false`) 라이선스 모듈은 디스크에 **아무것도 쓰지 않는다** — `evaluateTrial()`이 `!deps.enforced`에서 즉시 반환하고(`licenseManager.ts:304`) `runRevalidation()`도 키/토큰이 없어 조기 반환한다(`:544`).

### [low] src/main/database.ts:81 — 같은 파일에 `writeFile` 두 개가 겹칠 수 있다

`save()`는 `saveTimer`가 있으면 조기 반환하지만, 타이머가 발화해 `saveTimer = null`이 된 **직후** `writeFile`이 아직 비행 중일 때 새 `save()`가 들어오면 300 ms 뒤 두 번째 `writeFile`이 같은 경로로 시작된다. 원자적 교체(temp + rename)가 아닌 제자리 쓰기라 두 쓰기가 인터리브될 수 있다. `license.json`은 temp+rename을 쓰는데(`licenseStore.ts:108-110`) 훨씬 큰 `ticktick-data.json`은 안 쓴다 — 비대칭이다.

10 MB 쓰기가 300 ms를 넘길 수 있는 느린 디스크에서만 나는 종류의 사고다. `[high] database.ts:71`을 고칠 때 같이 정리할 것: 비행 중 플래그를 두고 완료 후에 다음 쓰기를 걸거나, 여기도 temp+rename으로 간다.

### [low] src/main/index.ts:124 — `initDatabase()`가 `createWindow()` 앞에서 동기로 돈다

부팅 순서: `initDatabase`(124) → `applyAppMenu`(133) → `setupIpcHandlers`(134) → `setupAppIpc`(136) → **`createWindow`(137)** → `initLicensing`(144).

측정한 `initDatabase` 블록 시간(읽기+파싱+마이그레이션 루프):

| 규모 | read+parse | 마이그레이션 루프 | 합 |
|---|---|---|---|
| 1k | 1.53 ms | 0.92 ms | 2.5 ms |
| 5k | 5.85 ms | 3.12 ms | 9.0 ms |
| 20k | 22.87 ms | 10.49 ms | **33.4 ms** |

일반적인 규모(1k)에서는 노이즈 이하다. 20k에서 33 ms는 `electron-updater`의 36 ms와 같은 급이고, 둘 다 창 만들기 앞에 있다. 다만 여기는 **읽기 실패를 창 띄우기 전에 알아야 한다**는 이유가 코드(`:123-131`)에 적혀 있어서, 옮기려면 그 계약을 먼저 다뤄야 한다. `[medium] database.ts:242`(무조건 save)를 먼저 고치는 편이 값싸다.

### [low] src/main/ipc-handlers.ts:88 — 부팅 시 `get-tasks`가 통째로 IPC를 건넌다

`loadData()`(`useStore.ts:411-421`)가 8개 채널을 병렬로 부르고, 그중 `get-tasks`가 가장 크다. `v8.serialize` 기준:

| 규모 | 메인 직렬화 | 렌더러 역직렬화 | 페이로드 |
|---|---|---|---|
| 1k | 0.7 ms | 0.9 ms | 0.4 MB |
| 5k | 3.1 ms | 3.9 ms | 2.2 MB |
| 20k | 12.1 ms | 11.6 ms | **9.0 MB** |

실행당 1회라 스타트업 예산 안에서만 문제가 된다. 다만 이 시점에 같은 데이터가 **메인 5.2 MB + 렌더러 5.2 MB(20k 기준 순수 객체 힙)**로 두 벌 상주하게 된다. 페이지네이션이나 지연 로딩을 넣기 전에는 어쩔 수 없는 구조다.

### [low] src/renderer/src/utils/search.ts:8 — 검색 판별식이 할일마다 질의를 다시 정규화한다

`matchesSearch`가 태스크마다 `query.trim().toLowerCase()`를 다시 만들고, `title`/`description`도 매번 `toLowerCase()`로 새 문자열을 만든다. **측정 결과 병목은 아니다** — 키 입력 1타당 전체 필터+검색+정렬 파이프라인이 0.18 ms(1k) / 0.49 ms(5k) / **1.83 ms**(20k)다. 같은 키 입력의 셀렉터 churn(위 critical, 1k에서 4.4 ms)에 묻힌다. 고칠 값어치가 생기는 것은 두 critical을 먼저 처리한 뒤다. 그때는 `q`를 `useMemo`로 한 번만 만들고 정규화된 검색 필드를 캐시하면 된다.

---

## 확인했고 문제 없는 것 (역행 방지용 기록)

- **유료 IPC 핫패스에 ed25519 재검증은 남아 있지 않다.** `ipc-gate.ts:76-81`의 `paid` 래퍼는 `licensing()?.allowsPaidFeatures()` 하나만 부른다. `allowsPaidFeatures`(`licenseManager.ts:677-701`)는 `!deps.enforced`면 즉시 true, 아니면 `clockSafeNow()`(= `Math.max`)와 상태의 마감을 비교할 뿐이다. `verifyToken` 호출처를 전부 추적했다 — `verifyCurrent()`(=`settle()` 경로), `activate()`, `refresh()` 셋뿐이고 어느 것도 IPC마다 돌지 않는다. `licenseManager.ts:686-691`의 "여기서 다시 검증하면 모든 유료 IPC 앞에 ed25519 한 번(33µs)이 붙는다"는 주석은 정확하다 — 실측 **34 µs**.
- **`free` 채널은 등록 시점에 갈라져 맨 핸들러가 걸린다**(`ipc-gate.ts:72-75`). 읽기 경로에 게이트 비용이 0이다.
- **기기 id는 지연 + 프로세스당 1회 캐시**다(`service.ts:150-158`, `licenseManager.ts:39-46`). 트라이얼/미인증 설치는 `ioreg`를 한 번도 안 돌린다.
- **캘린더 블록 리사이즈는 mousemove마다 스토어를 쓰지 않는다.** `TimeBlock.tsx:72-83`이 DOM 높이만 직접 만지고 `mouseup`에서 한 번 커밋한다(`:84-106`).
- **셀렉터 없는 `useStore()` 구독이 하나도 없다.** 렌더러 전체 202개 `useStore(` 호출 전부 셀렉터가 있고, 객체/배열 리터럴을 새로 만들어 돌려주는 셀렉터도 없다(Zustand v5에서 무한 리렌더를 부르는 패턴). `TaskItem`/`TaskDetail`의 O(N) 셀렉터 두 곳만 문제다.
- **AI IPC는 할일 전체를 보내지 않는다.** 세 경로(`useStore.ts:1130`, `:1203`, `:1276`) 모두 `buildAiTaskContext`(최대 48건)를 통과시킨다. 렌더러 미리보기(`AiChatPanel.tsx:60`)도 패널이 닫혀 있으면 계산하지 않는다.
- **포모도로는 별도 스토어이고 인터벌은 실행 중에만 건다**(`usePomodoroStore.ts:58-64`, `usePomodoroTicker.ts:12-15`). 매초 틱이 메인 스토어를 흔들지 않는다.
- **되돌리기 스택은 20건으로 캡**(`useStore.ts:895`), **채팅 히스토리도 캡**(`trim.ts`). 클로저가 무한히 잡아 두는 것은 없다.
- **`Settings`/`AiChatPanel`은 항상 마운트되지만 닫혀 있으면 내용 트리를 만들지 않는다** — Radix `Portal` + `Presence` 뒤라 `DialogContent`(`Settings.tsx:325`) 안의 `LicenseSection`·`CalendarSyncSection`·`GoogleSyncSection`은 열릴 때만 마운트된다. 셀렉터 19개는 전부 단순 속성 읽기다.
- **`TaskActionItems`의 셀렉터 4개는 행마다 실행되지 않는다.** `TaskContextMenu.tsx:50`에서 엘리먼트로만 만들어지고 Radix가 열릴 때만 렌더한다.
- **리마인더 폴러는 노이즈 이하다.** 60초마다 `getTasks()` = 20k에서 **0.56 ms**(1k에서 0.08 ms). `dueReminders`도 단일 패스다.
- **메인 프로세스의 동기 fs/서브프로세스를 전수 조사했다.** `fsyncSync` 1곳(licenseStore, durable 쓰기 한정), `execFileSync` 1곳(ioreg, 지연·캐시), 나머지는 설정 파일 읽기/쓰기(ai-config·calendar-config·google-config)로 전부 사용자 조작 시점에만 돈다. 핫패스에 걸린 동기 I/O는 없다.

---

## 권장 처리 순서

두 critical은 **서로를 증폭한다.** 하나씩 재보지 말고 둘 다 고친 뒤 다시 재는 편이 낫다.

1. `TaskList.tsx:112`의 `handleDrop` 참조 고정 — 한 줄 수준이고 M=1000에서 **73 ms → 0.2 ms**다. 가장 싼 큰 이득.
2. `TaskItem.tsx:26`의 하위작업 카운트를 부모의 파생 맵으로 — 스토어 쓰기당 O(N×M)을 O(1)로.
3. 위 둘 뒤에 AI 스트리밍(`useStore.ts:1140`)을 rAF 배칭으로. 1·2를 먼저 하면 3의 체감이 크게 줄어 우선순위가 내려갈 수도 있다.
4. `electron-updater` 동적 import + `initDatabase`의 무조건 `save()` 제거 — 둘 다 국소적이고 스타트업에서 각각 36 ms / 10 ms를 돌려받는다.
5. 목록 가상화. 가장 크지만 1·2를 하고 나면 급하지 않을 수 있다 — 그때 다시 재고 결정할 것.
