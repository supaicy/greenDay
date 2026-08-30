/**
 * 암호문에 **용도와 주인**을 새겨 넣는 봉투.
 *
 * ## 왜 필요한가 (M3 — 혼동 대리인)
 *
 * `safeStorage` 암호문은 무맥락이다. 같은 키로 만들어졌다는 것 말고는 아무것도
 * 말하지 않으므로, `userData`에 쓸 수 있는 주체는 **암호문을 옮기는 것만으로**
 * 한 비밀을 다른 비밀인 척하게 만들 수 있다. 공격자가 암호화를 할 필요조차 없다 —
 * 이미 있는 값을 다른 파일의 다른 칸에 붙여 넣으면 된다.
 *
 * 실제로 재현된 경로: `google-config.json`의 `tokens_enc`를
 * `calendar-config.json`의 `password_enc`로 옮기면, 복호화된 **Google OAuth 토큰
 * JSON 전체가** CalDAV의 `Authorization: Basic` 값이 되어 공격자 서버로 나간다.
 *
 * 그래서 평문이 아니라 **암호문 안에** 용도(`purpose`)와 주인(`account`)을 함께
 * 봉인한다. 파일을 고쳐서는 그 둘을 바꿀 수 없고(암호화 권한이 없다), 읽을 때
 * 기대한 값과 정확히 같지 않으면 거절한다.
 *
 * ## 이 파일의 운명
 *
 * wt-shell이 AI 설정 쪽에 같은 목적의 `sealSecret`/`openSecret`을 만들고 있다.
 * **머지할 때 하나로 합쳐야 한다** — 형식(`v`·`purpose`·`account`)을 맞춰 두었으므로
 * 저장된 값은 호환되지만, 구현이 둘로 남으면 다음 번 형식 변경이 한쪽만 따라간다.
 */

import type { KeyCrypto } from './database'

/**
 * 봉투 형식 번호. 형식을 바꾸면 올린다.
 *
 * 모르는 번호는 **거절한다** — 관대하게 읽으면 옛 형식으로 위장한 값이 통과한다.
 */
export const ENVELOPE_VERSION = 1

/**
 * 이 비밀이 무엇에 쓰이는가. 서로 다른 저장소의 값이 절대 같은 값을 갖지 않아야 한다.
 *
 * 문자열 리터럴 유니온이라, 새 용도를 추가하면 여기에 적지 않고는 컴파일되지 않는다.
 */
export type SecretPurpose = 'caldav.password' | 'google.tokens'

interface Envelope {
  v: number
  purpose: string
  account: string
  secret: string
}

/**
 * 비밀을 용도·주인에 묶어 암호화한다. 암호화가 불가능하거나 실패하면 null.
 *
 * null을 던지지 않고 돌려주는 이유: 호출처는 "평문으로 흘리느니 저장하지 않는다"를
 * 이미 하고 있고, 여기서 던지면 설정 저장 전체가 실패한다.
 */
export function sealSecret(
  secret: string,
  purpose: SecretPurpose,
  account: string,
  crypto: KeyCrypto
): string | null {
  if (!secret || !crypto.available()) return null
  try {
    const envelope: Envelope = { v: ENVELOPE_VERSION, purpose, account, secret }
    return crypto.encrypt(JSON.stringify(envelope))
  } catch {
    return null
  }
}

/**
 * 봉투를 열고 **용도와 주인이 기대한 것과 정확히 같을 때만** 비밀을 돌려준다.
 *
 * 하나라도 어긋나면 null이다. 여기서 관대해지면 이 파일이 존재하는 이유가 사라진다 —
 * 거절해야 할 유일한 상황이 "다른 곳에서 옮겨 온 암호문"이기 때문이다.
 *
 * **옛 형식(봉투 없는 맨 암호문)은 받지 않는다.** 받으면 다른 저장소의 맨 문자열
 * 비밀(예: AI API 키)을 여기 붙여 넣는 경로가 그대로 열린 채로 남는다. 그 값은
 * CalDAV 비밀번호와 생김새가 구별되지 않아서, 내용으로는 절대 가를 수 없다.
 * 그 대가는 이미 저장된 비밀번호를 한 번 다시 입력받는 것이고, 자격증명이 공격자
 * 서버로 나가는 것보다 싸다.
 */
export function openSecret(
  ciphertext: string,
  purpose: SecretPurpose,
  account: string,
  crypto: KeyCrypto
): string | null {
  if (!ciphertext || !crypto.available()) return null

  let plain: string
  try {
    plain = crypto.decrypt(ciphertext)
  } catch {
    // 다른 기기·다른 키체인에서 복사된 파일. 사용자에게 다시 입력받아야 한다.
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(plain)
  } catch {
    // 봉투가 아니다 — 옛 형식이거나 남의 저장소에서 옮겨 온 맨 문자열이다.
    return null
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const envelope = parsed as Partial<Envelope>
  if (envelope.v !== ENVELOPE_VERSION) return null
  if (envelope.purpose !== purpose) return null
  if (envelope.account !== account) return null
  if (typeof envelope.secret !== 'string' || !envelope.secret) return null
  return envelope.secret
}

/**
 * 봉투가 어느 계정의 것인지 읽는다 — **용도만 맞으면 되고 주인은 묻지 않는다.**
 *
 * `openSecret`은 주인까지 알아야 열 수 있는데, CalDAV 쪽은 "저장된 비밀번호가 지금
 * 설정과 같은 오리진·계정의 것인가"를 **판단하기 위해** 그 주인이 필요하다(M1).
 * 닭과 달걀이라, 판단에 쓸 값만 따로 꺼내는 통로를 둔다.
 *
 * 비밀 자체는 돌려주지 않는다. 용도가 다르면 아예 null이다.
 */
export function peekAccount(ciphertext: string, purpose: SecretPurpose, crypto: KeyCrypto): string | null {
  if (!ciphertext || !crypto.available()) return null
  try {
    const parsed: unknown = JSON.parse(crypto.decrypt(ciphertext))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const envelope = parsed as Partial<Envelope>
    if (envelope.v !== ENVELOPE_VERSION) return null
    if (envelope.purpose !== purpose) return null
    return typeof envelope.account === 'string' ? envelope.account : null
  } catch {
    return null
  }
}

/** CalDAV 비밀번호의 주인 — 오리진과 계정을 함께 묶는다(M1의 결속과 같은 쌍이다). */
export function caldavAccount(origin: string, username: string): string {
  return `${origin}|${username}`
}
