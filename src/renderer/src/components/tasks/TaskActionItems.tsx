import type { ComponentType, ReactNode } from 'react'
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
import type { TaskAction } from './taskActions'
import type { Task } from '../../types'

type ItemProps = { onSelect?: (e: Event) => void; className?: string; children?: ReactNode }
type WrapProps = { className?: string; children?: ReactNode }

/**
 * 같은 항목을 드롭다운으로도 컨텍스트 메뉴로도 그리기 위한 프리미티브 묶음.
 * Radix의 두 메뉴는 API 모양이 같아서, 어느 것을 쓸지만 바꿔 끼우면 된다.
 */
export type MenuKit = {
  Item: ComponentType<ItemProps>
  Separator: ComponentType<WrapProps>
  Sub: ComponentType<{ children?: ReactNode }>
  SubTrigger: ComponentType<WrapProps>
  SubContent: ComponentType<WrapProps>
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

/** 동작 목록(taskActions.ts)을 주어진 프리미티브로 그린다. */
export function TaskActionItems({
  actions,
  kit,
  task
}: {
  actions: TaskAction[]
  kit: MenuKit
  task: Task
}): React.JSX.Element {
  const { t } = useTranslation()
  const lists = useStore((s) => s.lists)
  const updateTask = useStore((s) => s.updateTask)
  const { Item, Separator, Sub, SubTrigger, SubContent } = kit

  return (
    <>
      {actions.map((action) => {
        if (action.kind === 'separator') return <Separator key={action.key} />
        if (action.kind === 'moveToList') {
          return (
            <Sub key={action.key}>
              <SubTrigger className="gap-2 text-sm">
                <action.Icon size={14} />
                {t(action.labelKey)}
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
          )
        }
        return (
          <Item
            key={action.key}
            onSelect={action.run}
            className={`gap-2 text-sm ${action.danger ? 'text-red-400' : ''}`}
          >
            <action.Icon size={14} />
            {t(action.labelKey)}
          </Item>
        )
      })}
    </>
  )
}
