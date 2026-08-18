/**
 * 라이선스 키 형식: `GREENDAY-XXXX-XXXX-XXXX-XXXX`.
 *
 * 알파벳은 서버(`keys.ts`의 ALPHABET)를 그대로 옮긴 것이고, I·L·O·U·0·1이 빠져 있다 —
 * 전화로 불러줄 수 있어야 하기 때문이다. 여기서 형태를 먼저 보면 오타가 네트워크
 * 왕복 전에 잡히고, 무엇보다 **다른 제품의 키가 서버까지 가지 않는다**.
 */

/** 이 제품의 접두사. 서버 `products.key_prefix`와 같은 값이며 출시 후 바뀌지 않는다. */
export const KEY_PREFIX = 'GREENDAY'

const KEY_RE = /^GREENDAY(-[ABCDEFGHJKMNPQRSTVWXYZ23456789]{4}){4}$/

export function normalizeKey(raw: string): string {
  return raw.trim().toUpperCase()
}

export function looksValidKey(raw: string): boolean {
  return KEY_RE.test(normalizeKey(raw))
}
