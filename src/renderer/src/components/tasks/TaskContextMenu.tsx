import type { ReactNode } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { CONTEXT_KIT, TaskActionItems } from './TaskActionItems'
import { useSharedTaskActions } from './taskActions'
import type { Task } from '../../types'

/**
 * 목록 행의 우클릭 메뉴. 전에는 손수 만든 fixed div였다 — 바깥 클릭 리스너를
 * 직접 달고, 하위메뉴는 절대 위치로 붙이고, 화면 밖으로 나가도 그대로 잘렸다.
 * Radix로 옮기면서 그 셋 다 프리미티브가 맡는다.
 *
 * 항목은 상세 패널의 ⋯과 공유한다(taskActions.ts). 다만 '완료로 변경'은
 * 행에서만 의미가 있다 — 상세 패널에는 상단바에 동그라미가 이미 있다.
 */
export function TaskContextMenu({
  task,
  extra,
  children
}: {
  task: Task
  /** 호출처만 아는 동작(예: 캘린더 블록의 '배정 해제'). 완료 토글 다음에 붙는다. */
  extra?: ReactNode
  children: ReactNode
}) {
  const { t } = useTranslation()
  const toggleTask = useStore((s) => s.toggleTask)
  const shared = useSharedTaskActions(task)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-[184px]">
        <ContextMenuItem onSelect={() => void toggleTask(task.id)} className="gap-2 text-sm">
          <CheckCircle2 size={14} />
          {task.completed ? t('task.markIncomplete') : t('task.markComplete')}
        </ContextMenuItem>
        {extra}
        <ContextMenuSeparator />
        <TaskActionItems actions={shared} kit={CONTEXT_KIT} task={task} />
      </ContextMenuContent>
    </ContextMenu>
  )
}
