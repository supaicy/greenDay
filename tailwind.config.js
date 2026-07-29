/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/src/**/*.{js,ts,jsx,tsx}', './src/renderer/index.html'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#4A90D9',
          600: '#3B7DD8',
          700: '#2563eb',
          800: '#1e40af',
          900: '#1e3a5f'
        },
        sidebar: {
          bg: '#2C2C2E',
          hover: '#3A3A3C',
          active: '#48484A',
          text: '#E5E5EA',
          muted: '#8E8E93'
        },
        // 다크 모드 표면. Apple 시스템 그레이 계열(채도 1~3%)로, 앱 셸(#1C1C1E)과
        // 사이드바(#2C2C2E)가 이미 쓰던 값이다.
        // Tailwind 기본 gray는 채도 28~39%의 한랭 계열이라, 큰 표면에 쓰면 옆의
        // 중립 표면과 색 계열이 달라 붕 뜬다(상세 패널이 bg-gray-900이라 그랬다).
        surface: {
          canvas: '#1C1C1E', // 메인 리스트 영역
          raised: '#2C2C2E', // 사이드 패널, 모달
          sunken: '#3A3A3C', // 입력칸, 칩
          line: '#48484A', // 패널 바깥 테두리
          divider: '#3A3A3C' // 패널 내부 구분선
        }
      }
    }
  },
  plugins: []
}
