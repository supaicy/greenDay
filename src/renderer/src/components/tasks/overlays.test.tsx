// @vitest-environment jsdom

/**
 * 오버레이를 Radix로 옮기며 드러난 것들을 붙잡는 테스트.
 *
 * 전부 순수 로직이 아니라 "실제로 눌렀을 때 뭐가 일어나는가"라서, 이 저장소
 * 최초의 컴포넌트 테스트다. 타입체크도 빌드도 어느 것 하나 잡지 못했다.
 * (main 브랜치의 shadcn 전환에서 이식 — 트렁크 재작업 2026-08-15)
 */

import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useState } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContextMenuItem } from '@/components/ui/context-menu'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import i18n from '../../i18n'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { useStore } from '../../store/useStore'
import { DueDatePicker } from './DueDatePicker'
import { PriorityMenu } from './PriorityMenu'
import { RecurringPicker } from './RecurringPicker'
import { ReminderPicker } from './ReminderPicker'
import { SortMenu } from './SortMenu'
import { TagPicker } from './TagPicker'
import { TaskContextMenu } from './TaskContextMenu'
import { TaskItem } from './TaskItem'
import { TaskMoreMenu } from './TaskMoreMenu'
import { QuickAdd } from '../common/QuickAdd'

beforeAll(async () => {
  // jsdom의 navigator.language는 en-US라 초기 언어가 흔들린다 — 한국어로 고정.
  await i18n.changeLanguage('ko')
  // Radix가 쓰는 브라우저 API 중 jsdom에 없는 것들.
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView = () => {}
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
})

// 이 파일은 실제 스토어에 연결된 컴포넌트를 그린다. window.api가 없으면 스토어
// 쓰기가 unhandled rejection으로 죽어, 가드가 회귀했을 때 깔끔한 실패 대신
// 에러로 터진다. 또 setState로 심은 값이 모듈 싱글턴에 남아 뒤 테스트로 샌다.
const STORE_KEYS = [
  'selectedTaskId',
  'showQuickAdd',
  'showAddTask',
  'tasks',
  // 아래는 테스트가 vi.fn()으로 갈아끼우는 것들 — 되돌리지 않으면 뒤 테스트가
  // 가짜 액션을 물려받아 통과해 버린다.
  'lists',
  'updateTask',
  'duplicateTask',
  'removeTask',
  'toggleTask',
  'popUndo',
  'setShowAddTask'
] as const
let storeSnapshot: Record<string, unknown>

beforeEach(() => {
  // jsdom의 window를 통째로 갈아끼우면 프로토타입과 getter가 날아간다 —
  // 필요한 것(api)만 얹는다.
  ;(window as unknown as Record<string, unknown>).api = {
    updateTask: vi.fn(),
    createTask: vi.fn(),
    deleteTask: vi.fn(),
    batchUpdateTasks: vi.fn(),
    addScoreEvent: vi.fn(),
    addScoreEvents: vi.fn(),
    reorderTasks: vi.fn()
  }
  const s = useStore.getState() as unknown as Record<string, unknown>
  storeSnapshot = Object.fromEntries(STORE_KEYS.map((k) => [k, s[k]]))
})

afterEach(() => {
  cleanup()
  useStore.setState(storeSnapshot as never)
})

describe('SortMenu', () => {
  it('트리거를 한 번 누르면 열린다', async () => {
    const user = userEvent.setup()
    render(<SortMenu trigger={<button type="button">정렬</button>} />)

    // 예전에는 호출처 버튼이 SortMenu를 mount하고 SortMenu가 자기 버튼을 또
    // 그려서, 첫 클릭은 두 번째 버튼을 나타나게 할 뿐이었다.
    await user.click(screen.getByRole('button', { name: '정렬' }))

    expect(await screen.findByRole('menuitem', { name: /마감일/ })).toBeInTheDocument()
  })
})

describe('ReminderPicker', () => {
  it('트리거를 한 번 누르면 열린다', async () => {
    const user = userEvent.setup()
    render(
      <ReminderPicker
        dueDate={null}
        value={null}
        onChange={() => {}}
        trigger={<button type="button">알림 설정</button>}
      />
    )

    await user.click(screen.getByRole('button', { name: '알림 설정' }))

    expect(await screen.findByRole('button', { name: '30분 전' })).toBeInTheDocument()
  })
})

describe('RecurringPicker', () => {
  it('트리거를 한 번 누르면 열린다', async () => {
    const user = userEvent.setup()
    render(<RecurringPicker value={null} onChange={() => {}} trigger={<button type="button">반복 설정</button>} />)

    await user.click(screen.getByRole('button', { name: '반복 설정' }))

    expect(await screen.findByRole('button', { name: '매주' })).toBeInTheDocument()
  })
})

/**
 * 외부 리뷰(Codex/GPT-5.5)가 지적한 것: 팝오버가 z-[111]이라 다이얼로그
 * 스크림(z-[110])보다 위이므로, 픽커를 열어둔 채 단축키로 모달을 띄우면
 * 팝오버가 어두운 배경 위에 떠 있을 수 있다.
 *
 * z 순서 관찰은 맞지만 결론은 성립하지 않는다 — 그 순간이 오지 않는다.
 * 모달 다이얼로그가 포커스를 가져가면 팝오버의 dismissable layer가
 * focus-outside로 스스로 닫는다. 바깥 클릭이 필요 없다.
 */
function ModalOverPopoverHarness(): React.JSX.Element {
  const [dialogOpen, setDialogOpen] = useState(false)
  // 실제 경로 그대로: window keydown이 상태를 바꿔 모달을 연다. 클릭 없음.
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'a') setDialogOpen(true)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  return (
    <>
      <ReminderPicker
        dueDate={null}
        value={null}
        onChange={() => {}}
        trigger={<button type="button">알림 설정</button>}
      />
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogTitle>빠른 추가</DialogTitle>
        </DialogContent>
      </Dialog>
    </>
  )
}

