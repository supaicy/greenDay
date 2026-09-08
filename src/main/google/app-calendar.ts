/**
 * 앱 소유 캘린더 확보 — "어느 캘린더에 쓸까"의 답.
 *
 * `calendar.app.created` 범위에서는 앱이 만든 캘린더만 보인다. 그래서 캘린더는
 * 사용자가 고르는 것이 아니라 여기서 정해진다: 저장해 둔 id가 살아 있으면 그것,
 * 아니면 `Greenday`라는 이름으로 새로 만든다.
 *
 * 목록 API(`calendarList.list`)는 이 범위를 받지 않아 **이름으로 찾을 수 없다.**
 * 그래서 id를 잃으면(설정 파일 삭제 등) 같은 이름의 캘린더가 하나 더 생긴다.
 * 연결 해제에서도 id를 지우지 않는 이유가 그것이다(`ipc-handlers.ts` `google:disconnect`).
 *
 * 순수 함수다 — 클라이언트를 주입받고 설정을 돌려줄 뿐, 저장은 부르는 쪽이 한다.
 */

import type { GoogleCalendar, GoogleCalendarClient } from './calendar'
import type { GoogleConfig } from '../google-config'

/** 계정 안에 만드는 보조 캘린더의 이름. 사용자가 구글에서 바꿔도 id로 따라간다. */
export const APP_CALENDAR_NAME = 'Greenday'

export type AppCalendarClient = Pick<GoogleCalendarClient, 'getCalendar' | 'createCalendar'>

export interface EnsureAppCalendarResult {
  config: GoogleConfig
  /** 이번에 새로 만들었는가. 만들었으면 이전 동기화 상태는 버려져 있다. */
  created: boolean
  calendar: GoogleCalendar
}

export async function ensureAppCalendar(
  client: AppCalendarClient,
  config: GoogleConfig
): Promise<EnsureAppCalendarResult> {
  if (config.calendarId) {
    const existing = await client.getCalendar(config.calendarId)
    if (existing) {
      return {
        config: {
          ...config,
          // 사용자가 구글에서 이름을 바꿨을 수 있다. 화면에는 지금 이름을 보여 준다.
          calendarName: existing.summary || config.calendarName || APP_CALENDAR_NAME,
          enabled: true
        },
        created: false,
        calendar: existing
      }
    }
  }

  const made = await client.createCalendar(APP_CALENDAR_NAME)
  return {
    config: {
      ...config,
      calendarId: made.id,
      calendarName: made.summary || APP_CALENDAR_NAME,
      enabled: true,
      // 다른 캘린더다. 이전 상태는 거기 없는 일정을 가리키므로 처음부터 다시 올린다.
      syncState: {}
    },
    created: true,
    calendar: made
  }
}
