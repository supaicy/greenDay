/**
 * 리뷰에서 실증된 시계 공격 둘.
 *
 * 둘 다 "설정을 지우면 트라이얼이 리셋된다"는 문서화된 트레이드오프보다 **강한**
 * 우회다. 그래서 받아들일 수 없다.
 *
 *   1. `license.json`의 `trialStartMs`를 먼 미래로 한 번 써넣으면, 마감 타이머가
 *      깰 때마다 창이 새로 열려 재시작 없이 영원히 미끄러진다.
 *   2. 시스템 시계를 크게 되돌리면 래칫이 통째로 버려져 만료된 토큰이 다시
 *      유효해진다. 되돌리기를 막으려던 장치가 되돌리기로 뚫린다.
 */

import { describe, it, expect } from 'vitest'
import { createLicenseManager } from './licenseManager'
import { PRODUCT_SLUG } from './activationToken'
import { GRACE_DURATION_MS, TRIAL_DURATION_MS } from './trialWindow'
import { importTestKey, makeKeyPair, signTestToken } from './testTokens'
import type { LicenseRecord } from './licenseStore'
import type { LicenseClient } from './licenseClient'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 7, 18)
const KEY = 'GREENDAY-A2B3-C4D5-E6F7-G8H9'
const DEVICE = 'a'.repeat(64)

const pair = makeKeyPair()
const publicKey = importTestKey(pair.rawBase64)

/** 비행기 안이라고 치자 — 서버는 이 시험에서 아무 역할도 하지 않는다. */
const offline: LicenseClient = {
  activate: async () => ({ ok: false, error: 'network' }),
  validate: async () => ({ ok: false, error: 'network' }),
  deactivate: async () => ({ ok: false, error: 'network' })
}

function token(over: { expMs?: number; iatMs?: number } = {}): string {
  const iatMs = over.iatMs ?? NOW
  return signTestToken(
    {
      lic: 'f'.repeat(64),
      dev: DEVICE,
      prod: PRODUCT_SLUG,
      exp: Math.floor((over.expMs ?? iatMs + 30 * DAY) / 1000),
      iat: Math.floor(iatMs / 1000)
    },
    pair.privateKey
  )
}

function boot(record: Partial<LicenseRecord>, startAt = NOW) {
  const stored: LicenseRecord = { key: null, token: null, lastSeenMs: 0, trialStartMs: null, ...record }
  let clock = startAt
  const timers: { atMs: number; fire: () => void }[] = []
  const manager = createLicenseManager({
    client: offline,
    store: { read: () => ({ ...stored }), write: (next) => Object.assign(stored, next) },
    publicKey,
    device: () => DEVICE,
    deviceName: null,
    enforced: true,
    now: () => clock,
    setTimer: (ms, fn) => {
      const entry = { atMs: clock + ms, fire: fn }
      timers.push(entry)
      return () => {
        const i = timers.indexOf(entry)
        if (i >= 0) timers.splice(i, 1)
      }
    }
  })
  return {
    manager,
    record: stored,
    setNow: (t: number) => {
      clock = t
    },
    /**
     * 절전에서 깨어나듯, **도래한** 마감 타이머만 깨운다.
     *
     * 아직 안 온 타이머까지 깨우면 안 된다 — 콜백이 단조 시계 바닥을 마감까지
     * 끌어올리므로, 시험이 만들려던 시각보다 앞선 상태에서 판정하게 된다.
     */
    wake: () => {
      const due = timers.filter((t) => t.atMs <= clock)
      for (const t of due) timers.splice(timers.indexOf(t), 1)
      for (const t of due) t.fire()
    }
  }
}

