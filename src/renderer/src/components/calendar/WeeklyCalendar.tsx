import type React from 'react'
import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useStore } from '../../store/useStore'
import { useToday } from '../../hooks/useToday'
import { toDateString } from '../../utils/date'
import type { Task, Priority } from '../../types'
import { ChevronLeft, ChevronRight, Flag } from 'lucide-react'
import { TimeBlock } from './TimeBlock'
import { UnscheduledRail } from './UnscheduledRail'
import { layoutOverlappingBlocks } from '../../utils/timeBlockLayout'
import { getScheduledForOccurrence, resolveTimeBlockDrop } from '../../utils/scheduledTime'
import { useTranslation } from 'react-i18next'
import { DND_MIME } from '../../utils/dnd'
import { isTopLevel } from '../../utils/smartLists'
import i18n, { tList } from '../../i18n'

// 시간 슬롯 — 하루 24시간을 전부 그린다.
//
// 8~22만 그리던 시절, dueTime이 있는 할일은 무조건 timed 버킷으로 가서 종일 행에서
// 빠지는데 정작 그 시각의 행이 없어 07:00·23:00 할일이 격자 어디에도 안 떴다.
// 시간블록도 같은 구멍이었다 — 블록 레이어가 -WEEK_START_HOUR만큼 올라가 있어
// 07:00 블록은 top이 음수(-48px)가 되어 스크롤로도 닿지 못했다. 밴드를 24시간으로
// 열면 버킷 판정(dueTime이 있나)과 렌더 판정(그 시각 행이 있나)이 같은 말을 한다.
const timeSlots: number[] = []
for (let h = 0; h <= 23; h++) {
  timeSlots.push(h)
}

// Pixels per minute: derived from hour-row minHeight: '48px' below.
// 48px / 60min = 0.8 px/min. Update if the slot row height changes.
const PX_PER_MIN = 48 / 60

// 격자는 0:00부터 시작한다. 블록 레이어 오프셋과 드롭 좌표 변환이 모두 이 값을
// 쓰므로, timeSlots의 첫 시각과 반드시 같아야 한다 — 어긋나면 그 차이만큼
// 블록이 위로 밀려 밴드 밖 시각이 통째로 사라진다.
const WEEK_START_HOUR = 0

