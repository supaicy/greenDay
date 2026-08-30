import { describe, it, expect } from 'vitest'
import {
  APP_BUNDLE_ID,
  OAUTH_LOOPBACK_HOST,
  OAUTH_LOOPBACK_PATH,
  loopbackRedirectUri,
  isAppScheme,
  findAppSchemeArg
} from './app-id'

/**
 * 2026-08-06 plan-eng-review에서 만든 테스트.
 *
 * 이 모듈은 그동안 테스트가 0건이었고, 그래서 딥링크 복귀(U-2)를 자동으로 확인할
 * 방법 자체가 없었다. Windows는 콜백을 argv로 넘기기 때문에 여기가 Windows에서만
 * 살아나는 버그가 사는 자리다 — Windows 머신 없이 맥에서 잡으려고 순수 함수로 뺐다.
 */

const CALLBACK = `${APP_BUNDLE_ID}:/oauth2redirect?code=abc123&state=xyz`

describe('isAppScheme', () => {
  it('accepts our own scheme URL', () => {
    expect(isAppScheme(CALLBACK)).toBe(true)
    expect(isAppScheme(`${APP_BUNDLE_ID}:/anything`)).toBe(true)
  })

  it('rejects other schemes', () => {
    expect(isAppScheme('https://accounts.google.com/o/oauth2/v2/auth')).toBe(false)
    expect(isAppScheme('com.other.app:/oauth2redirect')).toBe(false)
    expect(isAppScheme('file:///Applications/Greenday.app')).toBe(false)
  })

  it('rejects a prefix that only looks like ours', () => {
    // 'com.supaicy.haru2:' 는 우리 스킴이 아니다. ':' 까지 붙여서 봐야 한다.
    expect(isAppScheme('com.supaicy.haru2:/oauth2redirect')).toBe(false)
    expect(isAppScheme('com.supaicy.haru')).toBe(false)
  })

  // Windows 레지스트리는 등록된 스킴을 자기 방식대로 정규화해서 넘긴다.
  // RFC 3986에서 스킴은 대소문자 구분이 없으므로 접두사만 접어서 비교한다.
  it('ignores case in the scheme but not in the rest', () => {
    expect(isAppScheme(`COM.SUPAICY.HARU:/oauth2redirect?code=AbC`)).toBe(true)
    expect(isAppScheme(`Com.Supaicy.Haru:/oauth2redirect`)).toBe(true)
  })

  it('survives empty and non-string input', () => {
    expect(isAppScheme('')).toBe(false)
    expect(isAppScheme(undefined as unknown as string)).toBe(false)
    expect(isAppScheme(null as unknown as string)).toBe(false)
  })
})

describe('findAppSchemeArg', () => {
  // 패키징본의 전형적인 argv.
  it('finds the URL in a packaged-app argv', () => {
    expect(findAppSchemeArg(['/Applications/Greenday.app/Contents/MacOS/Greenday', CALLBACK])).toBe(CALLBACK)
  })

  // 개발 중에는 앞에 인자가 더 붙는다. 인덱스로 집으면 여기서 깨진다.
  it('finds the URL even when dev args come first', () => {
    const argv = ['/path/to/electron', '.', '--remote-debugging-port=9222', CALLBACK]
    expect(findAppSchemeArg(argv)).toBe(CALLBACK)
  })

  it('returns null when the app was simply launched twice', () => {
    expect(findAppSchemeArg(['/Applications/Greenday.app/Contents/MacOS/Greenday'])).toBeNull()
    expect(findAppSchemeArg([])).toBeNull()
  })

  it('takes the first callback when several are present', () => {
    const second = `${APP_BUNDLE_ID}:/oauth2redirect?code=second`
    expect(findAppSchemeArg(['exe', CALLBACK, second])).toBe(CALLBACK)
  })

  // 다른 앱의 딥링크나 평범한 파일 경로를 우리 것으로 착각하면 안 된다.
  it('does not mistake other URLs or paths for ours', () => {
    const argv = ['exe', 'https://example.com', 'com.other.app:/x', '/Users/me/note.md']
    expect(findAppSchemeArg(argv)).toBeNull()
  })

  it('trims surrounding whitespace before matching', () => {
    expect(findAppSchemeArg(['exe', `  ${CALLBACK}  `])).toBe(CALLBACK)
  })

  it('survives non-string entries and non-array input', () => {
    expect(findAppSchemeArg(['exe', undefined as unknown as string, CALLBACK])).toBe(CALLBACK)
    expect(findAppSchemeArg(undefined as unknown as string[])).toBeNull()
  })
})

/**
 * C6 — 구글 콜백은 커스텀 스킴이 아니라 루프백으로 온다.
 *
 * 구글의 현행 native-app 계약이 custom URI scheme을 받지 않는다. 스킴 자체는
 * `index.ts`의 배선 때문에 남아 있지만, OAuth와는 무관해졌다.
 */
describe('loopbackRedirectUri', () => {
  it('OS가 준 포트로 루프백 주소를 만든다', () => {
    expect(loopbackRedirectUri(51234)).toBe('http://127.0.0.1:51234/oauth2redirect')
  })

  it('localhost가 아니라 127.0.0.1이다 — localhost는 ::1로 먼저 풀릴 수 있다', () => {
    expect(OAUTH_LOOPBACK_HOST).toBe('127.0.0.1')
    expect(new URL(loopbackRedirectUri(1)).hostname).toBe('127.0.0.1')
  })

  it('경로가 상수와 일치한다 (리스너가 이 경로만 처리한다)', () => {
    expect(new URL(loopbackRedirectUri(1)).pathname).toBe(OAUTH_LOOPBACK_PATH)
  })

  it('더 이상 앱 스킴이 아니다', () => {
    expect(isAppScheme(loopbackRedirectUri(51234))).toBe(false)
  })
})
