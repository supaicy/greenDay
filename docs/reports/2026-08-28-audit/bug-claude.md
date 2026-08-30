# 버그(정확성) 감사 — bug-claude

대상: `supaicy/coordinate` 워크트리 (Electron + React + TS).
기준 상태: `npx tsc --build` 통과, `npx biome lint src electron.vite.config.ts` 통과,
`npx vitest run` 59 파일 / 915 테스트 통과 — 아래 결함은 전부 그 초록불 아래에 있다.

각 항목은 코드를 읽어 확인했고, 추측이 섞인 것은 그 자리에 **[추측]**으로 표시했다.
"설정 폴더를 지우면 트라이얼이 리셋된다"는 의도된 트레이드오프라 제외했다.

---

## HIGH

### [high] src/renderer/src/utils/date.ts:29,48,54,59,64,79 — 날짜 문자열을 UTC로 파싱해, UTC 음수 오프셋 지역에서 모든 마감일 판정이 하루씩 앞당겨진다

**문제.** `formatDueDate`·`isOverdue`·`isDueToday`·`isDueTomorrow`·`isDueInNext7Days`가
전부 `new Date('YYYY-MM-DD')`를 쓴다. ES 명세상 날짜만 있는 형식은 **UTC 자정**으로
파싱된다. KST(+9)에서는 같은 날 09:00이 되어 우연히 맞지만, 음수 오프셋에서는 전날이 된다.

실측(`TZ=America/New_York node -e "new Date('2026-08-28')"`):
`Thu Aug 27 2026 20:00:00 GMT-0400` — 로컬 날짜가 **27일**이다.

**왜.** 저장하는 쪽은 이미 로컬로 고쳐져 있다 — `shared/date.ts:9`의 `toLocalDateString`이
그 목적이고, `addTasks`(useStore.ts:518)와 `Cmd+D`(useKeyboardShortcuts.ts:114)가 그걸 쓴다.
`recurrence.ts:10`은 아예 "`Date(y, m, d)` 로컬 생성, 인수 없는 `new Date()` 금지"를 못 박고
`daysBetween`(recurrence.ts:179-185)은 그 규약을 지킨다. **읽는 쪽인 `date.ts`만 규약 밖이다.**
개발자 시간대가 KST라 테스트에서도 보이지 않는다.

뉴욕에서 오늘(2026-08-28) 마감인 할일 하나가 동시에 이렇게 된다:
- `isDueToday` false, `isOverdue` **true** → TaskItem.tsx:56이 오늘 만든 할일을 빨간 '지연'으로 칠한다
- `formatDueDate`가 `isYesterday`로 떨어져 **"어제"**라고 쓴다
- `isDueInNext7Days`의 `date >= today`가 거짓이라 `next7days`·`summary` 스마트 리스트에서 **사라진다**
  (smartLists.ts:67-68)
- `isDueTomorrow`가 한 칸 밀려 '내일' 뷰에 **모레** 할일이 뜬다 (smartLists.ts:66)

`today` 뷰만 `isDueToday || isOverdue`(smartLists.ts:65)의 우연으로 살아남는다.

**고치는 법.** `date.ts`에 로컬 파서를 하나 두고(`const [y,m,d]=s.split('-').map(Number);
new Date(y, m-1, d)`) 위 여섯 자리가 전부 그것을 거치게 한다. `recurrence.ts`의 `parseDate`가
이미 같은 일을 하므로 그쪽을 공유해도 된다. 날짜 대 날짜 비교(`isOverdue`,
`isDueInNext7Days`)는 `todayString()`과의 **문자열 비교**로 바꾸는 편이 더 안전하다 —
`smartLists.ts:55-59`의 `isRangeInProgress`가 이미 그 방식이다.
테스트는 `TZ=America/New_York`을 걸고 돌려야 재현된다.

---

### [high] src/renderer/src/store/useStore.ts:687-693, 901-907 + src/main/database.ts:402-408 — 하위작업이 있는 할일을 삭제하고 되돌리면 하위작업이 영영 휴지통에 남는다

