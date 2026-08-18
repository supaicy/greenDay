import type { ComponentPropsWithoutRef, ComponentType } from 'react'
import { ArrowRight, Copy, CopyPlus, Pin, PinOff, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger
} from '@/components/ui/context-menu'
import type { Task } from '../../types'

// 각 프리미티브에서 '그 프리미티브의' prop을 파생한다. 하나로 뭉뜽그리면
// disabled·asChild·sideOffset 같은 것이 조용히 사라져, 처음 필요한 순간
// 이 파일이 아니라 타입 선언부터 고쳐야 한다.
type ItemProps = ComponentPropsWithoutRef<typeof DropdownMenuItem>
type SeparatorProps = ComponentPropsWithoutRef<typeof DropdownMenuSeparator>
type SubProps = ComponentPropsWithoutRef<typeof DropdownMenuSub>
type SubTriggerProps = ComponentPropsWithoutRef<typeof DropdownMenuSubTrigger>
type SubContentProps = ComponentPropsWithoutRef<typeof DropdownMenuSubContent>

/**
 * 같은 항목을 드롭다운으로도 컨텍스트 메뉴로도 그리기 위한 프리미티브 묶음.
 * Radix의 두 메뉴는 prop 모양이 같아서, 어느 쪽을 쓸지만 바꿔 끼우면 된다.
 */
export type MenuKit = {
  Item: ComponentType<ItemProps>
  Separator: ComponentType<SeparatorProps>
  Sub: ComponentType<SubProps>
  SubTrigger: ComponentType<SubTriggerProps>
  SubContent: ComponentType<SubContentProps>
}

export const DROPDOWN_KIT: MenuKit = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent
}

export const CONTEXT_KIT: MenuKit = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent
}

/**
 * 상세 패널의 ⋯ 메뉴와 목록 행의 우클릭 메뉴가 함께 쓰는 항목들.
 *
 * 두 곳에 손으로 적어두면 한쪽만 고쳐져 같은 할일에 대해 메뉴마다 다른 말을
 * 한다 — 실제로 그랬다(우클릭에는 이동이 있고 ⋯에는 없었다).
 *
 * 여기 있는 것은 전부 '누르면 그 자리에서 끝나는' 동작이다. 편집기가 필요한
 * 것(기간·태그·첨부·하위작업)은 그 편집기가 있는 상세 패널의 ⋯에만 둔다.
 */
export function TaskActionItems({ kit, task }: { kit: MenuKit; task: Task }): React.JSX.Element {
  const { t } = useTranslation()
  const lists = useStore((s) => s.lists)
  const updateTask = useStore((s) => s.updateTask)
  const duplicateTask = useStore((s) => s.duplicateTask)
  const removeTask = useStore((s) => s.removeTask)
  const { Item, Separator, Sub, SubTrigger, SubContent } = kit
  const PinIcon = task.pinned ? PinOff : Pin

  return (
    <>
      <Item onSelect={() => void updateTask({ id: task.id, pinned: !task.pinned })} className="gap-2 text-sm">
        <PinIcon size={14} />
        {t(task.pinned ? 'task.unpin' : 'task.pin')}
      </Item>
      <Item onSelect={() => void duplicateTask(task.id)} className="gap-2 text-sm">
        <CopyPlus size={14} />
        {t('task.duplicate')}
      </Item>

      <Sub>
        <SubTrigger className="gap-2 text-sm">
          <ArrowRight size={14} />
          {t('task.moveToList')}
        </SubTrigger>
        <SubContent className="min-w-[160px]">
          {lists.map((list) => (
            <Item
              key={list.id}
              onSelect={() => void updateTask({ id: task.id, listId: list.id })}
              className={`gap-2 text-sm ${task.listId === list.id ? 'text-primary-400' : ''}`}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: list.color }} />
              {list.name}
            </Item>
          ))}
        </SubContent>
      </Sub>

      <Item onSelect={() => void navigator.clipboard.writeText(task.title)} className="gap-2 text-sm">
        <Copy size={14} />
        {t('task.copyTitle')}
      </Item>

      <Separator />

      <Item onSelect={() => void removeTask(task.id)} className="gap-2 text-sm text-red-400">
        <Trash2 size={14} />
        {t('common.delete')}
      </Item>
    </>
  )
}
