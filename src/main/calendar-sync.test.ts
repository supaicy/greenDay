import { describe, it, expect } from 'vitest'
import { runSync } from './calendar-sync'
import { CalDavClient, CalDavError, type FetchLike } from './caldav/client'
import { fingerprint, taskToEvent, eventHref, type SyncState, type TaskRow } from './caldav/sync'

const CALENDAR = 'https://caldav.icloud.com/1/calendars/home/'
const CREDS = { serverUrl: 'https://caldav.icloud.com', username: 'u@icloud.com', password: 'pw' }
const NOW = '2026-08-02T01:00:00.000Z'

function task(overrides: Partial<TaskRow> = {}): TaskRow {
  return { id: 't1', title: '장보기', due_date: '2026-08-03', ...overrides }
}

function entryFor(t: TaskRow, extra: Partial<SyncState[string]> = {}): SyncState[string] {
  return {
    href: eventHref(CALENDAR, t.id),
    etag: '"v1"',
    fingerprint: fingerprint(taskToEvent(t)!),
    sequence: 0,
    ...extra
  }
}

interface Recorded {
  method: string
  url: string
  body?: string
  headers: Record<string, string>
}

/** 요청을 기록하고, 경로별로 정해 둔 상태 코드를 돌려주는 서버 대역. */
function fakeServer(statusFor: (method: string, url: string) => number = () => 204) {
  const requests: Recorded[] = []
  const fetchImpl: FetchLike = async (url, init) => {
    const method = String(init.method)
    requests.push({
      method,
      url,
      body: init.body as string | undefined,
      headers: (init.headers ?? {}) as Record<string, string>
    })
    const status = statusFor(method, url)
    const hasBody = status !== 204 && status !== 205 && status !== 304
    return new Response(hasBody ? '' : null, { status, headers: { etag: '"srv"' } })
  }
  return { requests, client: new CalDavClient(CREDS, fetchImpl) }
}

describe('runSync — 생성', () => {
  it('새 할일을 올리고 상태에 기록한다', async () => {
    const { requests, client } = fakeServer(() => 201)
    const result = await runSync({
      credentials: CREDS,
      calendarUrl: CALENDAR,
      tasks: [task()],
      state: {},
      now: NOW,
      client
    })

    expect(result.created).toBe(1)
    expect(requests).toHaveLength(1)
    expect(requests[0].method).toBe('PUT')
    expect(requests[0].headers['If-None-Match']).toBe('*')
    expect(requests[0].body).toContain('SUMMARY:장보기')
    expect(result.state.t1.etag).toBe('"srv"')
    expect(result.state.t1.href).toBe(eventHref(CALENDAR, 't1'))
  })

  it('두 번째 동기화는 아무 요청도 보내지 않는다', async () => {
    const first = fakeServer(() => 201)
    const afterFirst = await runSync({
      credentials: CREDS,
      calendarUrl: CALENDAR,
      tasks: [task()],
      state: {},
      now: NOW,
      client: first.client
    })

    const second = fakeServer(() => 201)
    const afterSecond = await runSync({
      credentials: CREDS,
      calendarUrl: CALENDAR,
      tasks: [task()],
      state: afterFirst.state,
      now: NOW,
      client: second.client
    })

    expect(second.requests).toHaveLength(0)
    expect(afterSecond.created + afterSecond.updated + afterSecond.deleted).toBe(0)
  })

  it('날짜 없는 할일은 요청 없이 건너뛴 수만 센다', async () => {
    const { requests, client } = fakeServer()
    const result = await runSync({
      credentials: CREDS,
      calendarUrl: CALENDAR,
      tasks: [task({ due_date: null })],
      state: {},
      now: NOW,
      client
    })
    expect(requests).toHaveLength(0)
    expect(result.skippedNoDate).toBe(1)
  })
})

