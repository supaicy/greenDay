# Audit Fixes (Plan 3-fix) — 구현 계획 (그룹 A + B)

> 실행: 영역별 구현자 서브에이전트(TDD 가능한 곳은 TDD) + 컨트롤러 독립 헬스 검증 + 최종 전체 브랜치 리뷰. 근거: `docs/design/2026-07-21-audit-report.md`.

**Global Constraints:** co-author 트레일러 없음. 브랜치 `supaicy/coordinate`. 로컬 바이너리(`./node_modules/.bin/*`). 각 커밋 후 `tsc --build`/`biome lint`(0)/`vitest run` 그린. Korean 주석. `.superpowers/` 커밋 금지.

## A1 — 리마인더 스케줄러 (main)
- 문제: `reminderAt` 저장되나 발화 없음.
- 구현: 신규 `src/main/reminders.ts` — 순수 함수 `dueReminders(tasks, fromISO, toISO): Task[]`(완료 안 됨 + reminderAt이 (from, to] 구간). `index.ts`에서 앱 시작 후 60초 간격 폴링, 시작 시 `lastCheck=now`로 초기화(과거 리마인더 재발화 방지), 도래분에 `new Notification({title, body}).show()`. 인메모리 처리라 스키마 변경 없음.
- 테스트: `reminders.test.ts` — dueReminders 경계(구간 안/밖, 완료 제외, reminderAt null 제외).

## A2 — 반복 task 다음 인스턴스 (renderer)
- 구현: 신규 `src/renderer/src/utils/recurrence.ts` — `nextRecurringDate(pattern: string, fromISODate: string): string | null`. 패턴: `daily`(+1일), `weekly:d,d`(다음 해당 요일), `monthly:N`(다음 달 N일), `yearly:MM-DD`(내년 해당일). `useStore.toggleTask`에서 완료 시 `task.isRecurring && recurringPattern`이면 다음 due 계산해 `addTask`(같은 title/list/priority/tags, 새 dueDate, isRecurring 유지).
- 테스트: `recurrence.test.ts` — 각 패턴별 다음 날짜.

## A3 — 첨부파일 열기 (main+preload+renderer)
- 구현: `ipc-handlers.ts`에 `ipcMain.handle('open-attachment', (_, p) => shell.openPath(String(p)))`(경로 검증: 문자열). `preload/index.ts`+`index.d.ts`에 `openAttachment(path)`. `AttachmentList.tsx` 파일명에 클릭/키보드 핸들러로 `window.api.openAttachment(path)`.

## A4 — 일괄 삭제 되돌리기 (renderer)
- 구현: `useStore.batchDelete`에서 삭제 전 `pushUndo({ type:'deleteTasks', description:'N개 삭제됨', data: deletedTasks, timestamp })`. `popUndo`의 `deleteTasks` 핸들러 데이터 shape에 맞춤. `types/index.ts` `UndoAction`의 팬텀 타입 `completeTasks`/`moveTasks` 제거.

## B1 — score.events 상한 (main+renderer)
- `database.addScoreEvent`: push 후 `data.score.events`를 최근 200개로 slice. `useStore.addScore`(useStore.ts:662): `events:[...].slice(-200)`. total은 계속 누적.
- 테스트: database.test.ts에 200 초과 시 잘림 확인.

## B2 — 번들 코드분할 (renderer)
- `App.tsx`에서 `TaskDetail`을 `React.lazy(() => import('./components/tasks/TaskDetail'))` + `<Suspense fallback={null}>`로 감싸기(조건부 렌더 지점). markdown/hljs는 TaskDetail 내부에 있으므로 lazy TaskDetail로 함께 분리됨.
- 검증: `electron-vite build` 후 renderer가 별도 chunk로 분할(단일 1.45MB → 감소).

## B3 — AiConfig 단일 정의 (shared)
- `ai-service.ts`의 로컬 `interface AiConfig` 제거, `types/index.ts`의 `AiConfig` 재사용. Electron 프로세스 격리상 renderer types를 main이 import 가능한지 확인(electron-vite 별칭). 불가 시 `src/shared/ai-config.ts` 신설해 양쪽 import.

## B4 — PomodoroSession snake_case 정렬 (main)
- `database.savePomodoroSession`을 타 엔티티처럼 snake_case로 저장(`task_id`,`started_at`,`completed_at`). `useStore.mapPomodoroSession`(useStore.ts:227) 읽기도 snake_case로. 기존 camelCase 데이터 마이그레이션(initDatabase 마이그레이션 블록에 추가) 또는 읽기 폴백.
- 테스트: 저장→읽기 라운드트립.

## B5 — PRIORITY 상수 추출 (renderer)
- 신규 `src/renderer/src/utils/priority.ts`: `PRIORITY_OPTIONS`, `PRIORITY_COLOR`, `PRIORITY_ORDER`. `AddTask`,`TaskDetail`,`BatchBar`,`KanbanView`,`TimelineView`,`EisenhowerMatrix`의 중복 정의 제거·import.

## B6 — 동적 require 정리 (main)
- `ipc-handlers.ts` `export-data`의 `require('node:fs')` 2곳 → top-level `import { writeFileSync } from 'node:fs'`.

## 순서 & 검증
독립 파일군끼리 순차. 각 후 헬스 그린. 마지막 electron-vite build로 번들 확인 + 전체 브랜치 리뷰.
