/**
 * MAS 업로드(`scripts/mas-upload.sh`)가 **확인하지 못한 pkg를 올리지 않는지**.
 *
 * 2026-10-06 codex 검토에서 발견: 유니버설 확인이 실행 파일을 `-maxdepth 3`으로 찾았는데
 * 실제 위치(`dist/mas-universal/Greenday.app/Contents/MacOS/Greenday`)는 pkg 옆에서 깊이 4라
 * 한 번도 찾지 못했다. 못 찾으면 조용히 넘어가서 이 검사는 실제로 돈 적이 없었다.
 * 또 pkg 이름에는 버전만 들어가므로, 버전을 안 올린 채 소스를 고치고 빌드를 잊으면
 * 지난 pkg가 그대로 올라갔다.
 *
 * 실제 lipo·git·키체인은 쓰지 않는다. PATH 앞에 가짜를 둬서 "무슨 아키텍처인가",
 * "마지막 커밋이 언제인가"를 테스트가 정한다. stdin이 터미널이 아니므로 검사를 다
 * 통과하면 2/3(Apple 계정)에서 "입력받을 수 있는 터미널도 아닙니다"로 멈춘다 —
 * 업로드(xcrun)까지는 절대 가지 않는다.
 */

import { afterAll, describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'mas-upload.sh')
const PKG_TIME = 1_800_000_000

interface Setup {
  /** pkg 옆에 Greenday.app 실행 파일을 둘지 */
  app: boolean
  /** 가짜 lipo -archs 가 내놓을 값 */
  archs: string
  /** 가짜 git log -1 --format=%ct 가 내놓을 마지막 커밋 시각. null이면 git이 실패한다 */
  lastCommit: number | null
  /** 'clt-only'면 기본 git은 실패하고 Command Line Tools(DEVELOPER_DIR)로만 돈다 */
  git?: 'clt-only'
  /** 자격증명 경로. 'env'는 환경변수로, 'keychain'은 Apple ID만 환경변수·암호는 키체인에서 */
  creds?: 'env' | 'keychain'
}

const PASSWORD = 'abcd-efgh-ijkl-mnop'

