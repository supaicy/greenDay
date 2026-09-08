# 레퍼런스 — IPC 채널

2026-09-08 `ebf40d6` 기준. 출처는 `src/main/ipc-handlers.ts`, `src/main/app-ipc.ts`, `src/main/migration/boot.ts`, `src/main/index.ts`(메인→렌더러 이벤트), `src/preload/index.ts`(렌더러가 부르는 이름), 등급 목록은 `src/main/ipc-gate.test.ts` 의 `FREE_CHANNELS`.

## 규칙

- **등록은 `ipc-gate.ts` 의 `handle(channel, tier, listener)` 로만** 한다. `ipcMain.handle` 직접 호출은 `ipcMainBoundary.test.ts` 가 막고, 게이트를 지나지 않은 등록은 `ipc-gate.test.ts` 가 `registeredTiers()` 와 실제 등록 집합을 대조해 잡는다.
- 모든 채널이 **발신자 검사**를 먼저 지난다: `event.senderFrame.url` 이 앱 문서(`ELECTRON_RENDERER_URL` 오리진, 출하에서는 `out/renderer/index.html` 의 `file:` URL 과 문자열 일치)가 아니면 `Error('untrusted_sender')`. `free` 도 예외가 아니다.
- `paid` 채널은 그 다음에 `licensing()?.allowsPaidFeatures() === false` 면 `Error('license_required')` (`LICENSE_REQUIRED`, `src/shared/license.ts`). 매니저가 없는 빌드(`null`)는 잠그지 않는다. 오늘은 `IS_ENFORCED = false` 라 `allowsPaidFeatures()` 가 항상 `true` 다.
- 렌더러는 `ipcRenderer.invoke` 가 감싼 오류 문자열을 `includes(LICENSE_REQUIRED)` 로 본다(`useStore`).
- 무료 부류 다섯: 읽기 · 내보내기/자기 것 지우기 · 라이선스 자체 · 앱 메타와 업데이트 · 바깥 열기. 목록을 늘리려면 `FREE_CHANNELS` 도 같이 고쳐야 테스트가 통과한다.

## 렌더러 → 메인 (`invoke`)

방향은 전부 렌더러가 부르고 메인이 답한다. "preload" 열은 `window.api.<이름>`.

### 앱 메타·라이선스 — `ipc-handlers.ts`

| 채널 | 등급 | 인자 | 반환 | preload |
|---|---|---|---|---|
| `app:capabilities` | free | — | `Capabilities` (`shared/capabilities.ts`) | `capabilities()` |
| `license:state` | free | — | `PublicLicenseState` | `licenseGetState()` |
| `license:activate` | free | `key: string` | `ActivateFailure \| null` (매니저 없으면 `'network'`) | `licenseActivate(key)` |
| `license:deactivate` | free | — | `DeactivateFailure \| null` | `licenseDeactivate()` |
| `license:purchase` | free | `source: 'settings' \| 'locked'` (그 외는 `settings`) | `void` — `pay.begreen.dev/buy?product=greenday&src=…` 를 브라우저로 | `licenseOpenPurchase(source)` |
| `license:recover` | free | — | `void` — `/recover` 를 브라우저로 | `licenseOpenRecover()` |

### 폴더·목록·할일 — `ipc-handlers.ts` → `database.ts`

