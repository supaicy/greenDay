/**
 * 동기화 실행기 — 계획(sync.ts)을 실제 요청으로 옮기는 유일한 지점.
 *
 * 방향은 haru → 캘린더 한쪽이다. 반대 방향(캘린더 → haru)까지 자동으로 반영하면
 * 사용자가 Calendar.app에서 무심코 옮긴 일정이 할일 마감일을 바꿔 버린다. 읽기는
 * 별도 기능으로 둔다.
 */

import { CalDavClient, CalDavError, type CalDavCredentials } from './caldav/client'
import { serializeEvent } from './caldav/ical'
// fingerprint는 sync.ts 것을 그대로 쓴다. 여기서 다시 정의하면 두 계산이 어긋나는
// 순간 모든 항목이 매번 다시 올라간다.
import { fingerprint, planSync, type SyncState, type TaskRow } from './caldav/sync'

export interface SyncResult {
  created: number
  updated: number
  deleted: number
  skippedNoDate: number
  /** 항목별 실패. 하나가 실패해도 나머지는 계속 진행한다. */
  failures: { taskId: string; message: string }[]
  state: SyncState
}

export interface SyncOptions {
  credentials: CalDavCredentials
  calendarUrl: string
  tasks: TaskRow[]
  state: SyncState
  now: string
  client?: CalDavClient
}

/**
 * 한 번의 동기화. 개별 항목 실패는 모아서 돌려주고 전체를 중단하지 않는다 —
 * 일정 하나가 서버에서 거부됐다고 나머지 100개를 못 올릴 이유가 없다.
 *
 * 다만 인증 실패는 즉시 중단한다. 자격증명이 틀린 상태로 항목마다 재시도하면
 * 애플이 계정을 잠글 수 있다.
 */
export async function runSync(options: SyncOptions): Promise<SyncResult> {
  const client = options.client ?? new CalDavClient(options.credentials)
  const plan = planSync(options.tasks, options.state, options.calendarUrl)
  const state: SyncState = { ...options.state }
  const result: SyncResult = {
    created: 0,
    updated: 0,
    deleted: 0,
    skippedNoDate: plan.skippedNoDate,
    failures: [],
    state
  }

  for (const item of plan.creates) {
    try {
      const etag = await client.putEvent(item.href, serializeEvent(item.event, options.now), null)
      state[item.taskId] = {
        href: item.href,
        etag,
        fingerprint: fingerprint(item.event),
        sequence: item.event.sequence
      }
      result.created++
    } catch (error) {
      if (isFatal(error)) throw error
      result.failures.push({ taskId: item.taskId, message: messageOf(error) })
    }
  }

  for (const item of plan.updates) {
    try {
      const etag = await client.putEvent(item.href, serializeEvent(item.event, options.now), item.etag)
      state[item.taskId] = {
        href: item.href,
        etag,
        fingerprint: fingerprint(item.event),
        sequence: item.event.sequence
      }
      result.updated++
    } catch (error) {
      if (isFatal(error)) throw error
      // 충돌은 다음 동기화에서 다시 시도하도록 etag만 비운다(다음엔 If-Match 없이 덮어씀).
      if (error instanceof CalDavError && error.code === 'conflict') {
        state[item.taskId] = { ...state[item.taskId], etag: null }
      }
      result.failures.push({ taskId: item.taskId, message: messageOf(error) })
    }
  }

  for (const item of plan.deletes) {
    try {
      await client.deleteEvent(item.href, item.etag)
      delete state[item.taskId]
      result.deleted++
    } catch (error) {
      if (isFatal(error)) throw error
      // 서버에 이미 없으면 우리 상태에서도 지우는 게 맞다. 남겨 두면 영원히 재시도한다.
      if (error instanceof CalDavError && error.code === 'not_found') {
        delete state[item.taskId]
        result.deleted++
        continue
      }
      result.failures.push({ taskId: item.taskId, message: messageOf(error) })
    }
  }

  return result
}

/** 계속 진행해도 소용없는 오류인가. */
function isFatal(error: unknown): boolean {
  return error instanceof CalDavError && (error.code === 'unauthorized' || error.code === 'forbidden')
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
