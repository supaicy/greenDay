import { describe, it, expect } from 'vitest'
import {
  asPurchaseSource,
  LICENSE_BASE_URL,
  LICENSE_STATUSES,
  PRODUCT_SLUG,
  PURCHASE_SOURCES,
  purchaseUrl,
  recoverUrl,
  UNKNOWN_LICENSE_STATE
} from './license'

/**
 * 이 파일이 지키는 것들은 전부 "틀려도 조용한" 종류다. 구매 URL이 어긋나면
 * 링크가 404를 내고 증상은 매출이 안 나오는 것뿐이고, 슬러그가 갈리면
 * "결제했는데 활성화가 안 된다"만 남는다.
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

describe('상태 이름', () => {
  it('배열과 타입이 한 벌이다', () => {
    // 손으로 세 벌 복사돼 있던 것을 배열 하나에서 파생시킨다. 값이 하나 늘면
    // main의 LicenseState가 컴파일 에러를 내고, 렌더러도 같은 배열을 쓴다.
    expect([...LICENSE_STATUSES]).toEqual(['unlicensed', 'trial', 'trialExpired', 'licensed', 'grace'])
  })

  it('모르는 상태로 떨어질 때 잠그지 않는다', () => {
    // 우리 실수로 돈 낸 사람을 막는 것보다, 못 막는 편이 낫다.
    expect(UNKNOWN_LICENSE_STATE.allowsPaidFeatures).toBe(true)
    expect(UNKNOWN_LICENSE_STATE.enforced).toBe(false)
    expect(LICENSE_STATUSES).toContain(UNKNOWN_LICENSE_STATE.status)
  })
})
