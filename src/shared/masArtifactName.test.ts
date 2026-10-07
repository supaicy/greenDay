import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * **`mas:upload` 이 `mas:build` 의 산출물을 실제로 집는가.**
 *
 * `scripts/mas-upload.sh` 는 `dist` 에서 `<productName>-<version>*.pkg` 를 찾는다.
 * 그런데 `electron-builder.yml` 의 `mas:` 블록이 `artifactName` 을 적지 않으면
 * `mac.artifactName`(`${productName}-${arch}.${ext}` — 고정 다운로드 주소 때문에
 * 일부러 버전을 뺐다)을 그대로 물려받아 `Greenday-universal.pkg` 가 나온다
 * (app-builder-lib 의 macPackager 가 `deepAssign({}, mac, mas)` 로 MAS 옵션을 만든다).
 * 이름에 버전이 없으니 스크립트의 glob 은 영원히 빗나가고, 빌드가 성공한 직후에도
 * "올릴 pkg가 없습니다. 먼저 빌드하세요" 로 끝난다 — 빌드와 업로드가 서로를
 * 가리키는 무한루프가 되고 App Store 출시 경로가 통째로 죽는다.
 *
 * 그래서 두 파일 중 한쪽만 봐서는 안 된다. **이름을 만드는 쪽(설정)과 찾는 쪽
 * (스크립트)이 같은 이름을 말하는지**를 여기서 묶는다. 패턴 문자열만 비교하면
 * glob 문법이나 출력 디렉터리가 바뀔 때 조용히 통과하므로 스크립트를 진짜로 돌린다.
 *
 * 실제 빌드는 Apple 인증서가 있어야 하므로 여기서는 산출물 이름만 설정에서 다시
 * 계산해 빈 파일로 놓아둔다. 확인하려는 것이 이름의 일치 하나라서 그것으로 충분하다.
 */

const REPO = resolve(__dirname, '../..')

/** `electron-builder --mac mas --universal` 의 출력 디렉터리(`getArchSuffix`: 기본 arch 는 x64). */
const OUT_DIR = 'dist/mas-universal'

describe('MAS 산출물 이름', () => {
  it('mas:upload 가 mas:build 가 내놓는 pkg 를 찾는다', () => {
    const pkgName = masPkgName()
    const sandbox = mkdtempSync(join(tmpdir(), 'mas-upload-'))
    try {
      // 스크립트는 전부 cwd 기준으로 읽는다(`electron-builder.yml`, `./package.json`, `dist`).
      mkdirSync(join(sandbox, OUT_DIR), { recursive: true })
      writeFileSync(join(sandbox, OUT_DIR, pkgName), 'pkg')
      copy('electron-builder.yml', sandbox)
      copy('package.json', sandbox)
      // 진짜 Keychain 도 altool 도 건드리지 않는다 — 여기서 자격증명이 잡히면
      // 테스트가 App Store Connect 로 업로드를 시도한다.
      mkdirSync(join(sandbox, 'bin'))
      for (const stub of ['security', 'xcrun']) {
        writeFileSync(join(sandbox, 'bin', stub), '#!/bin/sh\nexit 1\n')
        chmodSync(join(sandbox, 'bin', stub), 0o755)
      }

      const run = spawnSync('bash', [join(REPO, 'scripts/mas-upload.sh')], {
        cwd: sandbox,
        // 터미널이 아니어야 스크립트가 Apple ID 를 묻지 않고 그 자리에서 멈춘다.
        stdio: ['ignore', 'pipe', 'pipe'],
        // 개발자 셸에 Apple 자격증명이 들어 있어도 2/3 을 넘지 못하게 비운다.
        env: {
          ...process.env,
          PATH: `${join(sandbox, 'bin')}:${process.env.PATH}`,
          APPLE_ID: '',
          APPLE_APP_PASSWORD: ''
        },
        encoding: 'utf-8'
      })

      // 1/3 을 지났는지 — 찾기 단계까지는 반드시 돌았다는 확인.
      expect(run.stdout).toContain('1/3')
      expect(run.stderr).not.toContain('올릴 pkg가 없습니다')
      expect(run.stdout).toContain(`${OUT_DIR}/${pkgName}`)
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })
})

/** `electron-builder --mac mas --universal` 이 만드는 pkg 파일 이름. */
function masPkgName(): string {
  const yml = readFileSync(join(REPO, 'electron-builder.yml'), 'utf-8')
  const productName = /^productName:\s*(.+)$/m.exec(yml)?.[1].trim()
  const version = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf-8')).version
  expect(productName).toBeTruthy()
  expect(version).toBeTruthy()
  // `mas:` 가 비면 `mac:` 을 물려받고(deepAssign), 둘 다 없으면 electron-builder 기본값.
  // biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder 매크로 문법 그대로다 — 우리가 보간하는 값이 아니다
  const DEFAULT_PATTERN = '${productName}-${version}-${arch}.${ext}'
  const pattern = blockScalar(yml, 'mas', 'artifactName') ?? blockScalar(yml, 'mac', 'artifactName') ?? DEFAULT_PATTERN
  const macros: Record<string, string> = {
    productName: String(productName),
    version: String(version),
    arch: 'universal',
    ext: 'pkg'
  }
  return pattern.replace(/\$\{(\w+)\}/g, (whole, name: string) => macros[name] ?? whole)
}

/**
 * `electron-builder.yml` 의 한 블록 안 스칼라 하나. yaml 파서를 새로 들이지 않고
 * 필요한 만큼만 읽는다 — 두 칸 들여쓴 `키: 값` 한 줄이 전부다.
 *
 * 들여쓰기를 다시 맞춘 사람이 있으면 undefined 로 떨어져 `mac:` 패턴을 쓰게 되고,
 * 그러면 이 테스트가 조용히 통과하는 대신 큰 소리로 실패한다 — 안전한 방향이다.
 */
function blockScalar(yml: string, block: string, key: string): string | undefined {
  const lines = yml.split('\n')
  const start = lines.indexOf(`${block}:`)
  if (start < 0) return undefined
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') continue
    if (!/^\s/.test(line)) break // 다음 최상위 블록
    const match = /^ {2}([A-Za-z0-9_]+):\s*(.+?)\s*$/.exec(line)
    if (match?.[1] === key) return match[2].replace(/^['"]|['"]$/g, '')
  }
  return undefined
}

function copy(name: string, sandbox: string): void {
  writeFileSync(join(sandbox, name), readFileSync(join(REPO, name), 'utf-8'))
}
