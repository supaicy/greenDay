# TODOS

## Pre-implementation (Must do before coding)

### [P0] ~~Korean LLM Accuracy Benchmark~~ ✅ DONE (2026-03-25)
- **Result:** llama3.2:latest (3B) — JSON 파싱 96%, 서브태스크 100%, 우선순위 70%
- **Verdict:** PASS — 3B 모델로 충분. 우선순위 프롬프트 few-shot 강화 필요. "글피" 등 비표준 표현은 기존 naturalDate.ts 폴백으로 커버
- **Model:** llama3.2:latest (3B, 2GB) — 디자인 문서의 8B 대신 3B로도 충분
- **Data:** /tmp/haru-benchmark-results.jsonl

## MVP (v2.0)

### ~~[P1] OpenAI Compatible API Fallback~~ ✅ DONE (v1.3.0, 2026-04-01)
- **Result:** Ollama + OpenAI + Custom API 지원 완료. Settings UI에서 provider 선택, API 키 설정, 연결 테스트 가능. LLM 출력 검증 및 설정 영속화 포함.

## Post-MVP

### ~~[P2] Chat History Persistence (v2.0.1)~~ ✅ DONE (2026-04-20, PR #18)
- **Result:** `<userData>/ai-chat.json`에 단일 스레드 히스토리 영속화. 사용자가 Settings에서 최대 메시지 수(기본 200) 조정 가능. 스트리밍 완료/오류/Clear 3개 지점에서 trim 후 저장. 재시작 후 자동 복원 확인.
- **Out of scope (follow-ups):** 세션 분리, LLM 컨텍스트 연속성, 스트리밍 중 크래시 복구
- **Design:** `docs/design/2026-04-20-ai-chat-history-persistence.md`
- **Plan:** `docs/plans/2026-04-20-ai-chat-history-persistence-plan.md`

## Code Quality / Lint Cleanup

Biome 도입 후 남은 린트 위반. PR #12, #13으로 biome 설치 + 자동 수정 완료. 초기 178 errors 중 128건 해소(PR #15/#16/#17), 현재 50 errors 잔존(모두 div 접근성).

### ~~[P1] `useHookAtTopLevel` 위반 2건~~ ✅ DONE (2026-04-20, PR #15)
- **Result:** `TaskDetail.tsx`의 `useCallback` / `useRef`가 `if (!task) return null` 이른 종료 아래에서 호출되던 **진짜 버그** 확인. 두 훅을 early return 위로 이동, 콜백 바디에 `if (!task) return` 가드 추가, deps를 `task`로 업데이트.

### ~~[P2] `useButtonType` codemod (115 errors)~~ ✅ DONE (2026-04-20, PR #17)
- **Result:** JSX-aware 1회성 codemod(괄호 깊이 + 문자열 상태 추적)로 `type=` 없는 모든 `<button>` 태그에 `type="button"` 주입. 25 파일, 115 태그 패치. 프로젝트에 `<form>`·`onSubmit`이 전혀 없어 일괄 적용이 안전했음(grep 확인).

### ~~[P3] 나머지 정밀 정리 (~11 errors + 10 warnings)~~ ✅ DONE (2026-04-20, PR #16)
- **Result:** 10 파일에서 `noNonNullAssertion` 6, `noLabelWithoutControl` 4, `noSvgWithoutTitle` 1, `noArrayIndexKey` 6, `noUnusedVariables` 4 해소. 린트 에러 11 제거 + 워닝 10→0.

### [P2] 클릭 가능 div 접근성 수정 (~50 errors)
- **What:** `<div onClick>` 요소에 키보드 핸들러 + 적절한 ARIA 역할 추가
- **Why:** Biome의 `lint/a11y/useKeyWithClickEvents` (22) + `lint/a11y/noStaticElementInteractions` (28) — 키보드 사용자가 해당 UI를 조작할 수 없음
- **How:** 각 케이스별로 (a) `<button>`으로 변경 가능한지 판단, (b) 불가하면 `role="button"` + `tabIndex={0}` + `onKeyDown` Enter/Space 핸들러 추가. 최대 사용처: Sidebar.tsx(24), Settings.tsx(14), HabitTracker.tsx(12) — 자동화 위험, 파일별 수동 판단 필요
- **Added:** 2026-04-20 by /health follow-up

### Follow-up

- **LLM 다국어 출력 품질** — 2026-04-20 수동 테스트에서 llama3.2:latest 3B가 한국어 질문에 한국어/베트남어/중국어 섞어 응답하는 케이스 관찰. 기존 벤치마크에서 알려진 3B 모델 한계. 해결 옵션: (a) 더 큰 모델(llama3.1:8b) 전환, (b) OpenAI provider 사용, (c) 시스템 프롬프트에 "한국어로만 답하라" 강제 추가

