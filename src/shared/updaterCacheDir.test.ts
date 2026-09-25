/**
 * 업데이터 캐시 디렉터리가 **한 이름**인지 확인한다.
 *
 * electron-builder 는 `publish.updaterCacheDirName` 을 읽지 않는다. app-update.yml 을
 * 쓰는 자리(app-builder-lib/out/publish/PublishManager.js 의
 * `getAppUpdatePublishConfiguration`)가 `{...publishConfigs[0], updaterCacheDirName:
 * packager.appInfo.updaterCacheDirName}` 으로 **우리 값 뒤에** 자기 값을 덮어쓴다.
 * 그 값은 package.json 의 `name` 에서 유도된다(appInfo.js:
 * `sanitizeFileName(name).toLowerCase() + "-updater"`). 그래서 설정에
 * `greenday-updater` 라고 적어도 앱은 평생 `~/Library/Caches/ticktick-updater` 만 쓴다.
 * 실측: 지난 빌드 산출물 dist/mac-arm64/haru.app/Contents/Resources/app-update.yml 이
 * 이미 `updaterCacheDirName: ticktick-updater` 다.
 *
 * **그 거짓말이 실제로 낸 버그**: Homebrew cask 의 zap 목록이 설정을 믿고
 * `~/Library/Caches/greenday-updater` 를 지웠다. 만들어진 적 없는 디렉터리다.
 * `brew uninstall --zap --cask greenday` 가 "전부 지웠다"고 말하면서 내려받은 업데이트
 * .zip(수백 MB)을 디스크에 그대로 남겼다.
 *
 * 이 파일은 그 두 자리를 **하나의 유도 규칙**에 묶는다. 값을 적어 두지 않고
 * package.json 에서 다시 계산하므로, 언젠가 `name` 을 옮길 수 있게 되는 날 cask 목록이
 * 같이 따라오지 않으면 여기서 멈춘다.
 *
 * 저장소 설정 검사인데 `src/` 아래 있는 이유: `vitest.config.ts` 가 include 를 `src/**`
 * 로 못박아서, 밖에 두면 이 파일이 **한 번도 실행되지 않는다**(releaseGate.test.ts 와 같다).
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf-8')

/**
 * electron-builder 가 app-update.yml 에 적는 값을 그대로 다시 계산한다.
 *
 * appInfo.js 의 `sanitizedName.toLowerCase() + "-updater"` 이고, sanitize 는
 * sanitize-filename 의 illegalRe(`/[\/\?<>\\:\*\|"]/g` — 파일명에 못 쓰는 글자)다.
 * 우리 `name` 에는 해당 글자가 없지만, 규칙을 그대로 옮겨 둬야 나중에 `name` 이
 * 바뀌어도 이 계산이 같이 따라간다. 상류가 규칙을 바꾸면 아래 세 번째 it() 이 운다.
 */
function updaterCacheDirNameFromPackageName(name: string): string {
  return `${name.replace(/[/?<>\\:*|"]/g, '').toLowerCase()}-updater`
}

/** release.yml 안 heredoc 의 `zap trash: [...]` 블록만 떼어 온다. */
function caskZapList(workflow: string): string {
  const match = workflow.match(/zap trash:\s*\[([\s\S]*?)\]/)
  if (match == null) throw new Error('release.yml 에서 cask 의 zap trash 목록을 못 찾았다')
  return match[1]
}

/**
 * 주석은 세지 않는다 — 이 저장소는 주석에 키 이름을 자주 적는다(YAML `#`, JS `//`).
 * 줄 전체가 주석인 것만 떨어뜨린다. 줄 안쪽까지 자르면 값에 들어 있는 `#`·`//`
 * (URL 등)를 같이 삼켜서, 검사가 조용히 빈손으로 통과하는 쪽으로 무너진다.
 */
function stripCommentLines(source: string): string {
  return source.replace(/^\s*(?:#|\/\/).*$/gm, '')
}

const PACKAGE_NAME = JSON.parse(read('package.json')).name as string
const CACHE_DIR = updaterCacheDirNameFromPackageName(PACKAGE_NAME)

describe('업데이터 캐시 디렉터리', () => {
  it('cask 의 zap 목록이 앱이 실제로 쓰는 캐시를 지운다', () => {
    const zap = caskZapList(read('.github/workflows/release.yml'))
    expect(zap).toContain(`~/Library/Caches/${CACHE_DIR}`)
  })

  it('빌드 설정이 먹지도 않는 updaterCacheDirName 을 선언하지 않는다', () => {
    // publish 키로도 최상위 키로도 살아남지 못한다(루트는 additionalProperties:false).
    // 적어 두면 읽는 사람이 믿고, cask 목록이 그 거짓말을 따라간다 — 실제로 따라갔다.
    const offenders = ['electron-builder.yml', 'electron-builder.bridge.cjs'].filter((file) =>
      stripCommentLines(read(file)).includes('updaterCacheDirName')
    )
    expect(offenders, `죽은 키를 선언한 파일: ${offenders.join(', ')}`).toEqual([])
  })

  it('실제로 훑는다', () => {
    // 경로가 틀리거나 정규식이 빗나가면 위 두 검사가 빈손으로 조용히 통과한다.
    // 이 줄은 상류(app-builder-lib)가 유도 규칙을 바꿨을 때의 신호이기도 하다.
    expect(CACHE_DIR).toBe('ticktick-updater')
    expect(caskZapList(read('.github/workflows/release.yml')).length).toBeGreaterThan(100)
    expect(stripCommentLines(read('electron-builder.yml'))).toContain('channel: greenday')
  })
})
