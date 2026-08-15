import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { Task } from '../../types'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import { snapTo15Min, toLocalIsoMinute } from '../../utils/scheduledTime'
import { DND_MIME } from '../../utils/dnd'

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

const MIN_BLOCK_MIN = 15

export function TimeBlock({ task, start, end, pxPerMin, column, columns, isDark }: Props): React.ReactElement {
  const { t } = useTranslation()
  const updateTask = useStore((s) => s.updateTask)
  const elRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
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
  const occurrenceDate = toLocalIsoMinute(start).slice(0, 10)

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

  // Context menu
  const onContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    setMenuOpen(true)
  }

  const unschedule = (): void => {
    // 시리즈 배정 해제 — 회차 오버라이드도 함께 지워 유령 블록을 남기지 않는다.
    void updateTask({ id: task.id, scheduledStart: null, scheduledEnd: null, scheduledOverrides: null })
    setMenuOpen(false)
  }

  const completedStripe = task.completed ? 'bg-stripes opacity-60' : ''

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 드래그 블록 — drag/contextMenu 인터랙션, button 전환 불가
    <div
      ref={elRef}
      draggable
      onDragStart={onDragStart}
      onContextMenu={onContextMenu}
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
      {menuOpen && (
        // biome-ignore lint/a11y/noStaticElementInteractions: 컨텍스트 메뉴 컨테이너 — 중첩 button이 키보드 접근성 제공
        <div
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className={`absolute right-1 top-1 rounded shadow-md z-10 ${
            isDark ? 'bg-gray-800 text-gray-200' : 'bg-white text-gray-800'
          }`}
        >
          <button
            type="button"
            className="px-3 py-1 text-xs hover:bg-gray-500/20 block w-full text-left"
            onClick={unschedule}
          >
            {t('calendar.unschedule')}
          </button>
          <button
            type="button"
            className="px-3 py-1 text-xs hover:bg-gray-500/20 block w-full text-left"
            onClick={() => setMenuOpen(false)}
          >
            {t('common.cancel')}
          </button>
        </div>
      )}
    </div>
  )
}