| 채널 | 등급 | 인자 | 반환 | preload |
|---|---|---|---|---|
| `get-folders` | free | — | 행 배열 | `getFolders()` |
| `create-folder` | paid | `id, name` | `void` | `createFolder` |
| `update-folder` | paid | `id, name, collapsed` | `void` | `updateFolder` |
| `delete-folder` | paid | `id` | `void` | `deleteFolder` |
| `get-lists` | free | — | 행 배열 | `getLists()` |
| `create-list` | paid | `id, name, color, icon, folderId \| null` | `void` | `createList` |
| `update-list` | paid | `id, updates` | `void` | `updateList` |
| `delete-list` | paid | `id` | `void` | `deleteList` |
| `get-tasks` | free | — | 행 배열(스네이크케이스) | `getTasks()` |
| `get-trash-tasks` | free | — | 행 배열 | `getTrashTasks()` |
| `create-task` | paid | `task` → `validateTaskInput` | `void` | `createTask` |
| `update-task` | paid | `task` → `validateTaskUpdate` | `void` | `updateTask` |
| `delete-task` | paid | `id` | `void` (휴지통) | `deleteTask` |
| `restore-task` | paid | `id` | `void` | `restoreTask` |
| `permanent-delete-task` | paid | `id` | `void` | `permanentDeleteTask` |
| `empty-trash` | paid | — | `void` | `emptyTrash` |
| `reorder-tasks` | paid | `ids: string[]` | `void` | `reorderTasks` |
| `batch-update-tasks` | paid | `ids, updates` | `void` | `batchUpdateTasks` |

### 습관·포모도로·점수

| 채널 | 등급 | 인자 | 반환 | preload |
|---|---|---|---|---|
| `get-habits` | free | — | 행 배열 | `getHabits()` |
| `create-habit` | paid | `id, name, color, frequency, targetDays: number[]` | `void` | `createHabit` |
| `delete-habit` | paid | `id` | `void` | `deleteHabit` |
| `get-habit-logs` | free | — | 행 배열 | `getHabitLogs()` |
| `toggle-habit-log` | paid | `id, habitId, date` | `void` | `toggleHabitLog` |
| `get-pomodoro-sessions` | free | — | 행 배열 | `getPomodoroSessions()` |
| `save-pomodoro-session` | paid | `session` | `void` | `savePomodoroSession` |
| `get-score` | free | — | `ScoreState` | `getScore()` |
| `add-score-event` | paid | `event` | `void` | `addScoreEvent` |
| `add-score-events` | paid | `events[]` | `void` | `addScoreEvents` |

### 첨부·내보내기·알림·외부

| 채널 | 등급 | 인자 | 반환 | preload |
|---|---|---|---|---|
| `pick-attachment` | paid | — (열기 대화상자) | `{ name, path }[]`. 대화상자가 닫힌 **뒤** 라이선스를 한 번 더 본다 | `pickAttachment()` |
| `open-attachment` | free | `path` — `attachments/` 안이어야 한다, 아니면 throw | `shell.openPath` 결과 | `openAttachment(path)` |
| `export-data` | free | — (저장 대화상자; `.json` 전체 또는 `.csv` 살아있는 할일만) | `boolean` | `exportData()` |
| `app:notification-permission` | free | — | `'supported' \| 'unsupported'` | `notificationPermission()` |
| `app:request-notification-permission` | free | — (확인용 알림을 띄운다) | `boolean` | `requestNotificationPermission()` |
| `app:open-notification-settings` | free | — | `void` (시스템 설정 알림 패널) | `openNotificationSettings()` |
| `open-external` | free | `url` — http(s) 만 | `void` | `openExternal(url)` |
| `register-global-shortcut` | free | — | `boolean` (`hasGlobalShortcuts` 가 false 면 `false`) | `registerGlobalShortcut()` |

### AI — `ipc-handlers.ts` → `ai-service.ts`

| 채널 | 등급 | 인자 | 반환 | preload |
|---|---|---|---|---|
| `ai:check-connection` | paid | — | 연결 결과 | `aiCheckConnection()` |
| `ai:warmup` | paid | — | | `aiWarmup()` |
| `ai:get-config` | free | — | 설정(복호화된 `apiKey` 포함 여부는 `ai-service` 가 정한다) | `aiGetConfig()` |
| `ai:set-config` | paid | `updates` | | `aiSetConfig(updates)` |
| `ai:create-task` | paid | `input, tasks` | 구조화된 할일 | `aiCreateTask` |
| `ai:interpret-action` | paid | `message, tasks` | 액션 해석 | `aiInterpretAction` |
| `ai:stream-chat` | paid | `message, tasks, history` | `void` — 결과는 아래 `ai:stream-*` 이벤트로 | `aiStreamChat` |
| `ai:get-history` | free | — | 메시지 배열 (`ai-chat.json`) | `aiGetHistory()` |
| `ai:save-history` | paid | `messages` | `void` | `aiSaveHistory` |
| `ai:pull-model` | paid | `model` | `void` — 진행은 `ai:pull-*` 이벤트로 | `aiPullModel(model)` |

