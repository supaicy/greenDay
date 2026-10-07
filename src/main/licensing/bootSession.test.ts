/**
 * 부팅 세션 — 벽시계와 무관한 시간 경과의 하한.
 *
 * 이 파일이 지키는 성질 하나: **답은 언제나 하한이다.** 모르면 0이고, 과대평가는
 * 정직한 사용자의 창을 일찍 닫는다. 여기서 부호 하나가 틀리면 증상이 조용하다 —
 * 30일 트라이얼이 며칠 만에 닫히거나, 반대로 영영 안 닫힌다.
 */

import { describe, it, expect } from 'vitest'
import {
  checkpointOf,
  elapsedSinceCheckpoint,
  readBootId,
  readBootSession,
  sameCheckpoint,
  uptimeMsOf,
  type BootProbes,
  type MonotonicCheckpoint
} from './bootSession'

const HOUR = 60 * 60 * 1000

function probes(over: Partial<BootProbes> = {}): BootProbes {
  return {
    platform: 'darwin',
    runCommand: () => null,
    readTextFile: () => null,
    uptimeSeconds: () => 0,
    ...over
  }
}

describe('elapsedSinceCheckpoint', () => {
  it('기준이 없으면 0이다 — 이번 관측이 기준이 된다', () => {
    expect(elapsedSinceCheckpoint(null, { id: 'a', uptimeMs: 5 * HOUR })).toBe(0)
  })

  it('같은 부팅이면 uptime의 차이가 곧 경과다', () => {
    const at = { bootId: 'a', uptimeMs: 2 * HOUR }
    expect(elapsedSinceCheckpoint(at, { id: 'a', uptimeMs: 7 * HOUR })).toBe(5 * HOUR)
  })

  it('**uptime이 그대로면 0이다** — 재부팅으로 읽으면 안 된다', () => {
    // `>` 로 쓰면 이 경우가 재부팅 갈래로 떨어져 지금까지의 uptime **전체**를
    // 다시 얹는다. 이 함수는 유료 IPC마다 불리므로 그 값이 매번 누적돼,
    // 30일 창이 몇 번의 호출로 타 버린다. 실제로 그렇게 썼다가 잡혔다.
    const at = { bootId: 'a', uptimeMs: 9 * HOUR }
    expect(elapsedSinceCheckpoint(at, { id: 'a', uptimeMs: 9 * HOUR })).toBe(0)
  })

  it('부팅 세션이 다르면 지금의 uptime만큼은 확실히 흘렀다', () => {
    // 한 기계에서 부팅은 직렬이다. 저 체크포인트가 적힌 세션은 이번 부팅이
    // 시작하기 전에 끝났으므로, 실제 경과는 최소한 "부팅 이후"만큼이다.
    const at = { bootId: 'old', uptimeMs: 100 * HOUR }
    expect(elapsedSinceCheckpoint(at, { id: 'new', uptimeMs: 3 * HOUR })).toBe(3 * HOUR)
  })

  it('식별자가 없어도 uptime이 줄었으면 재부팅이다', () => {
    // Windows에는 싼 부팅 식별자가 없다. 그래도 uptime이 뒤로 갔다는 사실만으로
    // 재부팅을 알 수 있고, 그 경우의 하한은 지금의 uptime이다.
    const at: MonotonicCheckpoint = { bootId: null, uptimeMs: 50 * HOUR }
    expect(elapsedSinceCheckpoint(at, { id: null, uptimeMs: 2 * HOUR })).toBe(2 * HOUR)
  })

  it('식별자가 한쪽만 있으면 uptime 규칙으로 떨어진다', () => {
    // 프로브가 이번 실행에서만 실패했거나(반대도) — 어느 쪽이든 차이는 하한이다.
    expect(elapsedSinceCheckpoint({ bootId: 'a', uptimeMs: HOUR }, { id: null, uptimeMs: 4 * HOUR })).toBe(3 * HOUR)
    expect(elapsedSinceCheckpoint({ bootId: null, uptimeMs: HOUR }, { id: 'a', uptimeMs: 4 * HOUR })).toBe(3 * HOUR)
  })

  it('다른 기계에서 복사해 온 파일은 창을 일찍 닫는다 — 안전한 방향이다', () => {
    // 남의 체크포인트는 세션 id가 달라 재부팅 갈래로 떨어진다. 얻는 것이 없다.
    const stolen = { bootId: 'someone-elses-mac', uptimeMs: 0 }
    expect(elapsedSinceCheckpoint(stolen, { id: 'mine', uptimeMs: 12 * HOUR })).toBe(12 * HOUR)
  })
})

