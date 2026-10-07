import type React from 'react'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Flag, Inbox } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { DND_MIME } from '../../utils/dnd'
import { PRIORITY_COLOR, byPinnedThenPriority } from '../../utils/priority'
import { isActiveTopLevel } from '../../utils/smartLists'

/**
 * 주/일 캘린더 옆에 붙는 '배정 안 됨' 목록.
 *
 * 시간블록을 만들려면 TASK_ID를 만드는 드래그 소스가 시간표와 같은 화면에 있어야 하는데,
 * 그 소스가 리스트 뷰의 TaskItem뿐이라 뷰 전환으로 갈려 있었다 — 즉 사용자가 시간블록을
 * 만들 방법이 없었다(2026-08-05 검증). 이 레일이 그 진입점이다.
 *
 * 반대 방향(블록 → 레일)도 받는다. 끌어다 놓으면 배정이 해제된다.
 */
export const UnscheduledRail = memo(function UnscheduledRail({ isDark }: { isDark: boolean }): React.ReactElement {
  const { t } = useTranslation()
  const tasks = useStore((s) => s.tasks)
  const selectTask = useStore((s) => s.selectTask)
  const updateTask = useStore((s) => s.updateTask)

  const unscheduled = useMemo(
    () => tasks.filter((x) => isActiveTopLevel(x) && !x.scheduledStart).sort(byPinnedThenPriority),
    [tasks]
  )

  const cardClass = `w-full text-left rounded-md border px-2 py-1.5 text-xs cursor-grab active:cursor-grabbing transition-colors ${
    isDark
      ? 'bg-gray-800 border-gray-700 text-gray-200 hover:border-gray-600'
      : 'bg-white border-gray-200 text-gray-800 hover:border-gray-300'
  }`

  return (
    <aside
      aria-label={t('calendar.unscheduledTitle')}
      className={`w-56 shrink-0 flex flex-col border-r ${isDark ? 'border-gray-700 bg-[#1C1C1E]' : 'border-gray-200 bg-gray-50'}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DND_MIME.TASK_BLOCK)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(DND_MIME.TASK_BLOCK)
        if (!id) return
        void updateTask({ id, scheduledStart: null, scheduledEnd: null })
      }}
    >
      <div className={`px-3 py-2 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
        <div
          className={`flex items-center gap-1.5 text-xs font-semibold ${isDark ? 'text-gray-300' : 'text-gray-600'}`}
        >
          <Inbox size={13} />
          {t('calendar.unscheduledTitle')}
          <span className={`ml-auto font-normal ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            {unscheduled.length}
          </span>
        </div>
        <p className={`mt-0.5 text-[10px] leading-snug ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          {t('calendar.unscheduledHint')}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {unscheduled.length === 0 ? (
          <p className={`px-1 py-6 text-center text-[11px] ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
            {t('calendar.unscheduledEmpty')}
          </p>
        ) : (
          unscheduled.map((task) => (
            <button
              type="button"
              key={task.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(DND_MIME.TASK_ID, task.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onClick={() => selectTask(task.id)}
              className={cardClass}
            >
              <span className="flex items-start gap-1.5">
                {task.priority !== 'none' && (
                  <Flag size={10} className={`mt-0.5 shrink-0 ${PRIORITY_COLOR[task.priority]}`} />
                )}
                <span className="min-w-0 break-words">{task.title}</span>
              </span>
              {task.dueDate && (
                <span className={`mt-0.5 block text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  {task.dueDate}
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </aside>
  )
})
