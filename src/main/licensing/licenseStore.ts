/**
 * 라이선스 상태의 보관 — `userData/license.json`.
 *
 * 할일 데이터(`ticktick-data.json`)와 **다른 파일**인 이유 셋:
 *   - 내보내기/가져오기가 라이선스를 실어 나르면 안 된다.
 *   - 사용자가 데이터를 복원해도 라이선스가 같이 되돌아가면 안 된다.
 *   - QA용 데이터 백업이 라이선스 상태를 건드리지 않아야 한다.
 *
 * 이 파일은 사용자가 열어 고칠 수 있다. **그래도 된다** — 여기 적힌 값 중 권한을
 * 만드는 것은 하나도 없다. 상태는 서명 검증을 통과한 토큰에서만 파생되고,
 * `lastSeen`·`trialStart`는 조작해봐야 트라이얼을 일찍 끝내거나(무의미) 그
 * 자리에서 클램프된다. 파일을 통째로 지우면 트라이얼이 리셋되는데, 그건
 * 의도된 트레이드오프다 — Electron 앱에서 목표는 깨지지 않는 DRM이 아니라
 * 우회에 의도적인 노력이 들게 하는 것까지다.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'

export interface LicenseRecord {
  /** 사용자가 입력한 키. 재검증에 다시 보낸다. */
  key: string | null
  /** 서버가 서명한 활성화 토큰 — 유일한 권한 증거. */
  token: string | null
  /** 이 앱이 본 적 있는 가장 나중 시각(ms). 올라가기만 하는 래칫. */
  lastSeenMs: number
  /** 트라이얼이 열린 시각(ms). enforcement가 켜진 뒤에만 기록된다. */
  trialStartMs: number | null
}

export interface LicenseStore {
  read(): LicenseRecord
  write(record: LicenseRecord): void
}

export const EMPTY_RECORD: LicenseRecord = { key: null, token: null, lastSeenMs: 0, trialStartMs: null }

export function createFileStore(filePath: string): LicenseStore {
  return {
    read: () => parseRecord(readRaw(filePath)),
    write: (record) => {
      try {
        writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8')
      } catch {
        // 디스크가 안 되면 이번 실행 동안 메모리 상태로 계속 간다. 여기서
        // 던지면 앱이 시작하다 죽는데, 라이선스를 못 적은 것보다 나쁜 결과다.
      }
    }
  }
}

function readRaw(filePath: string): unknown {
  try {
    if (!existsSync(filePath)) return null
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

/**
 * 손으로 고쳐진 파일에서도 항상 온전한 레코드가 나오게 한다.
 *
 * 타입이 어긋난 값을 그대로 통과시키면 `lastSeenMs`가 문자열이 되고 시각 비교가
 * 조용히 이상해진다 — 그 조용함이 여기서는 곧 만료되지 않는 상태다.
 */
function parseRecord(raw: unknown): LicenseRecord {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...EMPTY_RECORD }
  const o = raw as Record<string, unknown>
  return {
    key: typeof o.key === 'string' ? o.key : null,
    token: typeof o.token === 'string' ? o.token : null,
    lastSeenMs: typeof o.lastSeenMs === 'number' && Number.isFinite(o.lastSeenMs) ? o.lastSeenMs : 0,
    trialStartMs:
      typeof o.trialStartMs === 'number' && Number.isFinite(o.trialStartMs) ? o.trialStartMs : null
  }
}
