// @vitest-environment jsdom

/**
 * C2 회귀(렌더러 절반) — 창 밖에서 온 드롭이 기본 동작(그 대상으로 네비게이트)까지
 * 가면 새 문서가 `window.api`를 물려받는다.
 *
 * 웨이브 1.5에서 두 가지가 바뀌었다.
 *   - **캡처 단계.** 버블은 하위 요소의 `stopPropagation()` 한 번에 죽는다.
 *     아래 `stopPropagation` 테스트가 정확히 그 조건을 만든다.
 *   - **판정 기준이 payload.** 캡처는 앱 핸들러보다 먼저 돌아서 `defaultPrevented`를
 *     볼 수 없다. 실린 것으로 가른다.
 *
 * jsdom에는 `DataTransfer`가 없어서 진짜 `DragEvent`를 만들 수 없다. 핸들러는 좁은
 * 인터페이스로 직접 시험하고, 배선은 jsdom 이벤트를 실제로 전파시켜 확인한다.
 */

import { describe, it, expect, vi } from 'vitest'
import { installDragGuard, swallowUnhandledDrag, type GuardableDragEvent } from './dragGuard'
import { DND_MIME } from './dnd'

function fakeDrag(types: string[]) {
  const event = {
    preventDefault: vi.fn<() => void>(),
    dataTransfer: { dropEffect: 'move', types }
  }
  return event satisfies GuardableDragEvent
}

/** 실제 드래그가 싣는 조합. Finder 파일 드래그는 uri-list와 text/plain도 함께 싣는다. */
const FILE_DRAG = ['Files', 'text/uri-list', 'text/plain']
const LINK_DRAG = ['text/uri-list', 'text/plain']

describe('swallowUnhandledDrag', () => {
  it.each([
    ['파일 드래그', FILE_DRAG],
    ['링크 드래그', LINK_DRAG],
    ['파일만', ['Files']]
  ])('%s 는 기본 동작을 없애고 "못 놓음"으로 표시한다', (_label, types) => {
    const event = fakeDrag(types)
    swallowUnhandledDrag(event)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(event.dataTransfer?.dropEffect).toBe('none')
  })

  /**
   * 앱의 내부 드래그는 **아예 건드리지 않는다.** 캡처 단계라 앱 핸들러보다 먼저
   * 도는데, 여기서 `dropEffect='none'`을 걸면 명세상 드래그가 취소되어 `drop`이
   * 발화하지 않는다 — 할일 재배치·캘린더 배정이 통째로 죽는다.
   */
  it.each(Object.entries(DND_MIME))('내부 드래그(%s)는 손대지 않는다', (_name, mime) => {
    const event = fakeDrag([mime])
    swallowUnhandledDrag(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.dataTransfer?.dropEffect).toBe('move')
  })

  it('칸반이 쓰는 text/plain 단독 드래그도 손대지 않는다', () => {
    const event = fakeDrag(['text/plain'])
    swallowUnhandledDrag(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('dataTransfer가 없어도 던지지 않는다', () => {
    const event = { preventDefault: vi.fn(), dataTransfer: null }
    expect(() => swallowUnhandledDrag(event)).not.toThrow()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})

describe('installDragGuard', () => {
  it('dragover와 drop 둘 다에 캡처 단계로 건다', () => {
    const addEventListener = vi.fn()
    installDragGuard({ addEventListener } as unknown as Window)
    expect(addEventListener.mock.calls.map((c) => c[0]).sort()).toEqual(['dragover', 'drop'])
    for (const call of addEventListener.mock.calls) {
      expect(call[2]).toEqual({ capture: true })
    }
  })

  function dispatch(target: EventTarget, type: string, types: string[]): Event {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { dropEffect: 'copy', types } })
    target.dispatchEvent(event)
    return event
  }

  it.each(['dragover', 'drop'])('%s: 앱 바깥 공간에 떨어진 파일 드래그를 취소한다', (type) => {
    installDragGuard(window)
    const target = document.createElement('div')
    document.body.appendChild(target)

    const event = dispatch(target, type, FILE_DRAG)

    expect(event.defaultPrevented).toBe(true)
    expect((event as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect).toBe('none')
  })

  /**
   * **웨이브 1.5의 핵심 회귀.** 버블 단계였을 때는 하위 요소가 `stopPropagation()`을
   * 부르는 것만으로 가드가 통째로 사라졌다 — 그 상태에서 파일 드롭은 기본 동작까지 가고,
   * 창은 그 파일로 네비게이트한다. 캡처 단계는 대상에 닿기 전에 돌아 영향을 받지 않는다.
   */
  it.each(['dragover', 'drop'])('%s: 하위 요소가 stopPropagation을 불러도 살아남는다', (type) => {
    installDragGuard(window)
    const target = document.createElement('div')
    target.addEventListener(type, (e) => e.stopPropagation())
    document.body.appendChild(target)

    const event = dispatch(target, type, FILE_DRAG)

    expect(event.defaultPrevented).toBe(true)
  })

  it.each(['dragover', 'drop'])('%s: 하위 요소가 stopImmediatePropagation을 불러도 살아남는다', (type) => {
    installDragGuard(window)
    const target = document.createElement('div')
    target.addEventListener(type, (e) => e.stopImmediatePropagation())
    document.body.appendChild(target)

    const event = dispatch(target, type, FILE_DRAG)

    expect(event.defaultPrevented).toBe(true)
  })

  it('앱의 드롭 대상은 그대로 자기 효과를 정한다', () => {
    installDragGuard(window)
    const target = document.createElement('div')
    // 실제 드롭 대상이 하는 일과 같다.
    target.addEventListener('dragover', (e) => {
      e.preventDefault()
      ;(e as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect = 'move'
    })
    document.body.appendChild(target)

    const event = dispatch(target, 'dragover', [DND_MIME.TASK_ID])

    expect((event as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect).toBe('move')
    expect(event.defaultPrevented).toBe(true)
  })
})
