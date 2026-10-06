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
}

export interface GoogleSyncOptions {
  client: GoogleCalendarClient
  calendarId: string
  tasks: TaskRow[]
  state: SyncState
}

/**
 * 인증 실패(401/403)는 즉시 중단한다. 토큰이 죽은 채로 항목마다 호출하면 할당량만
 * 태우고 결과는 같다. 그 외 개별 실패는 모아서 돌려주고 나머지를 계속 진행한다.
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
    state
  }

  const write = async (
    item: { taskId: string; event: Parameters<GoogleCalendarClient['upsertEvent']>[1] },
    counter: 'created' | 'updated'
  ): Promise<void> => {
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
      result.failures.push({ taskId: item.taskId, message: messageOf(error) })
    }
  }

  for (const item of plan.creates) await write(item, 'created')
  for (const item of plan.updates) await write(item, 'updated')

  for (const item of plan.deletes) {
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