### Baseline

- 린트 에러 178 → 50 (div 접근성만 남음)
- 위 [P2] 완료 시 대략 클린 상태 도달 예상

## AI 어시스턴트

> **제안서(로드맵 원본):** `docs/proposals/2026-07-27-local-ai-privacy.html` — 로컬 AI 프라이버시 티어별 계획.

### ✅ 완료 (2026-07-27 세션, 커밋 참조)
- 스트리밍 견고성: 유휴 타임아웃·연결 재시도·디코더 flush, 한국어 전용 프롬프트 강화 (`fa3f7f4`)
- 멀티턴 대화 메모리 (`31e959e`) / 풍부한 할일 컨텍스트 buildAiTaskContext (`7f9033a`)
- 채팅 메시지 → 할일 추가(안전 액션) (`54c7108`)
- 설치 모델 드롭다운 + "8B+ 권장" 안내 (`8dda9b4`) — [P3 한국어 안내] 상당부분 해소
- IME 조합 Enter 버그 수정 (`741458a`) / 채팅 자동 스크롤 (`8835aa8`)
- 속도: 모델 웜업+keep_alive·max_tokens (`135ff67`)
- 프라이버시: 온디바이스 배지·외부 전환 경고·로컬 전용 잠금(main 강제) (`77916e6`,`d93733d`)

### 🔜 남은 로컬-AI / 프라이버시 로드맵 (제안서 기준)
- **[중기] 원클릭 Ollama 온보딩** — 미설치 감지 → 설치 안내/딥링크 + 추천 모델 자동 `ollama pull` (한국어 8B급). 연결 실패 화면에서 유도.
- **[중기] 전송 데이터 미리보기** — 모델에 보내는 컨텍스트(`buildAiTaskContext` 결과)를 펼쳐보기로 노출(투명성).
- **[중기] 네트워크 인디케이터** — AI 호출 목적지 표시(localhost면 "로컬"). 이그레스 가시성.
- **[중기] 한국어 모델 큐레이션** — 모델 드롭다운에 한국어 품질 추천 배지 + EXAONE/EEVE 원클릭 설치.
- **[장기] 내장 런타임** — `node-llama-cpp` 등으로 Ollama 의존 제거(설치 0). 번들 크기↑.
- **[장기] 로컬 RAG/임베딩** — Ollama 임베딩으로 관련 할일만 검색해 컨텍스트 구성(전량 전송 대체).

### [P2] 채팅에서 '기존 할일' 액션 (완료/리스케줄/삭제) — 디자인 필요
- **What:** 현재 채팅 액션은 안전한 '추가'만 지원. "이거 완료 처리해줘 / 내일로 미뤄줘"처럼 기존 태스크를 바꾸는 액션은 파괴적이라 자동 실행하지 않음.
- **필요:** (a) 모델이 대상 태스크를 특정하는 구조화 응답(툴콜링), (b) 실행 전 확인 카드 UX, (c) 신뢰 가능한 모델(3B는 부적합). 실데이터 오조작 위험 때문에 확인 흐름 필수.
- **권장:** 큰 모델(gpt-oss:20b/8B+) 사용 시에만 노출, 확인 후 실행.
- **Added:** 2026-07-26 AI 개선

### [P3] 한국어 응답 품질 — 모델 큐레이션 (일부 해소)
- ~~Settings에 "8B+ 권장" 안내 + 설치 모델 드롭다운~~ ✅ 2026-07-27 (`8dda9b4`).
- **남은 것:** 감지 목록에서 한국어 특화 모델 추천 배지 / 원클릭 설치 (위 로드맵 참조).
- **배경:** llama3.2(3B)는 한국어에 영어/CJK/타이 혼입(실측). gpt-oss:20b는 깨끗.
- **Added:** 2026-07-26 AI 개선

### [P4] createTaskFromNL의 existingTasks 미사용
- **What:** `ai.createTaskFromNL(input, _existingTasks)`는 컨텍스트를 무시. 중복 감지/태그 제안 등에 활용 여지. (현재 store는 buildAiTaskContext 결과를 넘기지만 서비스가 버림 → payload만 소모.)
- **Added:** 2026-07-26 AI 개선

## UI/UX

> **참고 (2026-07-25):** 하단(bottom) 상세 패널 → **오른쪽(right) 폭 리사이즈 패널**(TickTick식)로 전환됨. 아래 "하단 상세 패널" 항목 중 폭/세로스택 관련은 재해석 필요.

