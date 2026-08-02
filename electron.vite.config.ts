import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json'

export default defineConfig({
  main: {
    define: {
      // 구글 OAuth 클라이언트 ID. 데스크톱 앱은 공개 클라이언트라 이 값은 비밀이
      // 아니다(PKCE가 보호한다). 빌드 때 주입하지 않으면 설정에서 직접 넣을 수 있다.
      __GOOGLE_CLIENT_ID__: JSON.stringify(process.env.GOOGLE_OAUTH_CLIENT_ID ?? '')
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
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
