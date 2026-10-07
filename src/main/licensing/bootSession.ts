/**
 * 벽시계와 **무관한** 시간 경과의 증거 — 순수 함수만. OS도 디스크도 읽지 않는다.
 *
 * 왜 필요한가. `trialWindow.ts`의 래칫(`lastSeen`)은 벽시계 관측값만 모은다.
 * 시계를 묶어 두거나 되돌리면 그 관측값이 늘지 않으므로 트라이얼도 만료도
 * 움직이지 않는다. 프로세스 안에서는 `setTimeout`이 단조 시계로 재므로 그 구간이
 * 메워지지만, **앱을 끄면 그 증거가 통째로 사라진다** — 벽시계를 고정한 채
 * 마감 전에 반복해서 껐다 켜면 단조 경과가 매번 0에서 다시 시작한다.
 *
 * 그래서 프로세스 밖에서도 살아남는 증거가 필요하다: OS의 uptime이다. uptime은
 * 벽시계를 고쳐도 따라가지 않고, 부팅 이후 실제로 흐른 시간만 센다.
 *
 * 이 파일은 "체크포인트 하나와 지금의 부팅 세션을 비교해 **최소 얼마가 확실히
 * 흘렀는가**"만 답한다. 답은 항상 하한이다 — 모르면 0을 낸다. 과소평가는
 * 트라이얼을 늦게 닫고, 과대평가는 정직한 사용자의 창을 일찍 닫는다.
 */

/** 디스크에 남기는 관측 지점. `licenseStore`의 레코드에 실려 다닌다. */
export interface MonotonicCheckpoint {
  /**
   * 이 관측이 어느 부팅 세션의 것인가. 못 읽었으면 null.
   *
   * 없어도 아래 판정은 성립한다(uptime만으로도 하한이 나온다) — 있으면 그 하한이
   * 더 조여질 뿐이다. Windows처럼 싼 부팅 식별자가 없는 플랫폼을 위해 선택적이다.
   */
  bootId: string | null
  /** 그 순간의 uptime(ms). */
  uptimeMs: number
}

/** 지금의 부팅 세션. */
export interface BootSession {
  id: string | null
  uptimeMs: number
}

export interface BootProbes {
  platform: string
  /** 명령을 돌려 stdout을 준다. 실패하면 null. `deviceIdentity.ts`와 같은 계약이다. */
  runCommand: (command: string, args: string[]) => string | null
  readTextFile: (path: string) => string | null
  /** 부팅 후 경과 **초**. `node:os`의 `uptime()`. */
  uptimeSeconds: () => number
}

/**
 * 이 부팅 세션의 식별자. 벽시계에서 파생되지 않은 값만 쓴다.
 *
 * macOS의 `kern.boottime`을 쓰지 않는 이유가 그것이다 — 그건 "부팅 시각"이라
 * 사용자가 시계를 고치면 같이 움직이고, 그러면 시계를 고칠 때마다 새 부팅으로
 * 보인다. `kern.bootsessionuuid`는 부팅마다 커널이 새로 만드는 UUID라 시계와 무관하다.
 *
 * **절대 경로로 부른다.** `deviceIdentity.ts`가 같은 이유를 길게 적어 뒀다:
 * 맨 이름이면 PATH를 타고, `sysctl`이라는 이름의 스크립트 하나로 이 값을
 * 원하는 대로 만들 수 있다.
 */
export function readBootId(probes: BootProbes): string | null {
  switch (probes.platform) {
    case 'darwin':
      return nonEmpty(probes.runCommand('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid']))
    case 'linux':
      // 커널이 부팅마다 새로 만드는 UUID. 읽는 데 권한이 필요 없다.
      return nonEmpty(probes.readTextFile('/proc/sys/kernel/random/boot_id'))
    default:
      // Windows에는 싼 부팅 식별자가 없다. null이어도 uptime 규칙이 남는다.
      return null
  }
}

