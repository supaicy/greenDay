import { describe, it, expect } from 'vitest'
import { DEVICE_SALT, hashDeviceId, resolveDeviceId, type DeviceProbes } from './deviceIdentity'

const IOREG_OUT = `+-o J316sAP  <class IOPlatformExpertDevice, id 0x100000271, registered>
    {
      "IOPlatformUUID" = "8F2A11C4-7E3B-5D19-9A02-2C4E6B8D0F13"
      "IOPlatformSerialNumber" = "C02XX1234567"
    }
`

const REG_OUT = `
HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography
    MachineGuid    REG_SZ    3b1f9d24-6a70-4c8e-9f21-0e5d7c48ab93
`

const probes = (over: Partial<DeviceProbes> = {}): DeviceProbes => ({
  platform: 'darwin',
  runCommand: () => null,
  readTextFile: () => null,
  fallbackId: () => 'fallback-uuid',
  ...over
})

describe('hashDeviceId', () => {
  it('원본 하드웨어 값이 아니라 해시를 낸다', () => {
    const raw = '8F2A11C4-7E3B-5D19-9A02-2C4E6B8D0F13'
    const hashed = hashDeviceId(raw)
    expect(hashed).not.toContain(raw)
    expect(hashed).toMatch(/^[0-9a-f]{64}$/)
  })

  it('서버의 128자 한도 안에 든다', () => {
    expect(hashDeviceId('x').length).toBeLessThanOrEqual(128)
  })

  it('같은 기기는 같은 값, 다른 기기는 다른 값', () => {
    expect(hashDeviceId('a')).toBe(hashDeviceId('a'))
    expect(hashDeviceId('a')).not.toBe(hashDeviceId('b'))
  })

  it('salt가 BicMac과 달라 제품 간 대조가 안 된다', () => {
    // 같은 salt를 쓰면 한 Mac이 두 제품에서 같은 해시를 내고, 서버가 두 제품의
    // 구매자를 맞춰볼 수 있게 된다. salt는 정확히 그걸 막으려고 있다.
    expect(DEVICE_SALT).toBe('greenday.device.v1')
    expect(DEVICE_SALT).not.toContain('bicmac')
  })
})

describe('resolveDeviceId — macOS', () => {
  it('ioreg 출력에서 IOPlatformUUID를 꺼낸다', () => {
    const id = resolveDeviceId(probes({ runCommand: () => IOREG_OUT }))
    expect(id).toBe(hashDeviceId('8F2A11C4-7E3B-5D19-9A02-2C4E6B8D0F13'))
  })

  it('ioreg가 실패하면 대체 id로 넘어간다', () => {
    expect(resolveDeviceId(probes({ runCommand: () => null }))).toBe(hashDeviceId('fallback-uuid'))
  })

  it('ioreg가 답은 했는데 UUID가 없으면 대체 id로 넘어간다', () => {
    // 파싱 실패를 성공으로 오해하면 모든 Mac이 같은 해시(빈 문자열의 해시)를 갖게
    // 되고, 기기 한도가 통째로 무의미해진다.
    expect(resolveDeviceId(probes({ runCommand: () => '(nothing useful)' }))).toBe(hashDeviceId('fallback-uuid'))
  })
})

describe('resolveDeviceId — Windows', () => {
  it('레지스트리 출력에서 MachineGuid를 꺼낸다', () => {
    const id = resolveDeviceId(probes({ platform: 'win32', runCommand: () => REG_OUT }))
    expect(id).toBe(hashDeviceId('3b1f9d24-6a70-4c8e-9f21-0e5d7c48ab93'))
  })
})

describe('resolveDeviceId — Linux', () => {
  it('/etc/machine-id를 읽는다', () => {
    const id = resolveDeviceId(
      probes({ platform: 'linux', readTextFile: (p) => (p === '/etc/machine-id' ? 'd9b1a0f4e2c\n' : null) })
    )
    expect(id).toBe(hashDeviceId('d9b1a0f4e2c'))
  })

  it('빈 파일은 못 읽은 것으로 본다', () => {
    expect(resolveDeviceId(probes({ platform: 'linux', readTextFile: () => '   \n' }))).toBe(
      hashDeviceId('fallback-uuid')
    )
  })
})

describe('resolveDeviceId — 모르는 플랫폼', () => {
  it('대체 id를 쓴다', () => {
    expect(resolveDeviceId(probes({ platform: 'aix' }))).toBe(hashDeviceId('fallback-uuid'))
  })
})