describe('팝오버와 모달', () => {
  it('단축키로 모달이 열리면 팝오버는 남지 않는다', async () => {
    const user = userEvent.setup()
    render(<ModalOverPopoverHarness />)
    await user.click(screen.getByRole('button', { name: '알림 설정' }))
    expect(await screen.findByRole('button', { name: '30분 전' })).toBeInTheDocument()

    // 팝오버 안에 포커스가 있는 상태에서 Cmd+Shift+A — 클릭도 pointerdown도 없다
    await user.keyboard('{Meta>}{Shift>}a{/Shift}{/Meta}')

    await waitFor(() => expect(screen.getByText('빠른 추가')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '30분 전' })).toBeNull()
  })
})

function ShortcutHarness(): React.JSX.Element {
  useKeyboardShortcuts()
  return <div />
}

function EscapeHarness(): React.JSX.Element {
  useKeyboardShortcuts()
  const showQuickAdd = useStore((s) => s.showQuickAdd)
  const setShowQuickAdd = useStore((s) => s.setShowQuickAdd)
  return (
    <Dialog open={showQuickAdd} onOpenChange={setShowQuickAdd}>
      <DialogContent>
        <DialogTitle>빠른 추가</DialogTitle>
      </DialogContent>
    </Dialog>
  )
}

describe('Escape', () => {
  it('오버레이를 닫을 뿐, 선택된 태스크까지 해제하지 않는다', async () => {
    const user = userEvent.setup()
    useStore.setState({ selectedTaskId: 'task-1', showQuickAdd: true })
    render(<EscapeHarness />)
    expect(await screen.findByText('빠른 추가')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    // Radix는 document 캡처 단계에서 먼저 닫고 preventDefault만 건다.
    // 전파를 막지 않으므로 앱의 window 핸들러까지 오고, 그때 스토어는 이미
    // 갱신돼 있어서 체인이 한 칸 더 내려가 선택까지 해제했었다.
    expect(useStore.getState().showQuickAdd).toBe(false)
    expect(useStore.getState().selectedTaskId).toBe('task-1')
  })
})

/**
 * 벤더링한 ui 프리미티브가 프로젝트 규칙(CLAUDE.md '오버레이 규칙')을 지키는지.
 * shadcn 기본값을 그대로 두면 조용히 어긋나는 자리들이라 여기서 못박는다.
 */
describe('ui 프리미티브 — 프로젝트 규칙', () => {
  it('드롭다운 메뉴가 토스트(z-90)·컨텍스트 메뉴(z-100) 위에 뜬다', async () => {
    const user = userEvent.setup()
    render(<SortMenu trigger={<button type="button">정렬</button>} />)
    await user.click(screen.getByRole('button', { name: '정렬' }))

    const menu = await screen.findByRole('menu')
    // shadcn 기본 z-50이면 UndoToast(90)·TaskItem 컨텍스트 메뉴(100) 아래에 깔린다.
    // 포털이 #root 밖(body 직속)이라 stacking context가 없어 한 줄로 비교된다.
    expect(menu.className).toContain('z-overlayContent')
    expect(menu.className).not.toContain('z-50')
  })

  it('컨텍스트 메뉴도 같은 z 규칙을 따른다', async () => {
    const user = userEvent.setup()
    useStore.setState({ lists: [] as never })
    render(
      <TaskContextMenu task={menuTask}>
        <div>행</div>
      </TaskContextMenu>
    )
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('행') })

    // 프리미티브를 하나 더 벤더링할 때 z-50이 딸려 오는 것이 이 저장소의
    // 반복된 실수다. 드롭다운만 검사하면 새 메뉴가 조용히 어긋난다.
    const menu = await screen.findByRole('menu')
    expect(menu.className).toContain('z-overlayContent')
    expect(menu.className).not.toContain('z-50')
  })

  it('호출처가 onClick을 줘도 전파 차단이 살아 있다', async () => {
    const user = userEvent.setup()
    const rowClick = vi.fn()
    const contentClick = vi.fn()
    // 이 프리미티브의 존재 이유가 전파 차단인데, {...props}가 onClick 뒤에
    // 펼쳐져 있어 호출처가 onClick을 주는 순간 가드가 통째로 덮였다.
    render(
      // biome-ignore lint/a11y/useSemanticElements: Sidebar의 실제 구조 재현 — 중첩 button이 있어 <button>으로 못 바꾼다
      <div role="button" aria-label="행" tabIndex={0} onClick={rowClick} onKeyDown={() => {}}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" onClick={(e) => e.stopPropagation()}>
              메뉴
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent onClick={contentClick}>
            <DropdownMenuItem>삭제</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
    await user.click(screen.getByRole('button', { name: '메뉴' }))
    await user.click(await screen.findByRole('menuitem', { name: '삭제' }))

    expect(contentClick).toHaveBeenCalled()
    expect(rowClick).not.toHaveBeenCalled()
  })

  it('다이얼로그의 모서리 지정을 호출처가 이길 수 있다', async () => {
    render(
      <Dialog open>
        <DialogContent className="rounded-2xl">
          <DialogTitle>빠른 추가</DialogTitle>
        </DialogContent>
      </Dialog>
    )
    const dialog = await screen.findByRole('dialog')
    // 기본 클래스에 sm:rounded-lg가 남아 있으면 tailwind-merge가 지우지 못하고
    // (그룹이 다르다) 640px 이상에서 그쪽이 이겨, 호출처 지정이 죽는다.
    expect(dialog.className).toContain('rounded-2xl')
    expect(dialog.className).not.toContain('sm:rounded-lg')
  })

  it('다이얼로그의 폭 지정도 호출처가 이길 수 있다', async () => {
    render(
      <Dialog open>
        <DialogContent className="w-[480px]">
          <DialogTitle>설정</DialogTitle>
        </DialogContent>
      </Dialog>
    )
    const dialog = await screen.findByRole('dialog')
    // 같은 함정: w-*는 max-w-*를 못 이긴다. 기본에 max-w-lg가 남아 있으면
    // 호출처가 max-w-none 해독제를 매번 같이 써야 한다(두 곳이 그러고 있었다).
    expect(dialog.className).toContain('w-[480px]')
    expect(dialog.className).not.toContain('max-w-lg')
  })
})

