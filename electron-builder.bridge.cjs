/**
 * 브리지 릴리스 — 옛 번들 ID(com.haru.app)로 나가는 **마지막** 버전 v1.5.0.
 *
 * 기본 설정(electron-builder.yml)을 읽어 번들 ID·버전·자산 이름·URL 스킴·feed만 바꾼다.
 * YAML `extends`를 쓰지 않는 이유: electron-builder는 배열을 **합친다** — `mac.protocols`를
 * 덮어쓰려 했더니 새 스킴과 옛 스킴이 둘 다 Info.plist에 들어갔다(실측). JS 설정은 정확히
 * 원하는 객체를 돌려준다.
 *
 * 빌드: `npm run package:bridge` (BRIDGE_BUILD=1 로 electron-vite 가 __BRIDGE_BUILD__ 를 박는다).
 * 절차와 feed 분리는 docs/2026-09-07-브리지-릴리스.md.
 */
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const yaml = require('js-yaml')

const base = yaml.load(readFileSync(join(__dirname, 'electron-builder.yml'), 'utf8'))

/** 실제로 배포된 v1.4.1의 CFBundleIdentifier. src/shared/app-id.ts 의 LEGACY_BUNDLE_ID 와 같아야 한다. */
const LEGACY_BUNDLE_ID = 'com.haru.app'
/** src/shared/app-id.ts 의 BRIDGE_VERSION, electron.vite.config.ts 의 BRIDGE_VERSION 과 같아야 한다. */
const BRIDGE_VERSION = '1.5.0'
/** 사이트가 쓰는 고정 이름(Greenday-<arch>.dmg)과 겹치지 않게 — 브리지가 "최신 다운로드"로 잡히면 안 된다. */
const ARTIFACT = `Greenday-${BRIDGE_VERSION}-bridge-\${arch}.\${ext}`

module.exports = {
  ...base,
  appId: LEGACY_BUNDLE_ID,
  // package.json 을 건드리지 않고 이 빌드의 버전만 바꾼다.
  extraMetadata: { version: BRIDGE_VERSION },
  mac: {
    ...base.mac,
    artifactName: ARTIFACT,
    protocols: [{ name: 'Greenday', schemes: [LEGACY_BUNDLE_ID] }]
  },
  dmg: { ...base.dmg, artifactName: ARTIFACT },
  publish: {
    ...base.publish,
    // 옛 앱이 읽는 파일 이름은 `latest-mac.yml` — 기본 설정의 `channel: greenday` 를 되돌린다.
    channel: 'latest',
    updaterCacheDirName: 'ticktick-updater'
  }
}