describe('uptimeMsOf', () => {
  it('초를 ms로 바꾼다', () => {
    expect(uptimeMsOf(90)).toBe(90_000)
  })

  it('못 믿을 값은 0으로 — 그러면 판정이 "모른다"를 낸다', () => {
    // 0은 이 모듈에서 안전한 기본값이다: 경과를 과소평가할 뿐 권한을 만들지 않는다.
    expect(uptimeMsOf(Number.NaN)).toBe(0)
    expect(uptimeMsOf(Number.POSITIVE_INFINITY)).toBe(0)
    expect(uptimeMsOf(-5)).toBe(0)
  })
})

describe('readBootId', () => {
  it('macOS는 kern.bootsessionuuid를 절대 경로로 읽는다', () => {
    // 맨 이름이면 PATH를 타고, `sysctl`이라는 이름의 스크립트 하나로 이 값을
    // 원하는 대로 만들 수 있다 — `deviceIdentity.ts`와 같은 이유다.
    const seen: { command: string; args: string[] }[] = []
    const id = readBootId(
      probes({
        platform: 'darwin',
        runCommand: (command, args) => {
          seen.push({ command, args })
          return '93D8644F-D2DC-43FA-B8BA-F602D8CCEE9E\n'
        }
      })
    )
    expect(id).toBe('93D8644F-D2DC-43FA-B8BA-F602D8CCEE9E')
    expect(seen).toEqual([{ command: '/usr/sbin/sysctl', args: ['-n', 'kern.bootsessionuuid'] }])
  })

  it('**부팅 시각이 아니라 세션 UUID를 쓴다**', () => {
    // `kern.boottime`은 벽시계에서 파생돼 사용자가 날짜를 고치면 같이 움직인다 —
    // 그러면 시계를 고칠 때마다 새 부팅으로 보이고, 이 모듈의 근거가 무너진다.
    const asked: string[] = []
    readBootId(
      probes({
        runCommand: (_c, args) => {
          asked.push(args.join(' '))
          return null
        }
      })
    )
    expect(asked.join()).not.toContain('boottime')
  })

  it('리눅스는 커널이 부팅마다 새로 만드는 boot_id를 읽는다', () => {
    const read: string[] = []
    const id = readBootId(
      probes({
        platform: 'linux',
        readTextFile: (path) => {
          read.push(path)
          return 'c1f2e3d4-0000-1111-2222-333344445555\n'
        }
      })
    )
    expect(id).toBe('c1f2e3d4-0000-1111-2222-333344445555')
    expect(read).toEqual(['/proc/sys/kernel/random/boot_id'])
  })

  it('Windows에는 싼 식별자가 없다 — null이고, uptime 규칙이 남는다', () => {
    expect(readBootId(probes({ platform: 'win32' }))).toBeNull()
  })

  it('빈 출력은 성공이 아니다', () => {
    // 빈 문자열을 통과시키면 모든 기기가 같은 세션 id를 갖는다.
    expect(readBootId(probes({ runCommand: () => '   \n' }))).toBeNull()
  })
})

describe('readBootSession', () => {
  it('식별자와 uptime을 함께 준다', () => {
    const session = readBootSession(
      probes({ runCommand: () => 'ABC-123', uptimeSeconds: () => 3600 })
    )
    expect(session).toEqual({ id: 'ABC-123', uptimeMs: 3_600_000 })
  })
})

describe('checkpointOf / sameCheckpoint', () => {
  it('관측 지점을 지금으로 옮긴다', () => {
    expect(checkpointOf({ id: 'a', uptimeMs: 7 })).toEqual({ bootId: 'a', uptimeMs: 7 })
  })

  it('같은 지점이면 다시 쓰지 않는다 — 디스크를 아낀다', () => {
    expect(sameCheckpoint({ bootId: 'a', uptimeMs: 7 }, { bootId: 'a', uptimeMs: 7 })).toBe(true)
    expect(sameCheckpoint({ bootId: 'a', uptimeMs: 7 }, { bootId: 'a', uptimeMs: 8 })).toBe(false)
    expect(sameCheckpoint({ bootId: 'a', uptimeMs: 7 }, { bootId: 'b', uptimeMs: 7 })).toBe(false)
    expect(sameCheckpoint(null, { bootId: 'a', uptimeMs: 7 })).toBe(false)
  })
})