describe('QuickAdd', () => {
  it('열리면 입력칸에 포커스가 간다 (타이머 없이 Radix 포커스 훅으로)', async () => {
    useStore.setState({ showQuickAdd: true })
    render(<QuickAdd />)
    const input = await screen.findByRole('textbox')
    await waitFor(() => expect(input).toHaveFocus())
  })
})

describe('RecurringPicker — 빈 매주 패턴 차단', () => {
  it('요일을 고르기 전에는 적용할 수 없다', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<RecurringPicker value={null} onChange={onChange} trigger={<button type="button">반복 설정</button>} />)
    await user.click(screen.getByRole('button', { name: '반복 설정' }))
    await user.click(await screen.findByRole('button', { name: '매주' }))

    // 요일 0개로 적용하면 'weekly:' 패턴이 만들어져, 표시로는 고른 적 없는
    // 일요일 반복을 주장하고 다음 회차는 영영 생기지 않는다.
    const apply = screen.getByRole('button', { name: '적용' })
    expect(apply).toBeDisabled()
    await user.click(apply)
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('모달이 열려 있는 동안 앱 단축키', () => {
  it('뒤에 선택된 할일을 지우지 않는다', async () => {
    const user = userEvent.setup()
    useStore.setState({ selectedTaskId: 'task-1', showQuickAdd: true })
    render(<EscapeHarness />)
    expect(await screen.findByText('빠른 추가')).toBeInTheDocument()

    // 포커스가 입력칸이 아닌 곳(다이얼로그 본체)에 있을 때 Backspace가
    // 스크림 뒤의 선택 태스크를 삭제하던 경로. 1-4(우선순위), Cmd+Z도 같은 문제.
    screen.getByRole('dialog').focus()
    await user.keyboard('{Backspace}')

    expect(useStore.getState().selectedTaskId).toBe('task-1')
  })
})

describe('오버레이가 열린 동안 Cmd 단축키', () => {
  it('모달 뒤에서 Cmd+Z(되돌리기)·Cmd+D(오늘로)가 실행되지 않는다', async () => {
    const user = userEvent.setup()
    const popUndo = vi.fn()
    const updateTask = vi.fn()
    useStore.setState({ selectedTaskId: 'task-1', showQuickAdd: true, popUndo, updateTask })
    render(<EscapeHarness />)
    expect(await screen.findByText('빠른 추가')).toBeInTheDocument()
    screen.getByRole('dialog').focus()

    await user.keyboard('{Meta>}z{/Meta}')
    await user.keyboard('{Meta>}d{/Meta}')

    // 파괴적 확인 창(ConfirmDialog) 앞에서 특히 나쁘다 — 예전에는 그 컴포넌트가
    // 자기 캡처 리스너로 모든 키를 삼켜 막고 있었다.
    expect(popUndo).not.toHaveBeenCalled()
    expect(updateTask).not.toHaveBeenCalled()
  })

  it('드롭다운 메뉴가 열려 있어도 뒤의 할일이 지워지지 않는다', async () => {
    const user = userEvent.setup()
    const removeTask = vi.fn()
    useStore.setState({ selectedTaskId: 'task-1', showQuickAdd: false, removeTask })
    render(
      <>
        <ShortcutHarness />
        <SortMenu trigger={<button type="button">정렬</button>} />
      </>
    )
    await user.click(screen.getByRole('button', { name: '정렬' }))
    await screen.findByRole('menu')

    // Radix 메뉴는 role="menu"라 다이얼로그 셀렉터에 걸리지 않는다.
    await user.keyboard('{Backspace}')

    expect(removeTask).not.toHaveBeenCalled()
  })
})

describe('ReminderPicker — 상태 누수', () => {
  it('닫으면 사용자 지정 입력이 비워진다', async () => {
    const user = userEvent.setup()
    render(
      <ReminderPicker dueDate={null} value={null} onChange={() => {}} trigger={<button type="button">알림</button>} />
    )
    await user.click(screen.getByRole('button', { name: '알림' }))
    const date = document.querySelector('input[type="date"]') as HTMLInputElement
    await user.type(date, '2026-08-20')
    expect(date.value).toBe('2026-08-20')

    // 다른 할일로 옮겨가는 상황: 픽커는 언마운트되지 않고 닫히기만 한다.
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: '알림' }))

    const reopened = document.querySelector('input[type="date"]') as HTMLInputElement
    expect(reopened.value).toBe('')
  })
})