**문제.** 삭제는 하위작업까지 함께 하는데, 되돌리기는 부모 하나만 되살린다.

- `removeTask`는 `pushUndo`에 **부모 태스크 하나만** 싣는다 (useStore.ts:687-693).
  바로 아래 `set`은 `t.parentId === id`인 하위작업까지 `trashTasks`로 옮긴다 (696-703).
- main의 `deleteTask`도 `t.id === id || t.parent_id === id`를 함께 소프트 삭제한다
  (database.ts:397-399).
- `popUndo`의 `deleteTask` 갈래는 `action.data`의 부모 하나만 `tasks`로 되돌리고
  `window.api.restoreTask(task.id)`만 부른다 (useStore.ts:901-907).
- main의 `restoreTask`는 **그 한 행만** 찾아 `deleted_at = null`을 놓는다
  (database.ts:402-408) — `deleteTask`와 대칭이 아니다.

**왜.** 결과적으로 Cmd+Z 한 번이 "부모는 살아났는데 하위작업 셋은 휴지통에 남은" 상태를
만든다. 화면에서는 하위작업이 통째로 사라진 것으로 보이고, 사용자가 휴지통에서 하나씩
개별 복원하는 것 말고는 되돌릴 방법이 없다. 같은 파일의 `batchDelete`는 이 함정을
이미 피해 간다 — `allDeletedIds`(하위작업 포함)를 undo 데이터로 싣고
(useStore.ts:834-843) `deleteTasks` 갈래가 전부 복원한다(908-918). 단건 경로만 빠졌다.
휴지통 화면의 개별 '복원'(useStore.ts:758-768)도 같은 비대칭을 갖는다.

**고치는 법.** `removeTask`의 undo 데이터를 `deleteTasks`처럼 id 배열(부모+하위작업)로
바꾸거나, main의 `restoreTask`가 `deleteTask`를 거울처럼 따라 `t.parent_id === id`도
되살리게 한다. 후자가 휴지통 화면의 복원까지 같이 고친다.

---

### [high] src/renderer/src/store/useStore.ts:333-365 — 거절된 낙관적 편집이 되돌려지지 않는다 (enforcement를 켜는 날 첫 유료 IPC부터)

**문제.** 모든 변경 액션이 `set(...)`으로 화면을 먼저 바꾸고 `persist(...)`로 IPC를 쏜다.
`persist`는 거절을 잡아 `report`로 넘기고(336), `report`는 **로그 + `refreshLicense()`가
전부다**(360-364). 낙관적 변경은 그대로 남는다.

**왜.** `IS_ENFORCED`를 켜는 날, 트라이얼이 닫힌 사용자의 첫 편집은
`ipc-gate.ts:79`가 `license_required`로 거절한다. 그 순간 사용자가 보는 것은
"할일이 만들어졌다 / 완료됐다 / 삭제됐다"이고, 재시작하면 전부 없다. 주석(342-358)이
이 사실을 인정하며 롤백을 TODO로 미뤄 뒀지만, 켜는 날 **모든 사용자가 반드시 한 번은**
지나는 경로다.

점수는 더 나쁘다 — `addScore`(964-978)는 `score.total`을 렌더러에서 직접 계산해 올리고
`persist`로만 디스크에 반영하므로, 게이트가 거절하면 화면의 총점이 디스크와 **영구히**
갈린다(그 세션 동안 다시 맞춰지지 않는다). `removeTask`는 화면상 휴지통으로 옮겨진
할일을 남기고, 디스크에는 살아 있다.

**고치는 법.** 두 층 중 하나. (a) 액션마다 변경 전 슬라이스를 스냅샷으로 잡아 두고
`report`가 `LICENSE_REQUIRED`(또는 임의의 거절)를 보면 되돌린다. (b) 값싼 1차 방어로,
쓰기 액션 진입부에서 `useLicense.getState().allowsPaidFeatures`가 false면 낙관적 `set`
자체를 하지 않고 즉시 게이트를 띄운다. 메인의 게이트는 그대로 두 번째 벽으로 남긴다.

