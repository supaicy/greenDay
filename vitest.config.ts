import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// 테스트는 소스(src)만 대상으로 한다. `tsc --build`가 out/ 에 컴파일한 .test.js
// (빌드 산출물, gitignore됨)를 vitest가 중복/구버전으로 실행하지 않도록 제외한다.
const include = ['src/**/*.test.{ts,tsx}']
const exclude = ['**/node_modules/**', 'out/**', 'dist/**']

/**
 * 날짜 계산에 시간대가 실제로 개입하는 파일들. 아래 'west' 프로젝트가 이것만
 * 음수 오프셋에서 한 번 더 돌린다.
 */
const TZ_SENSITIVE = [
  'src/shared/date.test.ts',
  'src/shared/recurrence.test.ts',
  'src/renderer/src/utils/date.test.ts',
  'src/renderer/src/utils/naturalDate.test.ts',
  'src/renderer/src/utils/recurrence.test.ts',
  'src/renderer/src/utils/scheduledTime.test.ts',
  'src/renderer/src/utils/smartLists.test.ts',
  // 빠른 알림이 마감일을 어떻게 읽는지 — Seoul에서는 우연히 맞아떨어진다.
  'src/renderer/src/components/tasks/overlays.test.tsx'
]

export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
  test: {
    projects: [
      {
        resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
        test: {
          name: 'seoul',
          include,
          exclude,
          // 시간대를 고정한다. 날짜 테스트가 실행 머신의 TZ를 따르면, UTC 머신에서는
          // UTC와 로컬이 같아져 "UTC라 하루 밀린다"를 잡으려는 회귀 테스트가 통과해 버린다.
          env: { TZ: 'Asia/Seoul' }
        }
      },
      {
        resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
        test: {
          /**
           * **UTC 서쪽에서 한 번 더 돈다.**
           *
           * Asia/Seoul 고정만으로는 한쪽 방향밖에 못 본다. 오프셋이 +9라서
           * `new Date('YYYY-MM-DD')`(UTC 자정)이 로컬 같은 날 09:00이 되고,
           * "쓸 때는 로컬 / 읽을 때는 UTC"라는 비대칭이 통째로 가려졌다.
           *
           * 2026-09-25 진단에서 실측: 미주 사용자에게는 오늘 마감인 할일이
           * "어제"로 뜨고 연체로 표시됐는데, 테스트 1450개가 전부 초록이었다.
           * 음수 오프셋에서도 돌려야 그 비대칭이 드러난다.
           */
          name: 'west',
          include: TZ_SENSITIVE,
          exclude,
          env: { TZ: 'America/New_York' }
        }
      }
    ]
  }
})
