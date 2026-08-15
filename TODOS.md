# TODOS

## 트렁크 결정 (2026-08-15, 확정)

- **`supaicy/coordinate`가 트렁크다.** main은 4월에 갈라진 실험 가지로 동결.
  근거: `docs/reports/2026-08-07-todos-validity-audit.html`(main 워킹트리) — 공통 조상
  2026-04-20, coordinate 150 커밋 vs main 15 커밋, 병합 시 14파일 충돌 실측.
- **main의 shadcn/Radix 오버레이 전환 15커밋(`95a26d7`..`669de9f`)은 여기서 재작업한다.**
  병합보다 싸다. main의 커밋·CLAUDE.md 오버레이 규칙(트리거 prop, z 110/111,
  Escape `defaultPrevented` 가드)을 설계 지도로 쓴다. 아래 [P3] 모달 프리미티브와 같은 작업.
- main 한정 TODO 중 이쪽에서 유효한 것은 수제 드롭다운 2개(Sidebar/AddTask)뿐.
  main의 "렌더러 전용 패키지 4.2MB"는 대상 패키지가 CM6 전환으로 바뀌어 재측정 대상.

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

Biome 도입 후 남은 린트 위반. PR #12, #13으로 biome 설치 + 자동 수정 완료. 초기 178 errors 중 128건 해소(PR #15/#16/#17), 나머지 50건도 `06c9945`로 해소 — **현재 0 errors.**

### ~~[P1] `useHookAtTopLevel` 위반 2건~~ ✅ DONE (2026-04-20, PR #15)
- **Result:** `TaskDetail.tsx`의 `useCallback` / `useRef`가 `if (!task) return null` 이른 종료 아래에서 호출되던 **진짜 버그** 확인. 두 훅을 early return 위로 이동, 콜백 바디에 `if (!task) return` 가드 추가, deps를 `task`로 업데이트.

### ~~[P2] `useButtonType` codemod (115 errors)~~ ✅ DONE (2026-04-20, PR #17)
- **Result:** JSX-aware 1회성 codemod(괄호 깊이 + 문자열 상태 추적)로 `type=` 없는 모든 `<button>` 태그에 `type="button"` 주입. 25 파일, 115 태그 패치. 프로젝트에 `<form>`·`onSubmit`이 전혀 없어 일괄 적용이 안전했음(grep 확인).

### ~~[P3] 나머지 정밀 정리 (~11 errors + 10 warnings)~~ ✅ DONE (2026-04-20, PR #16)
- **Result:** 10 파일에서 `noNonNullAssertion` 6, `noLabelWithoutControl` 4, `noSvgWithoutTitle` 1, `noArrayIndexKey` 6, `noUnusedVariables` 4 해소. 린트 에러 11 제거 + 워닝 10→0.

### ~~[P2] 클릭 가능 div 접근성 수정 (~50 errors)~~ ✅ DONE (2026-07-21, `06c9945`)
- **Result:** `fix(a11y): keyboard support for clickable elements (biome green)` — 전 사용처에 `role`/`tabIndex`/`onKeyDown` 적용. 2026-08-15 실측 biome lint 0 errors(126 파일). 고쳐놓고 장부 표시를 안 해 방치돼 있던 것을 08-15 정리.

### Follow-up

- ~~**LLM 다국어 출력 품질**~~ ✅ 해소 (2026-07-27, `fa3f7f4`) — 해결 옵션 (c) 적용: `ai-service.ts`에 한국어 전용 강제절("respond ONLY in Korean… never mix in English words, Chinese, Japanese, Thai") 추가.

### Baseline