---

### [high] src/main/ai-service.ts:30,94-110,333-342,511-535 — 모듈 `config`가 시작 시 한 번도 하이드레이트되지 않아, 첫 연결 확인이 항상 기본값(ollama/localhost)으로 나간다

**문제.** `let config = { ...DEFAULT_CONFIG }`(30)는 `getAiConfig()`(36) ·
`getAiConfigInternal()`(45) · `setAiConfig()`(72) **안에서만** 교체된다.
`checkConnection`(94-110), `callLlm`(333-342), `streamChat`(511-535), `getChatUrl`(32)은
디스크를 읽지 않고 그 모듈 변수를 그대로 쓴다. `warmupModel`(117)과 `pullModel`(170)만
`getAiConfigInternal()`을 부른다 — 같은 파일 안에서 규약이 갈려 있다.

**왜.** `App.tsx:65`가 마운트 직후 `aiCheckConnection()`을 부른다. 그 시점에 main의
`config`는 `DEFAULT_CONFIG`(ollama, `http://localhost:11434`)라, OpenAI/커스텀으로
설정해 둔 사용자는 **매 실행 첫 확인이 localhost를 두드리고 `connected:false`**를 받는다.
그리고 `AiChatPanel.tsx:70-74`는 `aiConnected === null`일 때만 다시 확인하는데 이미
`false`가 박혀 있어 **AI 패널을 열어도 재확인되지 않는다.** 설정 화면을 열거나
(Settings.tsx:262-268이 `ai:get-config`를 먼저 보낸다) 재시도 버튼을 누르기 전까지
AddTask의 AI 버튼이 사라진 채로 있다. App.tsx:63-64 주석이 "설정을 열어야만 확인돼서
첫 실행에 AI 버튼이 안 보이던 것"을 고치려 넣은 호출인데, 정확히 그 증상이 남아 있다.

같은 이유로 `callLlm`·`streamChat`이 설정 로드 전에 도달하면 잘못된 엔드포인트·모델로
나가고, 335/520의 `config.localOnly` 런타임 방어도 하이드레이트되지 않은 값을 본다.

**고치는 법.** `checkConnection`·`callLlm`·`streamChat`이 각자 첫 줄에서
`const cfg = getAiConfigInternal()`을 잡고 `cfg`만 쓰게 한다(`getChatUrl`도 인자를 받게).
`warmupModel`/`pullModel`과 같은 모양이 된다.

---

## MEDIUM

### [medium] src/renderer/src/store/useStore.ts:996 + src/main/database.ts:496 — 완료 이벤트가 200개 창 밖으로 밀려나면 완료 취소가 점수를 회수하지 못한다

**문제.** `_netScoreFor(taskId)`는 `score.events`를 훑어 그 태스크에 지급된 순합을 낸다.
그런데 이벤트 배열은 양쪽 다 **최근 200개로 잘린다** — 렌더러는 `slice(-200)`(974, 990),
main은 `capEvents(events, 200)`(database.ts:496-498, 508, 518). `total`만 누적된다.

**왜.** 태스크를 완료해 점수를 받고, 그 뒤 200건 이상 점수 이벤트가 쌓이면
그 완료 이벤트가 배열에서 사라진다. 그 상태에서 완료를 취소하면
`toggleTask`(664-667)의 `owed`가 0이라 `if (owed > 0)`이 거짓 → **아무것도 회수되지 않는다.**
지급은 됐는데 회수는 안 되므로 총점이 순증하고, 같은 태스크로 반복 가능하다.
658-661 주석이 "완료/취소 반복으로 점수를 무한히 올릴 수 있었다"를 고쳤다고 적었는데,
그 수정에 200 이벤트짜리 지평선이 남아 있다.

**고치는 법.** 태스크별 순지급액을 표시용 이벤트 배열과 분리해 들고 있는다 —
태스크 레코드에 `awardedPoints`를 두거나, 잘리지 않는 `Record<taskId, number>` 원장을
`score` 옆에 둔다. 이벤트 배열은 지금처럼 표시용으로만 자른다.

