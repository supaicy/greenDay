/**
 * 동기화 실행기 — 계획(sync.ts)을 실제 요청으로 옮기는 유일한 지점.
 *
 * 방향은 haru → 캘린더 한쪽이다. 반대 방향(캘린더 → haru)까지 자동으로 반영하면
 * 사용자가 Calendar.app에서 무심코 옮긴 일정이 할일 마감일을 바꿔 버린다. 읽기는
 * 별도 기능으로 둔다.
 */

import { CalDavClient, CalDavError, type CalDavCredentials } from './caldav/client'
import { serializeEvent, type CalendarEvent } from './caldav/ical'
// fingerprint는 sync.ts 것을 그대로 쓴다. 여기서 다시 정의하면 두 계산이 어긋나는
// 순간 모든 항목이 매번 다시 올라간다.
import { eventUid, fingerprint, planSync, type SyncState, type TaskRow } from './caldav/sync'

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

  /** 성공한 쓰기 하나를 상태에 반영한다. 세 자리가 같은 필드를 쓰므로 한곳에 둔다. */
  const record = (taskId: string, href: string, etag: string | null, event: CalendarEvent): void => {
    state[taskId] = { href, etag, fingerprint: fingerprint(event), sequence: event.sequence }
  }

  for (const item of plan.creates) {
    const ics = serializeEvent(item.event, options.now)
    try {
      record(item.taskId, item.href, await client.createEvent(item.href, ics), item.event)
      result.created++
    } catch (error) {
      if (isFatal(error)) throw error
      // **그 자리에 이미 뭔가 있다.** 우리 상태에는 없는데 서버에는 있는 경우는
      // 흔하다 — 연동을 해제했다가 같은 캘린더를 다시 고르면 syncState만 비고
      // 서버의 일정은 그대로다. 예전에는 여기서 그냥 실패로 세고 끝나 그 할일이
      // 영원히 다시 올라가지 못했다.
      if (!isConflict(error)) {
        result.failures.push({ taskId: item.taskId, message: messageOf(error) })
        continue
      }
      try {
        const adopted = await adopt(client, item.taskId, item.href, ics)
        if (adopted) {
          record(item.taskId, item.href, adopted.etag, item.event)
          result.created++
          continue
        }
        result.failures.push({ taskId: item.taskId, message: FOREIGN_EVENT_MESSAGE })
      } catch (retryError) {
        if (isFatal(retryError)) throw retryError
        result.failures.push({ taskId: item.taskId, message: messageOf(retryError) })
      }
    }
  }

  for (const item of plan.updates) {
    const ics = serializeEvent(item.event, options.now)
    try {
      record(item.taskId, item.href, await client.updateEvent(item.href, ics, item.etag), item.event)
      result.updated++
    } catch (error) {
      if (isFatal(error)) throw error
      if (!isConflict(error)) {
        result.failures.push({ taskId: item.taskId, message: messageOf(error) })
        continue
      }
      // **충돌은 "내 etag가 낡았다"이지 "무엇이 있는지 안다"가 아니다.**
      //
      // 예전에는 여기서 `etag: null`만 남기고 다음 동기화로 미뤘는데, 그 null이
      // 생성 경로의 `If-None-Match: *`로 번역돼 **같은 412를 영원히 다시 받았다**.
      // 이제는 서버의 현재 값을 그 자리에서 다시 읽어 복구한다.
      try {
        const adopted = await adopt(client, item.taskId, item.href, ics)
        if (adopted) {
          record(item.taskId, item.href, adopted.etag, item.event)
          result.updated++
          continue
        }
        result.failures.push({ taskId: item.taskId, message: FOREIGN_EVENT_MESSAGE })
      } catch (retryError) {
        if (isFatal(retryError)) throw retryError
        result.failures.push({ taskId: item.taskId, message: messageOf(retryError) })
      }
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

function isConflict(error: unknown): boolean {
  return error instanceof CalDavError && error.code === 'conflict'
}

/**
 * 우리 경로에 남의 일정이 앉아 있을 때의 문구.
 *
 * 덮어쓰지 않는다. href는 UID에서 결정적으로 나오므로 이 상황은 사용자가 직접
 * 만든 일정이 우연히 같은 이름을 가졌거나, 다른 도구가 그 자리를 쓴 것이다.
 * 어느 쪽이든 조용히 지워 버릴 근거가 없다.
 */
const FOREIGN_EVENT_MESSAGE =
  '이 할일의 자리에 다른 일정이 있어 덮어쓰지 않았습니다. 캘린더에서 확인해 주세요.'

/**
 * 충돌 난 리소스를 **그 자리에서** 되찾는다. 되찾았으면 새 etag, 남의 것이면 null.
 *
 * 세 갈래다:
 *   - 사라졌다  → 다시 만든다(우리 것이 될 자리다).
 *   - 우리 UID → 서버의 현재 etag로 한 번 더 갱신한다. 이게 낡은 etag 하나 때문에
 *                영구 실패로 굳던 경로를 끊는다.
 *   - 남의 UID → 건드리지 않는다. 호출처가 사용자에게 알린다.
 */
async function adopt(
  client: CalDavClient,
  taskId: string,
  href: string,
  ics: string
): Promise<{ etag: string | null } | null> {
  const probe = await client.probeEvent(href)
  if (probe === null) return { etag: await client.createEvent(href, ics) }
  // UID를 못 읽는 서버(calendar-data를 안 주는 경우)는 우리 것으로 본다 —
  // href가 우리 UID에서 나온 경로라 그 근거가 이미 있고, 못 읽었다는 이유로
  // 사용자를 영구 실패에 두는 것이 더 나쁘다.
  if (probe.uid !== null && probe.uid !== eventUid(taskId)) return null
  return { etag: await client.updateEvent(href, ics, probe.etag) }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
