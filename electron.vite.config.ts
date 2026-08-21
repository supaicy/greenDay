import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json'

export default defineConfig({
  main: {
    define: {
      // 구글 OAuth 클라이언트 ID. 데스크톱 앱은 공개 클라이언트라 이 값은 비밀이
      // 아니다(PKCE가 보호한다). 빌드 때 주입하지 않으면 설정에서 직접 넣을 수 있다.
      __GOOGLE_CLIENT_ID__: JSON.stringify(process.env.GOOGLE_OAUTH_CLIENT_ID ?? ''),
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
})