---

### [medium] src/main/licensing/licenseManager.ts:599,618-624 — `refresh()`가 커밋 실패 시 시계 래칫을 과거로 되돌린다

**문제.**
```ts
const before = { token: record.token, lastSeenMs: record.lastSeenMs }   // 599
const result = await deps.client.validate(key, device, deps.deviceName) // 600 — 최대 15초
...
if (!commit()) {
  Object.assign(record, { token: before.token, lastSeenMs: before.lastSeenMs })  // 622
```
`before`를 **await 앞에서** 잡는다. 그 15초 동안 마감 타이머(413-422)가 깰 수 있고,
그러면 `advanceClockFloor(reachedMs)`가 `record.lastSeenMs`를 올리고 `persist()`한다.
커밋이 실패하면 622가 그 값을 await 이전 값으로 **덮어써서 래칫을 내린다.**

**왜.** `advanceClockFloor`(177-181)와 그 주석(140-161)이 세우는 불변식은
"`lastSeen`을 낮추는 길은 `anchorClockToServerTime` 하나뿐"이다. 타이머가 깼다는 사실은
단조 시계로 증명된 경과 시간이고(415-419 주석), 그걸 버리면 정확히 그 방어가 노리는
되돌리기 공격의 창이 다시 열린다. `activate()`는 같은 함정을 피해 간다 — `before`를
await **뒤**(450)에서 잡는다.

**고치는 법.** `before.lastSeenMs`를 `anchorClockToServerTime` 직전에 다시 읽거나,
롤백을 `record.token = before.token` 하나로 줄이고 래칫은 `advanceClockFloor`로만
움직이게 한다(내려야 할 때는 `anchorClockToServerTime`을 되돌리는 대신 다음 성공에 맡긴다).

---

### [medium] src/renderer/src/licensing/useActivation.ts:39-51 + LicenseSection.tsx:67-75 — 활성화/해제 IPC가 거절되면 버튼이 영구히 잠긴다

**문제.** 두 흐름 다 `finally`가 없다.
```ts
setBusy(true); setError(null)
const failure = await window.api.licenseActivate(key)   // 여기서 reject되면
setBusy(false)                                          // 이 줄에 도달하지 못한다
```
`LicenseSection.deactivate`도 같다 — `setReleasing(true)`(68) 뒤의
`await window.api.licenseDeactivate()`(70)가 거절되면 `setReleasing(false)`(71)가 안 돈다.

**왜.** `busy = activation.busy || releasing`(LicenseSection.tsx:53)이 **두 버튼을 모두**
잠그므로, 한 번의 거절로 사용자는 활성화도 해제도 못 하는 화면에 갇힌다.
잠금 화면(LicenseGate)에서는 `canSubmit`이 영영 false가 되어 유일한 탈출구가 막힌다.
게다가 호출처가 `void activate()`(LicenseGate.tsx:61, LicenseSection.tsx:109)라
그 거절은 unhandled rejection으로 사라진다. main의 핸들러가 던지는 경로는 좁지만
0은 아니다 — `apply()` → `onChange` → `broadcast()` 체인과 `store.write` 바깥의 예외가 있다.

**고치는 법.** 두 자리 모두 `try { … } finally { setBusy(false) }`로 감싸고,
catch에서 `network`(또는 새 실패 코드)를 세워 사용자에게 보여 준다.

---

### [medium] src/renderer/src/components/tasks/TaskDetail.tsx:414-417 — `pick-attachment` 거절이 아무 데서도 잡히지 않는다 (잠긴 날 무반응)

**문제.** `onAddAttachment`가 `await pickAttachment()`를 try 없이 부른다.
`pickAttachment`(useStore.ts:999-1001)도 감싸지 않고 그대로 던진다.