function stub(dir: string, name: string, body: string): void {
  const file = join(dir, name)
  writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`)
  chmodSync(file, 0o755)
}

const made: string[] = []
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
})

function upload(s: Setup): { code: number | null; out: string; args: string } {
  const root = mkdtempSync(join(tmpdir(), 'greenday-mas-upload-'))
  made.push(root)
  writeFileSync(join(root, 'electron-builder.yml'), 'appId: com.example.test\nproductName: Greenday\n')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '9.9.9' }))
  const outDir = join(root, 'dist', 'mas-universal')
  mkdirSync(outDir, { recursive: true })
  const pkg = join(outDir, 'Greenday-9.9.9-universal.pkg')
  writeFileSync(pkg, 'pkg')
  utimesSync(pkg, PKG_TIME, PKG_TIME)
  if (s.app) {
    const macos = join(outDir, 'Greenday.app', 'Contents', 'MacOS')
    mkdirSync(macos, { recursive: true })
    writeFileSync(join(macos, 'Greenday'), 'bin')
  }

  const bin = mkdtempSync(join(tmpdir(), 'greenday-mas-upload-bin-'))
  made.push(bin)
  stub(bin, 'lipo', `echo "${s.archs}"`)
  // null은 git 자체가 실패하는 맥 — Xcode 라이선스에 동의하지 않으면 /usr/bin/git이 이렇게 된다.
  const gitBody =
    s.lastCommit === null
      ? 'echo "Xcode license" >&2; exit 69'
      : s.git === 'clt-only'
        ? `[ "$DEVELOPER_DIR" = /Library/Developer/CommandLineTools ] || { echo "Xcode license" >&2; exit 69; }; echo ${s.lastCommit}`
        : `echo ${s.lastCommit}`
  stub(bin, 'git', gitBody)
  // 키체인 경로: `security find-generic-password -w`가 암호를 내놓는다.
  stub(bin, 'security', s.creds === 'keychain' ? `echo "${PASSWORD}"` : 'exit 1')
  // 받은 인자를 그대로 적어 둔다 — 암호가 프로세스 목록(argv)에 실렸는지 본다.
  const argsLog = join(root, 'xcrun-args')
  stub(
    bin,
    'xcrun',
    s.creds
      ? // @env:로 넘기면 altool은 자기 환경에서 읽는다 — 거기 없으면 실패하는 진짜와 같게.
        `[ "$APPLE_APP_PASSWORD" = "${PASSWORD}" ] || { echo "NO-ENV-PASSWORD"; exit 1; }; echo "$*" >> "${argsLog}"; echo "XCRUN-CALLED"; case "$*" in *--validate-app*) echo "VERIFY SUCCEEDED";; esac; exit 0`
      : 'echo "XCRUN-CALLED"; exit 1'
  )

  const { APPLE_ID: _id, APPLE_APP_PASSWORD: _pw, ...env } = process.env
  const creds =
    s.creds === 'env'
      ? { APPLE_ID: 'dev@example.com', APPLE_APP_PASSWORD: PASSWORD }
      : s.creds === 'keychain'
        ? { APPLE_ID: 'dev@example.com' }
        : {}
  const r = spawnSync('bash', [SCRIPT], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...env, ...creds, PATH: `${bin}:${process.env.PATH}` },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let args = ''
  try {
    args = readFileSync(argsLog, 'utf-8')
  } catch {
    // xcrun까지 가지 않았다
  }
  return { code: r.status, out: `${r.stdout}${r.stderr}`, args }
}

const FRESH = PKG_TIME - 60
const UNIVERSAL = 'x86_64 arm64'

describe('mas-upload 산출물 검사', () => {
  it('실행 파일을 못 찾으면 계정 단계로 넘어가지 않고 멈춘다', () => {
    const r = upload({ app: false, archs: UNIVERSAL, lastCommit: FRESH })
    expect(r.code).toBe(1)
    expect(r.out).toContain('아키텍처를 확인할 수 없습니다')
    expect(r.out).not.toContain('2/3')
  })

  it('한쪽 아키텍처뿐이면 멈춘다', () => {
    const r = upload({ app: true, archs: 'arm64', lastCommit: FRESH })
    expect(r.code).toBe(1)
    expect(r.out).toContain('유니버설이 아니면')
    expect(r.out).not.toContain('2/3')
  })

  it('pkg 가 마지막 커밋보다 오래됐으면 멈춘다', () => {
    const r = upload({ app: true, archs: UNIVERSAL, lastCommit: PKG_TIME + 60 })
    expect(r.code).toBe(1)
    expect(r.out).toContain('마지막 커밋보다 오래됐습니다')
    expect(r.out).not.toContain('2/3')
  })

  it('git을 못 돌려 마지막 커밋을 모르면 통과시키지 않고 멈춘다', () => {
    // 확인하지 못한 것을 확인한 것처럼 올리지 않는다 — 유니버설 검사와 같은 원칙.
    // 이 검사가 처음 들어갔을 때는 git이 실패하면 조용히 건너뛰었고, 그걸 만든 맥이
    // 바로 git이 막힌 상태였다(2026-10-06 레드팀).
    const r = upload({ app: true, archs: UNIVERSAL, lastCommit: null })
    expect(r.code).toBe(1)
    expect(r.out).toContain('마지막 커밋 시각을 알 수 없습니다')
    expect(r.out).not.toContain('2/3')
  })

  it('Xcode git이 막혀도 Command Line Tools git으로 커밋 시각을 읽어 계속한다', () => {
    const r = upload({ app: true, archs: UNIVERSAL, lastCommit: FRESH, git: 'clt-only' })
    expect(r.out).toContain('2/3')
    expect(r.out).not.toContain('마지막 커밋 시각을 알 수 없습니다')
  })

  // Value: protects=the app-specific password never appears in altool's argv;
  //   fails_when=the script goes back to -p "$APPLE_APP_PASSWORD";
  //   why_new=no test reached the altool calls with credentials before; seam=none
  // argv는 같은 맥의 어떤 프로세스든 `ps`로 읽는다. 검증·업로드는 몇 분 걸린다.
  it('앱 암호를 명령줄 인자로 넘기지 않는다 — 환경변수 참조로만', () => {
    const r = upload({ app: true, archs: UNIVERSAL, lastCommit: FRESH, creds: 'env' })
    expect(r.out).toContain('업로드 완료')
    expect(r.args).toContain('--validate-app')
    expect(r.args).toContain('--upload-app')
    expect(r.args).toContain('@env:APPLE_APP_PASSWORD')
    expect(r.args).not.toContain(PASSWORD)
  })

  // 키체인에서 읽은 암호는 셸 변수일 뿐 환경에 없다 — export가 빠지면 @env:가 빈 값을 읽는다.
  // 환경변수로 받은 경우는 bash가 이미 물려받아 export 없이도 통과하므로 이 경로가 필요하다.
  it('키체인에서 읽은 암호도 altool 환경으로 넘긴다', () => {
    const r = upload({ app: true, archs: UNIVERSAL, lastCommit: FRESH, creds: 'keychain' })
    expect(r.out).not.toContain('NO-ENV-PASSWORD')
    expect(r.out).toContain('업로드 완료')
    expect(r.args).not.toContain(PASSWORD)
  })

  it('최신 유니버설 pkg 면 검사를 통과해 계정 단계로 간다', () => {
    const r = upload({ app: true, archs: UNIVERSAL, lastCommit: FRESH })
    expect(r.out).toContain('(유니버설)')
    expect(r.out).toContain('2/3')
    // 터미널이 아니라 자격증명 입력에서 멈춘다 — 업로드 도구는 불리지 않는다.
    expect(r.out).not.toContain('XCRUN-CALLED')
  })
})
