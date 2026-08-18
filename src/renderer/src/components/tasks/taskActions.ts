import { ArrowRight, Copy, CopyPlus, Pin, PinOff, Trash2, type LucideIcon } from 'lucide-react'
import { useStore } from '../../store/useStore'
import type { Task } from '../../types'

export type TaskAction =
  | { kind: 'item'; key: string; labelKey: string; Icon: LucideIcon; danger?: boolean; run: () => void }
  /** 리스트 목록을 펼치는 하위메뉴. 항목은 렌더러가 스토어에서 읽어 그린다. */
  | { kind: 'moveToList'; key: string; labelKey: string; Icon: LucideIcon }
  | { kind: 'separator'; key: string }

/**
 * 상세 패널의 ⋯ 메뉴와 목록 행의 우클릭 메뉴가 함께 쓰는 항목들.
 *
 * 두 곳에 손으로 적어두면 한쪽만 고쳐져 같은 할일에 대해 메뉴마다 다른 말을
 * 한다 — 실제로 그랬다(우클릭에는 이동이 있고 ⋯에는 없었다).
 *
 * 여기 있는 것은 전부 '누르면 그 자리에서 끝나는' 동작이다. 편집기가 필요한
 * 것(기간·태그·첨부·하위작업)은 그 편집기가 있는 상세 패널의 ⋯에만 둔다.
 */
export function useSharedTaskActions(task: Task): TaskAction[] {
  const updateTask = useStore((s) => s.updateTask)
  const duplicateTask = useStore((s) => s.duplicateTask)
  const removeTask = useStore((s) => s.removeTask)

  return [
    {
      kind: 'item',
      key: 'pin',
      labelKey: task.pinned ? 'task.unpin' : 'task.pin',
      Icon: task.pinned ? PinOff : Pin,
      run: () => void updateTask({ id: task.id, pinned: !task.pinned })
    },
    {
      kind: 'item',
      key: 'duplicate',
      labelKey: 'task.duplicate',
      Icon: CopyPlus,
      run: () => void duplicateTask(task.id)
    },
    { kind: 'moveToList', key: 'move', labelKey: 'task.moveToList', Icon: ArrowRight },
    {
      kind: 'item',
      key: 'copyTitle',
      labelKey: 'task.copyTitle',
      Icon: Copy,
      run: () => void navigator.clipboard.writeText(task.title)
    },
    { kind: 'separator', key: 'sep' },
    {
      kind: 'item',
      key: 'delete',
      labelKey: 'common.delete',
      Icon: Trash2,
      danger: true,
      run: () => void removeTask(task.id)
    }
  ]
}
