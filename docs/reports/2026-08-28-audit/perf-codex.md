# haru/Greenday 성능 감사 — Codex

- 감사일: 2026-08-28
- 범위: Electron 메인 프로세스 시작·IPC·디스크 I/O, 라이선스 핫패스, React/Zustand 렌더링, 번들 및 장수명 메모리
- 전제: `src/main/licensing/service.ts`의 `IS_ENFORCED = false` 상태를 기준으로 확인했다. 다만 키/토큰이 이미 저장된 설치의 라이선스 초기화 비용은 enforcement와 무관하게 발생한다.

## 측정 메모

- 현재 macOS 호스트의 warm-cache 측정이다. 실제 패키지·사용자 디스크·데이터 분포에 따라 달라지므로 Node `require` 측정은 Electron 시작 시간의 프록시, 생성 데이터 측정은 합성 벤치로만 해석했다.
- `/usr/sbin/ioreg -rd1 -c IOPlatformExpertDevice` 20회는 중앙값 17.73ms, p95 19.42ms, 최대 19.61ms였다. 임시 파일의 일반 쓰기는 중앙값 0.084ms/p95 0.192ms, 쓰기+`fsync`는 중앙값 3.01ms/p95 4.97ms였다.
- 합성 태스크 JSON은 1천 건 0.689MB에서 stringify 중앙값 0.623ms·parse 0.666ms로 노이즈 이하였다. 1만 건 6.92MB에서는 5.99ms·6.63ms, 5만 건 34.72MB에서는 30.39ms(p95 45.89ms)·33.45ms(p95 37.29ms)였다.
- `TaskItem`의 현재 두 서브태스크 셀렉터만 그대로 모사한 합성 루프는 100행/100태스크(2만 비교) 중앙값 0.286ms, 1천/1천(200만 비교) 5.25ms·p95 13.31ms, 5천/5천(5천만 비교) 121.0ms·p95 123.95ms였다. React/DOM 비용은 포함하지 않았다.
- 현재 `reorderTasks`의 `orderedIds.map(id => tasks.find(...))`를 모사한 합성 벤치는 1천 태스크 중앙값 2.85ms·p95 3.38ms, 5천 21.17ms·p95 21.89ms, 1만 92.16ms·p95 93.76ms였다.
- `npm run build` 결과 메인 132.53kB, preload 9.35kB, 렌더러 초기 JS 642,668B(gzip 195,144B), lazy `TaskDetail` JS 618,937B(gzip 208,007B)였다. Node VM 파싱 프록시는 초기 청크 중앙값 6.72ms·p95 10.92ms로 이 호스트에서는 16.7ms 한 프레임보다 작았다.
- 20개의 새 Node 프로세스에서 `electron-updater`와 `uuid`를 require한 warm-cache 프록시는 합계 중앙값 37.29ms·p95 39.27ms였다(`electron-updater` 약 34.84ms, 뒤이은 `uuid` 약 2.45ms). 패키지 Electron에서의 실측은 아니므로 아래 시작 비용의 절대값은 추정이다.

## Critical

발견 없음.

## High

- [high] src/main/database.ts:568 — 메인 프로세스가 사용자가 고른 첨부파일을 `copyFileSync`로 한 개씩 복사한다 / `src/main/ipc-handlers.ts:120-136`은 크기 제한 없는 복수 선택을 허용하므로 대용량 파일이나 느린 볼륨에서는 복사 전체 시간 동안 창 이벤트와 모든 IPC가 정지하며 지연 상한도 없다 / `fs.promises.copyFile`을 제한된 동시성으로 await하고 진행률·취소를 제공하거나 복사 작업을 worker로 옮긴다.
- [high] src/renderer/src/components/tasks/TaskItem.tsx:25 — 마운트된 각 행의 두 Zustand 셀렉터가 모든 스토어 변경마다 전체 `tasks`를 다시 훑어 목록 비용이 `2 × 표시 행 M × 전체 태스크 N`이 된다 / `src/renderer/src/components/tasks/TaskList.tsx:229`는 가상화 없이 모든 필터 결과를 마운트하며 합성 벤치에서 1천 행/1천 태스크만으로 중앙값 5.25ms, 5천 행/5천 태스크는 121.0ms였고 AI 토큰처럼 태스크와 무관한 `set`도 셀렉터 평가를 촉발한다 / `tasks` 변경 때 한 번 `parentId -> {total, completed}` Map을 만들고 행은 O(1) 조회하게 하며 긴 목록은 windowing한다.