### CalDAV — `ipc-handlers.ts` → `calendar-config.ts`, `calendar-sync.ts`

설정 파일 `calendar-config.json`. 비밀번호는 저장하러 갈 때만 오가고 읽을 때는 `hasPassword` 만 온다(`toPublicConfig`).

| 채널 | 등급 | 인자 | 반환 | preload |
|---|---|---|---|---|
| `calendar:get-config` | free | — | 공개 설정(`password`·`passwordBinding`·`syncState` 제외, `hasPassword`, `syncedCount`) | `calendarGetConfig()` |
| `calendar:save-credentials` | paid | `{ serverUrl?, username?, password? }` — 오리진·계정이 바뀌면 비밀번호·캘린더·동기화 상태를 버린다 | 공개 설정 | `calendarSaveCredentials(input)` |
| `calendar:test-connection` | paid | — | `{ ok, message, calendars }` (일정 담을 수 있는 것만) | `calendarTestConnection()` |
| `calendar:select` | paid | `url, name` — 설정된 서버 오리진 밖이면 throw | 공개 설정 | `calendarSelect(url, name)` |
| `calendar:sync-now` | paid | — | `{ ok, message, result }` (created/updated/deleted/skippedNoDate/failures) | `calendarSyncNow()` |
| `calendar:disconnect` | free | — | 기본 설정 (`clearSecret: true` — 보호 모드도 물러난다) | `calendarDisconnect()` |

### Google — `ipc-handlers.ts` → `google-config.ts`, `google-auth-flow.ts`, `google-sync.ts`

설정 파일 `google-config.json`. 토큰은 렌더러로 넘어오지 않는다(`connected` 만).

| 채널 | 등급 | 인자 | 반환 | preload |
|---|---|---|---|---|
| `google:get-config` | free | — | 공개 설정 + `clientIdConfigured: boolean` | `googleGetConfig()` |
| `google:connect` | paid | — (브라우저 로그인, 루프백 콜백) | `{ ok, message }` | `googleConnect()` |
| `google:list-calendars` | paid | — | `{ ok, message, calendars }` (쓸 수 있는 것만) | `googleListCalendars()` |
| `google:select` | paid | `id, name` | 공개 설정 | `googleSelect(id, name)` |
| `google:sync-now` | paid | — | `{ ok, message, result }` | `googleSyncNow()` |
| `google:disconnect` | free | — (서버 revoke 시도 후 로컬 토큰 삭제, `clearSecret: true`) | 기본 설정 | `googleDisconnect()` |

### 언어·업데이트 — `app-ipc.ts`

| 채널 | 등급 | 인자 | 반환 | preload |
|---|---|---|---|---|
| `set-language` | free | `'ko' \| 'en'` | `void` — 바뀐 때만 앱 메뉴를 다시 짓는다 | `setLanguage(lang)` |
| `download-update` | free | — | `autoUpdater.downloadUpdate()` (`canSelfUpdate` 가 false 면 no-op) | `downloadUpdate()` |
| `install-update` | free | — | `quitAndInstall` (〃) | `installUpdate()` |

### 번들 ID 마이그레이션 — `migration/boot.ts`

전부 free. 반환은 항상 `MigrationStatus`(`shared/migration.ts`) — `{ mode: 'bridge' | 'arrival' | 'none', … }`. 부팅 때 계산한 값을 돌려주고, 아래 셋은 그 값을 갱신한다.