describe('Radix 포털과 React 이벤트 버블링', () => {
  it('메뉴에서 삭제를 눌러도 그 행이 선택되지 않는다', async () => {
    const user = userEvent.setup()
    const removeList = vi.fn()
    const setSelectedList = vi.fn()
    // Sidebar의 구조를 그대로 축약: 선택 가능한 행 안에 드롭다운 트리거가 들어있다.
    render(
      // biome-ignore lint/a11y/useSemanticElements: Sidebar의 실제 구조를 그대로 재현한다 — 중첩 button(메뉴 트리거)이 있어 <button>으로 못 바꾼다
      <div role="button" tabIndex={0} onClick={() => setSelectedList('list-1')} onKeyDown={() => {}}>
        <span>업무</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" onClick={(e) => e.stopPropagation()}>
              메뉴
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => removeList('list-1')}>삭제</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
    await user.click(screen.getByRole('button', { name: '메뉴' }))
    await user.click(await screen.findByRole('menuitem', { name: '삭제' }))

    expect(removeList).toHaveBeenCalledWith('list-1')
    // 포털은 DOM상 body 아래지만 React 트리로는 행의 자식이라 클릭이 행까지 올라간다.
    // 그대로 두면 리스트를 지운 직후 그 삭제된 id를 선택해 빈 화면이 남는다.
    expect(setSelectedList).not.toHaveBeenCalled()
  })
})

/**
 * TickTick 배치로 옮기며 생긴 오버레이 3형제. 전부 "트리거는 호출처가 준다"
 * 규약을 따르므로, 규약이 깨지면 한 번 눌러 열리지 않는 그 버그가 되돌아온다.
 */
describe('PriorityMenu', () => {
  it('깃발을 한 번 누르면 열리고, 높음이 맨 위다', async () => {
    const user = userEvent.setup()
    render(<PriorityMenu value="none" onChange={() => {}} trigger={<button type="button">우선순위</button>} />)

    await user.click(screen.getByRole('button', { name: '우선순위' }))

    const items = await screen.findAllByRole('menuitem')
    // PRIORITY_OPTIONS는 없음부터라 뒤집어 쓴다. 목록·필터와 같은 방향이어야 한다.
    expect(items.map((i) => i.textContent)).toEqual(['높음', '중간', '낮음', '없음'])
  })

  it('고르면 그 값으로 알린다', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<PriorityMenu value="none" onChange={onChange} trigger={<button type="button">우선순위</button>} />)

    await user.click(screen.getByRole('button', { name: '우선순위' }))
    await user.click(await screen.findByRole('menuitem', { name: '높음' }))

    expect(onChange).toHaveBeenCalledWith('high')
  })
})

describe('TagPicker', () => {
  beforeEach(() => {
    useStore.setState({
      tasks: [{ tags: ['출시', '버그'] }, { tags: ['출시', '문서'] }] as never
    })
  })

  it('(+)를 한 번 누르면 입력과 함께 이미 쓰던 태그가 뜬다', async () => {
    const user = userEvent.setup()
    render(<TagPicker tags={[]} onChange={() => {}} />)

    await user.click(screen.getByRole('button', { name: '태그' }))

    expect(await screen.findByPlaceholderText('태그...')).toBeInTheDocument()
    // 자동완성의 요점은 오타로 태그가 갈라지는 것을 막는 데 있다.
    expect(screen.getByRole('button', { name: '출시' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '문서' })).toBeInTheDocument()
  })

  it('이미 붙은 태그는 제안하지 않는다', async () => {
    const user = userEvent.setup()
    render(<TagPicker tags={['출시']} onChange={() => {}} />)

    await user.click(screen.getByRole('button', { name: '태그' }))
    await screen.findByPlaceholderText('태그...')

    // 칩으로 이미 보이는 것을 목록에 또 내밀면 눌러도 아무 일이 없다.
    expect(screen.queryByRole('button', { name: '출시' })).toBeNull()
    expect(screen.getByRole('button', { name: '버그' })).toBeInTheDocument()
  })

  it('입력한 말로 제안을 좁힌다', async () => {
    const user = userEvent.setup()
    render(<TagPicker tags={[]} onChange={() => {}} />)

    await user.click(screen.getByRole('button', { name: '태그' }))
    await user.type(await screen.findByPlaceholderText('태그...'), '문')

    expect(screen.getByRole('button', { name: '문서' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '버그' })).toBeNull()
  })

  it('Enter로 새 태그를 더한다', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TagPicker tags={['출시']} onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: '태그' }))
    await user.type(await screen.findByPlaceholderText('태그...'), '회고{Enter}')

    expect(onChange).toHaveBeenCalledWith(['출시', '회고'])
  })

  it('이미 있는 태그를 다시 넣어도 늘지 않는다', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TagPicker tags={['출시']} onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: '태그' }))
    await user.type(await screen.findByPlaceholderText('태그...'), '출시{Enter}')

    expect(onChange).not.toHaveBeenCalled()
  })

  it('칩의 x로 뗀다', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TagPicker tags={['출시', '버그']} onChange={onChange} />)

    await user.click(screen.getAllByRole('button', { name: '삭제' })[0])

    expect(onChange).toHaveBeenCalledWith(['버그'])
  })
})

