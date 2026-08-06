import { defineConfig } from 'vitest/config'

// 테스트는 소스(src)만 대상으로 한다. `tsc --build`가 out/ 에 컴파일한 .test.js
// (빌드 산출물, gitignore됨)를 vitest가 중복/구버전으로 실행하지 않도록 제외한다.
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', 'out/**', 'dist/**'],
    // 시간대를 고정한다. 날짜 테스트가 실행 머신의 TZ를 따르면, UTC 머신에서는
    // UTC와 로컬이 같아져 "UTC라 하루 밀린다"를 잡으려는 회귀 테스트가 통과해 버린다.
    env: { TZ: 'Asia/Seoul' }
  }
})
