# haru 코드 감사 리포트 (E2 성능 · E3 유지보수 · E4 완성도)

- **작성일:** 2026-07-21
- **방법:** 3개 병렬 서브에이전트(성능/유지보수/완성도)의 근거 기반 분석. 각 발견은 file:line·영향·수정 스케치·노력(S/M/L) 포함.
- **목적:** v2.0 출시 전 "지금 고칠 것 vs 다음 사이클로 미룰 것" 트리아지.

## 🔴 그룹 A — 깨진 기능 (E4 완성도, 출시 전 강력 권고)

이 기능들은 UI에 노출돼 있으나 실제로 동작하지 않아 **사용자를 오도**합니다.

1. **리마인더가 한 번도 울리지 않음** — `src/main/ipc-handlers.ts:122` 외
   - `reminderAt` 저장·벨 UI(`ReminderPicker`)·`show-notification` IPC 전부 있으나, **`reminderAt`를 읽어 알림을 발화하는 스케줄러가 어디에도 없음**. 설정한 모든 리마인더가 조용히 버려짐.
   - 수정: main에서 앱 시작 후 1분 폴링 → 도래한 `reminderAt` 태스크에 `Notification` 발화(재발화 방지 플래그 필요). 노력 **M**.
2. **반복 task가 다음 인스턴스를 만들지 않음** — `src/renderer/src/store/useStore.ts:445`
   - `isRecurring`/`recurringPattern` 저장·`RecurringPicker` UI 있으나, `toggleTask`가 단순 완료 플립만 함. 반복 task 완료 시 다음 발생 인스턴스가 생성되지 않음(기능의 핵심 가치가 no-op).
   - 수정: 완료 시 `recurringPattern`으로 다음 due 계산 → `addTask`. 노력 **S~M**.
3. **첨부파일을 열 수 없음** — `src/renderer/src/components/tasks/AttachmentList.tsx`
   - 첨부·목록 표시·삭제는 되나, 파일명 클릭 시 여는 경로가 없음(`open-attachment` IPC 부재). 쓰기 전용 → 사실상 무용.
   - 수정: `ipcMain.handle('open-attachment', (_, p) => shell.openPath(p))` + 클릭 배선. 노력 **S**.
4. **일괄 삭제 되돌리기 없음** — `src/renderer/src/store/useStore.ts:540`
   - `batchDelete`가 `pushUndo`를 호출하지 않음. `popUndo`의 `deleteTasks` 핸들러는 이미 존재. 팬텀 타입 `completeTasks`/`moveTasks`도 정리.
   - 수정: `batchDelete`에 `pushUndo({type:'deleteTasks',...})` 한 줄. 노력 **S**.

## 🟡 그룹 B — 값싼 고가치 개선 (전부 S 노력)

5. **score.events 무한 증가** — `database.ts:368`, `useStore.ts:662` (성능 High)
   - 모든 완료/습관/뽀모도로가 events에 append, 상한 없음 → 매 저장 시 전체 재직렬화 write amplification. 최근 N개(예: 200)로 캡. total은 별도 누적.
6. **번들 1.45MB, 코드 분할 없음** — `TaskDetail.tsx`, `electron.vite.config.ts` (성능 High)
   - `react-markdown` + highlight.js 10개 언어가 항상 로드. 매 콜드런치 파싱 세금(200~400ms). `TaskDetail`을 `React.lazy` + markdown/hljs 동적 import. 빠른 1차: lazy TaskDetail(S).
7. **AiConfig 이중 정의** — `ai-service.ts:11` vs `types/index.ts:107` (유지보수 High)
   - 동일 인터페이스 2곳, 링크 없음 → 한쪽만 바뀌면 조용히 드리프트. 공유 타입으로 단일화.
8. **PomodoroSession만 camelCase 저장** — `database.ts:358` vs 타 엔티티 snake_case (유지보수 High)
   - 세션만 저장 규약이 달라 향후 매핑 버그·export 불일치 위험. snake_case로 정렬(형식 굳기 전에).
9. **PRIORITY_OPTIONS/color/order 6개 파일 중복** — (유지보수 Med) → `utils/priority.ts`로 추출.
10. **`export-data` 핸들러의 동적 `require('node:fs')`** — `ipc-handlers.ts:112,115` → top-level import로. 노력 S.

## 🟢 그룹 C — 더 큰 리팩터 (defer 권고)

11. **useStore 844줄 9개 도메인 혼재** — Zustand slice 분리. 노력 M, 근시 correctness 위험 없음.
12. **DB 영속 경계 무타입** (`Record<string,unknown>[]`) — StoredTask 등 타입화. 노력 M.
13. **DB mutation 테스트 부재** (createTask/updateTask/batchUpdateTasks의 camel↔snake 매핑 무테스트) — 노력 M. *권고: 8·9 수정 시 함께 최소 테스트 추가.*
14. **가상화 없음** (500+ 태스크 시 스크롤 저크) — 노력 L. 개인 규모(<300)엔 비블로커.
15. **광범위 useStore 구조분해 재렌더**, DailyCalendar 슬롯 스캔, Sidebar taskCounts N×lists — 개인 규모 페이퍼컷, 필요 시.
16. **AI 엣지케이스**: 스트리밍 중 패널 닫기 시 main fetch 지속, 비SSE 응답 시 빈 말풍선, 프로바이더 오설정 시 generic 에러 — UX 폴리시. defer.

## 트리아지 권고 (컨트롤러)

- **그룹 A 전부 지금** — 노출됐는데 안 되는 기능은 출시 신뢰를 해침. (특히 리마인더·반복이 최우선.)
- **그룹 B 전부 지금** — 전부 S 노력, 형식/성능이 굳기 전에 처리하면 이득. (13의 DB 테스트를 8·9와 함께.)
- **그룹 C는 v2.0 이후** 별도 리팩터 사이클.

전체 규모: A(1 M + 3 S/M) + B(6× S) ≈ 반나절~하루. 사용자 판단 대기.
