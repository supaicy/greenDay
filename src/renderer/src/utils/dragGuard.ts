/**
 * 창 밖에서 들어온 드래그를 **삼킨다.**
 *
 * 브라우저 기본 동작은 "떨어뜨린 파일/URL로 그 창을 네비게이트한다"이고, Electron에서
 * 그것은 곧 새 문서가 `window.api`를 통째로 물려받는다는 뜻이다(`main/navigation-guard.ts`
 * 의 설명과 실측 참고). 메인 프로세스의 네비게이션 가드가 마지막 방어선이지만,
 * 애초에 드래그가 기본 동작까지 가지 않게 하는 것이 첫 번째 겹이다.
 *
 * **왜 요소마다 붙은 핸들러로는 부족한가.** 이 앱의 `onDragOver`/`onDrop`은 할일 목록·
 * 캘린더 셀·칸반 컬럼처럼 드롭을 받는 요소에만 붙어 있다. 사이드바·헤더·상세 패널·
 * 빈 공간에 떨어뜨리면 그 핸들러가 하나도 안 걸리고 기본 동작이 그대로 산다.
 *
 * **판정 기준은 "누가 처리했는가"가 아니라 "무엇이 실려 있는가"다.**
 * 한때 버블 단계에서 `defaultPrevented`를 보고 물러섰는데, 두 가지가 잘못됐다.
 *   1. 버블은 하위 요소의 `stopPropagation()` 한 번에 죽는다. React 17+는 합성 이벤트의
 *      `stopPropagation()`을 네이티브 이벤트에도 전달하므로, 드롭 대상 하나가 그렇게
 *      쓰기 시작하면 그날부터 창 전체가 다시 뚫린다.
 *   2. 그래서 캡처 단계로 옮겼는데, 캡처는 앱 핸들러보다 **먼저** 돌아서
 *      `defaultPrevented`가 항상 false다 — 그 판정 자체를 쓸 수 없다.
 *
 * 실린 것으로 가르면 순서에 기대지 않는다. 앱의 내부 드래그(할일·시간블록)는 `Files`도
 * `text/uri-list`도 싣지 않고, 네비게이션을 일으키는 바깥 드래그는 반드시 그 둘 중
 * 하나를 싣는다. 내부 드래그는 **아예 건드리지 않으므로** 앱의 드롭 동작이 그대로다.
 *
 * **전파는 막지 않는다.** `stopPropagation`을 걸면 이 리스너보다 아래에 붙은 것이 죽는다.
 * 여기서 하는 일은 기본 동작을 없애는 것 하나뿐이다.
 *
 * (나중에 "파일을 끌어다 첨부" 기능을 붙인다면, `dropEffect='none'`이 드래그를 취소해
 * `drop`이 발화하지 않는다는 점에 주의할 것 — 그 기능은 여기서 명시적으로 예외를
 * 만들어 통과시켜야 한다. 오늘 첨부는 파일 다이얼로그(`pick-attachment`)로만 들어온다.)
 */

/** `DragEvent` 중 이 가드가 실제로 쓰는 것만. 테스트가 가짜 이벤트를 만들 수 있게 좁게 잡는다. */
export interface GuardableDragEvent {
  preventDefault(): void
  dataTransfer: { dropEffect: string; types: readonly string[] } | null
}

/**
 * 창 밖에서 온 드래그인가 — 브라우저가 네비게이션을 일으킬 수 있는 것.
 *
 * `Files`는 HTML 명세가 파일이 실렸을 때 `types`에 넣도록 정한 이름이고,
 * `text/uri-list`는 브라우저·Finder에서 링크를 끌어올 때 실린다. 둘 다 떨어뜨리면
 * Chromium이 그 대상으로 창을 옮긴다.
 */
function carriesExternalPayload(dataTransfer: GuardableDragEvent['dataTransfer']): boolean {
  if (!dataTransfer) return false
  const types = Array.from(dataTransfer.types)
  return types.includes('Files') || types.includes('text/uri-list')
}

export function swallowUnhandledDrag(event: GuardableDragEvent): void {
  // 앱의 내부 드래그다 — 그대로 흘려보낸다.
  if (!carriesExternalPayload(event.dataTransfer)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
}

/**
 * `window`의 **캡처 단계**에 건다 — 이벤트 전파의 가장 처음이라, 아래 어디에서
 * `stopPropagation()`이 불려도 이 가드는 이미 지나간 뒤다.
 */
export function installDragGuard(target: Pick<Window, 'addEventListener'>): void {
  target.addEventListener('dragover', swallowUnhandledDrag, { capture: true })
  target.addEventListener('drop', swallowUnhandledDrag, { capture: true })
}
