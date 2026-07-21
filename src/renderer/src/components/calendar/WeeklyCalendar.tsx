import type React from 'react'
import { useState, useMemo, useCallback } from 'react'
import { useStore } from '../../store/useStore'
import { toDateString } from '../../utils/date'
import type { Task, Priority } from '../../types'
import { ChevronLeft, ChevronRight, Flag } from 'lucide-react'
import { TimeBlock } from './TimeBlock'
import { layoutOverlappingBlocks } from '../../utils/timeBlockLayout'
import { getScheduledForOccurrence, snapTo15Min } from '../../utils/scheduledTime'

// 요일 이름
const dayLabels = ['일', '월', '화', '수', '목', '금', '토']

// 시간 슬롯 (8시~22시)
const timeSlots: number[] = []
for (let h = 8; h <= 22; h++) {
  timeSlots.push(h)
}

// Pixels per minute: derived from hour-row minHeight: '48px' below.
// 48px / 60min = 0.8 px/min. Update if the slot row height changes.
const PX_PER_MIN = 48 / 60

// WeeklyCalendar shows 8:00 through 22:59 — i.e. [8, 23).
const WEEK_START_HOUR = 8

// 우선순위 색상 (배경용)
const priorityBg: Record<Priority, string> = {
  high: 'bg-red-500/20 border-red-500/40',
  medium: 'bg-amber-500/20 border-amber-500/40',
  low: 'bg-blue-500/20 border-blue-500/40',
  none: 'bg-gray-500/20 border-gray-500/40'
}

const priorityBgLight: Record<Priority, string> = {
  high: 'bg-red-100 border-red-300',
  medium: 'bg-amber-100 border-amber-300',
  low: 'bg-blue-100 border-blue-300',
  none: 'bg-gray-100 border-gray-300'
}

