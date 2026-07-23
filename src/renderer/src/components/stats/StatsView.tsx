import type React from 'react'
import { useMemo } from 'react'
import { useStore } from '../../store/useStore'
import { Trophy, CheckCircle2, Flame, Timer, Target, TrendingUp, Star, Calendar } from 'lucide-react'

// 요일 이름
const dayNames = ['일', '월', '화', '수', '목', '금', '토']

export function StatsView(): React.ReactElement {
  const { theme, tasks, pomodoroSessions, habitLogs, habits, score } = useStore()
  const isDark = theme === 'dark'

  const stats = useMemo(() => {
    const now = new Date()
    const todayStr = now.toISOString().split('T')[0]

    // 이번 주 시작 (월요일)
    const weekStart = new Date(now)
    const day = weekStart.getDay()
    const diff = day === 0 ? 6 : day - 1
    weekStart.setDate(weekStart.getDate() - diff)
    weekStart.setHours(0, 0, 0, 0)
    const weekStartStr = weekStart.toISOString().split('T')[0]

    // 완료된 태스크
    const completedTasks = tasks.filter((t) => t.completed && t.completedAt)
    const totalCompleted = completedTasks.length

    const completedToday = completedTasks.filter((t) => t.completedAt?.startsWith(todayStr)).length

    const completedThisWeek = completedTasks.filter((t) => t.completedAt && t.completedAt >= weekStartStr).length

    // 점수 & 레벨
    const totalScore = score.total
    const level = Math.floor(totalScore / 100) + 1
    const levelProgress = totalScore % 100

    // 최근 14일 일별 완료 수
    const last14Days: { date: string; label: string; count: number }[] = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().split('T')[0]
      const count = completedTasks.filter((t) => t.completedAt?.startsWith(dateStr)).length
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

    // 습관 완료율
    let habitCompletionRate = 0
    if (habits.length > 0 && habitLogs.length > 0) {
      const completedLogs = habitLogs.filter((l) => l.completed).length
      // 간단한 비율: 완료된 로그 / 전체 로그
      habitCompletionRate = habitLogs.length > 0 ? Math.round((completedLogs / habitLogs.length) * 100) : 0
    }

    // 가장 생산적인 요일
    const dayCount = [0, 0, 0, 0, 0, 0, 0] // 일~토
    for (const task of completedTasks) {
      if (task.completedAt) {
        const d = new Date(task.completedAt)
        dayCount[d.getDay()]++
      }
    }
    const maxDayCount = Math.max(...dayCount)
    const mostProductiveDay = maxDayCount > 0 ? dayNames[dayCount.indexOf(maxDayCount)] : '-'

    return {
      totalCompleted,
      completedToday,
      completedThisWeek,
      totalScore,
      level,
      levelProgress,
      last14Days,
      maxDailyCount,
      pomodoroCount,
      totalFocusHours,
      remainingMinutes,
      habitCompletionRate,
      mostProductiveDay,
      dayCount,
      maxDayCount
    }
  }, [tasks, pomodoroSessions, habitLogs, habits, score])

  // 카드 스타일
  const cardClass = `rounded-xl border p-4 ${isDark ? 'bg-gray-800/60 border-gray-700' : 'bg-white border-gray-200'}`

  const labelClass = `text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`
  const valueClass = `text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`
  const subValueClass = `text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* 헤더 */}
      <div className={`px-6 py-4 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
        <h2 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>통계</h2>
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
              <p className={labelClass}>레벨 & 점수</p>
              <div className="flex items-baseline gap-2">
                <span className={valueClass}>Lv.{stats.level}</span>
                <span className={subValueClass}>{stats.totalScore}점</span>
              </div>
            </div>
          </div>
          {/* 레벨 프로그레스 바 */}
          <div className="relative">
            <div className={`h-2 rounded-full ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`}>
              <div
                className="h-full rounded-full bg-amber-500 transition-all"
                style={{ width: `${stats.levelProgress}%` }}
              />
            </div>
            <div className="flex justify-between mt-1">
              <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{stats.levelProgress}/100</span>
              <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                다음 레벨까지 {100 - stats.levelProgress}점
              </span>
            </div>
          </div>
        </div>

        {/* 완료 현황 카드 */}
        <div className="grid grid-cols-3 gap-4">
          <div className={cardClass}>
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 size={16} className="text-green-500" />
              <span className={labelClass}>오늘 완료</span>
            </div>
            <p className={valueClass}>{stats.completedToday}</p>
          </div>
          <div className={cardClass}>
            <div className="flex items-center gap-2 mb-2">
              <Calendar size={16} className="text-blue-500" />
              <span className={labelClass}>이번 주 완료</span>
            </div>
            <p className={valueClass}>{stats.completedThisWeek}</p>
          </div>
          <div className={cardClass}>
            <div className="flex items-center gap-2 mb-2">
              <Star size={16} className="text-amber-500" />
              <span className={labelClass}>전체 완료</span>
            </div>
            <p className={valueClass}>{stats.totalCompleted}</p>
          </div>
        </div>

        {/* 14일간 완료 차트 */}
        <div className={cardClass}>
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={16} className={isDark ? 'text-blue-400' : 'text-blue-500'} />
            <span className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
              최근 14일 완료 추이
            </span>
          </div>
          <div className="flex items-end gap-1.5 h-32">
            {stats.last14Days.map((day) => (
              <div key={day.date} className="flex-1 flex flex-col items-center justify-end">
                {/* 바 */}
                <div
                  className={`w-full rounded-t transition-all ${
                    day.date === new Date().toISOString().split('T')[0]
                      ? 'bg-blue-500'
                      : isDark
                        ? 'bg-gray-600'
                        : 'bg-gray-300'
                  }`}
                  style={{
                    height: day.count > 0 ? `${Math.max((day.count / stats.maxDailyCount) * 100, 8)}%` : '2px',
                    minHeight: day.count > 0 ? '8px' : '2px'
                  }}
                  title={`${day.date}: ${day.count}개 완료`}
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
              <span className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>포모도로</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className={labelClass}>세션 수</span>
                <span className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                  {stats.pomodoroCount}회
                </span>
              </div>
              <div className="flex justify-between">
                <span className={labelClass}>총 집중 시간</span>
                <span className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                  {stats.totalFocusHours}시간 {stats.remainingMinutes}분
                </span>
              </div>
            </div>
          </div>

          {/* 습관 & 생산성 */}
          <div className={cardClass}>
            <div className="flex items-center gap-2 mb-3">
              <Flame size={16} className="text-orange-500" />
              <span className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>습관 & 생산성</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className={labelClass}>습관 완료율</span>
                <span className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                  {stats.habitCompletionRate}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className={labelClass}>최고 생산 요일</span>
                <span className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                  {stats.mostProductiveDay}요일
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
              요일별 완료 분포
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
