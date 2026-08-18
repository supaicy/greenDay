import type { ReactNode } from 'react'
import { CalendarRange, ListPlus, Paperclip, Tag, Timer } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import { usePomodoroStore } from '../../store/usePomodoroStore'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { DROPDOWN_KIT, TaskActionItems } from './TaskActionItems'
import type { Task } from '../../types'

/**
 * 상세 패널 하단의 ⋯ 메뉴. 자주 쓰지 않는 동작을 여기로 모아 본문(메모)이
 * 패널의 주인공이 되게 한다 — 전에는 하위작업·첨부 버튼이 늘 바닥을 차지했다.
 *
 * 앞쪽은 편집기가 필요한 동작(이 패널에만 있다), 뒤쪽은 우클릭 메뉴와 공유하는
 * 즉시 동작이다(TaskActionItems.tsx).
 */
export function TaskMoreMenu({
  task,
  onAddSubtask,
  onAddTag,
  onAddAttachment,
  onSetDateRange,
  trigger
}: {
  task: Task
  onAddSubtask: () => void
  onAddTag: () => void
  onAddAttachment: () => void
  onSetDateRange: () => void
  trigger: ReactNode
}) {
  const { t } = useTranslation()
  const setViewType = useStore((s) => s.setViewType)
  const toggleRun = usePomodoroStore((s) => s.toggleRun)
  const running = usePomodoroStore((s) => s.running)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="min-w-[184px]">
        <DropdownMenuItem onSelect={onAddSubtask} className="gap-2 text-sm">
          <ListPlus size={14} />
          {t('detail.addSubtask')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onAddTag} className="gap-2 text-sm">
          <Tag size={14} />
          {t('detail.tagsLabel')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onAddAttachment} className="gap-2 text-sm">
          <Paperclip size={14} />
          {t('detail.addAttachment')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onSetDateRange} className="gap-2 text-sm">
          <CalendarRange size={14} />
          {t('detail.setDateRange')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            // 포모도로 화면으로 옮기고 타이머를 시작한다. 이미 돌고 있으면 화면만 옮긴다.
            if (!running) toggleRun()
            setViewType('pomodoro')
          }}
          className="gap-2 text-sm"
        >
          <Timer size={14} />
          {t('detail.startFocus')}
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <TaskActionItems kit={DROPDOWN_KIT} task={task} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