function formatHour(h: number): string {
  const period = h < 12 ? '오전' : '오후'
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${period} ${hour12}시`
}

function getMonday(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function dateToStr(d: Date): string {
  return toDateString(d)
}

function parseTime(timeStr: string): { hour: number; minute: number } | null {
  // HH:MM 형식
  const match = timeStr.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  return { hour: parseInt(match[1], 10), minute: parseInt(match[2], 10) }
}

export function WeeklyCalendar(): React.ReactElement {
  const { theme, tasks, selectTask, selectedTaskId, updateTask } = useStore()
  const isDark = theme === 'dark'

  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()))

  // 주간 날짜 배열 (월~일)
  const weekDays = useMemo(() => {
    const days: Date[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart)
      d.setDate(d.getDate() + i)
      days.push(d)
    }
    return days
  }, [weekStart])

  const todayStr = useMemo(() => dateToStr(new Date()), [])

  // 날짜별 태스크 맵
  const tasksByDate = useMemo(() => {
    const map: Record<string, { allDay: Task[]; timed: Task[] }> = {}
    const activeTasks = tasks.filter((t) => !t.deletedAt && t.dueDate)

    for (const day of weekDays) {
      const dateStr = dateToStr(day)
      map[dateStr] = { allDay: [], timed: [] }
    }

    for (const task of activeTasks) {
      if (!task.dueDate) continue
      const entry = map[task.dueDate]
      if (!entry) continue

      if (task.dueTime) {
        entry.timed.push(task)
      } else {
        entry.allDay.push(task)
      }
    }

    return map
  }, [tasks, weekDays])

  // Per-day scheduled blocks + overlap layout.
  const perDay = useMemo(() => {
    return weekDays.map((date) => {
      const dayStr = dateToStr(date)
      const items: { task: Task; start: Date; end: Date }[] = []
      for (const t of tasks) {
        if (t.deletedAt) continue
        const sch = getScheduledForOccurrence(t, dayStr)
        if (!sch) continue
        if (!t.isRecurring && sch.start.slice(0, 10) !== dayStr) continue
        items.push({ task: t, start: new Date(sch.start), end: new Date(sch.end) })
      }
      const layout = layoutOverlappingBlocks(items.map((b) => ({ id: b.task.id, start: b.start, end: b.end })))
      return { dayStr, items, layout }
    })
  }, [tasks, weekDays])

  // 네비게이션
  const goToday = useCallback(() => setWeekStart(getMonday(new Date())), [])
  const goPrev = useCallback(
    () =>
      setWeekStart((prev) => {
        const d = new Date(prev)
        d.setDate(d.getDate() - 7)
        return d
      }),
    []
  )
  const goNext = useCallback(
    () =>
      setWeekStart((prev) => {
        const d = new Date(prev)
        d.setDate(d.getDate() + 7)
        return d
      }),
    []
  )

  // 특정 시간에 속하는 태스크 가져오기
  const getTasksAtHour = (dateStr: string, hour: number): Task[] => {
    const entry = tasksByDate[dateStr]
    if (!entry) return []
    return entry.timed.filter((t) => {
      if (!t.dueTime) return false
      const parsed = parseTime(t.dueTime)
      if (!parsed) return false
      return parsed.hour === hour
    })
  }

  // 월/년 표시
  const headerMonth = useMemo(() => {
    const first = weekDays[0]
    const last = weekDays[6]
    if (first.getMonth() === last.getMonth()) {
      return `${first.getFullYear()}년 ${first.getMonth() + 1}월`
    }
    if (first.getFullYear() === last.getFullYear()) {
      return `${first.getFullYear()}년 ${first.getMonth() + 1}월 - ${last.getMonth() + 1}월`
    }
    return `${first.getFullYear()}년 ${first.getMonth() + 1}월 - ${last.getFullYear()}년 ${last.getMonth() + 1}월`
  }, [weekDays])

  const taskCardClass = (task: Task) => {
    const base = isDark ? priorityBg[task.priority] : priorityBgLight[task.priority]
    const selected = selectedTaskId === task.id ? (isDark ? 'ring-1 ring-blue-500' : 'ring-1 ring-blue-400') : ''
    const completed = task.completed ? 'opacity-50 line-through' : ''
    return `${base} ${selected} ${completed} rounded px-1.5 py-0.5 text-[10px] leading-tight cursor-pointer border truncate`
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* 헤더 */}
      <div
        className={`px-6 py-3 border-b flex items-center justify-between ${
          isDark ? 'border-gray-700' : 'border-gray-200'
        }`}
      >
        <div>
          <h2 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{headerMonth}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goToday}
            className={`px-3 py-1 text-xs rounded-md border ${
              isDark
                ? 'border-gray-600 text-gray-300 hover:bg-gray-700'
                : 'border-gray-300 text-gray-600 hover:bg-gray-100'
            }`}
          >
            오늘
          </button>
          <button
            type="button"
            onClick={goPrev}
            className={`p-1 rounded-md ${
              isDark ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'
            }`}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            onClick={goNext}
            className={`p-1 rounded-md ${
              isDark ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'
            }`}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* 캘린더 본문 */}
      <div className="flex-1 overflow-auto">
        <div className="min-w-[700px]">
          {/* 요일 헤더 */}
          <div
            className={`flex border-b sticky top-0 z-10 ${
              isDark ? 'border-gray-700 bg-gray-900' : 'border-gray-200 bg-white'
            }`}
          >
            {/* 시간 칼럼 빈칸 */}
            <div className="w-16 flex-shrink-0" />
            {weekDays.map((day) => {
              const dateStr = dateToStr(day)
              const isToday = dateStr === todayStr
              return (
                <div
                  key={dateStr}
                  className={`flex-1 text-center py-2 border-l ${isDark ? 'border-gray-700' : 'border-gray-200'}`}
                >
                  <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    {dayLabels[day.getDay()]}
                  </div>
                  <div
                    className={`text-sm font-medium mt-0.5 ${
                      isToday
                        ? 'bg-blue-500 text-white w-7 h-7 rounded-full flex items-center justify-center mx-auto'
                        : isDark
                          ? 'text-gray-200'
                          : 'text-gray-800'
                    }`}
                  >
                    {day.getDate()}
                  </div>
                </div>
              )
            })}
          </div>

          {/* 종일 이벤트 행 */}
          {weekDays.some((day) => {
            const dateStr = dateToStr(day)
            return (tasksByDate[dateStr]?.allDay.length ?? 0) > 0
          }) && (
            <div className={`flex border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
              <div
                className={`w-16 flex-shrink-0 text-[10px] text-right pr-2 py-1 ${
                  isDark ? 'text-gray-500' : 'text-gray-400'
                }`}
              >
                종일
              </div>
              {weekDays.map((day) => {
                const dateStr = dateToStr(day)
                const allDayTasks = tasksByDate[dateStr]?.allDay ?? []
                return (
                  <div
                    key={`allday-${dateStr}`}
                    className={`flex-1 border-l p-1 space-y-0.5 min-h-[28px] ${
                      isDark ? 'border-gray-700' : 'border-gray-200'
                    }`}
                  >
                    {allDayTasks.map((task) => (
                      // 종일 태스크: 단순 클릭 → Pattern A (button)
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => selectTask(task.id)}
                        className={`${taskCardClass(task)} w-full text-left`}
                      >
                        {task.title}
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
          )}

          {/* 시간 슬롯 — day-first layout.
              Left: fixed time-axis column with hour labels.
              Right: 7 day columns, each containing:
                - hour-cell background rows with legacy dueTime task cards
                - an absolute TimeBlock layer offset by -WEEK_START_HOUR.
              Drop handlers live on each day column so clicks on legacy task
              cards (direct children of hour-cells) are not intercepted. */}
          <div className="flex">
            {/* Time axis column — one hour label per row, matching 48px height */}
            <div className="w-16 flex-shrink-0">
              {timeSlots.map((hour) => (
                <div
                  key={`label-${hour}`}
                  className={`text-[10px] text-right pr-2 pt-0.5 border-b ${
                    isDark ? 'border-gray-800 text-gray-500' : 'border-gray-100 text-gray-400'
                  }`}
                  style={{ height: '48px' }}
                >
                  {formatHour(hour)}
                </div>
              ))}
            </div>

            {/* 7 day columns */}
            {weekDays.map((day) => {
              const dayStr = dateToStr(day)
              const isToday = dayStr === todayStr
              const dayBlocks = perDay.find((p) => p.dayStr === dayStr)
              const items = dayBlocks?.items ?? []
              const layout = dayBlocks?.layout ?? []
              // 주간 칼럼: 드래그 드롭 대상 (<section>으로 의미론적 표현)
              return (
                <section
                  key={`daycol-${dayStr}`}
                  aria-label={dayStr}
                  className={`relative flex-1 border-l ${
                    isToday
                      ? isDark
                        ? 'bg-blue-900/10 border-gray-700'
                        : 'bg-blue-50/50 border-gray-200'
                      : isDark
                        ? 'border-gray-700'
                        : 'border-gray-200'
                  }`}
                  onDragOver={(e) => {
                    if (
                      e.dataTransfer.types.includes('application/haru-task-id') ||
                      e.dataTransfer.types.includes('application/haru-task-block')
                    ) {
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                    }
                  }}
                  onDrop={(e) => {
                    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                    const yPx = e.clientY - rect.top
                    const minutesFromTop = yPx / PX_PER_MIN
                    const totalMin = WEEK_START_HOUR * 60 + minutesFromTop
                    const hour = Math.floor(totalMin / 60)
                    const minute = Math.floor(totalMin % 60)
                    const pad = (n: number): string => String(n).padStart(2, '0')
                    const rawStart = `${dayStr}T${pad(hour)}:${pad(minute)}:00`
                    const snappedStart = snapTo15Min(rawStart)
                    const startMs = new Date(snappedStart).getTime()
                    const dayEnd = new Date(`${dayStr}T23:59:00`).getTime()
                    const toIso = (ms: number): string => {
                      const d = new Date(ms)
                      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`
                    }

                    const taskId =
                      e.dataTransfer.getData('application/haru-task-id') ||
                      e.dataTransfer.getData('application/haru-task-block')
                    if (!taskId) return
                    const existing = tasks.find((t) => t.id === taskId)
                    if (!existing) return

                    // Move of an existing block: preserve duration
                    let endMs = startMs + 30 * 60000
                    if (
                      e.dataTransfer.types.includes('application/haru-task-block') &&
                      existing.scheduledStart &&
                      existing.scheduledEnd
                    ) {
                      const origDur =
                        new Date(existing.scheduledEnd).getTime() - new Date(existing.scheduledStart).getTime()
                      endMs = startMs + origDur
                    }
                    const endMsClamped = Math.min(endMs, dayEnd)

                    void updateTask({
                      id: taskId,
                      scheduledStart: snappedStart,
                      scheduledEnd: toIso(endMsClamped)
                    })
                  }}
                >
                  {/* Background: hour-cell rows with legacy dueTime tasks */}
                  {timeSlots.map((hour) => {
                    const cellTasks = getTasksAtHour(dayStr, hour)
                    return (
                      <div
                        key={`${dayStr}-${hour}`}
                        className={`border-b p-0.5 ${isDark ? 'border-gray-800' : 'border-gray-100'}`}
                        style={{ height: '48px' }}
                      >
                        {cellTasks.map((task) => (
                          // 시간 셀 태스크: 단순 클릭 → Pattern A (button)
                          <button
                            key={task.id}
                            type="button"
                            onClick={() => selectTask(task.id)}
                            className={`${taskCardClass(task)} w-full text-left`}
                          >
                            <div className="flex items-center gap-1">
                              {task.priority !== 'none' && <Flag size={8} className="flex-shrink-0" />}
                              <span className="truncate">{task.title}</span>
                            </div>
                            {task.dueTime && (
                              <div className={`text-[9px] ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                {task.dueTime}
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                    )
                  })}

                  {/* TimeBlock layer: absolute, offset by -WEEK_START_HOUR * 60 * PX_PER_MIN
                      so a block at 8:00 lands at y=0 relative to the first hour-row.
                      pointer-events-none on the layer so empty space falls through to
                      the column-level drop handler; each TimeBlock wrapper enables
                      pointer-events-auto. */}
                  <div
                    className="absolute left-0 right-0 pointer-events-none"
                    style={{
                      top: `${-WEEK_START_HOUR * 60 * PX_PER_MIN}px`,
                      height: `${24 * 60 * PX_PER_MIN}px`
                    }}
                  >
                    <div className="relative w-full h-full">
                      {items.map((b) => {
                        const entry = layout.find((l) => l.id === b.task.id)
                        if (!entry) return null
                        return (
                          <div key={b.task.id} className="pointer-events-auto">
                            <TimeBlock
                              task={b.task}
                              start={b.start}
                              end={b.end}
                              pxPerMin={PX_PER_MIN}
                              column={entry.column}
                              columns={entry.columns}
                              isDark={isDark}
                            />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
