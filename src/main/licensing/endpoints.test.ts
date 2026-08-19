import { describe, it, expect } from 'vitest'
import {
  asPurchaseSource,
  LICENSE_BASE_URL,
  PRODUCT_SLUG,
  PURCHASE_SOURCES,
  purchaseUrl,
  recoverUrl
} from './endpoints'

/**
 * 여기 있는 것들은 전부 "틀려도 조용한" 종류다. 구매 URL이 어긋나면 링크가 404를
 * 내고 증상은 매출이 안 나오는 것뿐이고, 슬러그가 갈리면 "결제했는데 활성화가
 * 안 된다"만 남는다.
 */

describe('구매·복구 URL', () => {
  it('제품과 출처를 싣는다', () => {
    expect(purchaseUrl('settings')).toBe(`${LICENSE_BASE_URL}/buy?product=greenday&src=settings`)
    expect(purchaseUrl('locked')).toBe(`${LICENSE_BASE_URL}/buy?product=greenday&src=locked`)
    expect(recoverUrl()).toBe(`${LICENSE_BASE_URL}/recover`)
  })

  it('모든 출처가 실제 URL을 만든다', () => {
    for (const source of PURCHASE_SOURCES) {
      expect(purchaseUrl(source)).toContain(`src=${source}`)
    }
  })

  it('슬러그는 하나뿐이다 — 갈리면 체크아웃과 검증이 다른 제품을 본다', () => {
    // 출시 후 못 바꾸는 값이다. 발급된 키가 전부 여기 묶인다.
    expect(PRODUCT_SLUG).toBe('greenday')
    expect(purchaseUrl('settings')).toContain(`product=${PRODUCT_SLUG}`)
  })
})

describe('asPurchaseSource', () => {
  it('아는 출처는 그대로 통과한다', () => {
    for (const source of PURCHASE_SOURCES) expect(asPurchaseSource(source)).toBe(source)
  })

  it('모르는 값은 URL에 닿지 못한다', () => {
    // 렌더러가 준 문자열이 그대로 구매 URL 쿼리에 들어가면 안 된다.
    for (const bad of ['../../evil', 'settings&admin=1', '', null, undefined, 42, {}, ['locked']]) {
      expect(asPurchaseSource(bad)).toBe('settings')
    }
  })
})
