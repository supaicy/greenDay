/**
 * 구글 캘린더 동기화 실행기.
 *
 * 계획은 CalDAV와 같은 planSync를 쓴다 — 무엇을 올리고 지울지는 제공자와 무관한
 * 판단이라 두 번 구현할 이유가 없다. 여기서는 그 계획을 구글 API 호출로 옮기기만 한다.
 */

import { GoogleApiError, type GoogleCalendarClient } from './google/calendar'
import { eventUid, fingerprint, planSync, type SyncState, type TaskRow } from './caldav/sync'

export interface GoogleSyncResult {
  created: number
  updated: number
  deleted: number
  skippedNoDate: number
  failures: { taskId: string; message: string }[]
  state: SyncState
  /**
   * 할당량에 걸려 실행을 중간에 멈췄으면 그 오류, 끝까지 돌았으면 null.
   *
   * 멈춘 실행도 **결과를 돌려준다** — 이미 올린 항목의 상태를 저장해야 다음 동기화가
   * 그것을 다시 보내지 않는다. 던지면 호출처가 상태를 저장하지 않아, 할당량이
   * 회복된 뒤에 같은 쓰기를 처음부터 다시 태운다.
   */
  stoppedBy: GoogleApiError | null
}

export interface GoogleSyncOptions {
  client: GoogleCalendarClient
  calendarId: string
  tasks: TaskRow[]
  state: SyncState
}

/**
 * 인증 실패(401/403)는 즉시 중단한다(던진다). 토큰이 죽은 채로 항목마다 호출하면
 * 할당량만 태우고 결과는 같다.
 *
 * **할당량 초과(`rate_limit`)도 멈춘다** — 다만 던지지 않고 그때까지의 결과를 돌려준다.
 * 403 `usageLimits`와 429는 거부가 아니라 불통이라 토큰도 상태도 멀쩡하다. 그런데
 * OAuth 클라이언트가 빌드에 박혀 있어 할당량은 **모든 사용자가 한 프로젝트에서
 * 나눠 쓴다.** 바닥난 할당량에 남은 쓰기를 전부 두드리면 회복만 늦춘다. 손대지 못한
 * 항목은 실패로 보고하고 상태를 그대로 둔다 — 다음 수동 동기화가 그 자리부터 다시
 * 계획한다.
 *
 * 그 외 개별 실패는 모아서 돌려주고 나머지를 계속 진행한다.
 */
export async function runGoogleSync(options: GoogleSyncOptions): Promise<GoogleSyncResult> {
  // 구글은 우리가 이벤트 id를 정하므로 CalDAV의 href 자리에 캘린더 id를 넣어 둔다.
  // planSync는 href를 불투명한 식별자로만 쓴다.
  const plan = planSync(options.tasks, options.state, options.calendarId)
  const state: SyncState = { ...options.state }
  const result: GoogleSyncResult = {
    created: 0,
    updated: 0,
    deleted: 0,
    skippedNoDate: plan.skippedNoDate,
    failures: [],
    state,
    stoppedBy: null
  }

  /** 멈춘 뒤 남은 항목 — 시도하지 않았으니 상태는 건드리지 않고 실패로만 센다. */
  const skip = (taskId: string): void => {
    result.failures.push({ taskId, message: messageOf(result.stoppedBy) })
  }

  const write = async (
    item: { taskId: string; event: Parameters<GoogleCalendarClient['upsertEvent']>[1] },
    counter: 'created' | 'updated'
  ): Promise<void> => {
    if (result.stoppedBy) return skip(item.taskId)
    try {
      await options.client.upsertEvent(options.calendarId, item.event)
      state[item.taskId] = {
        href: options.calendarId,
        etag: null,
        fingerprint: fingerprint(item.event),
        sequence: item.event.sequence
      }
      result[counter]++
    } catch (error) {
      if (isFatal(error)) throw error
      if (isRateLimit(error)) result.stoppedBy = error
      result.failures.push({ taskId: item.taskId, message: messageOf(error) })
    }
  }

  for (const item of plan.creates) await write(item, 'created')
  for (const item of plan.updates) await write(item, 'updated')

  for (const item of plan.deletes) {
    if (result.stoppedBy) {
      skip(item.taskId)
      continue
    }
    try {
      await options.client.deleteEvent(options.calendarId, eventUid(item.taskId))
      delete state[item.taskId]
      result.deleted++
    } catch (error) {
      if (isFatal(error)) throw error
      // 이미 없는 것을 지우려 한 경우도 목표는 달성됐다. 상태에서 빼야 무한 재시도를 막는다.
      if (error instanceof GoogleApiError && (error.code === 'not_found' || error.status === 410)) {
        delete state[item.taskId]
        result.deleted++
        continue
      }
      if (isRateLimit(error)) result.stoppedBy = error
      result.failures.push({ taskId: item.taskId, message: messageOf(error) })
    }
  }

  return result
}

function isFatal(error: unknown): boolean {
  return (
    error instanceof GoogleApiError && (error.code === 'unauthorized' || error.code === 'forbidden')
  )
}

function isRateLimit(error: unknown): error is GoogleApiError {
  return error instanceof GoogleApiError && error.code === 'rate_limit'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
