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

import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'

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
  /**
   * 디스크에 확정됐으면 true. 실패는 던지지 않고 여기로 나온다 — 아래 주석.
   *
   * `durable`은 **전원이 끊겨도 살아남아야 하는 쓰기**에만 준다. 아래 fsync 설명 참고.
   */
  write(record: LicenseRecord, durable?: boolean): boolean
}

export const EMPTY_RECORD: LicenseRecord = { key: null, token: null, lastSeenMs: 0, trialStartMs: null }

export function createFileStore(filePath: string): LicenseStore {
  const tempPath = `${filePath}.tmp`
  return {
    read: () => parseRecord(readRaw(filePath)),
    /**
     * **임시 파일에 쓰고 rename으로 바꿔 끼운다.** 제자리에서 자르면 그 사이에
     * 전원이 끊겼을 때 파일이 깨진 JSON으로 남고, `parseRecord`가 그걸 빈
     * 레코드로 읽는다 — 돈 낸 사람의 활성화가 조용히 사라진다. rename은 같은
     * 파일시스템 안에서 원자적이라, 어느 시점에 끊겨도 옛 레코드 아니면 새
     * 레코드이지 그 중간은 없다.
     *
     * 실패를 던지지 않는 것은 그대로다 — 여기서 던지면 앱이 시작하다 죽는데,
     * 라이선스를 못 적은 것보다 나쁜 결과다. 대신 **삼키지도 않는다.**
     * 확정 여부를 돌려주면 활성화가 "성공했다고 답했는데 재시작하면 사라지는"
     * 결과를 피할 수 있다.
     *
     * **fsync는 잃으면 안 되는 것이 실려 있을 때.** rename은 원자적 *교체*이지
     * 내구성 있는 *커밋*이 아니라서, 임시 파일의 내용이 아직 페이지 캐시에만
     * 있으면 성공이라 답한 뒤 전원이 끊겼을 때 빈 파일이 제자리에 남는다.
     * 그런데 이 볼륨(APFS)에서 fsync 한 번은 **약 4ms, 그냥 쓰기의 22배**이고
     * 메인 프로세스를 그대로 세운다. 라이선스가 있는 설치에서는 6시간 재검증
     * 폴이 상태가 안 바뀌어도 매번 한 번씩 쓰므로(하루 4회), 모든 쓰기에 물리면
     * 래칫 하나 올리자고 일주일에 28번 디스크 배리어를 친다.
     *
     * 그래서 배리어를 걸지 말지는 **호출처가 고른다.** 판단 근거가 여기 없기
     * 때문이다: `write()`는 레코드를 통째로 직렬화하므로 래칫 하나 올리는 쓰기도
     * 같은 파일에 키와 토큰을 다시 쓰고, 그게 플러시되기 전에 전원이 끊기면
     * 자가 치유되는 것은 래칫뿐이고 돈 낸 사람의 라이선스는 사라진다. 무엇이
     * 실려 있는지는 `licenseManager.persist()`가 안다 — 규칙은 거기 한 곳에만
     * 둔다(한때 "래칫은 자가 치유되니 안 걸어도 된다"고만 적어 뒀는데, 그
     * 문장은 레코드가 통째로 실린다는 사실을 빠뜨리고 있었다).
     *
     * `writeFileSync(..., { flush: true })`로 줄여 쓰지 말 것. 더 단정해 보이지만
     * 여기서 재보면 0.11ms — 그냥 쓰기(0.15ms)와 구별되지 않고 명시적
     * fsync(4.07ms)의 1/36이다. 배리어가 걸리지 않는다.
     *
     * (rename이 만드는 디렉터리 항목까지 fsync하지는 않는다. 그쪽이 날아가면
     * 남는 것은 **옛 레코드**이지 깨진 파일이 아니라, 재활성화로 회복된다.)
     */
    write: (record, durable = false) => {
      try {
        const json = JSON.stringify(record, null, 2)
        if (durable) {
          const fd = openSync(tempPath, 'w')
          try {
            // `writeSync`가 아니라 `writeFileSync(fd, …)`다. 앞엣것은 짧은 쓰기를
            // **재시도하지 않아서**, 디스크가 가득 차면 부분 쓰기를 예외 없이
            // 돌려준다 — 그러면 잘린 JSON을 rename이 원자적으로 갈아끼우고
            // fsync가 그 잘림을 내구성 있게 못 박은 뒤, 이 함수가 true를 답한다.
            // `writeFileSync`는 루프를 돌고, fd를 받아도 닫지 않아 fsync가 이어진다.
            writeFileSync(fd, json, 'utf-8')
            fsyncSync(fd)
          } finally {
            closeSync(fd)
          }
        } else {
          writeFileSync(tempPath, json, 'utf-8')
        }
        renameSync(tempPath, filePath)
        return true
      } catch {
        // 반쯤 쓰인 임시 파일을 남기지 않는다. 이것마저 실패해도 할 수 있는 게 없다.
        try {
          unlinkSync(tempPath)
        } catch {
          /* 애초에 안 만들어졌다 */
        }
        return false
      }
    }
  }
}

/**
 * 파일을 읽는다. **"없다"와 "못 읽는다"를 가른다.**
 *
 * 예전에는 둘 다 `null`이었고, 그래서 깨진 파일이 새 설치와 구별되지 않았다.
 * enforcement가 켜지면 그 다음이 나쁘다: 트라이얼 레코드를 그 위에 그대로 써서
 * 돈 낸 사람의 키와 토큰이 영구히 사라진다. 같은 라운드에서 `ticktick-data.json`에는
 * 넣은 방어를 여기 빠뜨렸다 — 더 작지만 더 되돌리기 어려운 파일인데.
 *
 * 못 읽으면 원본을 옆으로 복사해 두고 빈 레코드로 시작한다. 사본이 있으면
 * 지원 메일 한 통으로 복구된다.
 */
function readRaw(filePath: string): unknown {
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch (error) {
    try {
      const aside = `${filePath}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`
      copyFileSync(filePath, aside)
      console.error(`[license] 읽기 실패 — 원본을 ${aside}로 복사했다`, error)
    } catch (copyError) {
      console.error('[license] 읽기 실패, 원본 복사도 실패', error, copyError)
    }
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
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY_RECORD }
  const o = raw as Record<string, unknown>
  return {
    key: typeof o.key === 'string' ? o.key : null,
    token: typeof o.token === 'string' ? o.token : null,
    lastSeenMs: typeof o.lastSeenMs === 'number' && Number.isFinite(o.lastSeenMs) ? o.lastSeenMs : 0,
    trialStartMs: typeof o.trialStartMs === 'number' && Number.isFinite(o.trialStartMs) ? o.trialStartMs : null
  }
}
