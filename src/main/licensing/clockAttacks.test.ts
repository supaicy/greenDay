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
import { licenseHash } from './activationToken'
import { PRODUCT_SLUG } from './endpoints'
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
      lic: licenseHash(KEY),
      dev: DEVICE,
      prod: PRODUCT_SLUG,
      exp: Math.floor((over.expMs ?? iatMs + 30 * DAY) / 1000),
      iat: Math.floor(iatMs / 1000)
    },
    pair.privateKey
  )
}

/**
 * 매니저 하나를 세우고 **두 시계를 따로** 흘린다.
 *
 * 벽시계(`now()`)와 단조 시계는 다른 것이고, 이 파일의 공격들이 노리는 것이
 * 정확히 그 차이다. `setTimeout`은 단조라 사용자가 날짜를 붙들어도 타이머는 제
 * 시간에 깬다 — 그게 마지막 방어선이다. 그래서 타이머는 **단조 시각으로만**
 * 예약되고, `setNow`는 벽시계를 옮기면서 단조를 앞으로 간 만큼만 밀어 준다
 * (되돌린 시계는 단조를 되돌리지 못한다).
 *
 * `frozenClock`은 벽시계를 `NOW`에 붙들어 둔 사용자다 — 단조만 흐른다.
 */
interface LaunchOptions {
  /** 이 실행이 시작될 때의 벽시계. `relaunch`가 쓴다. */
  at?: number
  frozenClock?: boolean
  client?: Partial<LicenseClient>
}

/**
 * OS의 부팅 세션. **프로세스가 아니라 기계에 속하므로 재시작을 넘어 산다** —
 * 그게 `setTimeout`의 단조 경과와 다른 점이고, H2가 노린 차이다.
 */
interface Session {
  id: string
  uptimeMs: number
}

let bootCount = 0

function boot(record: Partial<LicenseRecord>, over: LaunchOptions = {}) {
  return launch(
    { key: null, token: null, lastSeenMs: 0, trialStartMs: null, monotonic: null, blockedReason: null, ...record },
    over,
    { id: `boot-${++bootCount}`, uptimeMs: 0 }
  )
}

