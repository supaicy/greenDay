import { describe, it, expect } from 'vitest'
import { shouldSendOnEnter, isNearBottom, type EnterKeyEvent } from './chatInput'

const ev = (o: Partial<EnterKeyEvent> & { isComposing?: boolean } = {}): EnterKeyEvent => ({
  key: o.key ?? 'Enter',
  shiftKey: o.shiftKey ?? false,
  nativeEvent: { isComposing: o.isComposing ?? false }
})

describe('shouldSendOnEnter', () => {
  it('일반 Enter는 전송한다', () => {
    expect(shouldSendOnEnter(ev())).toBe(true)
  })

  // 회귀 방지: 이 가드가 없으면 한글 마지막 글자가 입력창에 남는다.
  it('IME 조합 중 Enter는 전송하지 않는다 (한글 마지막 글자 확정용)', () => {
    expect(shouldSendOnEnter(ev({ isComposing: true }))).toBe(false)
  })

  it('Shift+Enter는 전송하지 않는다 (줄바꿈)', () => {
    expect(shouldSendOnEnter(ev({ shiftKey: true }))).toBe(false)
  })

  it('Enter가 아닌 키는 전송하지 않는다', () => {
    expect(shouldSendOnEnter(ev({ key: 'a' }))).toBe(false)
  })
})

describe('isNearBottom', () => {
  it('맨 아래면 true (자동 따라내리기 유지)', () => {
    // scrollHeight 1000, clientHeight 300 → 최대 scrollTop 700
    expect(isNearBottom(1000, 700, 300)).toBe(true)
  })

  it('threshold 이내면 true', () => {
    expect(isNearBottom(1000, 670, 300)).toBe(true) // 30px 위 (<=40)
  })

  it('위로 많이 스크롤했으면 false (자동 스크롤 멈춤)', () => {
    expect(isNearBottom(1000, 200, 300)).toBe(false) // 500px 위
  })

  it('threshold를 넘기면 false', () => {
    expect(isNearBottom(1000, 650, 300, 40)).toBe(false) // 50px 위 (>40)
  })
})
