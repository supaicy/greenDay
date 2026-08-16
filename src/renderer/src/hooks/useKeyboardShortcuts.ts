import { useEffect } from 'react'
import { useStore } from '../store/useStore'
import { todayString } from '../utils/date'
import type { Priority } from '../types'

const PRIORITY_MAP: Record<string, Priority> = {
  '1': 'none',
  '2': 'low',
  '3': 'medium',
  '4': 'high'
}

export function useKeyboardShortcuts() {
  // 스토어를 구독하지 않는다. 액션은 참조가 고정이라 핸들러 안에서 getState()로 꺼내면
  // 되고, 구독을 만들면(특히 셀렉터 없는 useStore()) 모든 스토어 쓰기가 App을 리렌더시킨다.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey
      const key = e.key
      const {
        selectedTaskId,
        showAddTask,
        showQuickAdd,
        setSearchQuery,
        popUndo,
        updateTask,
        removeTask,
        selectTask,
        exportData
      } = useStore.getState()

      // Escape: 패널 닫기 / 선택 해제
      if (key === 'Escape') {
        // Radix는 document 캡처 단계에서 먼저 닫고 preventDefault만 건다 —
        // 전파는 막지 않으므로 이 window 핸들러까지 온다. 그때 스토어는 이미
        // 갱신돼 있어서 아래 체인이 한 칸 더 내려가고, 결국 오버레이를 닫은
        // Escape 한 번이 선택된 태스크까지 해제해버린다.
        if (e.defaultPrevented) return
        if (showQuickAdd) {
          useStore.getState().setShowQuickAdd(false)
          return
        }
        if (showAddTask) {
          useStore.getState().setShowAddTask(false)
          return
        }
        if (selectedTaskId) {
          selectTask(null)
          return
        }
        return
      }

      // Cmd+Shift+A: 빠른 추가 토글. 오버레이 가드보다 위에 둔다 — 빠른 추가는
      // 다른 오버레이 위로 전환되는 것이 의도된 동작이다.
      if (isMod && e.shiftKey && (key === 'a' || key === 'A')) {
        e.preventDefault()
        useStore.getState().setShowQuickAdd(!useStore.getState().showQuickAdd)
        return
      }

      // 오버레이가 떠 있으면 아래 단축키는 전부 쉰다. Escape와 Cmd+Shift+A만 위에
      // 남는다. 포커스가 입력칸이 아닌 곳(버튼·select·다이얼로그 본체·메뉴 컨테이너)에
      // 있으면 Backspace가 스크림 뒤의 선택 태스크를 지우고, 1-4가 우선순위를 바꾸고,
      // Cmd+Z가 되돌리기를, Cmd+D가 마감일을 바꿨다.
      // 예전에는 ConfirmDialog만 자기 캡처 리스너로 이를 막았고, 나머지 오버레이는
      // 뚫려 있었다 — 그 리스너를 걷어낸 뒤로는 파괴적 확인 창까지 뚫렸다.
      // 메뉴(role=menu)도 포함해야 한다: Radix DropdownMenu는 dialog가 아니다.
      if (
        document.querySelector(
          '[role="dialog"][data-state="open"],[role="alertdialog"][data-state="open"],[role="menu"][data-state="open"]'
        )
      ) {
        return
      }

      // Cmd+N: 태스크 추가 토글
      if (isMod && key === 'n') {
        e.preventDefault()
        useStore.getState().setShowAddTask(!useStore.getState().showAddTask)
        return
      }

      // Cmd+F: 검색 포커스
      if (isMod && key === 'f') {
        e.preventDefault()
        setSearchQuery('')
        setTimeout(() => {
          const searchInput = document.querySelector<HTMLInputElement>('[data-search-input]')
          searchInput?.focus()
        }, 50)
        return
      }

      // Cmd+Z: 되돌리기
      if (isMod && key === 'z' && !e.shiftKey) {
        e.preventDefault()
        popUndo()
        return
      }

      // Cmd+E: 내보내기
      if (isMod && key === 'e') {
        e.preventDefault()
        exportData()
        return
      }

      // Cmd+D: 선택된 태스크에 오늘 마감일 설정.
      // 로컬 날짜여야 한다 — toISOString()은 UTC라 KST 새벽에 '어제'가 박혔다.
      if (isMod && key === 'd') {
        e.preventDefault()
        const taskId = useStore.getState().selectedTaskId
        if (taskId) updateTask({ id: taskId, dueDate: todayString() })
        return
      }

      // 입력 필드에 포커스가 있으면 아래 단축키 무시
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return

      // Delete/Backspace: 선택된 태스크 삭제
      if (key === 'Delete' || key === 'Backspace') {
        const taskId = useStore.getState().selectedTaskId
        if (taskId) {
          e.preventDefault()
          removeTask(taskId)
        }
        return
      }

      // 1-4: 선택된 태스크 우선순위 설정
      if (!isMod && PRIORITY_MAP[key]) {
        const taskId = useStore.getState().selectedTaskId
        if (taskId) {
          e.preventDefault()
          updateTask({ id: taskId, priority: PRIORITY_MAP[key] })
        }
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