describe('TaskMoreMenu', () => {
  it('⋯을 한 번 누르면 이 앱에 실제로 있는 동작만 뜬다', async () => {
    const user = userEvent.setup()
    render(
      <TaskMoreMenu
        task={menuTask}
        onAddSubtask={() => {}}
        onAddTag={() => {}}
        onAddAttachment={() => {}}
        onSetDateRange={() => {}}
        trigger={<button type="button">더 보기</button>}
      />
    )

    await user.click(screen.getByRole('button', { name: '더 보기' }))

    const items = await screen.findAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual([
      '하위 작업 추가',
      '태그',
      '파일 추가',
      '기간 설정',
      '포커스 시작',
      '고정',
      '복제',
      '다른 리스트로 이동',
      '제목 복사',
      '삭제'
    ])
  })

  it('다른 오버레이로 넘기는 항목은 포커스를 트리거로 되돌리지 않는다', async () => {
    const user = userEvent.setup()
    render(
      <TaskMoreMenu
        task={menuTask}
        onAddSubtask={() => {}}
        onAddTag={() => {}}
        onAddAttachment={() => {}}
        onSetDateRange={() => {}}
        trigger={<button type="button">더 보기</button>}
      />
    )
    const trigger = screen.getByRole('button', { name: '더 보기' })
    await user.click(trigger)
    await user.click(await screen.findByRole('menuitem', { name: '기간 설정' }))

    // 메뉴가 닫히며 포커스를 트리거로 되돌리면, 그 순간 갓 열린 팝오버가
    // focus-outside로 스스로 닫힌다(실측: 열렸다가 ~400ms 뒤 사라졌다).
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(trigger).not.toHaveFocus()
  })

  it('넘기지 않는 항목은 포커스를 트리거로 돌려준다', async () => {
    const user = userEvent.setup()
    render(
      <TaskMoreMenu
        task={menuTask}
        onAddSubtask={() => {}}
        onAddTag={() => {}}
        onAddAttachment={() => {}}
        onSetDateRange={() => {}}
        trigger={<button type="button">더 보기</button>}
      />
    )
    const trigger = screen.getByRole('button', { name: '더 보기' })
    await user.click(trigger)
    await user.click(await screen.findByRole('menuitem', { name: '제목 복사' }))

    // 키보드 사용자가 자리를 잃지 않아야 한다 — 넘기는 항목에만 예외를 둔다.
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('하위 작업 추가는 호출처에 알린다 (숨어 있던 섹션을 꺼내는 건 상세 패널의 일)', async () => {
    const user = userEvent.setup()
    const onAddSubtask = vi.fn()
    render(
      <TaskMoreMenu
        task={menuTask}
        onAddSubtask={onAddSubtask}
        onAddTag={() => {}}
        onAddAttachment={() => {}}
        onSetDateRange={() => {}}
        trigger={<button type="button">더 보기</button>}
      />
    )

    await user.click(screen.getByRole('button', { name: '더 보기' }))
    await user.click(await screen.findByRole('menuitem', { name: '하위 작업 추가' }))

    expect(onAddSubtask).toHaveBeenCalled()
  })

  it('삭제는 그 할일을 지운다', async () => {
    const user = userEvent.setup()
    const removeTask = vi.fn()
    useStore.setState({ removeTask })
    render(
      <TaskMoreMenu
        task={menuTask}
        onAddSubtask={() => {}}
        onAddTag={() => {}}
        onAddAttachment={() => {}}
        onSetDateRange={() => {}}
        trigger={<button type="button">더 보기</button>}
      />
    )

    await user.click(screen.getByRole('button', { name: '더 보기' }))
    await user.click(await screen.findByRole('menuitem', { name: '삭제' }))

    expect(removeTask).toHaveBeenCalledWith('task-1')
  })
})

describe('DueDatePicker — 접힌 알림·반복', () => {
  const props = {
    dueDate: null,
    dueTime: null,
    startDate: null,
    reminderAt: null,
    recurringPattern: null,
    isRecurring: false,
    onChange: () => {},
    onStartDateChange: () => {},
    onReminderChange: () => {},
    onRecurringChange: () => {}
  }

  it('기한 팝오버 안에서 알림 픽커가 열린다', async () => {
    const user = userEvent.setup()
    render(<DueDatePicker {...props} trigger={<button type="button">기한</button>} />)

    await user.click(screen.getByRole('button', { name: '기한' }))
    // 상단바에서 치웠으므로, 여기서 못 열리면 알림 기능이 통째로 사라진 것이다.
    await user.click(await screen.findByRole('button', { name: /알림/ }))

    expect(await screen.findByRole('button', { name: '30분 전' })).toBeInTheDocument()
  })

  it('기한 팝오버 안에서 반복 픽커가 열린다', async () => {
    const user = userEvent.setup()
    render(<DueDatePicker {...props} trigger={<button type="button">기한</button>} />)

    await user.click(screen.getByRole('button', { name: '기한' }))
    await user.click(await screen.findByRole('button', { name: /반복/ }))

    expect(await screen.findByRole('button', { name: '매주' })).toBeInTheDocument()
  })

  it('기간 신호를 받으면 시작일 칸과 함께 열린다', async () => {
    // ⋯ 메뉴의 '기간 설정'과 이 팝오버를 잇는 유일한 배선이다.
    const trigger = <button type="button">기한</button>
    const { rerender } = render(<DueDatePicker {...props} autoOpenRangeSignal={0} trigger={trigger} />)
    rerender(<DueDatePicker {...props} autoOpenRangeSignal={1} trigger={trigger} />)

    expect(await screen.findByLabelText('시작')).toBeInTheDocument()
  })

  it('시작일이 저장돼 있으면 신호 없이도 기간 모드로 열린다', async () => {
    const user = userEvent.setup()
    render(<DueDatePicker {...props} startDate="2026-08-18" dueDate="2026-08-20" trigger={<button type="button">기한</button>} />)
    await user.click(screen.getByRole('button', { name: '기한' }))

    const start = await screen.findByLabelText('시작')
    expect(start).toHaveValue('2026-08-18')
    // 달력에서 거꾸로 된 기간을 아예 고를 수 없게 묶어 둔다.
    expect(start).toHaveAttribute('max', '2026-08-20')
  })

  it('기간 모드에서 끝을 늘려도 시작일은 제자리다', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <DueDatePicker
        {...props}
        startDate="2026-08-16"
        dueDate="2026-08-16"
        onChange={onChange}
        trigger={<button type="button">기한</button>}
      />
    )
    await user.click(screen.getByRole('button', { name: '기한' }))
    fireEvent.change(await screen.findByLabelText('마감일'), { target: { value: '2026-08-19' } })

    // 시작일을 같이 실어 보내지 않으면 스토어가 '마감일만 옮겼다'로 읽고
    // 기간을 통째로 끌고 간다 — 끝을 늘렸을 뿐인데 시작도 따라 움직였다.
    expect(onChange).toHaveBeenCalledWith({ dueDate: '2026-08-19', dueTime: null, startDate: '2026-08-16' })
  })

  it('기간이 아닐 때는 시작일을 싣지 않는다 — 캘린더 드래그는 기간째 옮겨야 한다', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DueDatePicker {...props} dueDate="2026-08-16" onChange={onChange} trigger={<button type="button">기한</button>} />)
    await user.click(screen.getByRole('button', { name: '기한' }))
    fireEvent.change(await screen.findByLabelText('마감일'), { target: { value: '2026-08-19' } })

    expect(onChange).toHaveBeenCalledWith({ dueDate: '2026-08-19', dueTime: null })
  })

  it('기간을 끄면 시작일을 지운다', async () => {
    const user = userEvent.setup()
    const onStartDateChange = vi.fn()
    render(
      <DueDatePicker
        {...props}
        startDate="2026-08-18"
        dueDate="2026-08-20"
        onStartDateChange={onStartDateChange}
        trigger={<button type="button">기한</button>}
      />
    )
    await user.click(screen.getByRole('button', { name: '기한' }))
    await user.click(await screen.findByRole('button', { name: /기간/ }))

    expect(onStartDateChange).toHaveBeenCalledWith(null)
  })

  it('기간을 켜며 자동으로 잡힌 마감일은 끌 때 같이 사라진다', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onStartDateChange = vi.fn()
    const trigger = <button type="button">기한</button>
    // 기한 없는 할일에서 '기간 설정' → 시작일을 고르면 그날이 마감일로도 잡힌다.
    const { rerender } = render(
      <DueDatePicker {...props} autoOpenRangeSignal={1} onChange={onChange} onStartDateChange={onStartDateChange} trigger={trigger} />
    )
    fireEvent.change(await screen.findByLabelText('시작'), { target: { value: '2026-08-18' } })
    expect(onChange).toHaveBeenCalledWith({ dueDate: '2026-08-18', dueTime: null })

    // 마음이 바뀌어 기간을 끄면, 사용자가 고른 적 없는 마감일만 남으면 안 된다.
    rerender(
      <DueDatePicker
        {...props}
        autoOpenRangeSignal={1}
        startDate="2026-08-18"
        dueDate="2026-08-18"
        onChange={onChange}
        onStartDateChange={onStartDateChange}
        trigger={trigger}
      />
    )
    await user.click(screen.getByRole('button', { name: /기간/ }))

    expect(onStartDateChange).toHaveBeenCalledWith(null)
    expect(onChange).toHaveBeenLastCalledWith({ dueDate: null, dueTime: null })
  })

  it('고른 적 없는 기간을 끌 때는 헛저장하지 않는다', async () => {
    const user = userEvent.setup()
    const onStartDateChange = vi.fn()
    const trigger = <button type="button">기한</button>
    const { rerender } = render(
      <DueDatePicker {...props} autoOpenRangeSignal={0} onStartDateChange={onStartDateChange} trigger={trigger} />
    )
    rerender(
      <DueDatePicker {...props} autoOpenRangeSignal={1} onStartDateChange={onStartDateChange} trigger={trigger} />
    )
    await screen.findByLabelText('시작')
    await user.click(screen.getByRole('button', { name: /기간/ }))

    // 지울 것이 없는데 저장을 부르면, 아무것도 안 바뀐 쓰기가 디스크까지 간다.
    expect(onStartDateChange).not.toHaveBeenCalled()
  })

  it('빠른 선택은 시각을 건드리지 않는다', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <DueDatePicker
        {...props}
        dueTime="09:30"
        onChange={onChange}
        trigger={<button type="button">기한</button>}
      />
    )

    await user.click(screen.getByRole('button', { name: '기한' }))
    await user.click(await screen.findByRole('button', { name: '오늘' }))

    // 날짜만 옮기는 조작이다. 시각까지 날리면 09:30 회의가 조용히 종일 일정이 된다.
    expect(onChange).toHaveBeenCalledWith({ dueDate: expect.any(String), dueTime: '09:30' })
  })
})

