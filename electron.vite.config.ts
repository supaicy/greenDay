import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID ?? ''

/**
 * 릴리스 빌드인가. 릴리스 워크플로(GitHub Actions)와 scripts/release.sh ·
 * scripts/mas-preflight.sh 를 거치는 빌드가 여기 해당한다. 로컬에서 `npm run build`
 * 나 `npm run package` 로 시험 빌드를 만드는 것은 릴리스가 아니므로 막지 않는다 —
 * 그 경우 경고만 남긴다(개발 빌드를 약하게 만들지 않는다).
 */
const IS_RELEASE_BUILD = process.env.GREENDAY_RELEASE === '1' || process.env.GITHUB_ACTIONS === 'true'

export default defineConfig(({ command }) => {
  if (command === 'build' && GOOGLE_CLIENT_ID === '') {
    const problem =
      'GOOGLE_OAUTH_CLIENT_ID 가 비어 있습니다 — 이 빌드는 Google 캘린더 연동이 ' +
      '"이 빌드에는 설정되어 있지 않습니다"로 나갑니다.'
    if (IS_RELEASE_BUILD) {
      // 2026-08 감사 [U-1]: 클라이언트 ID 없이 나간 빌드는 Google 연동이 통째로 죽는데,
      // 빌드는 멀쩡히 성공해서 사용자가 먼저 발견한다. 릴리스에서는 여기서 멈춘다.
      throw new Error(
        `${problem}\n` +
          '릴리스/MAS 빌드는 클라이언트 ID 없이 나갈 수 없습니다.\n' +
          '  - GitHub Actions: Settings → Secrets → GOOGLE_OAUTH_CLIENT_ID 를 등록하세요.\n' +
          '  - 로컬 릴리스: GOOGLE_OAUTH_CLIENT_ID=<id> npm run release  (또는 mas:build)\n' +
          '  값은 Google Cloud 콘솔의 "데스크톱 앱" 유형 OAuth 클라이언트 ID 입니다(비밀 아님).'
      )
    }
    console.warn(`[electron.vite] 경고: ${problem} (릴리스 빌드였다면 실패했을 것입니다)`)
  }

  return {
    main: {
      define: {
        // 구글 OAuth 클라이언트 ID. 데스크톱 앱은 공개 클라이언트라 이 값은 비밀이
        // 아니다(PKCE가 보호한다). 빌드 때 주입하지 않으면 설정에서 직접 넣을 수 있다.
        // 릴리스 빌드에서 비어 있으면 위에서 멈춘다.
        __GOOGLE_CLIENT_ID__: JSON.stringify(GOOGLE_CLIENT_ID),
        // **개발 빌드인가 — 빌드 시점에 못 박는다.**
        //
        // `is.dev`(=`!app.isPackaged`)는 런타임 탐지라, 출하한 asar를 맨 Electron으로
        // 열면 "개발 중"으로 보인다. 그걸로 enforcement를 끄면 앱의 JS를 고치는
        // 것보다 **싼** 우회가 생긴다 — 이 설계가 넘지 않기로 한 선이다.
        // 여기서 주입한 값은 번들에 리터럴로 박히므로 실행 방식으로 바뀌지 않는다.
        __IS_DEV_BUILD__: JSON.stringify(process.env.NODE_ENV !== 'production')
      },
      plugins: [externalizeDepsPlugin()]
    },
    preload: {
      plugins: [externalizeDepsPlugin()]
    },
    renderer: {
      define: {
        __APP_VERSION__: JSON.stringify(pkg.version)
      },
      build: {
        // 없으면 렌더러가 미압축으로 나간다(1.47MB → 절반 이하).
        minify: 'esbuild'
      },
      resolve: {
        alias: {
          '@': resolve('src/renderer/src')
        }
      },
      plugins: [react()]
    }
  }
})