// 처음 열었을 때 눈이 닿는 시각. 밴드는 24시간이지만 시선은 업무시간에서 시작한다 —
// 이 스크롤이 없으면 매번 00:00을 보고 아래로 끌어내려야 한다.
const WEEK_FOCUS_HOUR = 8

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
  const period = i18n.t(h < 12 ? 'date.am' : 'date.pm')
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return i18n.t('date.hour', { period, hour: hour12 })
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
  const { t } = useTranslation()
  const theme = useStore((s) => s.theme)
  const tasks = useStore((s) => s.tasks)
  const selectTask = useStore((s) => s.selectTask)
  const selectedTaskId = useStore((s) => s.selectedTaskId)
  const updateTask = useStore((s) => s.updateTask)
  const isDark = theme === 'dark'

  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()))

  // 마운트 때 한 번만 업무시간으로 스크롤한다. 주를 넘길 때마다 되감으면
  // 새벽 일정을 보던 사용자를 08:00으로 끌어다 놓는다 — 그래서 의존성은 빈 배열이다.
  // 요일 헤더와 종일 행은 한 sticky 래퍼로 같이 고정한다. 헤더만 고정하면 이 스크롤이
  // 종일 할일을 화면 밖으로 밀어내고, 목표값도 그 행 높이만큼 어긋난다. 래퍼가 격자
  // 바로 위 흐름 안에 있으므로 scrollTop = 초점시각 높이가 그 시각을 래퍼 바로 아래에
  // 정확히 놓는다 — 둘 사이에 다른 요소를 끼우지 말 것.
  const gridRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = gridRef.current
    if (el) el.scrollTop = WEEK_FOCUS_HOUR * 60 * PX_PER_MIN
  }, [])

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

  const todayStr = useToday()

  // 날짜별 태스크 맵
  const tasksByDate = useMemo(() => {
    const map: Record<string, { allDay: Task[]; timed: Task[] }> = {}
    // 하위작업 제외 — 일간 뷰와 같은 이유(부모 밖으로 새면 중복 계수 + 목록에서
    // 찾을 수 없는 할일이 열린다). 판별식은 smartLists 한 곳에서만 정의한다.
    const activeTasks = tasks.filter((t) => !t.deletedAt && isTopLevel(t) && t.dueDate)

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
    const months = tList('date.months')
    if (first.getMonth() === last.getMonth()) {
      return t('calendar.weekRangeSameMonth', { year: first.getFullYear(), month: months[first.getMonth()] })
    }
    if (first.getFullYear() === last.getFullYear()) {
      return t('calendar.weekRangeSameYear', {
        year: first.getFullYear(),
        from: months[first.getMonth()],
        to: months[last.getMonth()]
      })
    }
    return t('calendar.weekRangeCrossYear', {
      fromYear: first.getFullYear(),
      from: months[first.getMonth()],
      toYear: last.getFullYear(),
      to: months[last.getMonth()]
    })
  }, [weekDays, t])

  const taskCardClass = (task: Task) => {
    const base = isDark ? priorityBg[task.priority] : priorityBgLight[task.priority]
    const selected = selectedTaskId === task.id ? (isDark ? 'ring-1 ring-blue-500' : 'ring-1 ring-blue-400') : ''
    const completed = task.completed ? 'opacity-50 line-through' : ''
    return `${base} ${selected} ${completed} rounded px-1.5 py-0.5 text-[10px] leading-tight cursor-pointer border truncate`
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
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
            {t('common.today')}
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

      {/* 캘린더 본문 — 왼쪽 레일이 시간블록을 만드는 드래그 소스다 */}
      <div className="flex-1 flex min-h-0">
        <UnscheduledRail isDark={isDark} />
        <div ref={gridRef} className="flex-1 overflow-auto">
          <div className="min-w-[700px]">
            {/* 고정 층: 요일 헤더 + 종일 행. min-w 래퍼 안에 있어 가로 스크롤 때 격자 칼럼과
              함께 움직인다. z-10은 오버레이(110/111)·토스트(90) 아래다. */}
            <div className="sticky top-0 z-10">
              {/* 요일 헤더 */}
              <div className={`flex border-b ${isDark ? 'border-gray-700 bg-gray-900' : 'border-gray-200 bg-white'}`}>
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
                        {tList('date.weekdaysShort')[day.getDay()]}
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
                // 불투명 배경 — 고정된 채 아래 시간 셀이 비쳐 보이지 않게.
                <div
                  className={`flex border-b ${isDark ? 'border-gray-700 bg-[#1C1C1E]' : 'border-gray-200 bg-white'}`}
                >
                  <div
                    className={`w-16 flex-shrink-0 text-[10px] text-right pr-2 py-1 ${
                      isDark ? 'text-gray-500' : 'text-gray-400'
                    }`}
                  >
                    {t('date.allDay')}
                  </div>
                  {weekDays.map((day) => {
                    const dateStr = dateToStr(day)
                    const allDayTasks = tasksByDate[dateStr]?.allDay ?? []
                    return (
                      // 높이 상한은 칸마다 건다 — 행 전체에 스크롤을 걸면 세로 스크롤바 폭만큼
                      // 칼럼이 아래 격자와 어긋난다. 칸 안 스크롤바는 그 칸만 좁힌다.
                      <div
                        key={`allday-${dateStr}`}
                        className={`flex-1 border-l p-1 space-y-0.5 min-h-[28px] max-h-[96px] overflow-y-auto ${
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
            </div>

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
                        e.dataTransfer.types.includes(DND_MIME.TASK_ID) ||
                        e.dataTransfer.types.includes(DND_MIME.TASK_BLOCK)
                      ) {
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                      }
                    }}
                    onDrop={(e) => {
                      const taskId =
                        e.dataTransfer.getData(DND_MIME.TASK_ID) || e.dataTransfer.getData(DND_MIME.TASK_BLOCK)
                      if (!taskId) return
                      const existing = tasks.find((t) => t.id === taskId)
                      if (!existing) return
                      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                      const patch = resolveTimeBlockDrop({
                        yPx: e.clientY - rect.top,
                        dayStr,
                        startHour: WEEK_START_HOUR,
                        pxPerMin: PX_PER_MIN,
                        task: existing,
                        isBlockMove: e.dataTransfer.types.includes(DND_MIME.TASK_BLOCK),
                        sourceDate: e.dataTransfer.getData(DND_MIME.BLOCK_DATE) || null
                      })
                      if (patch) void updateTask(patch)
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
                      so a block at 0:00 lands at y=0 relative to the first hour-row.
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
    </div>
  )
}