describe('RecurringPicker — 버린 초안', () => {
  it('Escape로 닫으면 고치던 값이 남지 않는다', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<RecurringPicker value="daily" onChange={onChange} trigger={<button type="button">반복</button>} />)

    await user.click(screen.getByRole('button', { name: '반복' }))
    await user.click(await screen.findByRole('button', { name: '매월' }))
    await user.keyboard('{Escape}')

    // 다시 열어 적용하면, 버린 '매월'이 아니라 원래 값이어야 한다.
    await user.click(screen.getByRole('button', { name: '반복' }))
    await user.click(await screen.findByRole('button', { name: '적용' }))

    expect(onChange).toHaveBeenCalledWith('daily')
  })
})

/**
 * ⋯ 메뉴와 우클릭 메뉴는 겹치는 항목을 손으로 두 번 적고 있었다 — 한쪽만
 * 고쳐지면 같은 할일에 대해 메뉴마다 다른 말을 한다. 공유 정의를 두고,
 * 두 메뉴가 정말 같은 것을 보여주는지 여기서 붙잡는다.
 */
const menuTask = {
  id: 'task-1',
  title: '보고서',
  pinned: false,
  listId: 'inbox',
  completed: false
} as never

function renderContextMenu(over: Record<string, unknown> = {}): void {
  render(
    <TaskContextMenu task={{ ...(menuTask as object), ...over } as never}>
      <div>행</div>
    </TaskContextMenu>
  )
}

async function openContextMenu(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.pointer({ keys: '[MouseRight]', target: screen.getByText('행') })
  await screen.findByRole('menu')
}

