# Greenday

macOS 데스크탑 할일 관리 앱 (Electron + React + Zustand)

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review

## 오버레이 규칙 (2026-08-15 전환, 되돌리지 말 것)

메뉴·다이얼로그·팝오버는 전부 **Radix(shadcn/ui)**다. `components/ui/`에 벤더링돼
있고 GreenDay 색을 CSS 변수로 매핑했다 — 디자인은 바뀌지 않았고 동작만 바뀌었다.
직접 `<div>`로 드롭다운을 새로 만들지 말 것. 남은 수제는 우클릭 컨텍스트 메뉴
2곳(TaskItem·TimeBlock)뿐 — TODOS 참고.

- **트리거는 호출처가 prop으로 준다.** 컴포넌트가 자기 버튼을 그리지 않는다.
  전에는 호출처가 `{show && <Menu/>}`로 mount하고 Menu가 버튼을 또 그려서
  두 번 눌러야 열렸다. `show*` 플래그로 오버레이를 감싸지 말 것 — Radix가
  열림 상태를 갖고, 닫을 때 트리거로 포커스를 돌려줘야 한다.
- **z 순서**: 오버레이 110 / 콘텐츠 111. 앱 요소가 90(UndoToast)·100(TaskItem
  컨텍스트 메뉴)을 쓰므로, 기본값 50이면 토스트가 모달 위에 뜬다.
- **Escape**: `useKeyboardShortcuts`가 `e.defaultPrevented`면 즉시 반환한다.
  Radix는 캡처 단계에서 먼저 닫고 preventDefault만 걸 뿐 전파를 막지 않는다.
  이 가드가 없으면 Escape 한 번이 오버레이와 선택을 함께 지운다.
- **Tailwind 클래스**: `cn()`(tailwind-merge)은 그룹이 다르면 중복 제거를
  못 한다. `w-*`는 `max-w-*`를 못 이기고, `rounded-lg`는 `sm:rounded-lg`를
  못 이긴다. 호출처 크기가 안 먹으면 기본 클래스에 죽은 지정이 있는지 볼 것.
- **스토어 구독**: selector 없는 `useStore()`는 모든 쓰기에 재렌더된다.
  `useStore((s) => s.x)`로 조각만 구독한다.

## Health Stack

- typecheck: tsc --build
- lint: biome lint src electron.vite.config.ts
- test: vitest run

컴포넌트 테스트는 파일 맨 위 `// @vitest-environment jsdom` 독블록으로 켠다
(`components/tasks/overlays.test.tsx` 참고). `vitest.config.ts`가 범위를 `src`로
못박는다 — 없으면 빌드 산출물 `out/`까지 훑어 같은 테스트가 두 번 세어진다.
