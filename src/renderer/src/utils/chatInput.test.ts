import { describe, it, expect } from 'vitest'
import { shouldSendOnEnter, type EnterKeyEvent } from './chatInput'

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