describe('runSync — 갱신', () => {
  it('바뀐 할일만 If-Match로 다시 올린다', async () => {
    const before = task()
    const { requests, client } = fakeServer(() => 204)
    const result = await runSync({
      credentials: CREDS,
      calendarUrl: CALENDAR,
      tasks: [task({ due_date: '2026-08-09' })],
      state: { t1: entryFor(before) },
      now: NOW,
      client
    })
    expect(result.updated).toBe(1)
    expect(requests[0].headers['If-Match']).toBe('"v1"')
    expect(requests[0].body).toContain('SEQUENCE:1')
  })

  it('충돌(412)이면 etag를 비워 다음 회차에 덮어쓰게 한다', async () => {
    const before = task()
    const { client } = fakeServer(() => 412)
    const result = await runSync({
      credentials: CREDS,
      calendarUrl: CALENDAR,
      tasks: [task({ due_date: '2026-08-09' })],
      state: { t1: entryFor(before) },
      now: NOW,
      client
    })
    expect(result.updated).toBe(0)
    expect(result.failures).toHaveLength(1)
    expect(result.state.t1.etag).toBeNull()
    // 지문은 예전 것으로 남아 다음 회차에도 갱신 대상이 된다.
    expect(result.state.t1.fingerprint).toBe(entryFor(before).fingerprint)
  })
})

describe('runSync — 삭제', () => {
  it('사라진 할일을 서버에서 지우고 상태에서도 뺀다', async () => {
    const { requests, client } = fakeServer(() => 204)
    const result = await runSync({
      credentials: CREDS,
      calendarUrl: CALENDAR,
      tasks: [],
      state: { t1: entryFor(task()) },
      now: NOW,
      client
    })
    expect(requests[0].method).toBe('DELETE')
    expect(result.deleted).toBe(1)
    expect(result.state.t1).toBeUndefined()
  })

  it('서버에 이미 없으면(404) 성공으로 처리한다 (영원히 재시도하지 않도록)', async () => {
    const { client } = fakeServer(() => 404)
    const result = await runSync({
      credentials: CREDS,
      calendarUrl: CALENDAR,
      tasks: [],
      state: { t1: entryFor(task()) },
      now: NOW,
      client
    })
    expect(result.deleted).toBe(1)
    expect(result.failures).toHaveLength(0)
    expect(result.state.t1).toBeUndefined()
  })
})

describe('runSync — 오류 처리', () => {
  it('한 항목이 실패해도 나머지는 계속 올린다', async () => {
    const failing = eventHref(CALENDAR, 'bad')
    const { client } = fakeServer((_, url) => (url === failing ? 500 : 201))
    const result = await runSync({
      credentials: CREDS,
      calendarUrl: CALENDAR,
      tasks: [task({ id: 'bad' }), task({ id: 'good' })],
      state: {},
      now: NOW,
      client
    })
    expect(result.created).toBe(1)
    expect(result.failures.map((f) => f.taskId)).toEqual(['bad'])
    expect(result.state.good).toBeDefined()
    expect(result.state.bad).toBeUndefined()
  })

  it('인증 실패는 즉시 중단한다 (반복 시도로 계정이 잠기지 않도록)', async () => {
    let calls = 0
    const fetchImpl: FetchLike = async () => {
      calls++
      return new Response('', { status: 401 })
    }
    const client = new CalDavClient(CREDS, fetchImpl)
    await expect(
      runSync({
        credentials: CREDS,
        calendarUrl: CALENDAR,
        tasks: [task({ id: 'a' }), task({ id: 'b' }), task({ id: 'c' })],
        state: {},
        now: NOW,
        client
      })
    ).rejects.toBeInstanceOf(CalDavError)
    expect(calls).toBe(1)
  })

  it('실패한 항목은 상태에 남지 않아 다음 회차에 다시 시도된다', async () => {
    const { client } = fakeServer(() => 500)
    const result = await runSync({
      credentials: CREDS,
      calendarUrl: CALENDAR,
      tasks: [task()],
      state: {},
      now: NOW,
      client
    })
    expect(result.state.t1).toBeUndefined()
  })
})

describe('runSync — 입력 상태를 훼손하지 않는다', () => {
  it('넘겨받은 state 객체를 직접 수정하지 않는다', async () => {
    const original: SyncState = { t1: entryFor(task()) }
    const snapshot = JSON.parse(JSON.stringify(original))
    const { client } = fakeServer(() => 204)
    await runSync({
      credentials: CREDS,
      calendarUrl: CALENDAR,
      tasks: [],
      state: original,
      now: NOW,
      client
    })
    expect(original).toEqual(snapshot)
  })
})
