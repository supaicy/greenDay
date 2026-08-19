import { describe, it, expect } from 'vitest'
import { LICENSE_STATUSES, UNKNOWN_LICENSE_STATE } from './license'

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
