/**
 * 앱이 받지 않은 드래그를 **삼킨다.**
 *
 * 브라우저 기본 동작은 "떨어뜨린 파일로 그 창을 네비게이트한다"이고, Electron에서
 * 그것은 곧 새 문서가 `window.api`를 통째로 물려받는다는 뜻이다(`main/navigation-guard.ts`
 * 의 설명과 실측 참고). 메인 프로세스의 네비게이션 가드가 마지막 방어선이지만,
 * 애초에 드래그가 기본 동작까지 가지 않게 하는 것이 첫 번째 겹이다.
 *
 * **왜 요소마다 붙은 핸들러로는 부족한가.** 이 앱의 `onDragOver`/`onDrop`은 할일 목록·
 * 캘린더 셀·칸반 컬럼처럼 **드롭을 받는 요소에만** 붙어 있다. 사이드바·헤더·상세 패널·
 * 빈 공간에 떨어뜨리면 그 핸들러가 하나도 안 걸리고 기본 동작이 그대로 산다.
 *
 * **왜 무조건 `preventDefault`가 아닌가.** `dragover`의 기본 동작을 취소하는 것은
 * "여기는 드롭 가능한 자리다"라는 뜻이라, 창 전체에 걸면 앱 어디에나 드롭 커서가 뜬다.
 * 그래서 **앱이 이미 처리한 이벤트는 건드리지 않고**(`defaultPrevented`), 아무도 받지
 * 않은 것만 취소하면서 `dropEffect = 'none'`으로 "여긴 못 놓는다"를 표시한다.
 * `dropEffect`가 `none`이면 HTML 명세상 `drop`이 발화하지 않고 드래그가 취소되므로,
 * 파일 네비게이션은 `drop`에 닿기도 전에 끝난다.
 *
 * **전파는 막지 않는다.** `stopPropagation`을 걸면 이 리스너보다 위에 붙은 것이 죽는다.
 * 여기서 하는 일은 기본 동작을 없애는 것 하나뿐이다.
 */

/** `DragEvent` 중 이 가드가 실제로 쓰는 것만. 테스트가 가짜 이벤트를 만들 수 있게 좁게 잡는다. */
export interface GuardableDragEvent {
  defaultPrevented: boolean
  preventDefault(): void
  dataTransfer: { dropEffect: string } | null
}

export function swallowUnhandledDrag(event: GuardableDragEvent): void {
  // 앱의 드롭 대상이 이미 받았다. 그쪽이 정한 `dropEffect`('move'/'copy')를 덮어쓰면
  // 드래그 중 커서가 "못 놓음"으로 바뀌어, 실제로는 되는 동작이 안 되는 것처럼 보인다.
  if (event.defaultPrevented) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
}

/**
 * `window`에 건다 — 버블 체인의 **마지막** 자리다.
 *
 * `document`에 걸면 그 아래 어딘가에서 `stopPropagation`이 한 번만 불려도 가드가
 * 통째로 사라진다. 오늘 이 앱의 드래그 핸들러는 전파를 막지 않지만, 그건 지켜지고
 * 있는 규칙이 아니라 그냥 현재 상태다.
 */
export function installDragGuard(target: Pick<Window, 'addEventListener'>): void {
  target.addEventListener('dragover', swallowUnhandledDrag)
  target.addEventListener('drop', swallowUnhandledDrag)
}
