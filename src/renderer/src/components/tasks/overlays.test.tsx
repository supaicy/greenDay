// @vitest-environment jsdom

/**
 * 오버레이를 Radix로 옮기며 드러난 것들을 붙잡는 테스트.
 *
 * 전부 순수 로직이 아니라 "실제로 눌렀을 때 뭐가 일어나는가"라서, 이 저장소
 * 최초의 컴포넌트 테스트다. 타입체크도 빌드도 어느 것 하나 잡지 못했다.
 * (main 브랜치의 shadcn 전환에서 이식 — 트렁크 재작업 2026-08-15)
 */

import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import i18n from '../../i18n'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { useStore } from '../../store/useStore'
import { RecurringPicker } from './RecurringPicker'
import { ReminderPicker } from './ReminderPicker'
import { SortMenu } from './SortMenu'
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

afterEach(cleanup)

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
    expect(menu.className).toContain('z-[111]')
    expect(menu.className).not.toContain('z-50')
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
