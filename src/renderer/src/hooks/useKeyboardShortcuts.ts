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

      // Cmd+Shift+A: 빠른 추가 토글
      if (isMod && e.shiftKey && (key === 'a' || key === 'A')) {
        e.preventDefault()
        useStore.getState().setShowQuickAdd(!useStore.getState().showQuickAdd)
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