**왜.** `pick-attachment`는 유료 채널이고, **다이얼로그가 닫힌 뒤 한 번 더** 게이트를
확인해 던진다(ipc-handlers.ts:128-132 — 다이얼로그를 열어 둔 채 트라이얼이 끝나는 경우를
위해 일부러 넣은 검사다). 그러니 이 경로는 설계상 거절될 수 있다. 그런데
`AttachmentList.tsx:32-42`는 try/catch가 있고 `TaskDetail`의 ⋯ 메뉴 경로는 없다 —
비대칭이다. 잡히지 않으므로 (1) unhandled rejection, (2) 사용자에게 아무 표시도 없고,
(3) `report()`를 거치지 않아 `refreshLicense()`가 안 돌아 **잠금 화면도 안 뜬다.**
사용자가 보는 것은 "파일 추가를 눌렀는데 아무 일도 안 일어난다"뿐이다.

**고치는 법.** 두 호출처를 스토어의 한 액션으로 합치고, 그 액션이 거절을 잡아
`report('pickAttachment', e)`로 넘긴다(그래야 `LICENSE_REQUIRED`가 게이트를 깨운다).

---

### [medium] src/main/database.ts:60-65,651-653 + src/main/ipc-handlers.ts:154-198 — 읽기 실패 세션에서 '내보내기'가 빈 백업을 사용자의 파일 위에 쓴다

**문제.** `load()`가 던지면 `dbReadFailed = true`가 서고 `data`는 39-47의 **빈 기본값**으로
남는다. 쓰기는 `save()`가 막지만(78), `exportData()`(651-653)는 그 `data`를 그대로
직렬화하고 `export-data` 채널은 무료라 잠금 화면에서도 눌린다.
사용자가 경로를 고르면 `writeFileSync`(195)가 `{"lists":[],"tasks":[],…}`를 **그 경로에 쓴다.**

`isDatabaseReadOnly()`(63-65)는 주석에 "부팅이 사용자에게 알리는 데 쓴다"고 적혀 있지만
**소비자가 하나도 없다** — 테스트 밖에서 `grep`하면 선언부만 나온다.
`index.ts:123-131`은 자기 try/catch로 일반 다이얼로그만 띄우고 이 술어를 보지 않는다.

**왜.** 사용자가 마지막 백업이라고 믿는 파일이 빈 파일이 되고, 하필 기존 백업 위에
저장하면 진짜 백업까지 덮인다. 원본은 `.corrupt-*`로 옆에 복사돼 있어(177-179)
복구는 가능하지만, 사용자는 그 사실을 모른 채 "백업했다"고 생각한다.

**고치는 법.** `export-data`가 `db.isDatabaseReadOnly()`면 거절하고 `.corrupt-*` 경로를
문구에 담아 돌려준다. 잠금 화면의 내보내기 버튼도 그 결과를 표시해야 한다(아래 항목과 함께).

---

### [medium] src/renderer/src/store/useStore.ts:1004-1006 (+ LicenseGate.tsx:100, Settings.tsx:395, useKeyboardShortcuts.ts:105) — 내보내기 실패가 세 호출처 어디에서도 잡히지 않는다

**문제.** `exportData: async () => (await window.api.exportData()) as boolean` — try 없음.
main 쪽 `writeFileSync`(ipc-handlers.ts:193, 195)는 읽기 전용 볼륨·권한 거부·
빠진 외장 디스크에서 던지고, `dialog.showSaveDialog`도 던질 수 있다.
호출처 셋 모두 반환값을 버린다: `onClick={() => exportData()}`(LicenseGate.tsx:100),
`exportData()`(Settings.tsx:395), `exportData()`(useKeyboardShortcuts.ts:105).

**왜.** 사용자는 저장 다이얼로그가 닫히는 것만 보고 성공했다고 믿는다. 특히
LicenseGate.tsx:15-16이 "데이터를 인질로 잡지 않는다 — 잠긴 화면에서도 내보내기가
바로 눌린다"고 선언한 그 버튼이 조용히 실패한다.

**고치는 법.** 스토어 액션에서 잡아 `false`를 돌려주고, 세 호출처가 실패 문구를 띄운다.

---

### [medium] src/main/index.ts:197-198 + src/main/app-ipc.ts:25-28 — `autoUpdater`에 `error` 리스너가 없고, 체크/다운로드 결과를 아무도 받지 않는다

