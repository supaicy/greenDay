import { describe, it, expect } from 'vitest'
import { TRIAL_DURATION_MS, effectiveNow, isTrialOpen, trialEndsAt } from './trialWindow'

const DAY = 24 * 60 * 60 * 1000
const START = Date.UTC(2026, 7, 18)

describe('trialEndsAt', () => {
  it('창은 시작으로부터 30일이다', () => {
    expect(trialEndsAt(START)).toBe(START + 30 * DAY)
    expect(TRIAL_DURATION_MS).toBe(30 * DAY)
  })
})

describe('effectiveNow', () => {
  it('시스템 시계와 본 적 있는 가장 나중 시각 중 큰 쪽을 쓴다', () => {
    expect(effectiveNow(START, START - 5 * DAY)).toBe(START)
    // 시계를 되돌려도 이미 본 시각 아래로는 내려가지 않는다 — 어떤 로컬 만료든
    // 한 줄로 무력화하는 공격이 날짜를 되돌리는 것이다.
    expect(effectiveNow(START - 10 * DAY, START)).toBe(START)
  })
})

describe('isTrialOpen', () => {
  it('창 안이면 열려 있다', () => {
    expect(isTrialOpen(START, START + 1 * DAY)).toBe(true)
  })

  it('창을 지나면 닫힌다', () => {
    expect(isTrialOpen(START, START + 40 * DAY)).toBe(false)
  })

  it('시계를 되돌려도 다시 열리지 않는다', () => {
    // 판정에 들어오는 것은 effectiveNow가 만든 값이라, 시스템 시계를 되돌려도
    // 바닥인 lastSeen 아래로는 안 내려간다.
    const rolledBack = effectiveNow(START - 10 * DAY, START + 40 * DAY)
    expect(isTrialOpen(START, rolledBack)).toBe(false)
  })

  it('마감 시각 정각은 닫힌 것으로 본다', () => {
    const end = trialEndsAt(START)
    expect(isTrialOpen(START, end)).toBe(false)
    expect(isTrialOpen(START, end - 1)).toBe(true)
  })
})
