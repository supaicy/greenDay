import { defineConfig } from 'vitest/config'

// 테스트는 소스(src)만 대상으로 한다. `tsc --build`가 out/ 에 컴파일한 .test.js
// (빌드 산출물, gitignore됨)를 vitest가 중복/구버전으로 실행하지 않도록 제외한다.
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', 'out/**', 'dist/**']
  }
})
