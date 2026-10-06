import type React from 'react'
import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useStore } from '../../store/useStore'
import { useToday } from '../../hooks/useToday'
import { toDateString } from '../../utils/date'
import type { Task, Priority } from '../../types'
import { ChevronLeft, ChevronRight, Flag, CheckCircle2, Circle } from 'lucide-react'
import { TimeBlock } from './TimeBlock'
import { UnscheduledRail } from './UnscheduledRail'
import { layoutOverlappingBlocks } from '../../utils/timeBlockLayout'
import { getScheduledForOccurrence, resolveTimeBlockDrop } from '../../utils/scheduledTime'
import { useTranslation } from 'react-i18next'
import { DND_MIME } from '../../utils/dnd'
import { PRIORITY_COLOR } from '../../utils/priority'
import { isTopLevel } from '../../utils/smartLists'
import i18n, { tList } from '../../i18n'

// 시간 슬롯 (0:00 ~ 23:30, 30분 단위)
interface TimeSlot {
  hour: number
  minute: number
  label: string
}

// 라벨이 언어에 따라 달라지므로 모듈 상수가 아니라 렌더 시점에 만든다.
// language를 인자로 받아 useMemo 의존성이 실제 값과 일치하게 한다.
function buildTimeSlots(language: string): TimeSlot[] {
  const slots: TimeSlot[] = []
  // 6시부터 그리던 시절, dueTime이 있는 할일은 무조건 timed 버킷으로 가서 종일 영역에서
  // 빠지는데 정작 그 시각의 슬롯이 없어 03:00·00:30 할일이 하루 어디에도 안 떴다.
  // 시간블록도 같은 구멍이었다 — 레이어가 -DAY_START_HOUR만큼 올라가 있어 그 블록의
  // top이 음수(-240px)가 됐다. 밴드를 24시간으로 열어 버킷 판정과 렌더 판정을 맞춘다.
  for (let h = 0; h <= 23; h++) {
    slots.push({ hour: h, minute: 0, label: formatTime(h, 0, language) })
    slots.push({ hour: h, minute: 30, label: '' })
  }
  return slots
}

// Pixels per minute: derived from the time-slot row height in the JSX below.
// Each 30-min row has minHeight: '40px', so 40 / 30 ≈ 1.333.
// Update if the slot row height changes.
const PX_PER_MIN = 40 / 30

// Time-slot column range: 0:00 (inclusive) to 24:00 (exclusive).
// buildTimeSlots의 첫 시각과 반드시 같아야 한다 — 블록 레이어 오프셋과 드롭 좌표
// 변환이 둘 다 이 값을 쓴다.
const DAY_START_HOUR = 0
const DAY_END_HOUR_EXCLUSIVE = 24

// 처음 열었을 때 눈이 닿는 시각. 밴드는 24시간이지만 시선은 업무시간에서 시작한다.
const DAY_FOCUS_HOUR = 6

function formatTime(h: number, m: number, language: string): string {
  const t = i18n.getFixedT(language)
  const period = t(h < 12 ? 'date.am' : 'date.pm')
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return m === 0
    ? t('date.hour', { period, hour: hour12 })
    : t('date.hourMinute', { period, hour: hour12, minute: m.toString().padStart(2, '0') })
}

function dateToStr(d: Date): string {
  return toDateString(d)
}

function parseTime(timeStr: string): { hour: number; minute: number } | null {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  return { hour: parseInt(match[1], 10), minute: parseInt(match[2], 10) }
}

// 우선순위 색상 (배경용)
const priorityBg: Record<Priority, { dark: string; light: string }> = {
  high: { dark: 'bg-red-500/20 border-l-red-500', light: 'bg-red-50 border-l-red-400' },
  medium: { dark: 'bg-amber-500/20 border-l-amber-500', light: 'bg-amber-50 border-l-amber-400' },
  low: { dark: 'bg-blue-500/20 border-l-blue-500', light: 'bg-blue-50 border-l-blue-400' },
  none: { dark: 'bg-gray-700/50 border-l-gray-500', light: 'bg-gray-100 border-l-gray-400' }
}

