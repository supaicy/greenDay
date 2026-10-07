/**
 * 테스트 전용 — `key`가 같아야 풀리는 가짜 safeStorage. 같은 키면 풀리고 다른 키면
 * 던진다(실제 `safeStorage.decryptString`과 같은 계약). 실제 Keychain 없이 "옛 앱의 키"와
 * "새 앱의 키"를 흉내 낸다. 테스트 파일에서 export 할 수 없어(biome) 여기 둔다.
 */
import type { KeyCrypto } from '../database'

export function fakeCrypto(key: string, available = true): KeyCrypto {
  return {
    available: () => available,
    encrypt: (s) => Buffer.from(`${key}:${s}`, 'utf-8').toString('base64'),
    decrypt: (b64) => {
      const plain = Buffer.from(b64, 'base64').toString('utf-8')
      const sep = plain.indexOf(':')
      if (sep < 0 || plain.slice(0, sep) !== key) throw new Error('decryption failed (wrong key)')
      return plain.slice(sep + 1)
    }
  }
}