- 린트 에러 178 → 0 (2026-08-15 실측, typecheck 0 · vitest 478 green)

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
- ~~**[중기] 원클릭 Ollama 온보딩**~~ ✅ 2026-07-27 — 서버가 떠 있으면 HTTP `POST /api/pull`(NDJSON 진행률)로 CLI/PATH 없이 모델 설치. main `pullModel` + `parsePullProgress`(유휴 타임아웃, 9 tests), IPC `ai:pull-model`(+progress/done/error), preload/store 배관, 스토어 `aiPullModel` 액션(진행 상태·완료 시 목록 새로고침+실제 태그로 모델 자동 선택). Settings에 추천 모델 미설치 시 "한국어 모델 설치(exaone3.5)" 버튼 + 진행률 바. 서버 미연결이면 수동 안내 폴백. (라이브 QA 대기)
- ~~**[중기] 전송 데이터 미리보기**~~ ✅ 2026-07-27 — AI 패널 헤더 아래 접이식 "전송 데이터 미리보기 · N건" 디스클로저 추가. 스토어 전송 경로와 **동일한** `buildAiTaskContext(tasks)`를 useMemo로 계산해 노출(제목/마감/우선순위/태그) → 미리보기가 실제 전송값과 항상 일치. 렌더러 전용, 저위험. (라이브 QA 미검증 — Mac 잠금)
- ~~**[중기] 네트워크 인디케이터**~~ ✅ 2026-07-27 — `aiDestination(config)` 헬퍼(shared/ai-config.ts, 4 tests) 신설. AI 패널 배지에 실제 호출 목적지(host)를 노출: 외부 전송 시 "외부 · api.openai.com"처럼 host 인라인 표시, 로컬은 "온디바이스" + 툴팁에 "→ localhost". `hostnameOf` 추출로 URL 파싱을 `isLocalAiConfig`와 공유.
- **[중기] 한국어 모델 큐레이션** (배지 ✅ 2026-07-27 / 원클릭 설치 남음) — `utils/aiModels.ts`(isKoreanRecommendedModel/hasKoreanRecommendedModel, 4 tests) 신설. 설치 모델 드롭다운에서 EXAONE/EEVE 계열에 "· 한국어 추천" 라벨 표시. 추천 모델 미설치 시 모델 안내 문구에 `ollama pull exaone3.5` 안내 추가. **남은 것:** 앱 내 원클릭 pull(메인 프로세스 shell exec + 진행률 UI + QA 필요) → [원클릭 Ollama 온보딩]과 함께.
- **[장기] 내장 런타임** — `node-llama-cpp` 등으로 Ollama 의존 제거(설치 0). 번들 크기↑. → **제안서 작성됨(결정 대기)**: `docs/proposals/2026-07-27-embedded-runtime-and-local-rag.html` (번들 vs 다운로드/기본 모델/MAS 샌드박스/아키텍처/폴백 결정 필요). 무검증 구현 위험이 커 설계 단계로 둠.
- **[장기] 로컬 RAG/임베딩** — Ollama 임베딩으로 관련 할일만 검색해 컨텍스트 구성(전량 전송 대체). → **제안서 작성됨**: 위 HTML. **추천: v1 키워드 관련도(순수·저위험·즉시 구현 가능)부터 → v2 임베딩**. 승인 시 v1 착수.

### ~~[P2] 채팅에서 '기존 할일' 액션 (완료/리스케줄/삭제)~~ ✅ DONE (2026-07-27)
- **Result:** (a) main `interpretTaskAction`/`buildActionSystemPrompt`/`sanitizeActionResult` — 모델이 대상 태스크 제목+연산(complete/reschedule/delete/none)을 구조화 JSON으로 반환(`task_action` 액션 추가). (b) 렌더러 `resolveActionTarget`로 제목→실제 태스크 해석(정확→부분 매칭, 미완료·최상위만). (c) **확인 카드 UX**: 실행 전 반드시 사용자가 [확인]/[취소] — 삭제는 빨강. (d) `isCapableModel` 게이트 + `looksLikeTaskAction` 명령형 휴리스틱으로 소형 모델·일반 질문 오탐 차단. 실행은 기존 store 액션(toggle/update/remove=휴지통, 되돌리기 가능) 재사용. 신규 테스트 13건 포함 215 tests green.
- **미검증:** 라이브 QA(모델별 대상 식별 정확도). 안전은 확인 카드가 보장.
- **후속(소):** 액션 확인 메시지는 현재 디스크에 영속화 안 됨(재시작 시 소멸) — 필요 시 별도.
- **Added:** 2026-07-26 AI 개선

### [P3] 한국어 응답 품질 — 모델 큐레이션 (대부분 해소)
- ~~Settings에 "8B+ 권장" 안내 + 설치 모델 드롭다운~~ ✅ 2026-07-27 (`8dda9b4`).
- ~~감지 목록에서 한국어 특화 모델 추천 배지 + 추천 pull 안내~~ ✅ 2026-07-27 (utils/aiModels.ts).
- ~~**앱 내 원클릭 설치(ollama pull)**~~ ✅ 2026-07-27 — Settings "한국어 모델 설치" 버튼 + 진행률(위 원클릭 온보딩 참조).
- **배경:** llama3.2(3B)는 한국어에 영어/CJK/타이 혼입(실측). gpt-oss:20b는 깨끗.
- **Added:** 2026-07-26 AI 개선