export function DailyCalendar(): React.ReactElement {
  const { t, i18n: i18nInstance } = useTranslation()
  const timeSlots = useMemo(() => buildTimeSlots(i18nInstance.language), [i18nInstance.language])
  const theme = useStore((s) => s.theme)
  const tasks = useStore((s) => s.tasks)
  const selectTask = useStore((s) => s.selectTask)
  const selectedTaskId = useStore((s) => s.selectedTaskId)
  const toggleTask = useStore((s) => s.toggleTask)
  const updateTask = useStore((s) => s.updateTask)
  const isDark = theme === 'dark'

  const [currentDate, setCurrentDate] = useState(() => new Date())

  // 마운트 때 한 번만 업무시간으로 스크롤한다. 날짜를 넘길 때마다 되감으면
  // 새벽 일정을 보던 사용자를 06:00으로 끌어다 놓는다 — 그래서 의존성은 빈 배열이다.
  // 종일 블록은 같은 스크롤 컨테이너 맨 위에 sticky로 고정한다. 고정하지 않으면 이
  // 스크롤이 종일 할일을 화면 밖으로 밀어내고, 목표값도 그 블록 높이만큼 어긋난다.
  // 고정 블록이 격자 바로 위 흐름 안에 있으므로 scrollTop = 초점시각 높이가 그 시각을
  // 고정 블록 바로 아래에 정확히 놓는다 — 둘 사이에 다른 요소를 끼우지 말 것.
  const gridRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = gridRef.current
    if (el) el.scrollTop = DAY_FOCUS_HOUR * 60 * PX_PER_MIN
  }, [])

  const dateStr = useMemo(() => dateToStr(currentDate), [currentDate])
  const todayStr = useToday()
  const isToday = dateStr === todayStr

  // Scheduled time blocks that fall on the visible day.
  const blocks = useMemo(() => {
    const items: { task: Task; start: Date; end: Date }[] = []
    for (const t of tasks) {
      if (t.deletedAt) continue
      const sch = getScheduledForOccurrence(t, dateStr)
      if (!sch) continue
      // For non-recurring, only include if the block's start date matches dateStr
      if (!t.isRecurring && sch.start.slice(0, 10) !== dateStr) continue
      items.push({ task: t, start: new Date(sch.start), end: new Date(sch.end) })
    }
    return items
  }, [tasks, dateStr])

  const layout = useMemo(
    () => layoutOverlappingBlocks(blocks.map((b) => ({ id: b.task.id, start: b.start, end: b.end }))),
    [blocks]
  )

  // 해당 날짜의 태스크
  const { allDayTasks, timedTasks } = useMemo(() => {
    // 하위작업은 부모 안에서만 산다(smartLists.isTopLevel). 마감일이 붙었다고 종일/시간
    // 칸에 독립 카드로 서면 같은 일이 부모와 하위로 두 번 세어지고, 그 카드를 눌러 연
    // 할일은 목록 뷰 어디에도 없다 — TaskList는 언제나 최상위만 그린다.
    // AI 자연어 생성이 하위작업에 dueDate를 직접 붙이므로(ai-service.ts 스키마의
    // subtasks[].dueDate) 이건 예외가 아니라 기본 경로다. 바로 옆 UnscheduledRail은
    // 이미 이 규칙을 지키고 있어서, 가드가 없으면 한 화면 안에서 레일과 격자가
    // 서로 다른 말을 한다.
    const dayTasks = tasks.filter((t) => !t.deletedAt && isTopLevel(t) && t.dueDate === dateStr)

    const allDay: Task[] = []
    const timed: Task[] = []

    for (const task of dayTasks) {
      if (task.dueTime) {
        timed.push(task)
      } else {
        allDay.push(task)
      }
    }

    // 시간순 정렬
    timed.sort((a, b) => (a.dueTime || '').localeCompare(b.dueTime || ''))

    return { allDayTasks: allDay, timedTasks: timed }
  }, [tasks, dateStr])

  // 네비게이션
  const goToday = useCallback(() => setCurrentDate(new Date()), [])
  const goPrev = useCallback(
    () =>
      setCurrentDate((prev) => {
        const d = new Date(prev)
        d.setDate(d.getDate() - 1)
        return d
      }),
    []
  )
  const goNext = useCallback(
    () =>
      setCurrentDate((prev) => {
        const d = new Date(prev)
        d.setDate(d.getDate() + 1)
        return d
      }),
    []
  )

  // 특정 시간 슬롯에 속하는 태스크
  const getTasksAtSlot = (hour: number, minute: number): Task[] => {
    return timedTasks.filter((t) => {
      if (!t.dueTime) return false
      const parsed = parseTime(t.dueTime)
      if (!parsed) return false
      // 30분 단위로 매칭: 같은 시 + 분이 해당 범위
      if (parsed.hour !== hour) return false
      if (minute === 0) return parsed.minute < 30
      return parsed.minute >= 30
    })
  }

  // 헤더 날짜 표시
  const headerText = useMemo(() => {
    const y = currentDate.getFullYear()
    const m = currentDate.getMonth() + 1
    const d = currentDate.getDate()
    const dayLabel = tList('date.weekdaysLong')[currentDate.getDay()]
    return i18nInstance.language?.startsWith('en')
      ? `${dayLabel}, ${tList('date.months')[m - 1]} ${d}, ${y}`
      : `${y}년 ${m}월 ${d}일 ${dayLabel}`
  }, [currentDate, i18nInstance.language])

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* 헤더 */}
      <div
        className={`px-6 py-3 border-b flex items-center justify-between ${
          isDark ? 'border-gray-700' : 'border-gray-200'
        }`}
      >
        <div>
          <h2 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{headerText}</h2>
          {isToday && <span className="text-xs text-blue-500 font-medium">{t('common.today')}</span>}
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
        <div ref={gridRef} className="flex-1 overflow-y-auto">
          {/* 종일 태스크 — 스크롤해도 위에 고정. 불투명 배경이라 아래 슬롯이 비치지 않고,
            z-10은 오버레이(110/111)·토스트(90) 아래다. 길어지면 자체 스크롤로 격자를 못 먹게 한다. */}
          {allDayTasks.length > 0 && (
            <div
              className={`sticky top-0 z-10 max-h-[30vh] overflow-y-auto px-6 py-3 border-b ${
                isDark ? 'border-gray-700 bg-[#1C1C1E]' : 'border-gray-200 bg-white'
              }`}
            >
              <div className={`text-xs font-medium mb-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('date.allDay')}
              </div>
              <div className="space-y-1.5">
                {allDayTasks.map((task) => {
                  // 종일 태스크: 중첩 button(체크박스) 포함으로 <button> 전환 불가 → Pattern B
                  return (
                    // biome-ignore lint/a11y/useSemanticElements: 중첩 button 포함으로 <button> 전환 불가
                    <div
                      key={task.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => selectTask(task.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          selectTask(task.id)
                        }
                      }}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer border-l-2 ${
                        isDark ? priorityBg[task.priority].dark : priorityBg[task.priority].light
                      } ${selectedTaskId === task.id ? (isDark ? 'ring-1 ring-blue-500' : 'ring-1 ring-blue-400') : ''}`}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleTask(task.id)
                        }}
                        className="flex-shrink-0"
                      >
                        {task.completed ? (
                          <CheckCircle2 size={14} className="text-green-500" />
                        ) : (
                          <Circle size={14} className={isDark ? 'text-gray-500' : 'text-gray-400'} />
                        )}
                      </button>
                      <span
                        className={`text-sm flex-1 truncate ${
                          task.completed ? 'line-through text-gray-500' : isDark ? 'text-gray-200' : 'text-gray-800'
                        }`}
                      >
                        {task.title}
                      </span>
                      {task.priority !== 'none' && <Flag size={12} className={PRIORITY_COLOR[task.priority]} />}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* 시간 슬롯 (드래그 드롭 대상: <section>으로 의미론적 표현) */}
          <section
            aria-label={t('calendar.timeSlot')}
            className="px-2 relative"
            style={{
              minHeight: `${(DAY_END_HOUR_EXCLUSIVE - DAY_START_HOUR) * 60 * PX_PER_MIN}px`
            }}
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
              const taskId = e.dataTransfer.getData(DND_MIME.TASK_ID) || e.dataTransfer.getData(DND_MIME.TASK_BLOCK)
              if (!taskId) return
              const existing = tasks.find((t) => t.id === taskId)
              if (!existing) return
              const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
              const patch = resolveTimeBlockDrop({
                yPx: e.clientY - rect.top,
                dayStr: dateStr,
                startHour: DAY_START_HOUR,
                pxPerMin: PX_PER_MIN,
                task: existing,
                isBlockMove: e.dataTransfer.types.includes(DND_MIME.TASK_BLOCK),
                sourceDate: e.dataTransfer.getData(DND_MIME.BLOCK_DATE) || null
              })
              if (patch) void updateTask(patch)
            }}
          >
            {timeSlots.map((slot) => {
              const slotTasks = getTasksAtSlot(slot.hour, slot.minute)
              const isHourMark = slot.minute === 0
              return (
                <div
                  key={`${slot.hour}-${slot.minute}`}
                  className={`flex ${
                    isHourMark
                      ? `border-t ${isDark ? 'border-gray-700' : 'border-gray-200'}`
                      : `border-t ${isDark ? 'border-gray-800' : 'border-gray-100'}`
                  }`}
                  style={{ minHeight: '40px' }}
                >
                  {/* 시간 라벨 */}
                  <div className="w-20 flex-shrink-0 text-right pr-3 pt-0.5">
                    {isHourMark && (
                      <span className={`text-[11px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{slot.label}</span>
                    )}
                  </div>

                  {/* 태스크 영역 */}
                  <div className="flex-1 py-0.5 pr-4 space-y-1">
                    {slotTasks.map((task) => {
                      // 시간 슬롯 태스크: 중첩 button(체크박스) 포함으로 <button> 전환 불가 → Pattern B
                      return (
                        // biome-ignore lint/a11y/useSemanticElements: 중첩 button 포함으로 <button> 전환 불가
                        <div
                          key={task.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => selectTask(task.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              selectTask(task.id)
                            }
                          }}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer border-l-2 transition-colors ${
                            isDark ? priorityBg[task.priority].dark : priorityBg[task.priority].light
                          } ${
                            selectedTaskId === task.id ? (isDark ? 'ring-1 ring-blue-500' : 'ring-1 ring-blue-400') : ''
                          }`}
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleTask(task.id)
                            }}
                            className="flex-shrink-0"
                          >
                            {task.completed ? (
                              <CheckCircle2 size={14} className="text-green-500" />
                            ) : (
                              <Circle size={14} className={isDark ? 'text-gray-500' : 'text-gray-400'} />
                            )}
                          </button>

                          <div className="flex-1 min-w-0">
                            <p
                              className={`text-sm truncate ${
                                task.completed
                                  ? 'line-through text-gray-500'
                                  : isDark
                                    ? 'text-gray-200'
                                    : 'text-gray-800'
                              }`}
                            >
                              {task.title}
                            </p>
                            {task.dueTime && (
                              <p className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                                {task.dueTime}
                              </p>
                            )}
                          </div>

                          {task.priority !== 'none' && (
                            <Flag size={12} className={`flex-shrink-0 ${PRIORITY_COLOR[task.priority]}`} />
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}

            {/* Render scheduled time blocks absolutely on top of slot rows.
              TimeBlock computes top from start.getHours() * 60 * pxPerMin (i.e. from 0:00),
              so this layer is offset by -DAY_START_HOUR hours to align with the
              0:00-based time-slot column. Left offset matches the w-20 label column. */}
            <div
              className="absolute pointer-events-none"
              style={{
                top: `${-DAY_START_HOUR * 60 * PX_PER_MIN}px`,
                left: 'calc(0.5rem + 5rem)', // px-2 (8px) + w-20 label (80px)
                right: 'calc(0.5rem + 1rem)', // px-2 (8px) + pr-4 (16px)
                height: `${24 * 60 * PX_PER_MIN}px`
              }}
            >
              <div className="relative w-full h-full pointer-events-auto">
                {blocks.map((b) => {
                  const entry = layout.find((l) => l.id === b.task.id)
                  if (!entry) return null
                  return (
                    <TimeBlock
                      key={b.task.id}
                      task={b.task}
                      start={b.start}
                      end={b.end}
                      pxPerMin={PX_PER_MIN}
                      column={entry.column}
                      columns={entry.columns}
                      isDark={isDark}
                    />
                  )
                })}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
