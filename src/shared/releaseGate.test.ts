/**
 * 릴리스 경로가 **헬스 스택을 한 번은 돌고** 빌드로 넘어가는지 소스에서 확인한다.
 *
 * electron-vite 가 쓰는 esbuild 는 타입을 검사하지 않고 지우기만 한다 — 실측으로
 * `tsc --noEmit` 이 TS2322 로 죽는 파일을 esbuild 는 exit 0 으로 통과시킨다. 그래서
 * "빌드가 성공했다"는 타입에 대해서도 테스트에 대해서도 아무 말을 하지 않는다. 실제로
 * 이 저장소에는 태그를 밀 때(`.github/workflows/release.yml`)도, 로컬에서 낼 때
 * (`npm run release` → `scripts/release.sh`)도 vitest·tsc·biome 를 한 번이라도 부르는
 * 자리가 없었다. 게이트는 "시크릿 7종이 있는가"와 "서명·공증됐는가" 둘뿐이라 둘 다
 * 빨간 커밋에는 눈이 없다 — 그대로 공증·스테이플된 dmg 가 되어 `--latest` 로 공개되고
 * 설치된 맥에 자동 업데이트로 내려갔다.
 *
 * 가장 아픈 자리: CLAUDE.md 가 라이선스 경계의 **진짜 검사**로 못 박은 것은
 * `ipc-gate.test.ts` 의 런타임 대조(목킹된 `ipcMain.handle` 이 본 채널 집합 ==
 * `registeredTiers()`)와 그 안의 `FREE_CHANNELS` 다. 그게 출하 경로에 안 걸려 있으면,
 * 유료 채널을 `free` 로 잘못 달거나 게이트 밖에 등록한 빌드가 아무 신호 없이 돈 낸
 * 사람과 안 낸 사람에게 똑같이 나간다.
 *
 * 헬스 스택의 **정의는 `package.json` 의 `verify` 한 곳**에만 둔다. 두 경로가 각자
 * 명령을 나열하면 한쪽에만 lint 를 더하는 식으로 갈라진다 — 갈라진 쪽이 릴리스 경로면
 * 그 차이는 사용자가 먼저 발견한다.
 *
 * 저장소 설정 검사인데 `src/` 아래 있는 이유: `vitest.config.ts` 가 include 를
 * `src/**` 로 못박아서, 밖에 두면 이 파일이 **한 번도 실행되지 않는다**.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const WORKFLOW = join(ROOT, '.github', 'workflows', 'release.yml')
const RELEASE_SH = join(ROOT, 'scripts', 'release.sh')
const PACKAGE_JSON = join(ROOT, 'package.json')

/** 주석이 아니라 **실행되는 줄**만 센다. 이 저장소는 주석에 명령 모양을 자주 적는다. */
const stripComments = (source: string): string => source.replace(/^\s*#.*$/gm, '')

const RUNS_VERIFY = /\bnpm\s+run\s+verify\b/
const BUILDS = /electron-vite\s+build/

describe('릴리스 경로 헬스 스택', () => {
  it('verify 가 typecheck · lint · test 셋을 모두 돈다', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf-8')) as {
      scripts: Record<string, string | undefined>
    }
    const verify = pkg.scripts.verify ?? ''
    expect(verify, 'package.json 에 verify 스크립트가 없다').not.toBe('')
    for (const step of ['typecheck', 'lint', 'test']) {
      expect(verify, `verify 가 ${step} 을 안 돈다: "${verify}"`).toContain(step)
    }
  })

  it('release.yml 이 빌드보다 먼저 헬스 스택을 돈다', () => {
    const yml = stripComments(readFileSync(WORKFLOW, 'utf-8'))
    const build = yml.search(BUILDS)
    const gate = yml.search(RUNS_VERIFY)
    // 0개를 훑고 조용히 통과하는 것을 막는다. 경로나 빌드 명령이 바뀌면 여기서 걸린다.
    expect(build, 'release.yml 에서 electron-vite build 를 못 찾았다').toBeGreaterThanOrEqual(0)
    expect(
      gate,
      'release.yml 에 헬스 스택 단계가 없다 — 빨간 커밋이 공증된 dmg 로 나간다'
    ).toBeGreaterThanOrEqual(0)
    expect(gate, '헬스 스택이 빌드 뒤에 있다 — 실패를 공증 20분 뒤에 알게 된다').toBeLessThan(
      build
    )
  })

  it('scripts/release.sh 가 빌드보다 먼저 헬스 스택을 돈다', () => {
    const sh = stripComments(readFileSync(RELEASE_SH, 'utf-8'))
    const build = sh.search(BUILDS)
    const gate = sh.search(RUNS_VERIFY)
    expect(build, 'release.sh 에서 electron-vite build 를 못 찾았다').toBeGreaterThanOrEqual(0)
    expect(
      gate,
      'release.sh 에 헬스 스택이 없다 — 로컬 npm run release 가 그대로 공개까지 간다'
    ).toBeGreaterThanOrEqual(0)
    expect(gate, '헬스 스택이 빌드 뒤에 있다').toBeLessThan(build)
  })
})