### ~~[P4] createTaskFromNL의 existingTasks 미사용~~ ✅ DONE (2026-07-27)
- **Result:** `existingTasks`에서 `taskTagVocabulary`(중복 없는 태그 어휘, 최대 30)를 뽑아 `buildTaskSystemPrompt`가 태스크 생성 프롬프트에 "기존 태그 재사용" 힌트로 주입. 모델이 새 태그를 남발하지 않고 사용자 태그 어휘를 재사용하도록 유도. 출력 스키마/검증(sanitizeTaskResult)은 불변이라 저위험. 신규 테스트 7건(헬퍼 + fetch 바디에 태그 힌트 포함 확인) 포함 185 tests green.
- **남은 여지:** 중복 감지(동일 제목 경고)는 확인 UX가 필요해 별도 — [P2 기존 할일 액션]과 함께 다룰 사안.
- **Added:** 2026-07-26 AI 개선

## UI/UX

> **참고 (2026-07-25):** 하단(bottom) 상세 패널 → **오른쪽(right) 폭 리사이즈 패널**(TickTick식)로 전환됨. 아래 "하단 상세 패널" 항목 중 폭/세로스택 관련은 재해석 필요.

### [P3] 우측 상세 패널 — 코드 품질 후속 (/simplify 발견, 일부 해소)
- ~~**TaskDetail 구독 최적화**~~ ✅ 2026-07-25: 무선택자 `useStore()` → 개별 셀렉터로 전환(액션은 안정 참조).
- ~~**마크다운 재파싱**~~ 무효: react-markdown 제거(Atomic 에디터 전환)로 소멸.
- ~~**기본 높이 이동**~~ 무효: 높이 state 제거(우측 패널은 폭 기반), `DEFAULT_DETAIL_WIDTH` 상수로 처리.
- ~~**PickerRow 추출**~~ ✅ 2026-07-27: 알림/반복 토글의 트리거+조건부 드롭다운 구조를 로컬 `PickerRow`로 dedup(피커는 children). ~26줄 중복 제거, 동작 불변(typecheck/build/215 tests green).
- **DetailHeader 추출**: ❌ 보류(의도적) — 헤더 추출은 task/title/setTitle/save/toggle/remove/selectTask/priorityColor 등 8개+ prop 드릴링이 필요해 가독성 이득보다 비용·회귀위험이 큼. PickerRow dedup으로 파일 길이는 이미 개선.

### ~~[P3] 드래그 MIME 상수 일원화~~ ✅ DONE (2026-07-27)
- **Result:** `src/renderer/src/utils/dnd.ts`에 `DND_MIME`(TASK_ID/TASK_BLOCK/CAL_DATE) 상수+타입 신설. 인라인 문자열 6개 파일(TaskItem, TaskList, TimeBlock, Daily/WeeklyCalendar, CalendarView) 전부 상수 참조로 치환. CalendarView의 로컬 `CAL_DATE_MIME` 별칭도 제거해 직접 참조로 통일. typecheck/lint/173 tests green.
- **Added:** 2026-07-25 월 캘린더 드래그 /review

### ~~[P3] 배치 선택 vs 뷰 — 하위작업 제외 일원화~~ ✅ DONE (2026-07-27)
- **Result:** `getFilteredTaskIds`를 `useStore.ts`에서 순수 유틸 `utils/filteredTaskIds.ts`로 추출하고, 모든 브랜치(all/completed/실제 리스트/스마트/태그)에 `!parentId` 최상위 프리필터를 일원 적용. 이제 '전체 선택'이 뷰(TaskList: 항상 `!parentId`)와 정확히 일치. 신규 테스트 4건 포함 189 tests green. (동작 변경: 실제 리스트/스마트/all/completed에서 하위작업이 더 이상 select-all에 포함되지 않음 — 의도된 통일.)
- **Added:** 2026-07-25 태그 뷰 /review

