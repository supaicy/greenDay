import { describe, it, expect } from 'vitest'
import { KEY_PREFIX, looksValidKey, normalizeKey } from './licenseKey'

const VALID = 'GREENDAY-A2B3-C4D5-E6F7-G8H9'

describe('normalizeKey', () => {
  it('앞뒤 공백을 버리고 대문자로 만든다', () => {
    expect(normalizeKey('  greenday-a2b3-c4d5-e6f7-g8h9\n')).toBe(VALID)
  })
})

describe('looksValidKey', () => {
  it('형식이 맞으면 통과한다', () => {
    expect(looksValidKey(VALID)).toBe(true)
    expect(looksValidKey('  greenday-a2b3-c4d5-e6f7-g8h9  ')).toBe(true)
  })

  it('접두사가 이 제품의 것이 아니면 거절한다', () => {
    // 같은 워커가 모든 제품에 서명하므로, BicMac 키를 여기 넣는 일이 실제로
    // 일어난다. 네트워크를 치기 전에 여기서 끊는다.
    expect(looksValidKey('BICMAC-A2B3-C4D5-E6F7-G8H9')).toBe(false)
    expect(looksValidKey('HARU-A2B3-C4D5-E6F7-G8H9')).toBe(false)
    expect(KEY_PREFIX).toBe('GREENDAY')
  })

  it('전화로 잘못 들리는 글자는 애초에 키에 없다', () => {
    // 서버 알파벳이 I·L·O·U·0·1을 뺐다. 그 글자가 들어온 것은 받아적다 생긴
    // 오타이므로, 왕복 한 번을 아끼고 여기서 되돌려준다.
    expect(looksValidKey('GREENDAY-I2B3-C4D5-E6F7-G8H9')).toBe(false)
    expect(looksValidKey('GREENDAY-O2B3-C4D5-E6F7-G8H9')).toBe(false)
    expect(looksValidKey('GREENDAY-02B3-C4D5-E6F7-G8H9')).toBe(false)
    expect(looksValidKey('GREENDAY-12B3-C4D5-E6F7-G8H9')).toBe(false)
    expect(looksValidKey('GREENDAY-U2B3-C4D5-E6F7-G8H9')).toBe(false)
    expect(looksValidKey('GREENDAY-L2B3-C4D5-E6F7-G8H9')).toBe(false)
  })

  it('그룹 수나 길이가 어긋나면 거절한다', () => {
    expect(looksValidKey('GREENDAY-A2B3-C4D5-E6F7')).toBe(false)
    expect(looksValidKey('GREENDAY-A2B3-C4D5-E6F7-G8H9-J2K3')).toBe(false)
    expect(looksValidKey('GREENDAY-A2B-C4D5-E6F7-G8H9')).toBe(false)
    expect(looksValidKey('GREENDAYA2B3C4D5E6F7G8H9')).toBe(false)
    expect(looksValidKey('')).toBe(false)
  })

  it('접두사만 같고 뒤가 붙은 것도 거절한다', () => {
    expect(looksValidKey(`${VALID}-`)).toBe(false)
    expect(looksValidKey(`x${VALID}`)).toBe(false)
    expect(looksValidKey(`${VALID} extra`)).toBe(false)
  })
})