**문제.** `index.ts:166-195`가 `update-available`·`update-not-available`·
`download-progress`·`update-downloaded`는 붙이지만 **`error`는 붙이지 않는다.**
`electron-updater`의 `checkForUpdates()`는 실패 시 `.catch` 안에서
`this.emit("error", e, …)`를 한다(node_modules/electron-updater/out/AppUpdater.js:269-273).
Node의 EventEmitter는 리스너 없는 `'error'` emit에서 **던지므로**, 그 던짐이
체인의 거절이 되어 `index.ts:197`(시작 시 1회)과 `:198`(매 시간)에서
**처리되지 않은 거절**로 남는다 — 오프라인이면 한 시간마다 반복된다.

`downloadUpdate()`는 더 앞이다: `updateInfoAndProvider == null`이면
`this.dispatchError(error)`를 **동기로** 부르고(AppUpdater.js:435-440), 리스너가 없으니
그 자리에서 던진다. `app-ipc.ts:27`이 그 promise를 그대로 돌려주므로 렌더러의
`window.api.downloadUpdate?.()`(Settings.tsx:720)가 거절되는데, 그 호출도 반환값을 버린다.

**왜.** 다운로드가 실패해도 렌더러는 알 방법이 없다 — `update-error` 채널 자체가 없다.
진행률 바(Settings.tsx:705-714)가 멈춘 자리에 그대로 서 있고 사용자는 계속 기다린다.

**고치는 법.** `autoUpdater.on('error', …)`를 등록해 로그를 남기고 렌더러에
`update-error`를 보낸다. `checkForUpdates()` 두 호출에 `.catch`를 붙이고,
`download-update` 핸들러도 거절을 잡아 구조화된 실패를 돌려준다.

---

### [medium] src/renderer/src/hooks/useKeyboardShortcuts.ts:95-116 — 입력 필드 포커스 가드가 Cmd 단축키보다 **아래**에 있다

**문제.** 입력 가드는 118-120이다.
```ts
if (isMod && key === 'z' && !e.shiftKey) { e.preventDefault(); popUndo(); return }   // 95-100
if (isMod && key === 'e') { … }                                                      // 102-107
if (isMod && key === 'd') { … updateTask({ id: taskId, dueDate: todayString() }) }    // 109-116
const target = e.target as HTMLElement
if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || …) return          // 118-120
```

**왜.** 메모나 제목을 타이핑하다 Cmd+Z를 누르면 `preventDefault()`가 **네이티브 undo를
막고** 대신 앱 undo가 돌아 방금 지운 할일이 되살아난다 — 사용자가 원한 것은 글자 복원이다.
Cmd+D는 타이핑 중에 선택된 할일의 마감일을 오늘로 바꾼다. 69-75의 오버레이 가드는
Radix `[role=dialog|menu][data-state=open]`만 보므로 인라인 AddTask 입력이나
TaskDetail의 CodeMirror 메모에는 걸리지 않는다.

**고치는 법.** 입력 가드를 Escape / Cmd+Shift+A 바로 다음, 나머지 Cmd 단축키 **앞**으로
올린다. 전역이어야 하는 Cmd+N·Cmd+F만 그 위에 남긴다.

---

## LOW

### [low] src/renderer/src/licensing/useLicense.ts:84-86 — 트라이얼 첫날에 "29일 남음"이라 쓴다
`Math.floor((untilMs - now) / 86_400_000)`. `untilMs = start + 30일`이므로 창이 열린 직후
값은 `floor(29.99…) = 29`다. 30일 트라이얼이 시작하자마자 29를 말하고, 마지막 24시간
내내 0을 말한다(0은 `trialLastDay`/`graceToday` 문구로 처리되긴 한다).
`Math.ceil`이 "남은 날짜" 문구와 맞는다.