/**
 * 초 단위 uptime을 ms로. 못 믿을 값은 0으로 떨어뜨린다 — 그러면 아래 판정이
 * "모른다"(0)를 내고, 남은 벽시계 관측이 그 자리를 메운다.
 *
 * 따로 내보내는 이유: 호출처는 부팅 식별자를 **한 번만** 읽고 uptime은 **매번**
 * 읽는다(그게 이 값의 존재 이유다). 둘을 한 함수로 묶어 두면 uptime을 물을
 * 때마다 서브프로세스가 돈다.
 */
export function uptimeMsOf(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds * 1000) : 0
}

export function readBootSession(probes: BootProbes): BootSession {
  return { id: readBootId(probes), uptimeMs: uptimeMsOf(probes.uptimeSeconds()) }
}

/**
 * 체크포인트 이후 **확실히 흐른** 시간의 하한(ms).
 *
 * 세 경우뿐이다.
 *
 *   1. **체크포인트가 없다** → 0. 아직 잴 기준이 없다. 이번 관측이 기준이 된다.
 *   2. **다른 부팅 세션이다** → 지금의 uptime. 한 기계에서 부팅 세션은 직렬이므로,
 *      체크포인트가 적힌 세션은 이번 부팅이 시작하기 **전에** 끝났다. 따라서 실제
 *      경과는 최소한 "부팅 이후 흐른 시간" = 지금의 uptime이다.
 *   3. **같은 세션이다** → `지금 uptime - 적어둔 uptime`. 같은 부팅 안에서 uptime은
 *      단조 증가하므로 그 차이가 그대로 실제 경과다.
 *
 * 식별자가 없을 때도 답이 나온다. uptime이 뒤로 갔다면 그건 재부팅이 확실하므로
 * 2번이고, 앞으로 갔다면 같은 세션이든 다른 세션이든 그 차이는 하한이다
 * (다른 세션이면 실제 경과는 지금의 uptime이라 더 크다 — 하한으로서 여전히 옳다).
 *
 * **파일을 다른 기계에서 복사해 온 경우도 안전하다.** 그쪽 세션 id는 여기와
 * 다르므로 2번으로 떨어져 지금의 uptime만큼 앞당겨진다 — 창을 일찍 닫는 방향이다.
 */
export function elapsedSinceCheckpoint(checkpoint: MonotonicCheckpoint | null, session: BootSession): number {
  if (!checkpoint) return 0
  if (checkpoint.bootId !== null && session.id !== null && checkpoint.bootId !== session.id) {
    return session.uptimeMs
  }
  // **`>=`다.** 같으면 "같은 부팅, 아직 아무 시간도 안 흘렀다"이므로 0이다.
  // `>`로 두면 그 경우가 아래의 재부팅 갈래로 떨어져 **지금까지의 uptime 전체를
  // 다시** 얹는다 — 부를 때마다 그 값이 더해져, 유료 IPC 몇 번으로 30일 창이
  // 통째로 타 버린다. 실제로 그렇게 썼다가 트라이얼 테스트가 잡았다.
  if (session.uptimeMs >= checkpoint.uptimeMs) return session.uptimeMs - checkpoint.uptimeMs
  // uptime이 **줄었다** = 재부팅. 식별자가 없어도 이건 확실하다.
  return session.uptimeMs
}

/** 관측 지점을 지금으로 옮긴다. 같은 구간을 두 번 세지 않기 위해 매 관측마다 부른다. */
export function checkpointOf(session: BootSession): MonotonicCheckpoint {
  return { bootId: session.id, uptimeMs: session.uptimeMs }
}

export function sameCheckpoint(a: MonotonicCheckpoint | null, b: MonotonicCheckpoint): boolean {
  return a !== null && a.bootId === b.bootId && a.uptimeMs === b.uptimeMs
}

function nonEmpty(value: string | null): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
