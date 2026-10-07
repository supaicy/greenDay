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

describe('서버 주소', () => {
  it('주소를 리터럴로 못 박는다 — 활성화와 구매가 같은 배포를 본다', () => {
    // 아래 URL 단언들은 양변에 `LICENSE_BASE_URL`을 끼워 넣어서, 주소가 통째로
    // 틀려도 통과한다. 실제로 `typo.begreen.dev`로 바꿔도 865개가 전부 통과했다 —
    // 그 상수는 활성화 서버이면서 구매 페이지라, 틀리면 아무도 활성화 못 하고
    // 아무도 못 산다. 옆의 PRODUCT_SLUG는 같은 이유로 이미 리터럴로 박혀 있다.
    expect(LICENSE_BASE_URL).toBe('https://pay.begreen.dev')
    // 다운그레이드도 막는다 — 원본 라이선스 키가 요청 본문에 실린다.
    expect(LICENSE_BASE_URL.startsWith('https://')).toBe(true)
  })
})

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