## Medium

- [medium] src/main/index.ts:4 — 창 생성 전에 `electron-updater`와 메인 IPC의 `uuid` 의존성을 무조건 로드한다 / `src/main/ipc-handlers.ts:4`도 `uuid`를 top-level import하고 번들된 메인은 두 패키지를 즉시 `require`하며 `createWindow()`는 `src/main/index.ts:137`에 있어, 새 프로세스 프록시 중앙값 37.29ms가 업데이트를 지원하지 않는 빌드와 첨부 기능을 쓰지 않는 시작에도 붙는다(실제 Electron 절대값은 추정) / updater는 `canSelfUpdate` 분기 뒤·창 표시 뒤 동적 import하고 메인의 UUID 생성은 `node:crypto.randomUUID`로 바꾼다.
- [medium] src/main/index.ts:124 — 첫 `BrowserWindow` 전에 전체 JSON DB를 동기 읽기·parse하고 매번 모든 태스크/세션을 마이그레이션한다 / `src/main/database.ts:106`의 `readFileSync + JSON.parse`와 `src/main/database.ts:159-224`의 O(N) 순회가 시작 임계경로이며 합성 5만 태스크는 parse만 중앙값 33.45ms였지만 1천 건은 0.666ms라 보통 데이터에서는 노이즈 이하다; parse 실패 시에는 `src/main/database.ts:178`이 크기 제한 없이 원본까지 동기 복사하는 드문 추가 지연이 있다 / 먼저 스켈레톤 창을 표시한 뒤 worker/비동기 경로에서 읽고, 오류 백업도 비동기로 수행하며 명시적 스키마 버전으로 필요한 마이그레이션만 수행한다.
- [medium] src/main/database.ts:83 — 모든 앱 데이터를 매 변경 버스트마다 메인에서 통째로 stringify한 뒤 파일 전체로 다시 쓴다 / 20개 mutation 경로와 시작 시 `src/main/database.ts:242`가 `save()`를 호출하고 300ms 윈도우라 지속 변경 시 약 3.3회/초 직렬화·전체 쓰기가 가능하며, 종료 중 보류분은 `src/main/database.ts:100`에서 동기 쓰기한다; 합성 5만 태스크 stringify는 중앙값 30.39ms·p95 45.89ms지만 1천 건은 0.623ms로 노이즈 이하다 / 시작 시 dirty가 없으면 저장하지 말고, 직렬화를 worker로 옮기거나 SQLite/증분 journal로 변경분만 쓰며 진행 중 저장을 단일 큐로 합친다.
- [medium] src/main/index.ts:144 — `createWindow()` 직후 같은 메인 이벤트 루프 턴에서 라이선스를 초기화해 토큰 보유 설치의 `ready-to-show`를 여전히 막는다 / 창은 `show:false`이고 `ready-to-show`에서만 보이는데(`src/main/index.ts:42-55`), 초기 settle이 `src/main/licensing/service.ts:166`의 최대 5초 `execFileSync(ioreg)`를 실행하고 즉시 revalidation은 `src/main/licensing/licenseManager.ts:553`에서 시계 래칫을 저장한다; 현재 호스트의 정상 경로는 ioreg 중앙값 17.73ms + durable fsync 중앙값 3.01ms였고 이 비용은 토큰이 없는 설치에는 없다 / 기기 조회를 비동기 child process 또는 worker로 옮기고 첫 표시/idle 뒤 초기화하며, 생성자 settle과 첫 revalidation을 합치고 자주 바뀌는 래칫을 자격증명과 분리해 자격증명 내구성은 유지하되 6시간마다(하루 4회) fsync하지 않게 한다.
- [medium] src/main/database.ts:417 — 실제 유료 `reorder-tasks`와 `batch-update-tasks`가 ID마다 전체 `data.tasks.find`를 반복해 O(K×N)으로 동작한다 / 채널은 `src/main/ipc-handlers.ts:96-97`이고 라이선스 게이트보다 뒤의 mutation 자체가 병목이며, reorder 합성 벤치는 1천 태스크 2.85ms로 노이즈에 가깝지만 5천 21.17ms, 1만 92.16ms로 메인 이벤트 루프를 막았다 / 로드 시 `id -> task` Map 인덱스를 유지하거나 호출마다 한 번 만들고 reorder·batch 모두 O(N+K)로 처리한다.
- [medium] src/renderer/src/components/tasks/TaskItem.tsx:48 — 각 행이 `selectedTaskId`, 전체 `batchSelectedIds`, `dragTaskId`를 구독하고 변경 시 거의 모든 행이 리렌더된다 / 선택 한 건도 모든 행에 다른 전역 값을 전달하고 `batchSelectedIds.includes`는 행마다 선형 탐색하며, `src/renderer/src/components/tasks/TaskList.tsx:112-121`의 `onDrop`도 `dragTaskId`와 `filteredTasks`가 바뀔 때마다 새 함수가 되어 `memo(TaskItem)`을 무력화한다 / 행별 boolean 셀렉터와 Set 기반 배치 선택을 쓰고 드롭 핸들러는 `getState()`로 최신 값을 읽는 안정된 콜백으로 만든 뒤 목록을 가상화한다.
- [medium] src/renderer/src/store/useStore.ts:1140 — AI 스트림 토큰 하나마다 전체 메시지 배열을 map하고 증가하는 문자열을 이어 붙이는 Zustand `set`을 발행한다 / 메인은 `src/main/ai-service.ts:551`에서 SSE 조각마다 JSON parse한 뒤 `src/main/ipc-handlers.ts:237`에서 토큰별 IPC를 보내고, 각 `set`은 위 TaskItem 셀렉터까지 모두 재평가하며 `src/renderer/src/components/ai/AiChatPanel.tsx:91-95,259-309`는 최대 200개 메시지를 다시 렌더하고 토큰마다 `scrollIntoView`한다; 실제 빈도는 provider 의존이며 live-model 측정은 하지 않아 체감 크기는 추정이다 / 델타를 `requestAnimationFrame` 또는 30~50ms 단위로 합쳐 현재 draft만 갱신하고, 기존 메시지 행을 memoize하며 자동 스크롤도 같은 주기로 제한한다.
- [medium] src/main/ipc-handlers.ts:166 — 내보내기가 메인에서 전체 DB 복사본을 만들고 CSV는 그 문자열을 다시 parse·map·join한 뒤 `writeFileSync`한다 / JSON도 이벤트 루프를 동기 쓰기 동안 막고 CSV는 원본 객체·JSON 문자열·parsed 객체·행 문자열을 동시에 보유한다; 합성 5만 태스크는 stringify+parse만 약 64ms 중앙값이고 실제 디스크/CSV 생성은 별도지만 1천 건 CPU는 약 1.3ms로 노이즈 이하다 / DB 스냅샷을 worker로 넘겨 JSON/CSV를 스트리밍하고 `fs.promises`로 쓰며 CSV는 JSON 왕복 없이 원본 레코드에서 직접 생성한다.

