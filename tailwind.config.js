/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: ['./src/renderer/src/**/*.{js,ts,jsx,tsx}', './src/renderer/index.html'],
  theme: {
    extend: {
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)'
        // sm은 재정의하지 않는다 — ui 컴포넌트가 쓰지 않는데
        // 앱 곳곳의 rounded-sm만 2px→4px로 바뀐다.
      },
      colors: {
        // ── shadcn 의미 토큰 → index.css의 CSS 변수. 기존 색 정의는 아래 그대로 남는다.
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        // 기본 gray(채도 28~39%, 한랭)를 중립 계열로 전면 교체 (TODOS [P2], 2026-08-15).
        // 700~950은 Apple 시스템 그레이 = 아래 surface 토큰과 같은 값이라, 큰 면이
        // 맞붙어도 색 계열이 갈라지지 않는다. 400~600은 기존 대비 사다리를 유지하도록
        // 명도를 맞춘 중립값(실측: 500 on white 4.83→4.70 AA, 400 on #1C1C1E 6.70 동일,
        // 400 on #2C2C2E 5.49 — 2026-07-29 설정 화면 실측치와 일치).
        gray: {
          50: '#F8F8FA',
          100: '#F2F2F7',
          200: '#E4E4E9',
          300: '#D2D2D7',
          400: '#A2A2A8',
          500: '#73737B',
          600: '#54545C',
          700: '#48484A',
          800: '#3A3A3C',
          900: '#2C2C2E',
          950: '#1C1C1E'
        },
        primary: {
          // shadcn이 쓰는 bg-primary / text-primary-foreground
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          // 기존 스케일 — bg-primary-500 등 현재 코드가 그대로 동작한다
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: 'hsl(var(--primary))', // 브랜드 색의 유일한 출처는 index.css의 --primary
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
  plugins: [require('tailwindcss-animate')]
}
