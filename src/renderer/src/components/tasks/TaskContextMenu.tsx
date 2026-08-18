import { useState, type ReactNode } from 'react'
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
import type { Task } from '../../types'

/**
 * 목록 행의 우클릭 메뉴. 전에는 손수 만든 fixed div였다 — 바깥 클릭 리스너를
 * 직접 달고, 하위메뉴는 절대 위치로 붙이고, 화면 밖으로 나가도 그대로 잘렸다.
 * Radix로 옮기면서 그 셋 다 프리미티브가 맡는다.
 *
 * 내용은 열렸을 때만 만든다. 이 컴포넌트는 할일 행마다 하나씩 있어서, 닫힌
 * 메뉴의 항목까지 매 렌더에 그려두면 목록 길이만큼 헛일이 곱해진다.
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
  const [open, setOpen] = useState(false)

  return (
    <ContextMenu onOpenChange={setOpen}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      {open && <TaskContextMenuContent task={task} extra={extra} />}
    </ContextMenu>
  )
}

function TaskContextMenuContent({ task, extra }: { task: Task; extra?: ReactNode }): React.JSX.Element {
  const { t } = useTranslation()
  const toggleTask = useStore((s) => s.toggleTask)

  return (
    <ContextMenuContent className="min-w-[184px]">
      {/* '완료로 변경'은 행에서만 의미가 있다 — 상세 패널에는 상단바에 동그라미가 이미 있다. */}
      <ContextMenuItem onSelect={() => void toggleTask(task.id)} className="gap-2 text-sm">
        <CheckCircle2 size={14} />
        {task.completed ? t('task.markIncomplete') : t('task.markComplete')}
      </ContextMenuItem>
      {extra}
      <ContextMenuSeparator />
      <TaskActionItems kit={CONTEXT_KIT} task={task} />
    </ContextMenuContent>
  )
}
