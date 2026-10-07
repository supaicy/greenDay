import type React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import { useToday } from '../../hooks/useToday'
import { tList } from '../../i18n'
import { toDateString } from '../../utils/date'
import { levelFromScore, levelProgress, pointsToNextLevel, POINTS_PER_LEVEL } from '../../utils/score'
import { habitCompletionRate } from '../../utils/habitStats'
import { Trophy, CheckCircle2, Flame, Timer, Target, TrendingUp, Star, Calendar } from 'lucide-react'

export function StatsView(): React.ReactElement {
  const { t, i18n } = useTranslation()
  // tList는 매번 새 배열을 돌려주므로 메모해야 아래 useMemo가 매 렌더 재계산되지 않는다.
  const dayNames = useMemo(() => tList('date.weekdaysShort', i18n.language), [i18n.language])
  const theme = useStore((s) => s.theme)
  const tasks = useStore((s) => s.tasks)
  const pomodoroSessions = useStore((s) => s.pomodoroSessions)
  const habitLogs = useStore((s) => s.habitLogs)
  const habits = useStore((s) => s.habits)
  const score = useStore((s) => s.score)
  const isDark = theme === 'dark'

  // 자정에 갱신되는 '오늘'(로컬 기준 — toISOString()은 UTC라 KST 00:00~09:00에 하루 밀렸다).
  const todayStr = useToday()

  const stats = useMemo(() => {
    const now = new Date()

    // 이번 주 시작 (월요일)
    const weekStart = new Date(now)
    const day = weekStart.getDay()
    const diff = day === 0 ? 6 : day - 1
    weekStart.setDate(weekStart.getDate() - diff)
    weekStart.setHours(0, 0, 0, 0)
    const weekStartStr = toDateString(weekStart)

    // 완료된 태스크. completedAt은 UTC ISO 문자열이므로 로컬 날짜로 변환해 비교한다 —
    // 문자열 앞자리를 그대로 맞대면 KST 00:00~09:00 완료분이 전날로 세어진다.
    const completedTasks = tasks.filter((t) => t.completed && t.completedAt)
    const totalCompleted = completedTasks.length
    const completedLocalDays = completedTasks.map((t) => toDateString(new Date(t.completedAt as string)))

    const completedToday = completedLocalDays.filter((d) => d === todayStr).length

    const completedThisWeek = completedLocalDays.filter((d) => d >= weekStartStr).length

    // 점수 & 레벨 (utils/score.ts 단일 출처 — 사이드바와 같은 값)
    const totalScore = score.total
    const level = levelFromScore(totalScore)
    const progressInLevel = levelProgress(totalScore)

    // 최근 14일 일별 완료 수
    const last14Days: { date: string; label: string; count: number }[] = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const dateStr = toDateString(d)
      const count = completedLocalDays.filter((x) => x === dateStr).length
      last14Days.push({
        date: dateStr,
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        count
      })
    }
    const maxDailyCount = Math.max(...last14Days.map((d) => d.count), 1)

    // 포모도로 통계
    const workSessions = pomodoroSessions.filter((s) => s.type === 'work' && s.completedAt)
    const pomodoroCount = workSessions.length
    const totalFocusSeconds = workSessions.reduce((sum, s) => sum + s.duration, 0)
    const totalFocusMinutes = Math.floor(totalFocusSeconds / 60)
    const totalFocusHours = Math.floor(totalFocusMinutes / 60)
    const remainingMinutes = totalFocusMinutes % 60

    // 습관 완료율 — 분모는 '기대한 날'이지 '남아 있는 로그'가 아니다.
    // 체크를 풀면 로그의 completed가 false가 되는 게 아니라 행이 지워지므로,
    // 로그끼리 나누면 언제나 100%였다(utils/habitStats.ts에 이유를 적어 뒀다).
    const habitRate = habitCompletionRate(habits, habitLogs, todayStr)

    // 가장 생산적인 요일
    const dayCount = [0, 0, 0, 0, 0, 0, 0] // 일~토
    for (const task of completedTasks) {
      if (task.completedAt) {
        const d = new Date(task.completedAt)
        dayCount[d.getDay()]++
      }
    }
    const maxDayCount = Math.max(...dayCount)
    // 완료한 할일이 하나도 없으면 최고 요일이라는 것도 없다. '-'를 흘려보내면
    // date.dayLabel('{{day}}요일')이 '-요일'이라는 없는 요일을 그린다 —
    // 값이 없다는 것은 렌더가 말하게 한다.
    const mostProductiveDay = maxDayCount > 0 ? dayNames[dayCount.indexOf(maxDayCount)] : null

    return {
      totalCompleted,
      completedToday,
      completedThisWeek,
      totalScore,
      level,
      progressInLevel,
      todayStr,
      last14Days,
      maxDailyCount,
      pomodoroCount,
      totalFocusHours,
      remainingMinutes,
      habitCompletionRate: habitRate,
      mostProductiveDay,
      dayCount,
      maxDayCount
    }
  }, [tasks, pomodoroSessions, habitLogs, habits, score, dayNames, todayStr])

  // 카드 스타일
  const cardClass = `rounded-xl border p-4 ${isDark ? 'bg-gray-800/60 border-gray-700' : 'bg-white border-gray-200'}`

  const labelClass = `text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`
  const valueClass = `text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`
  const subValueClass = `text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* 헤더 */}
      <div className={`px-6 py-4 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
        <h2 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('stats.title')}</h2>
      </div>

      {/* 통계 콘텐츠 */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* 점수 & 레벨 */}
        <div className={cardClass}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
              <Trophy size={20} className="text-amber-500" />
            </div>
            <div>
              <p className={labelClass}>{t('stats.levelAndScore')}</p>
              <div className="flex items-baseline gap-2">
                <span className={valueClass}>Lv.{stats.level}</span>
                <span className={subValueClass}>{t('stats.points', { points: stats.totalScore })}</span>
              </div>
            </div>
          </div>
          {/* 레벨 프로그레스 바 */}
          <div className="relative">
            <div className={`h-2 rounded-full ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`}>
              <div
                className="h-full rounded-full bg-amber-500 transition-all"
                style={{ width: `${stats.progressInLevel}%` }}
              />
            </div>
            <div className="flex justify-between mt-1">
              <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                {stats.progressInLevel}/{POINTS_PER_LEVEL}
              </span>
              <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                {t('stats.toNextLevel', { points: pointsToNextLevel(stats.totalScore) })}
              </span>
            </div>
          </div>
        </div>

        {/* 완료 현황 카드 */}
        <div className="grid grid-cols-3 gap-4">
          <div className={cardClass}>
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 size={16} className="text-green-500" />
              <span className={labelClass}>{t('stats.completedToday')}</span>
            </div>
            <p className={valueClass}>{stats.completedToday}</p>
          </div>
          <div className={cardClass}>
            <div className="flex items-center gap-2 mb-2">
              <Calendar size={16} className="text-blue-500" />
              <span className={labelClass}>{t('stats.completedThisWeek')}</span>
            </div>
            <p className={valueClass}>{stats.completedThisWeek}</p>
          </div>
          <div className={cardClass}>
            <div className="flex items-center gap-2 mb-2">
              <Star size={16} className="text-amber-500" />
              <span className={labelClass}>{t('stats.completedTotal')}</span>
            </div>
            <p className={valueClass}>{stats.totalCompleted}</p>
          </div>
        </div>

        {/* 14일간 완료 차트 */}
        <div className={cardClass}>
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={16} className={isDark ? 'text-blue-400' : 'text-blue-500'} />
            <span className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
              {t('stats.trend14d')}
            </span>
          </div>
          <div className="flex items-end gap-1.5 h-32">
            {stats.last14Days.map((day) => (
              <div key={day.date} className="flex-1 flex flex-col items-center justify-end">
                {/* 바 */}
                <div
                  className={`w-full rounded-t transition-all ${
                    day.date === stats.todayStr ? 'bg-blue-500' : isDark ? 'bg-gray-600' : 'bg-gray-300'
                  }`}
                  style={{
                    height: day.count > 0 ? `${Math.max((day.count / stats.maxDailyCount) * 100, 8)}%` : '2px',
                    minHeight: day.count > 0 ? '8px' : '2px'
                  }}
                  title={t('stats.dayTooltip', { date: day.date, done: day.count })}
                />
                {/* 숫자 */}
                {day.count > 0 && (
                  <span className={`text-[9px] mt-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{day.count}</span>
                )}
                {/* 라벨 */}
                <span className={`text-[9px] mt-0.5 ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>{day.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 하단 통계 카드 */}
        <div className="grid grid-cols-2 gap-4">
          {/* 포모도로 */}
          <div className={cardClass}>
            <div className="flex items-center gap-2 mb-3">
              <Timer size={16} className="text-red-500" />
              <span className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
                {t('stats.pomodoro')}
              </span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className={labelClass}>{t('stats.sessionCount')}</span>
                <span className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                  {t('stats.sessions', { sessions: stats.pomodoroCount })}
                </span>
              </div>
              <div className="flex justify-between">
                <span className={labelClass}>{t('stats.totalFocus')}</span>
                <span className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                  {t('stats.hoursMinutes', { hours: stats.totalFocusHours, minutes: stats.remainingMinutes })}
                </span>
              </div>
            </div>
          </div>

          {/* 습관 & 생산성 */}
          <div className={cardClass}>
            <div className="flex items-center gap-2 mb-3">
              <Flame size={16} className="text-orange-500" />
              <span className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
                {t('stats.habitsAndProductivity')}
              </span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className={labelClass}>{t('stats.habitRate')}</span>
                <span className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                  {stats.habitCompletionRate}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className={labelClass}>{t('stats.mostProductiveDay')}</span>
                <span className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                  {stats.mostProductiveDay ? t('date.dayLabel', { day: stats.mostProductiveDay }) : t('common.none')}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 요일별 분포 */}
        <div className={cardClass}>
          <div className="flex items-center gap-2 mb-4">
            <Target size={16} className={isDark ? 'text-green-400' : 'text-green-500'} />
            <span className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
              {t('stats.weekdayDistribution')}
            </span>
          </div>
          <div className="flex items-end gap-3 h-20">
            {dayNames.map((name, idx) => (
              <div key={name} className="flex-1 flex flex-col items-center justify-end">
                <div
                  className={`w-full rounded-t transition-all ${
                    stats.dayCount[idx] === stats.maxDayCount && stats.maxDayCount > 0
                      ? 'bg-green-500'
                      : isDark
                        ? 'bg-gray-600'
                        : 'bg-gray-300'
                  }`}
                  style={{
                    height:
                      stats.maxDayCount > 0 && stats.dayCount[idx] > 0
                        ? `${Math.max((stats.dayCount[idx] / stats.maxDayCount) * 100, 8)}%`
                        : '2px'
                  }}
                />
                <span className={`text-[10px] mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {stats.dayCount[idx]}
                </span>
                <span className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