### [P3] 우측 상세 패널 — 코드 품질 후속 (/simplify 발견, 일부 해소)
- ~~**TaskDetail 구독 최적화**~~ ✅ 2026-07-25: 무선택자 `useStore()` → 개별 셀렉터로 전환(액션은 안정 참조).
- ~~**마크다운 재파싱**~~ 무효: react-markdown 제거(Atomic 에디터 전환)로 소멸.
- ~~**기본 높이 이동**~~ 무효: 높이 state 제거(우측 패널은 폭 기반), `DEFAULT_DETAIL_WIDTH` 상수로 처리.
- **PickerRow 추출**: 알림/반복 토글 블록 ~26줄 near-identical → 로컬 `PickerRow` 컴포넌트로 dedup. (미해소)
- **DetailHeader 추출**: TaskDetail — 헤더/메타 서브컴포넌트 추출로 가독성. (미해소)

### ~~[P3] 드래그 MIME 상수 일원화~~ ✅ DONE (2026-07-27)
- **Result:** `src/renderer/src/utils/dnd.ts`에 `DND_MIME`(TASK_ID/TASK_BLOCK/CAL_DATE) 상수+타입 신설. 인라인 문자열 6개 파일(TaskItem, TaskList, TimeBlock, Daily/WeeklyCalendar, CalendarView) 전부 상수 참조로 치환. CalendarView의 로컬 `CAL_DATE_MIME` 별칭도 제거해 직접 참조로 통일. typecheck/lint/173 tests green.
- **Added:** 2026-07-25 월 캘린더 드래그 /review

### [P3] 배치 선택 vs 뷰 — 하위작업 제외 일원화
- **What:** `getFilteredTaskIds`(전체 선택)는 스마트/태그 리스트에서 뷰와 달리 `!parentId`를 일괄 적용하지 않음(태그 케이스만 맞춤). 뷰는 항상 최상위만 표시하므로 select-all도 항상 하위작업 제외하도록 통일하면 좋음(기존 리스트 동작 변경이라 별도 처리).
- **Added:** 2026-07-25 태그 뷰 /review

### ~~[P3] 우측 상세 패널 — AiChat 동시 오픈 시 폭 경합~~ ✅ DONE (2026-07-27)
- **Result:** `clampDetailWidth(px, windowWidth, aiChatOpen?)`에 3번째 인자 추가 — 챗 열림 시 `AI_CHAT_WIDTH(320)`을 상한에서 추가 예약. TaskDetail(읽기/드래그)과 store `setDetailPanelWidthPx`(persist)가 모두 `showAiChat`을 전달. 챗을 열면 상세 패널이 자동 축소돼 가운데 목록이 0으로 눌리지 않음. 인자 생략 시 기존 동작 유지(기본 false). 신규 테스트 2건 포함 175 tests green.
- **Added:** 2026-07-25 우측 패널 /review

### [P3] 노트 에디터 — 번들 감량 (코드 언어 축소)
- **What:** Atomic 라이브프리뷰 도입으로 lazy TaskDetail 청크가 563kB→~1,135kB. `@codemirror/lang-*` 13종이 상당 부분. `codeLanguages` prop으로 흔한 언어(js/ts/py/json/bash/css/html)만 로드하면 감량 가능.
- **Impact:** 온디맨드 lazy 청크라 메인 초기로드엔 영향 없음. 저위험 최적화.
- **Added:** 2026-07-24 노트 라이브프리뷰

### [P2] 하단 상세 패널 — 알림/반복 피커 드롭다운 클리핑
- **What:** ReminderPicker/RecurringPicker가 `absolute top-full` 드롭다운인데, 하단 패널의 짧은 좌측 컬럼(`overflow-y-auto`)에서 아래로 열리면 잘림. z-50로도 overflow 조상은 못 벗어남.
- **Fix 후보:** 포털 렌더 또는 `position: fixed`, 혹은 트리거가 컬럼 하단이면 위로(bottom-full) 열기. **라이브 QA로 검증 필요** (2026-07-24 code-review 발견, Mac 잠금으로 즉시 검증 불가).
- **Added:** 2026-07-24 bottom-detail /review

### [P2] 하단 상세 패널 — 좁은 폭 반응형 스택
- **What:** 하단 상세 패널의 2열 본문(하위작업+메타 | 메모)이 콘텐츠 폭이 좁을 때 답답함. 브레이크포인트를 두어 특정 폭 미만에서 세로 스택으로 전환.
- **Why:** 우선 2열로 출시하기로 결정(2026-07-24). 좁은 창/사이드패널 동시 오픈 시 가독성 개선을 위한 후속.
- **Design:** `docs/design/2026-07-24-bottom-task-detail-design.md` (Deferred follow-ups)
- **Added:** 2026-07-24, bottom-detail 디자인 세션
