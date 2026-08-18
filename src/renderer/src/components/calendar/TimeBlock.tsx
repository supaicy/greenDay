import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { CalendarOff } from 'lucide-react'
import type { Task } from '../../types'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import { snapTo15Min, toLocalIsoMinute, MIN_BLOCK_MS } from '../../utils/scheduledTime'
import { toDateString } from '../../utils/date'
import { DND_MIME } from '../../utils/dnd'
import { ContextMenuItem } from '@/components/ui/context-menu'
import { TaskContextMenu } from '../tasks/TaskContextMenu'

interface Props {
  task: Task
  /** Start time of the block for this occurrence. */
  start: Date
  /** End time of the block for this occurrence. */
  end: Date
  /** Pixels per minute for the calendar (e.g. Weekly ~0.67, Daily ~1.6). */
  pxPerMin: number
  /** Column layout from layoutOverlappingBlocks. */
  column: number
  columns: number
  isDark: boolean
}

// updateTask가 거부하는 하한과 같은 값이어야 한다 — 따로 들고 있으면 한쪽만
// 바뀌었을 때 리사이즈 결과가 조용히 저장되지 않는다.
const MIN_BLOCK_MIN = MIN_BLOCK_MS / 60000

export function TimeBlock({ task, start, end, pxPerMin, column, columns, isDark }: Props): React.ReactElement {
  const { t } = useTranslation()
  const updateTask = useStore((s) => s.updateTask)
  const elRef = useRef<HTMLDivElement>(null)
  const [isResizing, setIsResizing] = useState(false)
  const resizeAbortRef = useRef<AbortController | null>(null)

  // Cleanup any in-progress resize when the component unmounts
  useEffect(() => () => resizeAbortRef.current?.abort(), [])

  const durationMin = (end.getTime() - start.getTime()) / 60000
  const topPx = (start.getHours() * 60 + start.getMinutes()) * pxPerMin
  const heightPx = durationMin * pxPerMin
  const widthPct = 100 / columns
  const leftPct = column * widthPct

  // Serialize Date → local ISO "YYYY-MM-DDTHH:mm:00"

  // 이 블록이 그려진 발생일. 반복 할일은 드롭/리사이즈가 이 날짜의 회차만 건드린다.
  const occurrenceDate = toDateString(start)

  const onDragStart = (e: React.DragEvent): void => {
    e.dataTransfer.setData(DND_MIME.TASK_BLOCK, task.id)
    e.dataTransfer.setData(DND_MIME.BLOCK_DATE, occurrenceDate)
    e.dataTransfer.effectAllowed = 'move'
  }

  // Resize handle
  const onResizeStart = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()

    // Abort any previous resize first (shouldn't happen, but defensive)
    resizeAbortRef.current?.abort()
    const ac = new AbortController()
    resizeAbortRef.current = ac

    const startY = e.clientY
    const startEnd = new Date(end)
    setIsResizing(true)

    const onMove = (ev: MouseEvent): void => {
      const deltaMin = (ev.clientY - startY) / pxPerMin
      const newEnd = new Date(startEnd.getTime() + deltaMin * 60000)
      // Clamp to at least 15 min after start and not past 23:59 same day
      const minEnd = new Date(start.getTime() + MIN_BLOCK_MIN * 60000)
      const dayEnd = new Date(start)
      dayEnd.setHours(23, 59, 0, 0)
      const clampedEnd = new Date(Math.max(minEnd.getTime(), Math.min(newEnd.getTime(), dayEnd.getTime())))
      if (elRef.current) {
        elRef.current.style.height = `${((clampedEnd.getTime() - start.getTime()) / 60000) * pxPerMin}px`
      }
    }
    const onUp = (ev: MouseEvent): void => {
      ac.abort() // detach both listeners
      setIsResizing(false)
      const deltaMin = (ev.clientY - startY) / pxPerMin
      const newEnd = new Date(startEnd.getTime() + deltaMin * 60000)
      const minEnd = new Date(start.getTime() + MIN_BLOCK_MIN * 60000)
      const dayEnd = new Date(start)
      dayEnd.setHours(23, 59, 0, 0)
      const clampedEnd = new Date(Math.max(minEnd.getTime(), Math.min(newEnd.getTime(), dayEnd.getTime())))
      const snapped = snapTo15Min(toLocalIsoMinute(clampedEnd))
      if (task.isRecurring) {
        // 반복 할일의 리사이즈는 시리즈 템플릿이 아니라 이 회차만 바꾼다.
        void updateTask({
          id: task.id,
          scheduledOverrides: {
            ...(task.scheduledOverrides ?? {}),
            [occurrenceDate]: { start: toLocalIsoMinute(start), end: snapped }
          }
        })
      } else {
        void updateTask({ id: task.id, scheduledEnd: snapped })
      }
    }

    document.addEventListener('mousemove', onMove, { signal: ac.signal })
    document.addEventListener('mouseup', onUp, { signal: ac.signal })
  }

  // 시리즈 배정 해제. 회차 오버라이드 정리는 스토어의 불변식이 맡는다.
  const unschedule = (): void => void updateTask({ id: task.id, scheduledStart: null, scheduledEnd: null })

  const completedStripe = task.completed ? 'bg-stripes opacity-60' : ''

  return (
    <TaskContextMenu
      task={task}
      extra={
        <ContextMenuItem onSelect={unschedule} className="gap-2 text-sm">
          <CalendarOff size={14} />
          {t('calendar.unschedule')}
        </ContextMenuItem>
      }
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 드래그 블록 — drag 인터랙션, button 전환 불가 */}
      <div
        ref={elRef}
        draggable
        // 포커스를 받을 수 있어야 Shift+F10·컨텍스트 메뉴 키로 메뉴를 열 수 있다.
        // role="button"은 붙이지 않는다 — Enter/Space로 할 일이 없어 지키지 못할
        // 약속이 되고, aria-label을 걸면 안에 그린 시간 범위가 대신 가려진다.
        // biome-ignore lint/a11y/noNoninteractiveTabindex: 위 주석 — 컨텍스트 메뉴 키를 받으려면 포커스가 필요하다
        tabIndex={0}
        onDragStart={onDragStart}
        style={{
          position: 'absolute',
          top: `${topPx}px`,
          left: `${leftPct}%`,
          width: `${widthPct}%`,
          ...(isResizing ? {} : { height: `${heightPx}px` })
        }}
        className={`rounded-md border-l-4 px-2 py-1 text-xs overflow-hidden cursor-grab select-none ${
          isDark ? 'bg-blue-500/20 border-l-blue-400 text-gray-100' : 'bg-blue-100 border-l-blue-400 text-gray-800'
        } ${completedStripe}`}
      >
        <div className="font-medium truncate">{task.title}</div>
        <div className="text-[10px] opacity-70">
          {start.getHours()}:{String(start.getMinutes()).padStart(2, '0')}–{end.getHours()}:
          {String(end.getMinutes()).padStart(2, '0')}
        </div>
        {/* Resize handle (bottom 6px) */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: 크기 조정 핸들, 마우스 드래그 전용 */}
        <div
          onMouseDown={onResizeStart}
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '6px', cursor: 'ns-resize' }}
        />
      </div>
    </TaskContextMenu>
  )
}
