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

## UI/UX

### [P3] 하단 상세 패널 — 코드 품질 후속 (/simplify 2026-07-24 발견, 보류)
- **TaskDetail 구독 최적화**: `const {…} = useStore()` 무선택자 구독이라 아무 store 쓰기에도 리렌더. `useShallow` 선택자로 전환(액션은 안정 참조라 분리). 리렌더 급감. (기존 패턴, 리팩터가 toggleTask 추가하며 유지)
- **마크다운 재파싱**: preview에서 매 렌더 `<Markdown>` 재파싱 — `components` 객체를 `useMemo([toggleCheckbox])`로 고정(input 렌더러 타입 마찰 주의). REMARK_PLUGINS는 이미 호이스트됨.
- **PickerRow 추출**: 알림/반복 토글 블록 ~26줄 near-identical → 로컬 `PickerRow` 컴포넌트로 dedup.
- **DetailHeader 추출**: TaskDetail 470줄 — 헤더(~95줄) 서브컴포넌트 추출로 가독성.
- **기본 높이 이동**: `window.innerHeight*0.72` 인라인 기본값을 `store/detailHeight.ts`의 `defaultDetailHeight(contentHeight)`로 이동, store에서 null→기본 해소. Stage 3(드래그+contentHeight)에서 함께 처리 예정.

### [P3] 하단 상세 패널 — 드래그 리스너 언마운트 정리
- **What:** TaskDetail의 그립 드래그가 mousedown에서 window mousemove/mouseup를 붙이고 mouseup에서 떼는데, 드래그 도중 패널이 언마운트(selectTask(null) 등)되면 리스너가 남음.
- **Impact:** React18에서 언마운트 후 setState는 무해(no-op)하고 다음 mouseup에서 정리되지만, 견고성을 위해 useEffect cleanup으로 unmount 시 리스너 해제 권장.
- **Added:** 2026-07-24 Stage 3 /review

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