## Low

- [low] src/renderer/src/components/sidebar/Sidebar.tsx:101 — 태스크 변경마다 smart count용 전체 스캔을 여러 번 하고 각 사용자 리스트마다 다시 `incomplete.filter`한다 / 비용은 O(N×L)이고 렌더 중 폴더마다 `lists.filter`하는 `src/renderer/src/components/sidebar/Sidebar.tsx:176,399`도 O(L×F)지만 일반적인 태스크·리스트 수에서는 노이즈 수준으로 예상되며 이 경로만의 UI 실측은 하지 않았다 / 태스크를 한 번 순회해 smart/list/tag count Map을 만들고 리스트도 `folderId`별로 한 번 그룹화한다.
- [low] src/renderer/src/App.tsx:3 — 현재 뷰와 무관한 캘린더·습관·칸반·타임라인·통계·설정·AI 모듈을 모두 초기 청크에 eager import한다 / 초기 JS가 minified 642.7kB(gzip 195.1kB)로 Vite 500kB 경고를 넘지만 로컬 파일이고 현재 호스트 파싱 프록시는 중앙값 6.72ms라 한 프레임보다 작아 시작 지연은 노이즈에 가깝다 / `TaskDetail`처럼 비초기 뷰·설정·AI 패널을 route 단위 lazy chunk로 나누고 실제 Electron의 renderer parse/compile을 trace한다.
- [low] src/renderer/src/components/ai/AiChatPanel.tsx:28 — 메시지별 `taskAdds` 로컬 Map이 채팅 trim/clear와 함께 제거되지 않고 앱 수명 동안 유지된다 / 패널은 `src/renderer/src/App.tsx:120`에서 항상 마운트되므로 삭제된 메시지 ID도 세션 끝까지 클로저 상태에 남고 새 항목마다 Map 전체를 복사하지만, 사용자가 “할일로 추가”를 누른 횟수에만 비례해 정상 사용에서는 노이즈 수준이다 / 메시지가 제거될 때 살아 있는 ID로 Map을 prune하거나 clear 동작에서 함께 초기화한다.
- [low] src/renderer/src/store/useStore.ts:411 — 첫 렌더 직후 활성/휴지통 태스크와 모든 습관 로그·포모도로 세션 등 여덟 데이터셋을 한꺼번에 IPC로 복제하고 다시 새 렌더러 객체로 map한다 / `src/main/database.ts:306-312,466-478`의 메인 상주 데이터가 렌더러에도 중복 상주하고 원시 IPC 배열과 mapped 배열이 일시 중첩되며, 로그·세션은 페이지네이션이 없어 장기 사용 시 메모리와 structured-clone 시간이 데이터에 비례한다; Electron clone 실측은 하지 않아 심각도는 추정이다 / 현재 뷰에 필요한 데이터만 lazy/paginated 조회하고 오래된 로그·세션은 집계하며 초기 hydration은 한 번의 versioned snapshot으로 일관되게 전달한다.
- [low] src/main/database.ts:25 — AI 응답 완료·오류·clear마다 채팅 전체를 메인에서 pretty JSON으로 stringify해 `writeFileSync`하고 다음 실행에는 `readFileSync + JSON.parse`한다 / 호출은 `src/renderer/src/store/useStore.ts:1145-1160,1180`에 있어 토큰별은 아니지만 기본 200개(설정 UI 최대 10,000개) 메시지의 길이에는 바이트 상한이 없으므로 큰 기록은 응답 완료 순간 메인 IPC를 멈출 수 있으며 보통 크기는 측정하지 못해 추정이다 / 메시지 수와 총 바이트를 함께 제한하고 atomic async write를 단일 큐로 직렬화하며 읽기도 비동기로 수행한다.

