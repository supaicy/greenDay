/**
 * MAS 프리플라이트(`scripts/mas-preflight.sh`)의 **설치 패키지(.pkg) 인증서** 점검.
 *
 * 이 스크립트가 있는 이유는 "빌드는 성공하는데 나중에야 터지는 문제"를 빌드 **전에**
 * 잡는 것이다. 그런데 1/6 의 설치 인증서 검사가 한때
 * `3rd Party Mac Developer Installer|Apple Distribution` 으로 걸러서, **앱** 서명
 * 인증서인 'Apple Distribution' 만 깔린 맥에서도 초록으로 통과했다. electron-builder 는
 * MAS pkg 를 flatten 할 때 이름으로 정확히 '3rd Party Mac Developer Installer:' 만
 * 찾으므로(app-builder-lib 의 macPackager → findIdentity), 그런 맥은 유니버설 빌드를
 * 두 아키텍처 다 돌리고 병합·서명까지 마친 **뒤에** 실패한다 — 프리플라이트는 그동안
 * 인증서가 괜찮다고 말해 둔 상태라, 개발자에게는 electron-builder 버그처럼 읽힌다.
 *
 * 실제 키체인은 읽지 않는다. `security` 를 PATH 앞의 가짜로 바꿔 "이 맥에 무슨 인증서가
 * 있는가"를 테스트가 정한다 — 그러지 않으면 인증서를 다 가진 개발자 머신에서는 이 회귀가
 * 영원히(그리고 엉뚱한 이유로) 통과한다.
 */

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REPO = join(__dirname, '..', '..')
const SCRIPT = join(REPO, 'scripts', 'mas-preflight.sh')

const APP_CERT = '  1) AAAA "Apple Distribution: BeGreen (TEAM12345)"'
const INSTALLER_CERT = '  2) BBBB "3rd Party Mac Developer Installer: BeGreen (TEAM12345)"'

/**
 * `security` 흉내. `-p codesigning` 은 서명 정책 신원만, 옵션 없는 `-v` 는 설치용까지
 * 전부 내놓는다 — 스크립트가 두 줄에서 서로 다르게 부르는 이유가 그것이다.
 *
 * 목록은 heredoc 으로 **한 번에** 뱉는다. 줄마다 echo 하면 `grep -q` 가 첫 줄에서 먼저
 * 끝나 버리는 순간 남은 echo 가 SIGPIPE 로 죽고, 스크립트의 `set -o pipefail` 이 그 141 을
 * 파이프라인 결과로 삼아 "인증서 없음" 으로 뒤집힌다. 진짜 security 는 출력이 작아 한 번에
 * 다 쓰므로, 흉내도 그래야 같은 것을 재는 셈이 된다.
 */
function stubSecurity(have: { app: boolean; installer: boolean }): string {
  const dir = mkdtempSync(join(tmpdir(), 'greenday-preflight-'))
  const bin = join(dir, 'security')
  const all = [have.app ? APP_CERT : '', have.installer ? INSTALLER_CERT : ''].filter((row) => row !== '')
  const codesigning = have.app ? [APP_CERT] : []
  // 종료 태그는 반드시 줄 맨 앞이어야 한다 — 들여쓰면 heredoc 이 안 닫힌다.
  const heredoc = (tag: string, rows: string[]): string => [`cat <<'${tag}'`, ...rows, tag].join('\n')
  writeFileSync(
    bin,
    [
      '#!/usr/bin/env bash',
      'if [ "$1" = "find-identity" ]; then',
      '  if [[ " $* " == *" -p codesigning "* ]]; then',
      heredoc('CODESIGNING', codesigning),
      '  else',
      heredoc('ALL', all),
      '  fi',
      '  exit 0',
      'fi',
      'exit 1',
      ''
    ].join('\n')
  )
  chmodSync(bin, 0o755)
  return dir
}

/** 프리플라이트를 돌리고 화면에 나온 것을 통째로 돌려준다. 종료 코드는 여기 관심이 아니다. */
function preflight(have: { app: boolean; installer: boolean }): string {
  try {
    return execFileSync('bash', [SCRIPT], {
      cwd: REPO,
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: `${stubSecurity(have)}:${process.env.PATH}`,
        // 프로파일 검사(2/6)는 여기 관심이 아니다. 없는 경로를 줘서 건너뛴다 —
        // 그래야 가짜 security 가 `cms -D` 까지 흉내 낼 필요가 없다.
        MAS_PROVISIONING_PROFILE: '/nonexistent/preflight-test.provisionprofile'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (e) {
    // 인증서가 없으면 스크립트는 exit 1 로 끝난다(그게 요점이다). 그때도 화면은 읽어야 한다.
    const failed = e as { stdout?: string; stderr?: string }
    return `${failed.stdout ?? ''}${failed.stderr ?? ''}`
  }
}

describe('mas-preflight · 인증서(1/6)', () => {
  it('설치 인증서가 없으면 앱 인증서가 있어도 통과시키지 않는다', () => {
    const out = preflight({ app: true, installer: false })
    expect(out).toContain('설치 패키지(.pkg) 서명 인증서 없음')
    expect(out).not.toContain('설치 패키지 서명 인증서 있음')
  })

  it('앱 인증서 검사는 Apple Distribution 을 그대로 받는다', () => {
    // 3rd Party Mac Developer Application 의 새 이름이다. 여기까지 좁히면 거짓 경보가 된다.
    expect(preflight({ app: true, installer: false })).toContain('앱 서명 인증서 있음')
  })

  it('둘 다 있으면 둘 다 통과한다', () => {
    const out = preflight({ app: true, installer: true })
    expect(out).toContain('앱 서명 인증서 있음')
    expect(out).toContain('설치 패키지 서명 인증서 있음')
  })

  it('실제로 스크립트를 돌린다', () => {
    // 경로가 틀리면 위 단언들이 빈 문자열을 상대로 조용히 통과한다.
    expect(preflight({ app: false, installer: false })).toContain('1/6  인증서')
  })
})
