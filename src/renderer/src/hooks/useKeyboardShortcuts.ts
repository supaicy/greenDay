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

/**
 * 지금 글자를 입력하는 자리인가. 입력칸이 자기 키를 먼저 가져야 하는 단축키가
 * 이걸로 양보한다. CodeMirror 노트 에디터는 contentEditable이라 셋 다 본다.
 */
function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.tagName !== 'string') return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true
}

export function useKeyboardShortcuts() {
  // 스토어를 구독하지 않는다. 액션은 참조가 고정이라 핸들러 안에서 getState()로 꺼내면
  // 되고, 구독을 만들면(특히 셀렉터 없는 useStore()) 모든 스토어 쓰기가 App을 리렌더시킨다.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey
      const key = e.key
      /**
       * 문자 단축키 비교용 키. **Caps Lock이 켜져 있으면 `e.key`가 'N'으로 온다.**
       *
       * 예전에는 문자 단축키가 전부 소문자만 비교해서(`key === 'n'`), Caps Lock 하나에
       * Cmd+N·F·Z·E·D가 통째로 죽었다. 설정 화면이 그 단축키들을 광고하고 있으므로
       * 사용자에게는 "앱이 고장났다"로 보인다 — 특히 Cmd+Z는 방금 지운 할일을
       * 되돌리지 못한다.
       *
       * Cmd+Shift+A만 `(key === 'a' || key === 'A')`로 양쪽을 처리하고 있었는데,
       * 그건 Shift 때문에 대문자가 오는 것이 눈에 띄어서였을 뿐이고 나머지로
       * 일반화되지 않았다. 여기서 한 번 맞춰 두면 그 특례도 필요 없다.
       *
       * `e.code`(KeyN)를 쓰지 않는 이유: 비QWERTY 배열에서 물리 키 위치가 달라
       * 사용자가 실제로 누른 글자와 어긋난다.
       *
       * 한 글자일 때만 소문자로 내린다 — 'Escape'·'Delete'·'Backspace'는 이름 그대로
       * 비교해야 한다.
       */
      const letter = key.length === 1 ? key.toLowerCase() : key
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
      //
      // **계약: Escape를 자기 몫으로 쓴 쪽은 `preventDefault()`로 알린다.** 그러면
      // 여기서 아무것도 하지 않는다. 알리는 쪽은 둘이다.
      //
      // 1. Radix 오버레이. document 캡처 단계에서 먼저 닫고 preventDefault만 건다 —
      //    전파는 막지 않으므로 이 window 핸들러까지 온다. 그때 스토어는 이미
      //    갱신돼 있어서, 이 가드가 없으면 아래 체인이 한 칸 더 내려가 오버레이를
      //    닫은 Escape 한 번이 선택된 태스크까지 해제해버린다.
      // 2. 손으로 쓴 입력칸의 onKeyDown — 할일 추가칸 AddTask, 하위작업 입력칸
      //    SubtaskList(지울 글자가 있을 때만), 새 폴더·새 리스트 이름 Sidebar, 습관 추가 HabitTracker.
      //    React는 루트에 위임해 처리하므로 그 안의 preventDefault는 버블 단계의
      //    이 window 리스너보다 먼저 네이티브 이벤트에 찍힌다. 예전에는 이 칸들이
      //    알리지 않아서, 추가칸을 닫으려던 Escape가 `showAddTask`를 내린 뒤 체인을
      //    한 칸 더 내려와 오른쪽 상세 패널(App.tsx: `selectedTaskId`가 null이면
      //    TaskDetail 언마운트)까지 닫았다.
      //
      // **입력칸이라는 이유만으로 양보하지 않는다.** 한때 아래 선택 해제가
      // INPUT/TEXTAREA/contentEditable 전부에 양보했는데, 상세 패널의 제목칸·
      // CodeMirror 노트·검색창은 Escape를 따로 쓰지 않는다 — 그곳에서 Escape가
      // 아무것도 하지 않게 됐다. 그 칸들에서는 Escape가 패널을 닫는 것이 맞다.
      // 새로 만드는 입력칸이 Escape를 쓴다면 그 핸들러에서 preventDefault를 걸 것
      // (useKeyboardShortcuts.test.tsx가 양쪽을 못 박는다).
      //
      // **IME 조합 중이면 아무것도 하지 않는다.** 한글을 치다 누른 Escape는 IME가 조합을
      // 끝내는 데 쓴다(keydown이 isComposing, WebKit에선 keyCode 229로 온다). 제목칸처럼
      // 자기 Escape가 없는 칸에서 이걸 받으면 음절 하나를 치다 상세 패널이 닫힌다.
      if (key === 'Escape') {
        if (e.isComposing || e.keyCode === 229) return
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
      if (isMod && e.shiftKey && letter === 'a') {
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
      if (isMod && letter === 'n') {
        e.preventDefault()
        useStore.getState().setShowAddTask(!useStore.getState().showAddTask)
        return
      }

      // Cmd+F: 검색 포커스
      if (isMod && letter === 'f') {
        e.preventDefault()
        setSearchQuery('')
        setTimeout(() => {
          const searchInput = document.querySelector<HTMLInputElement>('[data-search-input]')
          searchInput?.focus()
        }, 50)
        return
      }

      // Cmd+Z: 되돌리기.
      //
      // **글자를 치고 있는 중이면 양보한다.** 아래 입력칸 가드는 이 블록보다 한참
      // 뒤에 있어서, 노트·제목·검색창에서 누른 Cmd+Z를 전역 되돌리기가 가로챘다.
      // 결과가 둘 다 나쁘다: `preventDefault()`가 그 칸의 네이티브 글자 되돌리기를
      // 죽이고, 대신 undo 스택에 남아 있던(최대 20개, 토스트는 5초 뒤 사라져도
      // 스택은 남는다) **몇 분 전에 지운 할일이 목록에 조용히 되살아난다.**
      // 스택이 비어 있으면 앱의 모든 입력칸에서 Cmd+Z가 아무것도 안 하는 것으로 보인다.
      if (isMod && letter === 'z' && !e.shiftKey) {
        if (isTextEntry(e.target)) return
        e.preventDefault()
        popUndo()
        return
      }

      // Cmd+E: 내보내기
      if (isMod && letter === 'e') {
        e.preventDefault()
        exportData()
        return
      }

      // Cmd+D: 선택된 태스크에 오늘 마감일 설정.
      // 로컬 날짜여야 한다 — toISOString()은 UTC라 KST 새벽에 '어제'가 박혔다.
      if (isMod && letter === 'd') {
        e.preventDefault()
        const taskId = useStore.getState().selectedTaskId
        if (taskId) updateTask({ id: taskId, dueDate: todayString() })
        return
      }

      // 입력 필드에 포커스가 있으면 아래 단축키 무시
      if (isTextEntry(e.target)) return

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