## 확인했으나 성능 발견으로 분류하지 않은 항목

- 유료 IPC 게이트는 ed25519를 재검증하지 않는다. `src/main/ipc-gate.ts:76-80`은 `allowsPaidFeatures()`만 호출하고, `src/main/licensing/licenseManager.ts:677-700`은 enforcement가 꺼지면 즉시 `true`, 켜져도 시계·deadline 비교만 한다. 1천만 회 합성 호출은 0.026µs/회였고 별도 native ed25519 verify는 35.38µs/회였으며, `src/main/licensing/licenseManager.test.ts:491-511`도 20회 핫 호출에서 검증의 대리 지표인 device read가 0임을 확인한다. 토큰 보유 시작은 생성자 `settle()`(`src/main/licensing/licenseManager.ts:703`) 뒤 즉시 revalidation의 `settle()`(`src/main/licensing/licenseManager.ts:554`)을 해 서명 검증이 두 번이지만 합계 약 0.071ms로 ioreg 대비 노이즈다. 대상 테스트 91개도 통과했다.
- 코드 전체 정적 검색에서 셀렉터 없는 `useStore()` 구독은 0건이었다. 문제는 전체 상태 구독이 아니라 위에 적은 “셀렉터 내부 O(N) 계산”과 모든 행이 같은 전역 필드를 구독하는 방식이다.
- 라이선스 매니저의 장수명 클로저는 작은 레코드와 최대 두 타이머만 잡고 `src/main/licensing/licenseManager.ts:712-716`에서 둘 다 취소한다. AI 전송 컨텍스트도 `src/renderer/src/utils/aiContext.ts:31-51`에서 태스크 48개, 대화 히스토리는 `src/shared/ai-history.ts:7-23`에서 10개로 제한되어 큰 요청 객체를 장기 보유하는 경로는 확인하지 못했다.
- `TaskDetail`의 618.9kB 청크는 `src/renderer/src/App.tsx:23`에서 이미 lazy라 초기 번들 비용이 아니다. 첫 상세 열기 때만 로드되므로 별도 시작 결함으로 세지 않았다.
- 60초 리마인더 폴은 `src/main/index.ts:152-158`에서 전체 태스크 filter/sort를 하지만 합성 정렬은 1천 0.023ms, 1만 0.185ms, 5만 1.02ms 중앙값으로 현재 측정에서는 노이즈 이하였다.
- AI/캘린더/Google 설정 파일의 동기 JSON 쓰기는 작은 설정 객체이며 명시적 저장 같은 사용자 동작 때만 발생한다. 현 구조에서 반복 핫패스나 의미 있는 fsync 비용은 확인하지 못했다.
