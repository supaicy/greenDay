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
import type { Task } from '../../types'

/**
 * 목록 행의 우클릭 메뉴. 전에는 손수 만든 fixed div였다 — 바깥 클릭 리스너를
 * 직접 달고, 하위메뉴는 절대 위치로 붙이고, 화면 밖으로 나가도 그대로 잘렸다.
 * Radix로 옮기면서 그 셋 다 프리미티브가 맡는다.
 *
 * 내용을 `{open && ...}`로 감싸지 않는다(CLAUDE.md '오버레이 규칙'). Radix가
 * 열림 상태를 갖고 Presence로 DOM 마운트를 이미 막는다 — 바깥에서 언마운트하면
 * data-state="closed" 프레임이 없어 닫힘 애니메이션이 죽고, 트리거로 포커스를
 * 돌려주는 것도 언마운트 순서에 딸려간다. 행마다 React 엘리먼트를 만드는 비용은
 * 남지만, 그건 포커스 정확성과 바꿀 것이 못 된다.
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

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
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
    </ContextMenu>
  )
}