### ~~[P3] 우측 상세 패널 — AiChat 동시 오픈 시 폭 경합~~ ✅ DONE (2026-07-27)
- **Result:** `clampDetailWidth(px, windowWidth, aiChatOpen?)`에 3번째 인자 추가 — 챗 열림 시 `AI_CHAT_WIDTH(320)`을 상한에서 추가 예약. TaskDetail(읽기/드래그)과 store `setDetailPanelWidthPx`(persist)가 모두 `showAiChat`을 전달. 챗을 열면 상세 패널이 자동 축소돼 가운데 목록이 0으로 눌리지 않음. 인자 생략 시 기존 동작 유지(기본 false). 신규 테스트 2건 포함 175 tests green.
- **Added:** 2026-07-25 우측 패널 /review

### ~~[P3] 노트 에디터 — 번들 감량 (코드 언어 축소)~~ ❌ 무효 (2026-07-27, 측정 결과 전제 오류)
- **측정:** `npm run build` 후 TaskDetail lazy 청크(1,135kB)를 grep한 결과 `@codemirror/lang-*` 중 **`lang-markdown`만** 포함(에디터 필수 문법). 나머지 13종은 청크에 없음.
- **원인:** `AtomicCodeMirrorEditor`의 `codeLanguages`는 기본값 `[]`이고, 우리 코드는 이 prop이나 `ATOMIC_CODE_LANGUAGES`를 넘기지 않아 13종이 트리셰이크로 이미 빠져 있음. 코드 펜스는 plain monospace로 렌더.
- **결론:** 감량할 lang 번들이 애초에 없음 → `codeLanguages` 축소는 no-op. 오히려 큐레이션 리스트를 넘기면 문법이 lazy로 **추가**됨. 1,135kB의 본체는 CodeMirror 코어 + Atomic 에디터로, 이미 lazy 청크라 초기 로드 무영향.
- **후속(선택):** 펜스 하이라이트가 필요하면 흔한 언어만 담은 `codeLanguages`를 **추가**하는 기능(감량 아님) — 별도 판단.
- **Added:** 2026-07-24 노트 라이브프리뷰

### ~~[P2] 하단 상세 패널 — 알림/반복 피커 드롭다운 클리핑~~ 🔄 대체로 소멸 (2026-07-27, 우측 패널 재해석)
- **재검토:** 우측 패널에서 메타 영역(TaskDetail.tsx:235)은 `flex flex-wrap` 헤더로, 패널 루트까지 `overflow-y-auto`/`overflow-hidden` 조상이 없다(스크롤 영역은 하위작업·첨부 본문 line 405뿐). 따라서 "짧은 overflow 컬럼에서 아래로 열려 잘림"이라는 **원래 클리핑 조건이 소멸**. 드롭다운은 메모 영역 위로 자유롭게 펼쳐짐.
- **남은 미세 엣지:** 창 높이가 매우 낮을 때 드롭다운이 패널 하단을 넘을 수 있음(별개 사안) — 필요 시 라이브 QA. Mac 잠금으로 즉시 검증 불가.
- **Added:** 2026-07-24 bottom-detail /review

### ~~[P2] 하단 상세 패널 — 좁은 폭 반응형 스택~~ ❌ 무효 (2026-07-27, 우측 패널 전환으로 소멸)
- **재검토:** 우측 패널 본문은 이미 단일 세로 컬럼(메모 히어로 flex-1 + 하위작업·첨부 스택, TaskDetail.tsx:393-412)이라 "2열 본문"이 존재하지 않음. 브레이크포인트 세로 스택 전환 대상 자체가 없음. 폭은 리사이즈 핸들로 조절.
- **Design:** `docs/design/2026-07-24-bottom-task-detail-design.md` (Deferred follow-ups)
- **Added:** 2026-07-24, bottom-detail 디자인 세션

