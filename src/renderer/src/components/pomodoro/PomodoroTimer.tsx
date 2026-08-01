import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Pause, RotateCcw, SkipForward } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import i18n from '../../i18n'

type TimerMode = 'work' | 'shortBreak' | 'longBreak'

const MODES: { key: TimerMode; labelKey: string; duration: number; color: string }[] = [
  { key: 'work', labelKey: 'pomodoro.work', duration: 25 * 60, color: '#E74C3C' },
  { key: 'shortBreak', labelKey: 'pomodoro.shortBreak', duration: 5 * 60, color: '#2ECC71' },
  { key: 'longBreak', labelKey: 'pomodoro.longBreak', duration: 15 * 60, color: '#4A90D9' }
]

const SESSION_DOTS = ['dot-a', 'dot-b', 'dot-c', 'dot-d'] as const

export function PomodoroTimer() {
  const { t } = useTranslation()
  const { theme, savePomodoroSession } = useStore()
  const isDark = theme === 'dark'
  const [mode, setMode] = useState<TimerMode>('work')
  const sessionStartRef = useRef<string | null>(null)
  const [timeLeft, setTimeLeft] = useState(25 * 60)
  const [isRunning, setIsRunning] = useState(false)
  const [sessions, setSessions] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const currentMode = MODES.find((m) => m.key === mode) ?? MODES[0]

  const reset = useCallback(() => {
    setIsRunning(false)
    setTimeLeft(currentMode.duration)
    if (intervalRef.current) clearInterval(intervalRef.current)
  }, [currentMode])

  const switchMode = useCallback((newMode: TimerMode) => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    setIsRunning(false)
    const m = MODES.find((m) => m.key === newMode) ?? MODES[0]
    setMode(newMode)
    setTimeLeft(m.duration)
  }, [])

  const skipToNext = useCallback(() => {
    // 세션 완료 시 저장
    if (sessionStartRef.current) {
      const m = MODES.find((m) => m.key === mode) ?? MODES[0]
      savePomodoroSession({
        taskId: null,
        duration: m.duration,
        type: mode === 'work' ? 'work' : 'break',
        startedAt: sessionStartRef.current,
        completedAt: new Date().toISOString()
      })
      sessionStartRef.current = null
    }
    if (mode === 'work') {
      const newSessions = sessions + 1
      setSessions(newSessions)
      switchMode(newSessions % 4 === 0 ? 'longBreak' : 'shortBreak')
    } else {
      switchMode('work')
    }
  }, [mode, sessions, switchMode, savePomodoroSession])

  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            // 타이머 완료 - interval을 즉시 정리하여 이중 실행 방지
            if (intervalRef.current) {
              clearInterval(intervalRef.current)
              intervalRef.current = null
            }
            new Notification(i18n.t('pomodoro.title'), {
              body: i18n.t(mode === 'work' ? 'pomodoro.workDone' : 'pomodoro.breakDone')
            })
            setTimeout(() => skipToNext(), 0)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isRunning, mode, skipToNext])

  const minutes = Math.floor(timeLeft / 60)
  const seconds = timeLeft % 60
  const progress = 1 - timeLeft / currentMode.duration
  const circumference = 2 * Math.PI * 140
  const strokeDashoffset = circumference * (1 - progress)

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
          {/* 배경 원 */}
          <circle cx="150" cy="150" r="140" fill="none" stroke={isDark ? '#333' : '#E5E5E5'} strokeWidth="6" />
          {/* 진행 원 */}
          <circle
            cx="150"
            cy="150"
            r="140"
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
          className={`p-3 rounded-full transition-colors ${isDark ? 'text-gray-500 hover:text-gray-300 hover:bg-gray-800' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
        >
          <RotateCcw size={22} />
        </button>
        <button
          type="button"
          onClick={() => {
            if (!isRunning && !sessionStartRef.current) sessionStartRef.current = new Date().toISOString()
            setIsRunning(!isRunning)
          }}
          className="p-5 rounded-full text-white transition-colors"
          style={{ backgroundColor: currentMode.color }}
        >
          {isRunning ? <Pause size={28} /> : <Play size={28} className="ml-1" />}
        </button>
        <button
          type="button"
          onClick={skipToNext}
          className={`p-3 rounded-full transition-colors ${isDark ? 'text-gray-500 hover:text-gray-300 hover:bg-gray-800' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
        >
          <SkipForward size={22} />
        </button>
      </div>

      {/* 세션 카운트 */}
      <div className="flex items-center gap-2 mt-8">
        {SESSION_DOTS.map((dot, i) => (
          <div
            key={dot}
            className={`w-3 h-3 rounded-full transition-colors ${
              i < sessions % 4 ? '' : isDark ? 'bg-gray-700' : 'bg-gray-300'
            }`}
            style={i < sessions % 4 ? { backgroundColor: currentMode.color } : {}}
          />
        ))}
        <span className="text-xs text-gray-500 ml-2">{t('pomodoro.sessions', { n: sessions })}</span>
      </div>
    </div>
  )
}
