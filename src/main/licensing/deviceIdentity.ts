/**
 * 이 기기의 안정적이고 프라이버시를 지키는 식별자.
 *
 * 서버는 원본 하드웨어 값을 절대 모른다 — 제품 고유 salt를 섞어 해시한 값만 받는다.
 * 두 사람이 라이선스 하나를 나눠 쓰면 여기서 서로 다른 값이 나오는 것이 요점이고,
 * 그게 기기 한도가 성립하는 근거 전부다.
 */

import { createHash } from 'node:crypto'

/**
 * BicMac의 `bicmac.device.v1`과 **반드시 달라야 한다.**
 *
 * 같으면 한 대의 Mac이 두 제품에서 같은 해시를 내고, 서버가 두 제품의 구매자를
 * 맞춰볼 수 있게 된다. salt는 정확히 그걸 막으려고 있다.
 */
export const DEVICE_SALT = 'greenday.device.v1'

export interface DeviceProbes {
  platform: string
  /** 명령을 돌려 stdout을 준다. 실패하면 null. */
  runCommand: (command: string, args: string[]) => string | null
  readTextFile: (path: string) => string | null
  /** 하드웨어에서 못 읽었을 때 쓰는, 디스크에 보관되는 난수 id. */
  fallbackId: () => string
}

export function hashDeviceId(raw: string): string {
  return createHash('sha256').update(`${DEVICE_SALT}:${raw}`, 'utf-8').digest('hex')
}

/**
 * 하드웨어에서 읽은 값을 해시해 돌려준다. 못 읽으면 대체 id를 쓴다.
 *
 * 대체 id는 약한 식별자다 — 설정을 지우면 리셋된다. 그래도 새 구멍은 아니다:
 * 트라이얼 시작일도 같은 곳에 있어서 어차피 같이 리셋된다. Electron 앱에서
 * 목표는 깨지지 않는 DRM이 아니라 우회에 의도적인 노력이 들게 하는 것까지다.
 */
export function resolveDeviceId(probes: DeviceProbes): string {
  return hashDeviceId(readRawId(probes) ?? probes.fallbackId())
}

function readRawId(probes: DeviceProbes): string | null {
  switch (probes.platform) {
    case 'darwin':
      // 레지스트리 경로가 아니라 클래스로 찾는다 — 플랫폼 전문가의 경로가
      // Intel(AppleACPIPlatformExpert)과 Apple Silicon(AppleARMPE)에서 다르다.
      // **절대 경로로 부른다.** 맨 이름이면 PATH를 타고, Windows의 CreateProcess는
      // 앱 디렉터리와 현재 폴더를 PATH보다 먼저 본다. `ioreg`라는 이름의 두 줄짜리
      // 스크립트를 놓아 두면 기기 해시를 원하는 값으로 만들 수 있고, 그러면 토큰의
      // 기기 결속과 서버의 기기 한도가 동시에 무의미해진다. 불가능하게 만들지는
      // 못해도, 비용을 "PATH에 스크립트 하나"에서 "바이너리를 고친다"로 올린다.
      return match(
        probes.runCommand('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']),
        /"IOPlatformUUID"\s*=\s*"([^"]+)"/
      )
    case 'win32':
      return match(
        probes.runCommand(`${windowsRoot()}\\System32\\reg.exe`, [
          'query',
          'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
          '/v',
          'MachineGuid'
        ]),
        /MachineGuid\s+REG_SZ\s+(\S+)/
      )
    case 'linux':
      return nonEmpty(probes.readTextFile('/etc/machine-id'))
    default:
      return null
  }
}

/**
 * 파싱 실패를 성공으로 오해하면 안 된다.
 *
 * 빈 문자열을 돌려주면 모든 기기가 같은 해시를 갖게 되고, 기기 한도가 통째로
 * 무의미해진다 — 한 사람의 키가 세상 모든 설치에서 이미 활성화된 것처럼 보인다.
 */
function match(output: string | null, re: RegExp): string | null {
  if (!output) return null
  return nonEmpty(re.exec(output)?.[1] ?? null)
}

/**
 * Windows 디렉터리. `SystemRoot`를 **그대로 믿지 않는다.**
 *
 * 절대 경로로 부르는 이유가 "PATH에 놓인 가짜를 막는 것"인데, 뿌리를 환경변수에서
 * 가져오면 그 변수를 바꿔 같은 일을 할 수 있다 — `SystemRoot=D:\\fake` 로 띄우고
 * `D:\\fake\\System32\\reg.exe` 를 놓으면 기기 해시를 원하는 값으로 만든다.
 * 드라이브 문자 + `\Windows` 모양일 때만 받아들이면, 그 우회의 비용이
 * "환경변수 하나"에서 "시스템 디렉터리에 쓰기"로 올라간다.
 */
function windowsRoot(): string {
  const root = process.env.SystemRoot
  return root && /^[A-Za-z]:\\Windows$/i.test(root) ? root : 'C:\\Windows'
}

function nonEmpty(value: string | null): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