### [low] src/renderer/src/store/useStore.ts:980-991 — `addScores`가 동시 점수 쓰기를 덮어쓴다
`let total = get().score.total`(984)로 스냅샷을 뜬 뒤 `set((s) => ({ score: { total, … } }))`(990)
에서 그 값을 **그대로** 쓴다. 같은 파일의 `addScore`(970-976)는 `s.score.total + applied`로
setter 인자에서 파생하는데 여기만 다르다. `get()`과 `set()` 사이에 끼어든 점수 쓰기는 사라진다.
`batchComplete`는 `await get().addTasks(...)`(825)를 사이에 두고 `addScores`(826)를 부르므로
창이 실제로 열려 있다. `set((s) => …)` 안에서 누적을 다시 계산하면 닫힌다.

### [low] src/renderer/src/components/tasks/AttachmentList.tsx:5-16 + TaskDetail.tsx:416 — 파일명에 `|`가 있으면 첨부를 영영 열 수 없다
저장 형식이 `name|path`이고 `parseAttachment`가 **첫 번째** `|`로 자른다(6). macOS 파일명에
`|`는 합법이라 `a|b.txt`는 `path = "b.txt|/Users/…/attachments/…"`가 되고,
`isInsideAttachments`(ipc-handlers.ts:149)가 거부해 `open-attachment`가 던진다.
두 생성 지점이 형식을 각각 조립하고 있는 것도 같은 뿌리다(`formatAttachment` vs
TaskDetail.tsx:416의 인라인 템플릿). 구분자를 마지막 `|`로 자르거나(경로에는 `|`가
들어갈 수 없다) 이름을 인코딩한다.

### [low] src/renderer/src/components/common/UndoToast.tsx:15-43 — 되돌리기 직후 토스트가 **이전** 항목으로 다시 뜬다
이펙트가 `lastAction?.timestamp`에 걸려 있다(35). `handleUndo` → `popUndo()`가 스택을
줄이면 `lastAction`이 그 아래 항목으로 바뀌고 timestamp가 달라져 이펙트가 다시 돌아
`setLeaving(false); setVisible(true)`(20-21)를 한다. 사용자는 방금 하지도 않은
"…삭제됨"을 다시 보고, 한 번 더 누르면 의도치 않은 것을 되돌린다.
26·42의 중첩 `setTimeout(…, 300)`은 정리되지 않아 언마운트 뒤 setState도 남는다.

### [low] src/main/index.ts:99-201 — `app.whenReady().then(...)`에 `.catch`가 없다
`initDatabase`만 자기 try/catch를 갖고(123-131), 그 뒤의 `applyAppMenu`·`setupIpcHandlers`·
`setupAppIpc`·`createWindow`·`initLicensing`은 전부 처리되지 않는 promise 안에서 돈다.
어느 하나가 던지면 창도 IPC도 없이 조용히 멈춘다 — 100-103 주석이 막으려던 상황 그대로다.

### [low] src/main/licensing/licenseManager.ts:529-540 — `revalidateIfNeeded()`가 재진입에 무방비다
동시 진입을 막는 것이 없고, 겹친 두 실행이 각각 `finally`에서 `armNextRevalidation`을 부른다.
뒤엣것이 앞엣것의 타이머를 취소하고 `unreachableStreak`(579)을 두 번 올려 백오프가 어긋난다.
오늘은 외부 호출자가 `service.ts:98` 하나뿐이라 잠복 상태다. 진행 중인 promise를
들고 있다가 그대로 돌려주면 닫힌다.

### [low] src/main/database.ts:81-102 — 디바운스된 비동기 쓰기가 `flushSave()`의 동기 쓰기를 덮을 수 있다
타이머가 깨어 `json`을 스냅샷하고(83) `writeFile`을 비동기로 시작한 직후(84)
`flushSave()`가 돌면, `savePending`이 아직 true라 `writeFileSync`(100)가 **최신** 데이터를
쓴다. 그 뒤 앞의 비동기 쓰기가 착륙하면 파일이 **옛 스냅샷으로 되돌아간다.**
종료 경로에서는 프로세스가 먼저 끝나 대개 무해하지만, macOS의 `window-all-closed`는
앱을 끝내지 않으므로(index.ts:212-217) 실제로 살아남을 수 있다.
`flushSave`에서 진행 중인 비동기 쓰기를 취소하거나 세대 카운터로 무시한다.

