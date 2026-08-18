import type { ReactNode } from 'react'
import { ListPlus, Tag, Paperclip, Timer, Copy, Trash2 } from 'lucide-react'
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

/**
 * 상세 패널 하단의 ⋯ 메뉴. 자주 쓰지 않는 동작을 여기로 모아 본문(메모)이
 * 패널의 주인공이 되게 한다 — 전에는 하위작업·첨부 버튼이 늘 바닥을 차지했다.
 * 이 앱에 실제로 있는 기능만 넣는다.
 */
export function TaskMoreMenu({
  taskId,
  title,
  onAddSubtask,
  onAddTag,
  onAddAttachment,
  trigger
}: {
  taskId: string
  title: string
  onAddSubtask: () => void
  onAddTag: () => void
  onAddAttachment: () => void
  trigger: ReactNode
}) {
  const { t } = useTranslation()
  const removeTask = useStore((s) => s.removeTask)
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

        <DropdownMenuItem
          onSelect={() => void navigator.clipboard.writeText(title)}
          className="gap-2 text-sm"
        >
          <Copy size={14} />
          {t('task.copyTitle')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => removeTask(taskId)} className="gap-2 text-sm text-red-400">
          <Trash2 size={14} />
          {t('common.delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