describe('공유 할일 동작', () => {
  beforeEach(() => {
    useStore.setState({
      lists: [
        { id: 'inbox', name: '기본함', color: '#000' },
        { id: 'work', name: '업무', color: '#111' }
      ] as never
    })
  })

  it('두 메뉴가 같은 공유 항목을 같은 순서로 보여준다', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <TaskMoreMenu
        task={menuTask}
        onAddSubtask={() => {}}
        onAddTag={() => {}}
        onAddAttachment={() => {}}
        onSetDateRange={() => {}}
        trigger={<button type="button">더 보기</button>}
      />
    )
    await user.click(screen.getByRole('button', { name: '더 보기' }))
    const more = (await screen.findAllByRole('menuitem')).map((i) => i.textContent)
    unmount()

    renderContextMenu()
    await openContextMenu(user)
    const ctx = screen.getAllByRole('menuitem').map((i) => i.textContent)

    const shared = ['고정', '복제', '다른 리스트로 이동', '제목 복사', '삭제']
    expect(more.filter((x) => shared.includes(x as string))).toEqual(shared)
    expect(ctx.filter((x) => shared.includes(x as string))).toEqual(shared)
  })

  it('우클릭 메뉴는 즉시 끝나는 동작만 담는다', async () => {
    const user = userEvent.setup()
    renderContextMenu()
    await openContextMenu(user)

    // 기간·태그·첨부·하위작업은 편집기가 필요하다 — 목록 행에는 열 자리가 없다.
    for (const editorAction of ['기간 설정', '태그', '파일 추가', '하위 작업 추가']) {
      expect(screen.queryByRole('menuitem', { name: editorAction })).toBeNull()
    }
    expect(screen.getByRole('menuitem', { name: '완료로 변경' })).toBeInTheDocument()
  })

  it('호출처가 자기만 아는 항목을 끼워 넣을 수 있다', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    // 캘린더 블록의 '배정 해제'가 이 자리를 쓴다 — 전에는 그 메뉴가 별도의
    // 손수 만든 div였고, 바깥을 클릭해도 닫히지 않았다.
    render(
      <TaskContextMenu task={menuTask} extra={<ContextMenuItem onSelect={onSelect}>배정 해제</ContextMenuItem>}>
        <div>행</div>
      </TaskContextMenu>
    )
    await openContextMenu(user)

    const items = screen.getAllByRole('menuitem').map((i) => i.textContent)
    expect(items.slice(0, 2)).toEqual(['완료로 변경', '배정 해제'])
    await user.click(screen.getByRole('menuitem', { name: '배정 해제' }))
    expect(onSelect).toHaveBeenCalled()
  })

  it('완료로 변경을 누르면 그 할일을 토글한다', async () => {
    const user = userEvent.setup()
    const toggleTask = vi.fn()
    useStore.setState({ toggleTask })
    renderContextMenu()
    await openContextMenu(user)
    await user.click(screen.getByRole('menuitem', { name: '완료로 변경' }))

    expect(toggleTask).toHaveBeenCalledWith('task-1')
  })

  it('이미 완료된 할일은 미완료로 변경으로 뒤집힌다', async () => {
    const user = userEvent.setup()
    renderContextMenu({ completed: true })
    await openContextMenu(user)

    expect(screen.getByRole('menuitem', { name: '미완료로 변경' })).toBeInTheDocument()
  })

  it('고정을 누르면 그 할일을 고정한다', async () => {
    const user = userEvent.setup()
    const updateTask = vi.fn()
    useStore.setState({ updateTask })
    renderContextMenu()
    await openContextMenu(user)
    await user.click(screen.getByRole('menuitem', { name: '고정' }))

    expect(updateTask).toHaveBeenCalledWith({ id: 'task-1', pinned: true })
  })

  it('이미 고정된 할일은 해제로 뒤집힌다', async () => {
    const user = userEvent.setup()
    const updateTask = vi.fn()
    useStore.setState({ updateTask })
    renderContextMenu({ pinned: true })
    await openContextMenu(user)
    await user.click(screen.getByRole('menuitem', { name: '고정 해제' }))

    expect(updateTask).toHaveBeenCalledWith({ id: 'task-1', pinned: false })
  })

  it('복제를 누르면 복제한다', async () => {
    const user = userEvent.setup()
    const duplicateTask = vi.fn()
    useStore.setState({ duplicateTask })
    renderContextMenu()
    await openContextMenu(user)
    await user.click(screen.getByRole('menuitem', { name: '복제' }))

    expect(duplicateTask).toHaveBeenCalledWith('task-1')
  })

  it('이동 하위메뉴에서 목록을 고르면 그 목록으로 옮긴다', async () => {
    const user = userEvent.setup()
    const updateTask = vi.fn()
    useStore.setState({ updateTask })
    renderContextMenu()
    await openContextMenu(user)
    // 포인터로는 못 연다 — jsdom엔 레이아웃이 없어 Radix의 hover 의도 판정이
    // 하위메뉴를 즉시 닫는다(실제 브라우저에서는 포인터가 내용 위에 남는다).
    // 키보드 경로는 Radix의 실제 열기·선택 핸들러를 그대로 지난다.
    screen.getByRole('menuitem', { name: '다른 리스트로 이동' }).focus()
    await user.keyboard('{ArrowRight}')
    await screen.findByRole('menuitem', { name: '업무' })
    await user.keyboard('{ArrowDown}{Enter}')

    expect(updateTask).toHaveBeenCalledWith({ id: 'task-1', listId: 'work' })
  })
})

/**
 * Regression: 진단 2.4 / 3장 #20 — 문자 단축키가 소문자만 비교했다.
 * Found by /qa on 2026-09-25
 * Report: docs/reports/2026-09-25-전체-진단.html
 *
 * Caps Lock은 shiftKey를 세우지 않고 `e.key`만 대문자로 만든다. 그래서
 * userEvent의 '{Shift>}z'가 아니라 fireEvent로 key만 대문자로 보내야
 * 실제 상황과 같아진다.
 */