| 채널 | 인자 | 하는 일 | preload |
|---|---|---|---|
| `migration:status` | — | 현재 상태 | `migrationStatus()` |
| `migration:snooze` | — | 브리지: "나중에" — `noticeSnoozedUntil` 을 3일 뒤로 | `migrationSnooze()` |
| `migration:reopen` | — | 브리지: 스누즈 해제 (설정 → 버전 → "안내 다시 보기") | `migrationReopen()` |
| `migration:dismiss-old-app` | — | 새 앱: "옛 앱 지워도 됩니다" 를 영구히 닫는다 (`oldAppHintDismissed: true`) | `migrationDismissOldApp()` |
| `migration:release-lock` | — | 새 앱: 보호 모드 해제 — 새 sentinel 을 심고 열린 것을 확인한 뒤 `secretsLocked: false` | `migrationReleaseLock()` |

## 메인 → 렌더러 (`webContents.send`)

preload 가 `on<이름>(callback)` 으로 노출하고 해제 함수를 돌려준다.

| 채널 | 페이로드 | 보내는 곳 | preload |
|---|---|---|---|
| `update-available` | `{ version, downloadUrl }` | `index.ts` autoUpdater (`canSelfUpdate` 일 때만 배선) | `onUpdateAvailable` |
| `update-not-available` | — | 〃 | `onUpdateNotAvailable` |
| `update-download-progress` | `percent: number` | 〃 | `onUpdateProgress` |
| `update-downloaded` | — | 〃 | `onUpdateDownloaded` |
| `ai:stream-token` | `token: string` | `ai:stream-chat` 핸들러 | `onAiStreamToken` |
| `ai:stream-done` | — | 〃 | `onAiStreamDone` |
| `ai:stream-error` | `error: string` | 〃 | `onAiStreamError` |
| `ai:pull-progress` | `{ status, completed?, total?, percent }` | `ai:pull-model` 핸들러 | `onAiPullProgress` |
| `ai:pull-done` | — | 〃 | `onAiPullDone` |
| `ai:pull-error` | `error: string` | 〃 | `onAiPullError` |
| `license:changed` | `PublicLicenseState` | `licensing/service.ts` `broadcast()` — 상태 전이·마감 타이머·재검증 | `onLicenseChanged` |
| `global-quick-add` | — | `register-global-shortcut` 이 등록한 `Cmd/Ctrl+Shift+A` | `onGlobalQuickAdd` |

## 무료 채널 전체 (36개, `FREE_CHANNELS`)

```
ai:get-config  ai:get-history  app:capabilities  app:notification-permission
app:open-notification-settings  app:request-notification-permission
calendar:get-config  calendar:disconnect  google:disconnect  export-data
get-folders  get-habit-logs  get-habits  get-lists  get-pomodoro-sessions
get-score  get-tasks  get-trash-tasks  google:get-config
license:activate  license:deactivate  license:purchase  license:recover  license:state
open-attachment  open-external  register-global-shortcut
set-language  download-update  install-update
migration:status  migration:snooze  migration:reopen  migration:dismiss-old-app  migration:release-lock
```

나머지 등록 채널은 전부 `paid` 다.

## 배선을 지키는 테스트

| 테스트 | 무엇 |
|---|---|
| `src/preload/wiring.test.ts` | 메인의 모든 `handle('…')` 이 preload 에 있고, preload 의 모든 `invoke('…')` 에 핸들러가 있고, preload 의 모든 메서드를 렌더러가 `api.x` 로 부른다. **주석은 지우고 센다** — 주석에 진짜 채널 이름을 적으면 유령 등록이 된다 |
| `src/main/ipc-gate.test.ts` | 무료 집합이 정확히 위 목록, 등록 집합 = 게이트 집합, 잠긴 상태의 거절, 발신자 경계 |
| `src/main/ipcMainBoundary.test.ts` | `ipcMain.handle` 직접 호출이 없다 |
| `src/main/calendarIpcBoundary.test.ts` | 캘린더 채널의 오리진 결속 |
