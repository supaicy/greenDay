/**
 * Regression: 할당량이 바닥난 뒤에도 남은 일정을 하나씩 전부 보냈다.
 *
 * `google/calendar.ts`는 `usageLimits` reason이 붙은 403과 429를 `rate_limit`으로
 * 가른다(거부가 아니라 불통). 그런데 `runGoogleSync`의 `isFatal()`은
 * `unauthorized`·`forbidden`만 멈춤 조건으로 보아서, 첫 요청이 할당량에 걸려도
 * 계획된 create·update·delete를 끝까지 하나씩 보냈다. OAuth 클라이언트가 빌드에
 * 박혀 있어 할당량은 **모든 사용자가 한 프로젝트에서 나눠 쓴다** — 바닥난 할당량에
 * 계속 두드리는 것은 그 사용자 하나의 문제가 아니다.
 *
 * 그래서 첫 `rate_limit`에서 이번 실행을 멈춘다. 이미 끝낸 항목의 상태는 남기고,
 * 손대지 못한 항목은 실패로 보고해 상태를 그대로 둔다 — 다음 수동 동기화가 그
 * 자리부터 다시 계획한다.
 *
 * 진짜 `GoogleCalendarClient`에 fetch만 갈아끼운다. 분류(403 + reason → rate_limit)와
 * 루프의 멈춤을 한 번에 본다 — 둘 중 하나만 맞으면 요청은 여전히 새어 나간다.
 */

import { describe, it, expect } from 'vitest'
import { runGoogleSync } from './google-sync'
import { GoogleCalendarClient } from './google/calendar'
import type { FetchLike } from './google/oauth'
import { fingerprint, taskToEvent, type SyncState, type TaskRow } from './caldav/sync'

const CALENDAR_ID = 'greenday-cal@group.calendar.google.com'

function task(id: string, overrides: Partial<TaskRow> = {}): TaskRow {
  return { id, title: `할일 ${id}`, due_date: '2026-10-08', ...overrides }
}

function entryFor(t: TaskRow): SyncState[string] {
  const event = taskToEvent(t)
  if (!event) throw new Error('날짜 없는 할일로 상태를 만들 수 없다')
  return { href: CALENDAR_ID, etag: null, fingerprint: fingerprint(event), sequence: 0 }
}

/** 구글이 할당량 초과를 알리는 실제 모양 — 상태는 403, 이유는 본문에만 있다. */
function quotaExceeded(): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: 403,
        message: 'Rate Limit Exceeded',
        errors: [{ domain: 'usageLimits', reason: 'rateLimitExceeded', message: 'Rate Limit Exceeded' }]
      }
    }),
    { status: 403, headers: { 'Content-Type': 'application/json' } }
  )
}

function ok(): Response {
  return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function recordingFetch(respond: (call: number, init: RequestInit) => Response): {
  fetchImpl: FetchLike
  calls: { url: string; method: string }[]
} {
  const calls: { url: string; method: string }[] = []
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, method: String(init.method) })
    return respond(calls.length, init)
  }
  return { fetchImpl, calls }
}

describe('runGoogleSync: 할당량에 걸리면 이번 실행을 멈춘다', () => {
  it('첫 쓰기가 할당량 초과(403 rateLimitExceeded)면 요청은 그 한 번뿐이다', async () => {
    // create 셋 + update 하나 + delete 하나 = 계획된 쓰기 다섯.
    const changed = task('u1')
    const gone = task('d1')
    const state: SyncState = {
      u1: { ...entryFor(changed), fingerprint: 'stale' },
      d1: entryFor(gone)
    }
    const { fetchImpl, calls } = recordingFetch(() => quotaExceeded())

    const result = await runGoogleSync({
      client: new GoogleCalendarClient('token', fetchImpl),
      calendarId: CALENDAR_ID,
      tasks: [task('c1'), task('c2'), task('c3'), changed],
      state
    })

    expect(calls).toHaveLength(1)
    expect(result.stoppedBy?.code).toBe('rate_limit')
    // 손대지 못한 것까지 전부 "안 됐다"로 센다 — 화면의 실패 수가 실제로 남은 일이다.
    expect(result.failures.map((f) => f.taskId).sort()).toEqual(['c1', 'c2', 'c3', 'd1', 'u1'])
    expect(result.created + result.updated + result.deleted).toBe(0)
    // 상태는 그대로 — 다음 동기화가 다섯을 다시 계획한다.
    expect(result.state).toEqual(state)
  })

  it('중간에 걸리면(429) 이미 올린 것은 상태에 남기고 나머지는 다음으로 미룬다', async () => {
    const { fetchImpl, calls } = recordingFetch((n) =>
      n === 1 ? ok() : new Response('', { status: 429 })
    )

    const result = await runGoogleSync({
      client: new GoogleCalendarClient('token', fetchImpl),
      calendarId: CALENDAR_ID,
      tasks: [task('c1'), task('c2'), task('c3')],
      state: {}
    })

    expect(calls).toHaveLength(2)
    expect(result.created).toBe(1)
    expect(Object.keys(result.state)).toEqual(['c1'])
    expect(result.failures.map((f) => f.taskId).sort()).toEqual(['c2', 'c3'])
    expect(result.stoppedBy?.code).toBe('rate_limit')
  })

  it('삭제 단계에서 걸려도 멈추고, 상태의 항목을 지우지 않는다', async () => {
    const a = task('d1')
    const b = task('d2')
    const state: SyncState = { d1: entryFor(a), d2: entryFor(b) }
    const { fetchImpl, calls } = recordingFetch(() => quotaExceeded())

    const result = await runGoogleSync({
      client: new GoogleCalendarClient('token', fetchImpl),
      calendarId: CALENDAR_ID,
      tasks: [],
      state
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('DELETE')
    expect(result.state).toEqual(state)
    expect(result.failures).toHaveLength(2)
  })

  it('할당량이 아닌 개별 실패(500)는 그 항목만 실패로 두고 계속한다 — 멈춤을 넓히지 않는다', async () => {
    const { fetchImpl, calls } = recordingFetch((n) =>
      n === 1 ? new Response('', { status: 500 }) : ok()
    )

    const result = await runGoogleSync({
      client: new GoogleCalendarClient('token', fetchImpl),
      calendarId: CALENDAR_ID,
      tasks: [task('c1'), task('c2'), task('c3')],
      state: {}
    })

    expect(calls).toHaveLength(3)
    expect(result.created).toBe(2)
    expect(result.failures.map((f) => f.taskId)).toEqual(['c1'])
    expect(result.stoppedBy).toBeNull()
  })
})