describe('미래로 조작된 시작일이 창을 무한히 밀지 못한다', () => {
  it('타이머가 몇 번을 깨어도 창은 딱 한 번만 열린다', () => {
    // 이걸 못 막으면 파일 한 줄이 영구 무료가 된다 — 설정을 지워 얻는 창 하나보다
    // 훨씬 강하다. 되쓰기를 안 하는 것은 시계가 고장난 사용자를 위해서지,
    // 창을 계속 새로 주기 위해서가 아니다.
    const forged = NOW + 100 * 365 * DAY
    const h = boot({ trialStartMs: forged })
    expect(h.manager.allowsPaidFeatures()).toBe(true)

    // 창 안에서 타이머가 여러 번 깬다. 깰 때마다 시작일을 다시 도출하면
    // 그때마다 창이 30일씩 앞으로 밀려 영원히 안 닫힌다.
    for (let elapsed = 5 * DAY; elapsed <= 25 * DAY; elapsed += 5 * DAY) {
      h.setNow(NOW + elapsed)
      h.wake()
      expect(h.manager.allowsPaidFeatures()).toBe(true)
    }

    // 첫 도출로부터 30일. 시계는 계속 앞으로만 갔다.
    h.setNow(NOW + TRIAL_DURATION_MS + DAY)
    h.wake()
    expect(h.manager.allowsPaidFeatures()).toBe(false)
    expect(h.manager.getState().status).toBe('trialExpired')
  })

  it('그래도 파일에는 되쓰지 않는다 — 시계 고장난 기기를 벽돌로 만들지 않는다', () => {
    const forged = NOW + 100 * 365 * DAY
    const h = boot({ trialStartMs: forged })
    h.setNow(NOW + 20 * DAY)
    h.wake()
    expect(h.record.trialStartMs).toBe(forged)
  })

  it('정직한 트라이얼은 그대로 30일이다', () => {
    const h = boot({ trialStartMs: NOW })
    h.setNow(NOW + 29 * DAY)
    h.wake()
    expect(h.manager.allowsPaidFeatures()).toBe(true)
    h.setNow(NOW + TRIAL_DURATION_MS)
    expect(h.manager.allowsPaidFeatures()).toBe(false)
  })
})

describe('시계를 크게 되돌려도 만료된 토큰이 되살아나지 않는다', () => {
  it('60일 되돌려도 유예에 머문다', () => {
    const expMs = NOW - DAY
    const h = boot({ key: KEY, token: token({ expMs, iatMs: expMs - 30 * DAY }), lastSeenMs: NOW })
    expect(h.manager.getState().status).toBe('grace')

    // 시스템 설정에서 날짜를 60일 되돌린다. 래칫이 사라지면 토큰이 만료 전으로 보인다.
    h.setNow(NOW - 60 * DAY)
    h.wake()
    expect(h.manager.getState().status).not.toBe('licensed')
    expect(h.manager.getState().status).toBe('grace')
  })

  it('되돌린 시계로 유예 천장을 넘겨 쓸 수도 없다', () => {
    const expMs = NOW - (GRACE_DURATION_MS + DAY) // 이미 천장을 지났다
    const h = boot({
      key: KEY,
      token: token({ expMs, iatMs: expMs - 30 * DAY }),
      lastSeenMs: NOW,
      trialStartMs: NOW - 40 * DAY // 트라이얼도 이미 끝났다 — 여기로 떨어지면 안 된다
    })
    expect(h.manager.allowsPaidFeatures()).toBe(false)

    h.setNow(NOW - 60 * DAY)
    expect(h.manager.allowsPaidFeatures()).toBe(false)
  })
})

describe('래칫을 조건 없이 믿는 대가', () => {
  it('시계가 미래로 튀면 트라이얼이 닫힌다 — 회복은 설정 삭제다', () => {
    // 이걸 봐주려고 상대 임계값을 두면 2단계 공격이 열린다(파일 상단 주석 2번).
    // 그래서 래칫을 조건 없이 믿고, 대신 회복 경로를 이미 문서화된 것 하나로
    // 남긴다. 이 테스트는 그 대가가 무엇인지를 숨기지 않고 못 박는다.
    const h = boot({ trialStartMs: NOW, lastSeenMs: NOW + 100 * 365 * DAY })
    expect(h.manager.allowsPaidFeatures()).toBe(false)

    // 설정 폴더를 지운 것과 같은 상태 — 창이 다시 열린다.
    const fresh = boot({})
    expect(fresh.manager.allowsPaidFeatures()).toBe(true)
  })

  it('유료 사용자는 재활성화 한 번으로 회복한다', async () => {
    // 이쪽에는 서버라는 진짜 시각의 증거가 있다. 그게 없었다면 위의 엄격함은
    // 정당화되지 않는다.
    const stored: LicenseRecord = {
      key: null,
      token: null,
      lastSeenMs: NOW + 100 * 365 * DAY, // 시계가 한 번 미래로 튀었다
      trialStartMs: NOW - 40 * DAY
    }
    const manager = createLicenseManager({
      client: {
        ...offline,
        activate: async () => ({ ok: true, value: { token: token(), expiresAtMs: NOW + 30 * DAY } })
      },
      store: { read: () => ({ ...stored }), write: (next) => Object.assign(stored, next) },
      publicKey,
      device: () => DEVICE,
      deviceName: null,
      enforced: true,
      now: () => NOW,
      setTimer: () => () => {}
    })
    expect(manager.allowsPaidFeatures()).toBe(false)

    expect(await manager.activate(KEY)).toBeNull()
    expect(stored.lastSeenMs).toBe(NOW) // 서버가 바닥을 내려 줬다
    expect(manager.allowsPaidFeatures()).toBe(true)
  })
})
