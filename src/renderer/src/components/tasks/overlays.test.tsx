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
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import i18n from '../../i18n'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { useStore } from '../../store/useStore'
import { RecurringPicker } from './RecurringPicker'
import { ReminderPicker } from './ReminderPicker'
import { SortMenu } from './SortMenu'

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