describe('Caps Lock — 문자 단축키', () => {
  it('대문자 key로 와도 Cmd+Z가 되돌린다', () => {
    const popUndo = vi.fn()
    useStore.setState({ popUndo, showQuickAdd: false, showAddTask: false })
    render(<ShortcutHarness />)

    fireEvent.keyDown(window, { key: 'Z', metaKey: true })

    // 예전에는 `key === 'z'`만 봐서, Caps Lock 하나로 방금 지운 할일을
    // 키보드로 되돌릴 방법이 사라졌다.
    expect(popUndo).toHaveBeenCalledTimes(1)
  })

  it('대문자 key로 와도 Cmd+N이 할일 추가를 연다', () => {
    const setShowAddTask = vi.fn()
    useStore.setState({ setShowAddTask, showQuickAdd: false, showAddTask: false })
    render(<ShortcutHarness />)

    fireEvent.keyDown(window, { key: 'N', metaKey: true })

    expect(setShowAddTask).toHaveBeenCalledWith(true)
  })

  it('소문자도 그대로 동작한다 (회귀 방지의 반대쪽)', () => {
    const popUndo = vi.fn()
    useStore.setState({ popUndo, showQuickAdd: false, showAddTask: false })
    render(<ShortcutHarness />)

    fireEvent.keyDown(window, { key: 'z', metaKey: true })

    expect(popUndo).toHaveBeenCalledTimes(1)
  })
})

/**
 * Regression: 진단 3장 #20 — 입력칸의 Cmd+Z를 전역 되돌리기가 가로챘다.
 * Found by /qa on 2026-09-25
 */
describe('Cmd+Z는 글자를 치는 중이면 양보한다', () => {
  it('입력칸에서 누른 Cmd+Z가 지운 할일을 되살리지 않는다', () => {
    const popUndo = vi.fn()
    useStore.setState({ popUndo, showQuickAdd: false, showAddTask: false })
    render(
      <>
        <ShortcutHarness />
        <input aria-label="제목" defaultValue="타이핑 중" />
      </>
    )

    fireEvent.keyDown(screen.getByLabelText('제목'), { key: 'z', metaKey: true })

    // 예전에는 preventDefault()가 그 칸의 네이티브 글자 되돌리기를 죽이고,
    // 대신 몇 분 전에 지운 할일이 목록에 조용히 되살아났다.
    expect(popUndo).not.toHaveBeenCalled()
  })

  it('contentEditable(노트 에디터)에서도 양보한다', () => {
    const popUndo = vi.fn()
    useStore.setState({ popUndo, showQuickAdd: false, showAddTask: false })
    const { container } = render(
      <>
        <ShortcutHarness />
        <div contentEditable data-testid="note" suppressContentEditableWarning />
      </>
    )
    const note = container.querySelector('[data-testid="note"]') as HTMLElement
    // jsdom은 contentEditable 속성만으로 isContentEditable을 세우지 않는다.
    Object.defineProperty(note, 'isContentEditable', { value: true })

    fireEvent.keyDown(note, { key: 'z', metaKey: true })

    expect(popUndo).not.toHaveBeenCalled()
  })

  it('입력칸 밖에서는 그대로 되돌린다', () => {
    const popUndo = vi.fn()
    useStore.setState({ popUndo, showQuickAdd: false, showAddTask: false })
    render(<ShortcutHarness />)

    fireEvent.keyDown(document.body, { key: 'z', metaKey: true })

    expect(popUndo).toHaveBeenCalledTimes(1)
  })
})

/**
 * Regression: 진단 2.7 / 3장 #24 — 드래그가 'copy'를 광고해 드롭이 거부됐다.
 * Found by /qa on 2026-09-25
 * Report: docs/reports/2026-09-25-전체-진단.html
 *
 * HTML5 DnD는 `effectAllowed`와 `dropEffect`가 맞아야 드롭을 허용한다.
 * 어긋나면 `onDrop`이 아예 발화하지 않아 재정렬이 조용히 죽는다 — 행이
 * 흐려지며 드래그는 시작되므로 "기능이 없다"가 아니라 "앱이 놓쳤다"로 보인다.
 */
describe('할일 드래그 — 드래그와 드롭의 effect가 맞는가', () => {
  const dragTask = {
    id: 'drag-1',
    title: '끌어보기',
    completed: false,
    priority: 'none',
    dueDate: null,
    listId: 'inbox',
    parentId: null,
    tags: [],
    attachments: [],
    pinned: false
  } as never

  function fakeTransfer(): { setData: ReturnType<typeof vi.fn>; effectAllowed: string; dropEffect: string } {
    return { setData: vi.fn(), effectAllowed: 'uninitialized', dropEffect: 'none' }
  }

  function renderRow(): HTMLElement {
    useStore.setState({ tasks: [dragTask] as never })
    render(<TaskItem task={dragTask} />)
    return screen.getByText('끌어보기').closest('[draggable="true"]') as HTMLElement
  }

  it('드래그 시작이 move를 허용한다', () => {
    const dt = fakeTransfer()
    fireEvent.dragStart(renderRow(), { dataTransfer: dt })
    expect(dt.effectAllowed).toBe('move')
  })

  it('드래그와 드롭이 같은 effect를 말한다 (드롭이 허용되는 조건)', () => {
    const row = renderRow()
    const dt = fakeTransfer()
    fireEvent.dragStart(row, { dataTransfer: dt })
    fireEvent.dragOver(row, { dataTransfer: dt })
    // 'copy' vs 'move'로 갈리면 브라우저가 드롭을 거부한다.
    expect(dt.effectAllowed).toBe(dt.dropEffect)
  })
})