### [P2] Tailwind gray 팔레트를 중립 계열로 전면 교체
- **What:** 프로젝트 전역 `gray-*` 토큰을 Apple 시스템 그레이(중립) 계열로 교체.
- **Why:** 앱 표면은 채도 1~3%의 중립 그레이(`#1C1C1E` 캔버스 / `#2C2C2E` 사이드바·모달)인데, Tailwind 기본 `gray`는 채도 28~39%의 한랭 계열이다. 큰 면에서 맞붙으면 한쪽만 붕 뜬다. 2026-07-29 상세 패널이 정확히 그 사례였다 — `bg-gray-900`(#111827, 채도 39%, 파랑 편향 +22)이 옆 리스트(#1C1C1E, 채도 3%, 편향 +2)와 색 계열이 달라 이질적으로 보였다.
- **Pros:** `tailwind.config.js`에서 `colors.gray`만 재정의하면 한 곳에서 전부 바뀐다. 나중에 테마 CSS 변수를 추출할 때 방향이 같다.
- **Cons:** 2026-07-29 설정 화면에서 실측한 대비율(힌트 5.49:1 / 라벨 9.46:1 / 제목 11.26:1 등)이 전부 바뀌므로 재검증이 필요하다.
- **Context:** 같은 혼용이 15개 컴포넌트에 남아 있다 — calendar/{CalendarView,TimeBlock,WeeklyCalendar}, eisenhower, habits, kanban, pomodoro, stats, timeline, tasks/{AddTask,SubtaskList,TaskItem,TaskList,TrashView}. 상세 패널(TaskDetail)만 `surface-*` 토큰으로 이미 전환됨(커밋 `4329ece`). 대비 측정 방법은 `docs/reports/2026-07-29-settings-design-review.html`의 "검증 방법" 참조.
- **Depends on / blocked by:** 없음. 동기화 계획과 독립. 다만 **동기화 재작성과 같은 브랜치에서 돌리지 말 것** — 뭔가 깨졌을 때 원인 분리가 어려워진다.
- **Added:** 2026-07-29, /plan-eng-review (동기화 설계 리뷰 중 발견)

## 미검증 항목 (2026-08-05 전수 검증)

> **대장:** `docs/reports/2026-08-05-unverified-items.html` — 준비물·검증 절차 포함.
> **전체 결과:** `docs/reports/2026-08-05-feature-inventory.html`

전수 검증에서 끝까지 확인하지 못한 5가지. 코드 의심이 아니라 **외부 자격증명·다른 빌드 구성이 없어서** 막힌 것들이다.

### [U-1] Google 캘린더 동기화 왕복 — 차단
- **막힌 이유:** 빌드에 OAuth 클라이언트 ID 없음(`__GOOGLE_CLIENT_ID__` / `GOOGLE_OAUTH_CLIENT_ID` 둘 다 빈 값) → 화면에 "이 빌드에는 Google 연동이 설정되어 있지 않습니다"
- **준비물:** Google Cloud Console 데스크톱 앱 OAuth 클라이언트 ID. 리디렉션에 **번들 ID `com.supaicy.haru`** 등록(앱 이름 Greenday와 다름 — 실수 지점)
- **이미 확인됨:** PKCE·토큰 갱신/폐기·캘린더 필터·동기화 계획 로직 유닛테스트 통과

### [U-2] 커스텀 스킴 딥링크 복귀 — 차단 (U-1 종속)
- **막힌 이유:** Google OAuth 콜백 전용 경로
- **확인할 것:** 브라우저 동의 후 앱 창이 앞으로 나오고 최소화 시 복원되는지. `is.dev` 분기 때문에 **개발/패키징 양쪽** 확인 필요

### [U-3] CalDAV(iCloud) 동기화 왕복 — 보류
- **막힌 이유:** Apple ID + 앱 전용 암호 필요
- **이미 확인됨:** 프로토콜 4개 모듈 유닛테스트 통과, 비밀번호 safeStorage 암호화 + 렌더러 미노출 코드 확인
- **확인할 것:** 생성/수정(중복 아님)/삭제 반영, 캘린더 변경 시 동기화 상태 초기화, 연동 해제 시 서버 일정 보존

### [U-4] 자동 업데이트 "새 버전 있음" 경로 — 보류
- **막힌 이유:** GitHub 최신 릴리스 v1.4.1 < 로컬 v2.0.1 → 업데이트 감지 자체가 불가
- **확인할 것:** 2.0.1보다 높은 릴리스 발행 후 감지 → 진행률 → 재시작 설치

### [U-5] MAS(App Store) 빌드 분기 — 보류
- **막힌 이유:** dev·패키징 모두 `process.mas === false`
- **확인할 것:** ① 설정에 "App Store를 통해 업데이트" ② 전역 단축키 no-op(앱 외부 Cmd+Shift+A가 **안 먹는 게 정상**) ③ 업데이트 IPC no-op

### 별건 — 미검증이 아니라 기능 부재
- **라이선스 검증:** `src/shared/license/`에 서명 검증 코어 + 테스트가 있으나 **어디에서도 import되지 않음.** 현재 빌드에 라이선스 게이트가 없다. 유료화 구조 확정 후 배선 → 그때 검증 대상.

## 가격 정책 — 확정 (2026-08-06)

> **근거 문서:** `docs/reports/2026-08-06-pricing-structure.html`
> **설계 문서:** `~/.gstack/projects/supaicy-haru/supermicrosoft-supaicy-coordinate-design-20260806-pricing.md`

**확정: 플랫폼별 일회성. 기능 차등 없음.**

```
Mac      ₩19,000  일회성   ┐  기능 전부 동일
Windows  ₩19,000  일회성   ├─ iCloud + Google 동기화 모두 포함
iOS      ₩12,000  일회성   ┘  잠긴 기능 0개 · IAP 0개
```

- **Google 동기화를 유료 애드온으로 자르지 않는다.** 원가가 0원이고(자체 서버 없음 —
  `calendar-config.ts:31`, `google/oauth.ts:16`, `google/calendar.ts:11` 전부 제공자 직결),
  App Store에서 잠금 해제를 팔려면 IAP·영수증 검증·잠금 UI가 강제되며,
  사용자 요청 2위가 정확히 "다양한 캘린더 연동"이다.
- **판매 문구로 쓴다:** "iCloud와 Google 캘린더 모두 지원, 추가 결제 없음" —
  TickTick(연 7~8만원 구독) 대비 현재 가진 유일한 가격 무기.
- **순서:** 지금은 App Store에 집중. Windows는 맥 출시 이후 판단.

### 실측 정정 — 다운로드 118건 (5,742 아님)

2026-08-03 가격 제안서의 "5,742명"은 릴리스 **전체 에셋** 합계였고 대부분이
`latest-mac.yml`(자동 업데이터 폴링 파일)이었다. 실제 설치파일(.dmg+.zip)은 **118건**(5개월).
`homebrew-haru` cask가 같은 GitHub 릴리스 asset을 가리키므로 `brew install`도 이미 포함.
스타 2 · 포크 2 · 이슈 0 · 최근 14일 방문 고유 21명 · 유입은 clien.net 100%.

**목표(월 300~1,000만원)까지 140~460배.** 요금제로는 닿지 않는다 — 유입 문제다.

### 이 결정으로 필요 없어진 작업
- IAP 영수증 검증 / 기능 잠금 게이트 / 업그레이드 유도 화면
- 라이선스 등급 구분(평생 vs 평생+Google)
- 직접판매 활성화 서버 — Windows를 Microsoft Store로 내면 당분간 불필요
  (개인정보처리방침의 "개발자가 운영하는 서버가 없습니다"를 지킬 수 있음)

### 배포 채널 — 확정 (2026-08-06 /plan-eng-review)

- **Windows는 웹사이트 직접 판매.** Microsoft Store 안 함 → `process.windowsStore` 분기 불필요.
- **라이선스는 오프라인 서명 키만.** 활성화 서버 없음. `src/shared/license/`의 검증 코어(테스트 29개)를
  앱에 배선하기만 한다. 공유 억제는 **구매자 이름 각인**(Sublime Text 방식).
  서버는 복제가 실제로 보일 때 얹는다 — 오프라인 키가 온라인 활성화의 **토대**라 버리는 작업이 0이다.
  덕분에 개인정보처리방침의 "개발자가 운영하는 서버가 없습니다"를 그대로 유지한다.
- **빌드는 자체 정적 호스팅.** `electron-builder.yml`의 `publish: provider: github`를 그대로 두면
  유료 Windows 빌드가 공개 저장소 릴리스에 올라가 결정 ⑨와 충돌한다.
  → Cloudflare R2/Pages + electron-updater `generic` provider. 정적 파일이라 서버 로직 0.

### [P1] Windows 이식 — 코드는 싸지만 "8줄"은 오도였다

> **정정:** 2026-08-06 오전에 기록한 "main의 macOS 전용 코드 8줄"은 줄 수는 맞지만 오도다.
> 그중 `index.ts:150`의 `app.on('open-url')` 한 줄은 **Windows에서 메커니즘 전체가 없다**는 뜻이다.

- **좋은 소식:** 네이티브 모듈이 0개다. deps에 sqlite/keytar 계열이 없고 저장은 순수 JSON
  `writeFileSync`(`database.ts:77`). `fsevents`는 vite의 optional dev 의존성뿐.
  **Electron Windows 이식에서 보통 제일 비싼 node-gyp 리빌드가 이 프로젝트엔 아예 없다.**
  `safeStorage`(DPAPI)·`globalShortcut`·`Notification` 전부 Windows 지원.
  `setAppUserModelId`(`index.ts:56`)도 이미 호출돼 있다.
- **나쁜 소식:** Windows는 `open-url`을 영원히 발화하지 않는다. 프로토콜 콜백은 **두 번째 인스턴스의
  argv**로 온다. `requestSingleInstanceLock`·`second-instance`·`process.argv` 전부 grep 0건.
  고치지 않으면 Windows에서 Google 로그인이 5분 뒤 "로그인 시간이 초과되었습니다"로 끝난다
  (`google-auth-flow.ts:21` 타임아웃). 판매 문구 "iCloud와 Google 모두 지원"이 거짓이 된다.

### [P1] Windows 착수 시 준비물 — 체크리스트

착수 기준: **맥 판매 첫 10건, 또는 Windows 선구매 의사 5명** 중 하나.
아래는 리드타임이 있어 결심 시점에 알면 이미 늦는 것들이다.

- [ ] **MoR 결제 처리자** — Paddle 또는 Lemon Squeezy. 대리 판매자가 되어 EU VAT·세금을 대신
      처리하고 구매자 정보도 그쪽이 보관한다(→ 개인정보 보관 주체가 되지 않는다). 심사 리드타임 있음.
- [ ] **Windows 코드 서명 인증서** — 없으면 SmartScreen이 막아 배포 자체가 무의미하다.
      작년 Gatekeeper와 같은 상황(학습 `haru-release-needs-tag-and-certs`).
      EV(연 30~50만원) vs Azure Trusted Signing(월 1만원대) — 후자의 자격 요건 확인 필요.
- [ ] **정적 호스팅** — Cloudflare R2/Pages 무료 티어. `generic` provider용 업데이트 피드.
- [ ] **`electron-builder.yml`에 `win:` + `nsis:` 블록** — 지금 아예 없다.
- [ ] **Windows CI 러너** — `release.yml:10`이 `runs-on: macos-latest`이고 `:72`가 `--mac`만 돈다.
      NSIS는 Windows 러너가 필요하다(맥 크로스빌드는 wine 의존이라 불안정).
- [ ] **`mas-preflight.sh` → `build-preflight.sh` 일반화** — 지금은 `appId` ↔ `mac.protocols[].schemes`
      ↔ `app-id.ts`만 대조한다(`:146-155`). Windows는 **네 번째 자리**(`win.protocols` / NSIS 레지스트리)를
      더하는데 검사가 없다. 어긋나면 `app-id.ts` 주석이 경고하는 그대로 조용히 깨진다.
- [ ] **라이선스 키 입력 UI 배선** — Windows 빌드에만. macOS/MAS에 노출되면 Apple 3.1.1 리젝.

### [P1] Windows 실기 확인 — 자동 테스트로 못 덮는 것

> 전체 목록: `~/.gstack/projects/supaicy-haru/supermicrosoft-supaicy-coordinate-eng-review-test-plan-20260806.md`

- [ ] **리마인더 토스트가 실제로 뜨는가** — `setAppUserModelId`(`index.ts:56`)의 값과 NSIS 바로가기의
      AUMID가 일치해야 뜬다. **어긋나면 에러 없이 조용히 안 뜬다.**
      이 리뷰에서 유일하게 남은 **critical gap**이고, 리마인더는 이 앱의 핵심 기능이다.
- [ ] **타이틀바 이중 드래그** — `titleBarStyle: 'hiddenInset'` + `trafficLightPosition`(`index.ts:22-23`)은
      Windows에서 무시돼 표준 프레임이 생기는데, `Sidebar.tsx:263`에 커스텀 `WebkitAppRegion: 'drag'`가
      있어 드래그 영역이 이중이 되고 사이드바 상단 여백이 뜬다. → 디자인 결정 필요.
- [ ] **SmartScreen** — 서명 없이 배포하면 실행 자체가 막힌다.
- [ ] **`safeStorage`(DPAPI)** — `available()` 가드(`database.ts:445-450`)가 false면 평문 폴백이므로 확인.
- [ ] **스킴 대소문자** — `isAppScheme`는 `startsWith`라 대소문자를 구분하는데
      Windows 레지스트리는 스킴을 소문자로 정규화한다.

### 후속 판단이 필요한 것
- **Windows 이식 실비용은 코드가 아니라 인증서·QA·지원이다.** 위 체크리스트 참조.

## /review 후속 (2026-08-05) — 의도적으로 미룬 항목

전수 검증 → 수정 → /simplify → /review 사이클에서 **확인했지만 이번 범위 밖으로 둔 것들.**
전부 리뷰 근거가 남아 있고, 다음에 손댈 때 바로 착수할 수 있다.

### [P2] 반복 할일과 시간블록의 의미가 정의돼 있지 않음
- **증상:** '배정 안 됨' 레일에서 **반복** 할일을 특정 날짜에 끌어다 놓으면, `getScheduledForOccurrence`가 날짜 부분을 버리고 시각만 템플릿으로 쓰기 때문에 **매일(그리고 앞으로 영원히) 같은 시간에 블록이 뜬다.** 주간 뷰면 7일 전부.
- **왜 지금 드러났나:** 레일이 생기기 전에는 시간블록을 만들 진입점 자체가 없어 잠복 상태였다.
- **제품 결정 (2026-08-15, 확정):** **둘 다.** 기본은 (a) — 드롭한 시각이 시리즈의 템플릿이 되되 블록은 **실제 반복 발생일에만** 표시한다(지금처럼 비발생일에도 매일 뜨는 건 버그로 수정). 추가로 (b) — 특정 회차만 시각을 다르게 잡는 **회차별 오버라이드**를 지원한다(오버라이드가 있으면 그날은 템플릿 대신 오버라이드).
- **위치:** `utils/scheduledTime.ts:42-55`, `WeeklyCalendar.tsx:123`, `DailyCalendar.tsx:90`

### [P2] batchComplete가 반복 시리즈를 조용히 끝낸다
- **증상:** `toggleTask`는 완료 시 다음 인스턴스를 만들지만 `batchComplete`는 만들지 않는다. 일괄 완료로 반복 할일을 끝내면 시리즈가 거기서 멈춘다.
- **이번에 안 고친 이유:** 완료 전이(점수 + 반복 생성)를 한 헬퍼로 묶는 리팩터가 필요하고, 점수 부분만 이번에 정렬했다.
- **위치:** `useStore.ts` `toggleTask` vs `batchComplete`

### [P3] 모달 프리미티브가 없다
- ConfirmDialog / Settings / QuickAdd가 배경·Esc·aria를 각자 구현한다. 포커스 트랩·복원·스크롤 잠금을 추가하면 세 곳을 따로 고쳐야 한다.
- **다음 단계:** `useEscapeKey` + `ModalShell` 추출 후 셋 다 이관.

### [P3] 주/일 캘린더의 드롭 핸들러 중복
- ~40줄 `onDrop`이 두 파일에 사실상 같은 코드로 존재(시작 시각 상수와 날짜 변수만 다름). `toLocalIsoMinute` 공유는 이번에 했지만 핸들러 본문은 남았다.
- **다음 단계:** `resolveTimeBlockDrop(e, { dayStr, startHour, pxPerMin, tasks })`로 추출 → `scheduledTime.test.ts`에서 스냅/클램프 검증 가능해짐.

### [P3] '오늘'이 자정을 넘겨도 갱신되지 않는다
- 여러 화면이 `useMemo(() => toDateString(new Date()), [])`로 오늘 날짜를 마운트 시점에 고정한다. 아이젠하워는 이번에 tasks 의존으로 바꿔 완화했지만, **KanbanView는 그 값을 쓰기까지 한다**(`dueDate: todayStr`) — 자정을 넘긴 창에서 카드를 '진행 중'으로 옮기면 어제 날짜가 박힌다.
- **다음 단계:** 다음 로컬 자정에 타임아웃을 걸어 리렌더하는 `useToday()` 훅 하나로 통일.

### [P3] 메인 스토어를 셀렉터 없이 구독하는 컴포넌트가 다수
- `const {...} = useStore()` 형태가 10곳 이상. AI 채팅은 토큰마다 스토어를 쓰므로(초당 30~100회) 스트리밍 중에는 사이드바·현재 뷰가 통째로 재조정된다. 포모도로 1Hz 경로는 이번에 분리했지만 이쪽은 남았다.
- **다음 단계:** Sidebar·WeeklyCalendar·DailyCalendar·Kanban·Timeline·Eisenhower·StatsView·TaskList을 개별 셀렉터로.
