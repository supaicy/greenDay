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
직접 `<div>`로 드롭다운을 새로 만들지 말 것. 우클릭 메뉴도 Radix다
(`ui/context-menu.tsx` + `tasks/TaskContextMenu.tsx`) — TaskItem과 캘린더
TimeBlock이 같은 것을 쓴다. 항목은 `TaskActionItems.tsx` 한 곳에 있고 ⋯ 메뉴와
공유한다: 한쪽만 고치면 같은 할일에 대해 메뉴마다 다른 말을 한다.

- **트리거는 호출처가 prop으로 준다.** 컴포넌트가 자기 버튼을 그리지 않는다.
  전에는 호출처가 `{show && <Menu/>}`로 mount하고 Menu가 버튼을 또 그려서
  두 번 눌러야 열렸다. `show*` 플래그로 오버레이를 감싸지 말 것 — Radix가
  열림 상태를 갖고, 닫을 때 트리거로 포커스를 돌려줘야 한다.
- **z 순서**: 오버레이 110 / 콘텐츠 111. 앱 요소가 90(UndoToast)을 쓰므로,
  기본값 50이면 토스트가 모달 위에 뜬다. 컨텍스트 메뉴도 같은 111을 쓴다.
- **`{...props}`는 `onClick`보다 먼저 펼칠 것.** 뒤에 두면 호출처가 `onClick`을
  주는 순간 프리미티브의 전파 차단이 통째로 덮여 조용히 사라진다.
- **Escape**: `useKeyboardShortcuts`가 `e.defaultPrevented`면 즉시 반환한다.
  Radix는 캡처 단계에서 먼저 닫고 preventDefault만 걸 뿐 전파를 막지 않는다.
  이 가드가 없으면 Escape 한 번이 오버레이와 선택을 함께 지운다.
- **Tailwind 클래스**: `cn()`(tailwind-merge)은 그룹이 다르면 중복 제거를
  못 한다. `w-*`는 `max-w-*`를 못 이기고, `rounded-lg`는 `sm:rounded-lg`를
  못 이긴다. 호출처 크기가 안 먹으면 기본 클래스에 죽은 지정이 있는지 볼 것.
- **스토어 구독**: selector 없는 `useStore()`는 모든 쓰기에 재렌더된다.
  `useStore((s) => s.x)`로 조각만 구독한다.

## 라이선스 (2026-08-18)

`src/main/licensing/` — 서버는 `pay.begreen.dev`(BicMac과 같은 워커). 앱은 활성화와
30일 재검증 때만 서버를 부르고, 그 사이 판정은 전부 로컬에서 서명으로 한다.

- **`IS_ENFORCED = false`로 출하한다** (`licensing/service.ts`). 켜기 전에 서버
  배포와 실거래 활성화를 확인할 것. 꺼져 있는 동안은 아무것도 잠기지 않고
  트라이얼 시작일도 **기록되지 않는다** — 켜는 날 모두가 온전한 30일을 받아야 한다.
- **`greenday` slug와 `GREENDAY-` 접두사는 출시 후 못 바꾼다.** 토큰의 `prod`
  클레임과 발급된 모든 키가 여기 묶인다. 워커 시크릿 하나가 모든 제품에 서명하므로
  **`prod` 검사가 제품 격리의 전부다** — 지우면 BicMac 키로 haru가 열린다.
- **권한은 서명 검증을 통과한 페이로드에서만 나온다.** `license.json`의 어떤 값도
  권한을 만들지 못한다. 유예 마감은 토큰의 `exp + 30일`이지, 앱이 적어둔
  타임스탬프가 아니다.
- **거부와 불통을 뭉치지 말 것.** 409와 JSON 봉투가 있는 404만 라이선스를 닫는다.
  Cloudflare의 HTML 404·타임아웃·봉투 없는 400은 닫지 않는다 — 워커 배포 사고
  한 번에 유료 사용자 전원이 라이선스를 잃는다.
- **키와 토큰은 렌더러로 내려보내지 않는다.** IPC는 `shared/license.ts`의
  `PublicLicenseState`만 넘긴다(상태·마감·가린 키).
- **키 입력 UI는 `capabilities.needsLicenseKey`로만 그린다.** 스토어 빌드에 남으면
  Apple 3.1.1(외부 결제 유도)로 심사에서 거절된다.
- 게이트는 `licensing/LicenseGate.tsx` **한 곳**이다(무료 티어 없음). 잠긴
  화면에서도 내보내기가 눌린다 — 데이터를 인질로 잡지 않는다.

## Health Stack

- typecheck: tsc --build
- lint: biome lint src electron.vite.config.ts
- test: vitest run

컴포넌트 테스트는 파일 맨 위 `// @vitest-environment jsdom` 독블록으로 켠다
(`components/tasks/overlays.test.tsx` 참고). `vitest.config.ts`가 범위를 `src`로
못박는다 — 없으면 빌드 산출물 `out/`까지 훑어 같은 테스트가 두 번 세어진다.
