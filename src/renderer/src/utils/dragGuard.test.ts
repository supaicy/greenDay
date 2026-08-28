// @vitest-environment jsdom

/**
 * C2 회귀(렌더러 절반) — 앱이 받지 않은 드롭이 기본 동작(파일로 네비게이트)까지 가면
 * 그 문서가 `window.api`를 물려받는다.
 *
 * jsdom에는 `DataTransfer`가 없어서 진짜 `DragEvent`를 만들 수 없다. 그래서 핸들러는
 * 좁은 인터페이스(`GuardableDragEvent`)로 직접 시험하고, 배선(어느 이벤트에 붙는가)은
 * jsdom 이벤트를 실제로 버블시켜 확인한다.
 */

import { describe, it, expect, vi } from 'vitest'
import { installDragGuard, swallowUnhandledDrag, type GuardableDragEvent } from './dragGuard'

function fakeDrag(defaultPrevented = false): GuardableDragEvent & { preventDefault: ReturnType<typeof vi.fn> } {
  const event = {
    defaultPrevented,
    preventDefault: vi.fn(() => {
      event.defaultPrevented = true
    }),
    dataTransfer: { dropEffect: 'move' }
  }
  return event
}

describe('swallowUnhandledDrag', () => {
  it('아무도 받지 않은 드래그는 기본 동작을 없애고 "못 놓음"으로 표시한다', () => {
    const event = fakeDrag()
    swallowUnhandledDrag(event)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(event.dataTransfer?.dropEffect).toBe('none')
  })

  /**
   * 이게 없으면 창 전체가 드롭 가능 영역이 되어, 앱 어디에서나 드롭 커서가 뜨고
   * 진짜 드롭 대상의 `dropEffect`가 덮인다 — 되는 동작이 안 되는 것처럼 보인다.
   */
  it('앱이 이미 받은 드래그는 건드리지 않는다', () => {
    const event = fakeDrag(true)
    swallowUnhandledDrag(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.dataTransfer?.dropEffect).toBe('move')
  })

  it('dataTransfer가 없어도 던지지 않는다', () => {
    const event = { defaultPrevented: false, preventDefault: vi.fn(), dataTransfer: null }
    expect(() => swallowUnhandledDrag(event)).not.toThrow()
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })
})

describe('installDragGuard', () => {
  it('dragover와 drop 둘 다에 건다', () => {
    const addEventListener = vi.fn()
    installDragGuard({ addEventListener } as unknown as Window)
    expect(addEventListener.mock.calls.map((c) => c[0]).sort()).toEqual(['dragover', 'drop'])
  })

  /**
   * 앱의 드롭 대상은 자기 요소에 붙어 있다. 그 바깥(사이드바·헤더·빈 공간)에
   * 떨어진 이벤트가 `window`까지 버블해 여기서 취소되는지가 이 항목의 요점이다.
   */
  it.each(['dragover', 'drop'])('%s 이 window까지 버블하면 취소된다', (type) => {
    installDragGuard(window)
    const target = document.createElement('div')
    document.body.appendChild(target)

    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { dropEffect: 'copy' } })
    target.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect((event as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect).toBe('none')
  })

  it('앱의 드롭 대상이 먼저 받으면 window 가드는 물러선다', () => {
    installDragGuard(window)
    const target = document.createElement('div')
    // 실제 드롭 대상이 하는 일과 같다: 기본 동작을 취소하고 자기 효과를 정한다.
    target.addEventListener('dragover', (e) => {
      e.preventDefault()
      ;(e as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect = 'move'
    })
    document.body.appendChild(target)

    const event = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { dropEffect: 'copy' } })
    target.dispatchEvent(event)

    expect((event as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect).toBe('move')
  })
})
