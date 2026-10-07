import { Play, Pause, RotateCcw, SkipForward } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import {
  usePomodoroStore,
  POMODORO_DURATIONS,
  POMODORO_LONG_BREAK_EVERY,
  type PomodoroMode
} from '../../store/usePomodoroStore'

const MODES: { key: PomodoroMode; labelKey: string; color: string }[] = [
  { key: 'work', labelKey: 'pomodoro.work', color: '#E74C3C' },
  { key: 'shortBreak', labelKey: 'pomodoro.shortBreak', color: '#2ECC71' },
  { key: 'longBreak', labelKey: 'pomodoro.longBreak', color: '#4A90D9' }
]

// 점 개수는 긴 휴식 주기에서 파생한다. 상수를 바꿨는데 점이 그대로면 둘이 어긋난다.
const SESSION_DOTS = Array.from({ length: POMODORO_LONG_BREAK_EVERY }, (_, i) => i)
const RADIUS = 140

// 타이머 상태와 1초 틱은 스토어와 usePomodoroTicker가 갖는다. 이 컴포넌트는
// 순수 표시 + 조작만 한다 — 언마운트돼도 카운트다운이 이어지도록.
export function PomodoroTimer() {
  const { t } = useTranslation()
  const isDark = useStore((s) => s.theme) === 'dark'
  const mode = usePomodoroStore((s) => s.mode)
  const timeLeft = usePomodoroStore((s) => s.timeLeft)
  const running = usePomodoroStore((s) => s.running)
  const sessions = usePomodoroStore((s) => s.sessions)
  const switchMode = usePomodoroStore((s) => s.switchMode)
  const toggleRun = usePomodoroStore((s) => s.toggleRun)
  const reset = usePomodoroStore((s) => s.reset)
  const skip = usePomodoroStore((s) => s.skip)

  const currentMode = MODES.find((m) => m.key === mode) ?? MODES[0]
  const duration = POMODORO_DURATIONS[mode]

  const minutes = Math.floor(timeLeft / 60)
  const seconds = timeLeft % 60
  const circumference = 2 * Math.PI * RADIUS
  const strokeDashoffset = circumference * (timeLeft / duration)

  return (
    <div className={`flex-1 flex flex-col items-center justify-center min-h-0 ${isDark ? 'bg-[#1C1C1E]' : 'bg-white'}`}>
      {/* 모드 선택 */}
      <div className="flex gap-2 mb-12">
        {MODES.map((m) => (
          <button
            type="button"
            key={m.key}
            onClick={() => switchMode(m.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === m.key
                ? 'text-white'
                : isDark
                  ? 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                  : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
            }`}
            style={mode === m.key ? { backgroundColor: `${m.color}33`, color: m.color } : {}}
          >
            {t(m.labelKey)}
          </button>
        ))}
      </div>

      {/* 원형 타이머 */}
      <div className="relative w-80 h-80 mb-10">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 300 300">
          <title>{t('pomodoro.progress')}</title>
          <circle cx="150" cy="150" r={RADIUS} fill="none" stroke={isDark ? '#333' : '#E5E5E5'} strokeWidth="6" />
          <circle
            cx="150"
            cy="150"
            r={RADIUS}
            fill="none"
            stroke={currentMode.color}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-all duration-1000 ease-linear"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-6xl font-light tabular-nums ${isDark ? 'text-gray-100' : 'text-gray-800'}`}>
            {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
          </span>
          <span className="text-sm text-gray-500 mt-2">{t(currentMode.labelKey)}</span>
        </div>
      </div>

      {/* 컨트롤 */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={reset}
          aria-label={t('pomodoro.reset')}
          className={`p-3 rounded-full transition-colors ${isDark ? 'text-gray-500 hover:text-gray-300 hover:bg-gray-800' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
        >
          <RotateCcw size={22} />
        </button>
        <button
          type="button"
          onClick={toggleRun}
          aria-label={t(running ? 'pomodoro.pause' : 'pomodoro.start')}
          className="p-5 rounded-full text-white transition-colors"
          style={{ backgroundColor: currentMode.color }}
        >
          {running ? <Pause size={28} /> : <Play size={28} className="ml-1" />}
        </button>
        <button
          type="button"
          onClick={() => void skip()}
          aria-label={t('pomodoro.skip')}
          className={`p-3 rounded-full transition-colors ${isDark ? 'text-gray-500 hover:text-gray-300 hover:bg-gray-800' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
        >
          <SkipForward size={22} />
        </button>
      </div>

      {/* 세션 카운트 */}
      <div className="flex items-center gap-2 mt-8">
        {SESSION_DOTS.map((i) => {
          const filled = i < sessions % POMODORO_LONG_BREAK_EVERY
          return (
            <div
              key={i}
              className={`w-3 h-3 rounded-full transition-colors ${filled ? '' : isDark ? 'bg-gray-700' : 'bg-gray-300'}`}
              style={filled ? { backgroundColor: currentMode.color } : {}}
            />
          )
        })}
        <span className="text-xs text-gray-500 ml-2">{t('pomodoro.sessions', { n: sessions })}</span>
      </div>
    </div>
  )
}