### [low] src/main/google-auth-flow.ts:88-108 — 콜백이 두 번 오면 성공한 인증이 거절될 수 있다
`pending`은 `await exchangeCode(...)`(94) **뒤에야** 비워진다(104의 `settle`).
그 사이 같은 스킴 URL이 한 번 더 들어오면(링크 두 번 클릭, `open-url` 중복 발화)
두 번째 호출이 같은 `flow`로 들어와 이미 쓴 코드를 교환하려다 실패하고
`settle(flow, () => flow.reject(...))`(106)를 부른다. 그게 첫 번째 성공보다 먼저 착륙하면
정상 로그인이 실패로 끝난다. 진입 직후 `pending = null`로 자리를 비우면 닫힌다.

### [low] src/renderer/src/components/sidebar/Settings.tsx:259 — `capabilities()` 거절이 처리되지 않는다
`window.api.capabilities?.().then(setCaps)` — `.catch`가 없다. 실패하면 처리되지 않은
거절이 되고 `caps`가 `null`에 머물러 `needsLicenseKey` 갈래(412)가 거짓이 되므로
**라이선스 칸이 통째로 사라진다** — 키를 넣을 곳이 없어진다. 채널은 무료라 실패 확률은
낮지만, 실패했을 때의 증상이 조용하고 비싸다.

### [low] [추측] src/main/ipc-handlers.ts:501-502 — 가드는 `||`, 인자는 `??`
```ts
if (config.tokens?.refreshToken || config.tokens?.accessToken) {
  await revokeToken(config.tokens.refreshToken ?? config.tokens.accessToken, …)
```
`refreshToken`이 빈 문자열이면 가드는 accessToken 쪽으로 떨어지는데 인자는 `''`를 그대로
보낸다. 타입은 `string | null`(google/oauth.ts:117)이라 오늘 도달 가능한지는 확인하지
못했다 — 저장/복호화 경로가 `''`를 만들 수 있는지에 달렸다. 두 연산자를 `||`로 맞추면
질문 자체가 사라진다. (`revokeToken`은 던지지 않으므로 500번의 "실패해도 로컬 토큰은
반드시 지운다"는 약속 자체는 지켜진다 — 확인함.)

---

## 확인했으나 결함이 아니었던 것 (다음 감사를 위해)

- **`anchorClockToServerTime`이 래칫을 낮추는 것**(licenseManager.ts:194-196) — 레퍼런스
  서버가 `/v1/activate`·`/v1/validate` 모두 `iat: Math.floor(Date.now()/1000)`으로 **매번 새로
  서명한다**(bicmac-license/src/index.ts:186,194). 옛 `iat`가 재사용되지 않으므로
  래칫이 과거로 끌려갈 경로가 없다.
- **`KNOWN_REFUSALS`와 서버 계약**(licenseClient.ts:74-83) — `device_limit` 409,
  `unknown_key`/`revoked`/`device_not_active` 404, `deactivation_limit` 429가
  서버 핸들러(index.ts:181-182, 242-249)와 정확히 일치한다.
- **`license.error.*` 로케일 키** — `ActivateFailure`·`DeactivateFailure`의 14개 값이
  ko/en 양쪽에 빠짐없이 있다(스크립트로 대조).
- **스토어 빌드에서 잠금 화면이 뜨는가** — `enforced = IS_ENFORCED && !isDevBuild &&
  !isStoreBuild`(service.ts:51-53, capabilities.ts:82)라 `LicenseGate`의 이른 반환(38)이
  스토어 빌드에서 항상 발화한다. Apple 3.1.1 위험 없음.
- **`closeDatabase()`가 macOS `window-all-closed`에서 불리는 것**(index.ts:212-213) —
  `flushSave()`뿐이라 DB를 닫지 않는다. dock 재활성화 뒤에도 정상 동작한다.
