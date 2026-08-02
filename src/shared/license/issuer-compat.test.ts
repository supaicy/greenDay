import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { verifyLicense } from './format'
import { makeVerifier } from './crypto'
import { LICENSE_PUBLIC_KEY } from './public-key'

/**
 * 발급 도구(scripts/license.mjs)와 앱 검증 코드는 canonicalize를 각각 구현하고 있다.
 * 둘이 한 바이트라도 어긋나면 발급한 모든 키가 거부되는데, 각자의 단위 테스트로는
 * 절대 드러나지 않는다. 실제로 발급해서 실제로 검증해 본다.
 */
describe('발급 도구 ↔ 앱 검증 호환성', () => {
  const hasKeys = existsSync('.license-keys/private.pem')

  it.skipIf(!hasKeys)('발급한 키를 앱이 그대로 통과시킨다', () => {
    const output = execFileSync(
      'node',
      ['scripts/license.mjs', 'issue', '--name', '테스트 구매자', '--email', 't@example.com', '--seats', '2', '--dry-run'],
      { encoding: 'utf-8' }
    )
    const key = output.split('\n').find((line) => line.startsWith('eyJ'))
    expect(key).toBeTruthy()

    const result = verifyLicense(key as string, makeVerifier(LICENSE_PUBLIC_KEY))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.payload.name).toBe('테스트 구매자')
      expect(result.payload.seats).toBe(2)
      expect(result.payload.expiresAt).toBeNull()
    }
  })

  it.skipIf(!hasKeys)('기간제 라이선스도 만료일이 실려 나온다', () => {
    const output = execFileSync(
      'node',
      ['scripts/license.mjs', 'issue', '--name', '구독자', '--email', 's@example.com', '--days', '365', '--dry-run'],
      { encoding: 'utf-8' }
    )
    const key = output.split('\n').find((line) => line.startsWith('eyJ')) as string
    const result = verifyLicense(key, makeVerifier(LICENSE_PUBLIC_KEY))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.payload.expiresAt).toBeTruthy()
  })
})