function launch(stored: LicenseRecord, over: LaunchOptions, session: Session) {
  let clock = over.at ?? NOW
  // 이 프로세스의 단조 시계 — `setTimeout`의 기준이라 실행마다 0에서 시작한다.
  // `session.uptimeMs`는 그렇지 않다: 같은 부팅이면 재시작을 넘어 계속 올라간다.
  let mono = 0
  const timers: { atMono: number; fire: () => void }[] = []

  /** 도래한 것만 깨운다 — 콜백이 단조 바닥을 마감까지 끌어올리므로, 안 온 것까지 깨우면 상태가 앞서 간다. */
  const fireDue = (): void => {
    const due = timers.filter((t) => t.atMono <= mono)
    for (const t of due) timers.splice(timers.indexOf(t), 1)
    for (const t of due) t.fire()
  }

  const manager = createLicenseManager({
    client: { ...offline, ...over.client },
    store: {
      read: () => ({ ...stored }),
      write: (next) => {
        Object.assign(stored, next)
        return true
      },
      lastReadSalvaged: () => false
    },
    publicKey,
    device: () => DEVICE,
    deviceName: null,
    enforced: true,
    now: () => (over.frozenClock ? NOW : clock),
    bootSession: () => ({ id: session.id, uptimeMs: session.uptimeMs }),
    setTimer: (ms, fn) => {
      const entry = { atMono: mono + ms, fire: fn }
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
    /** 벽시계를 옮긴다. 앞으로 간 만큼만 단조·uptime도 흐른다. */
    setNow: (t: number) => {
      const forward = Math.max(0, t - clock)
      mono += forward
      session.uptimeMs += forward
      clock = t
    },
    /** 벽시계는 그대로 두고 실제 시간만 흘린다 — 시계를 묶어 둔 사용자다. */
    idle: (ms: number) => {
      mono += ms
      session.uptimeMs += ms
    },
    /** 절전에서 깨어나듯, 도래한 마감 타이머를 깨운다. */
    wake: fireDue,
    /**
     * 앱을 껐다 켠다 — **디스크만 남고 프로세스 메모리는 사라진다.**
     *
     * 트라이얼 시작일 도출은 프로세스당 한 번 메모되므로, 재시작을 넘나드는
     * 공격은 이 경계를 넘어야만 보인다. 한 프로세스 안에서만 시험하면
     * 메모이제이션이 공격을 가려 준다.
     *
     * **부팅 세션은 그대로 물려준다.** 기계는 안 껐다 — 그게 요점이다.
     */
    relaunch: (atMs: number) => launch(stored, { ...over, at: atMs }, session),
    /** 기계를 재부팅한다. 세션 id가 바뀌고 uptime이 0으로 돌아간다. */
    reboot: (atMs: number) => launch(stored, { ...over, at: atMs }, { id: `boot-${++bootCount}`, uptimeMs: 0 }),
    /** 종료 훅. 실제 앱은 `will-quit`에서 이걸 부른다. */
    quit: () => manager.dispose(),
    /** 단조로만 시간을 흘리며 도래한 타이머를 깨운다. 재검증은 비동기라 기다린다. */
    run: async (untilMs: number, stepMs: number) => {
      for (let t = stepMs; t <= untilMs; t += stepMs) {
        session.uptimeMs += t - mono
        mono = t
        fireDue()
        await new Promise((r) => setImmediate(r))
      }
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

  it('재시작해도 새 창이 열리지 않는다 — 한 번의 편집이 영구 라이선스가 되면 안 된다', () => {
    // 프로세스 안에서만 막는 것으로는 부족하다. 데스크톱 앱은 스스로 재시작하므로,
    // 되쓰지 않은 미래 시작일은 **실행마다** 새 창을 주고 사용자는 아무것도 더
    // 하지 않아도 된다. 설정을 지우는 우회는 30일마다 손을 대야 하는데 이건
    // 한 번 편집하고 끝이라 문서화된 트레이드오프보다 명백히 강하다.
    const forged = NOW + 100 * 365 * DAY
    let h = boot({ trialStartMs: forged })
    expect(h.manager.allowsPaidFeatures()).toBe(true) // 첫 실행은 창을 준다

    h = h.relaunch(NOW + 31 * DAY)
    expect(h.manager.allowsPaidFeatures()).toBe(false)
    expect(h.manager.getState().status).toBe('trialExpired')

    // 몇 번을 껐다 켜도 마찬가지다.
    h = h.relaunch(NOW + 400 * DAY)
    expect(h.manager.allowsPaidFeatures()).toBe(false)
  })

  it('시계가 뒤로 간 기기에는 되쓰지 않는다 — RTC가 죽은 기기를 벽돌로 만들지 않는다', () => {
    // 위와 겉모습이 같다(기록된 시작일이 시스템 시각보다 한참 미래). 가르는 것은
    // 래칫이다: 시계가 뒤로 간 기기만 `lastSeen`이 지금보다 앞서 있다. 여기서
    // 되쓰면 정직한 사용자의 시작일이 2001년으로 박제된다.
    const honest = NOW
    const h = boot({ trialStartMs: honest, lastSeenMs: NOW }, { at: NOW - 25 * 365 * DAY })
    expect(h.record.trialStartMs).toBe(honest)
  })

  it('보정한 값을 파일에 남긴다 — 그래야 다음 실행이 같은 창을 본다', () => {
    const forged = NOW + 100 * 365 * DAY
    const h = boot({ trialStartMs: forged })
    h.setNow(NOW + 20 * DAY)
    h.wake()
    expect(h.record.trialStartMs).toBe(NOW)
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

describe('벽시계를 묶어 둬도 마감은 온다', () => {
  it('날짜를 붙들어도 트라이얼은 30일에 닫힌다', async () => {
    // 6시간짜리 재검증 폴이 `settle()`을 돌 때마다 마감 타이머를 다시 걸면,
    // 그 타이머는 영영 발화하지 못한다. 게다가 남은 시간을 생 벽시계로 재면
    // 시계가 안 가는 동안 마감이 계속 뒤로 물러난다. 둘 다 실증된 우회였다.
    const h = boot({ trialStartMs: NOW }, { frozenClock: true })
    await h.manager.revalidateIfNeeded()
    expect(h.manager.allowsPaidFeatures()).toBe(true)

    await h.run(40 * DAY, 6 * 60 * 60 * 1000)
    expect(h.manager.allowsPaidFeatures()).toBe(false)
    expect(h.manager.getState().status).toBe('trialExpired')
  })

  it('날짜를 붙들어도 유예 천장은 온다', async () => {
    const expMs = NOW - DAY
    const h = boot(
      {
        key: KEY,
        token: token({ expMs, iatMs: expMs - 30 * DAY }),
        lastSeenMs: NOW,
        trialStartMs: NOW - 40 * DAY // 트라이얼도 이미 끝났다 — 유예가 닫히면 갈 곳이 없어야 한다
      },
      { frozenClock: true }
    )
    await h.manager.revalidateIfNeeded()
    expect(h.manager.getState().status).toBe('grace')

    await h.run(40 * DAY, 6 * 60 * 60 * 1000)
    expect(h.manager.allowsPaidFeatures()).toBe(false)
  })
})

/**
 * H2 — **끄면 단조 경과가 사라진다.**
 *
 * `setTimeout`이 단조 시계로 재는 것은 맞지만 그 증거는 프로세스와 함께 죽는다.
 * 감사 재현: 5시간을 쓴 뒤 껐다가 시계를 되돌려 다시 켜자 `lastSeenMs`가 그대로였고
 * 라이선스도 그대로였다. 껐다 켜기를 반복하면 벽시계를 고정한 채 무기한 버틴다.
 *
 * 메우는 것은 OS의 uptime이다 — 벽시계를 고쳐도 따라가지 않고, 프로세스보다 오래 산다.
 */
describe('껐다 켜도 흐른 시간이 사라지지 않는다', () => {
  it('유료 기능을 쓴 시간이 디스크에 남는다', () => {
    const h = boot({ trialStartMs: NOW })
    expect(h.manager.allowsPaidFeatures()).toBe(true)

    // 벽시계는 묶어 둔 채 6시간을 실제로 쓴다. 유료 IPC마다 이 함수가 불린다.
    h.idle(6 * 60 * 60 * 1000)
    expect(h.manager.allowsPaidFeatures()).toBe(true)

    // **그 6시간이 파일에 남아야 한다.** 안 남으면 다음 실행이 0에서 다시 센다.
    expect(h.record.lastSeenMs).toBeGreaterThanOrEqual(NOW + 6 * 60 * 60 * 1000)
  })

  it('껐다 켜기를 반복해도 트라이얼은 30일에 닫힌다', () => {
    // 시계는 첫날에 고정. 프로세스를 계속 새로 만들어 `setTimeout`의 단조 경과를
    // 매번 버린다 — 그게 감사가 실증한 우회다.
    let h = boot({ trialStartMs: NOW }, { frozenClock: true })
    expect(h.manager.allowsPaidFeatures()).toBe(true)

    for (let day = 1; day <= 31; day++) {
      h.idle(DAY) // 하루를 쓴다
      h.quit() // 끈다 — 마지막 관측이 디스크로 내려간다
      h = h.relaunch(NOW) // 시계를 첫날로 되돌려 다시 켠다
    }

    expect(h.manager.allowsPaidFeatures()).toBe(false)
    expect(h.manager.getState().status).toBe('trialExpired')
  })

  it('재부팅으로도 되감기지 않는다 — 부팅 이후 흐른 시간은 여전히 흐른 시간이다', () => {
    // 재부팅하면 uptime이 0으로 돌아간다. 그걸 "경과 없음"으로 읽으면 끄고
    // 재부팅하는 것만으로 시계가 멈춘다. 부팅 세션은 직렬이므로, 다른 세션의
    // 체크포인트를 봤다면 최소한 지금의 uptime만큼은 실제로 흘렀다.
    let h = boot({ trialStartMs: NOW }, { frozenClock: true })
    for (let round = 0; round < 16; round++) {
      h.idle(2 * DAY)
      h.quit()
      h = h.reboot(NOW) // 기계를 껐다 켠다: uptime 0, 새 세션 id
      h.idle(2 * DAY) // 그리고 다시 쓴다
    }
    expect(h.manager.allowsPaidFeatures()).toBe(false)
  })

  it('시계를 앞으로 돌려 uptime을 부풀릴 수는 없다', () => {
    // uptime은 벽시계에서 파생되지 않는다. 날짜를 100년 앞으로 밀어도 이 값은
    // 안 움직이므로, 래칫을 부풀려 뒤에 되돌리는 2단계 공격의 재료가 되지 않는다.
    // (벽시계 관측 자체는 래칫을 올린다 — 그건 원래 그렇고, 창을 일찍 닫는다.)
    const h = boot({ trialStartMs: NOW })
    const before = h.record.monotonic?.uptimeMs ?? 0
    h.setNow(NOW + 100 * 365 * DAY)
    h.manager.allowsPaidFeatures()
    // setNow는 앞으로 간 만큼 uptime도 밀지만(실제로 흐른 것으로 친다), 그건
    // 이 테스트의 관심사가 아니다. 관심사는 **되돌렸을 때** 줄지 않는 것이다.
    h.setNow(NOW)
    h.manager.allowsPaidFeatures()
    expect(h.record.monotonic?.uptimeMs ?? 0).toBeGreaterThanOrEqual(before)
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

  it('배경 갱신도 시계 바닥을 서버 시각으로 내린다', async () => {
    // `anchorClockToServerTime()`은 `lastSeen` 래칫을 **낮출 수 있는 유일한 것**인데,
    // 갱신 쪽 호출을 지워도 테스트가 전부 통과했다. 활성화 쪽만 덮여 있었다.
    // 그게 없으면 시계가 한 번 앞으로 튄 기기는 배경 갱신으로는 영영 회복 못 하고
    // 부풀려진 바닥에 갇힌다.
    const h = boot(
      { key: KEY, token: token({ iatMs: NOW - 20 * DAY, expMs: NOW + 10 * DAY }), lastSeenMs: NOW + 100 * 365 * DAY },
      { client: { validate: async () => ({ ok: true, value: { token: token(), expiresAtMs: NOW + 30 * DAY } }) } }
    )
    await h.manager.revalidateIfNeeded()
    expect(h.record.lastSeenMs).toBe(NOW)
    expect(h.manager.allowsPaidFeatures()).toBe(true)
  })

  it('유료 사용자는 재활성화 한 번으로 회복한다', async () => {
    // 이쪽에는 서버라는 진짜 시각의 증거가 있다. 그게 없었다면 위의 엄격함은
    // 정당화되지 않는다.
    const h = boot(
      {
        lastSeenMs: NOW + 100 * 365 * DAY, // 시계가 한 번 미래로 튀었다
        trialStartMs: NOW - 40 * DAY
      },
      { client: { activate: async () => ({ ok: true, value: { token: token(), expiresAtMs: NOW + 30 * DAY } }) } }
    )
    expect(h.manager.allowsPaidFeatures()).toBe(false)

    expect(await h.manager.activate(KEY)).toBeNull()
    expect(h.record.lastSeenMs).toBe(NOW) // 서버가 바닥을 내려 줬다
    expect(h.manager.allowsPaidFeatures()).toBe(true)
  })
})
