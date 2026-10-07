// @vitest-environment jsdom

/**
 * Escape의 계약: **Escape를 자기 몫으로 쓴 입력칸은 `preventDefault()`로 알린다.**
 * 알리지 않은 입력칸(상세 패널의 제목·CodeMirror 노트·검색창)에서 누른 Escape는
 * 예전처럼 선택을 해제해 상세 패널을 닫는다.
 *
 * 한때 Escape 분기가 입력칸 전부(INPUT/TEXTAREA/contentEditable)에 양보했다.
 * 추가칸·하위작업칸이 패널을 함께 닫는 버그는 막았지만, 자기 Escape가 없는 제목·노트
 * 편집 중에는 Escape가 아무것도 안 하게 됐다 — 아래 첫 묶음이 그 회귀를 잡는다.
 *
 * fireEvent로 **입력칸에서** 올려 보낸다: 판정 기준은 포커스가 아니라 이벤트 target과
 * defaultPrevented다. React 17+는 루트에서 위임받아 처리하므로, onKeyDown 안의
 * preventDefault는 버블 단계 window 리스너(훅)보다 먼저 네이티브 이벤트에 찍힌다.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { useStore } from '../store/useStore'
import { HabitTracker } from '../components/habits/HabitTracker'
import { Sidebar } from '../components/sidebar/Sidebar'
import { SubtaskList } from '../components/tasks/SubtaskList'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'

const STORE_KEYS = [
  'selectedTaskId',
  'showQuickAdd',
  'showAddTask',
  'tasks',
  'habits',
  'habitLogs',
  'addHabit'
] as const
let storeSnapshot: Record<string, unknown>

beforeAll(async () => {
  await i18n.changeLanguage('ko')
})

beforeEach(() => {
  ;(window as unknown as Record<string, unknown>).api = {
    createTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn()
  }
  const s = useStore.getState() as unknown as Record<string, unknown>
  storeSnapshot = Object.fromEntries(STORE_KEYS.map((k) => [k, s[k]]))
  useStore.setState({ selectedTaskId: 'task-1', showAddTask: false, showQuickAdd: false })
})

afterEach(() => {
  cleanup()
  useStore.setState(storeSnapshot as never)
})

function ShortcutHarness(): null {
  useKeyboardShortcuts()
  return null
}

describe('자기 Escape가 없는 입력칸 — 상세 패널을 닫는다', () => {
  it('제목 입력칸(TaskDetail 제목처럼 onKeyDown이 Escape를 안 씀)', () => {
    const { container } = render(
      <>
        <ShortcutHarness />
        <input type="text" defaultValue="장보기" />
      </>
    )
    const input = container.querySelector('input') as HTMLInputElement

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(useStore.getState().selectedTaskId).toBe(null)
  })

  it('노트 에디터(CodeMirror처럼 contentEditable)', () => {
    const { container } = render(
      <>
        <ShortcutHarness />
        {/* biome-ignore lint/a11y/useSemanticElements: CodeMirror의 DOM 모양을 흉내 낸다 */}
        <div contentEditable suppressContentEditableWarning role="textbox" tabIndex={0}>
          메모
        </div>
      </>
    )
    const editor = container.querySelector('[contenteditable]') as HTMLElement
    // jsdom은 isContentEditable을 구현하지 않는다 — 브라우저가 주는 값을 얹는다.
    Object.defineProperty(editor, 'isContentEditable', { value: true })

    fireEvent.keyDown(editor, { key: 'Escape' })

    expect(useStore.getState().selectedTaskId).toBe(null)
  })

  it('하위작업 입력칸이 비어 있으면 지울 글자가 없으니 패널을 닫는다', () => {
    // 하위작업 입력칸은 상세 패널에 늘 열려 있다. 빈 칸에서도 Escape를 가져가면
    // 그 칸에 포커스가 있는 한 Escape로 패널을 닫을 길이 없다.
    useStore.setState({ tasks: [] as never })
    const { container } = render(
      <>
        <ShortcutHarness />
        <SubtaskList taskId="task-1" />
      </>
    )
    const input = container.querySelector('input[type="text"]') as HTMLInputElement

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(useStore.getState().selectedTaskId).toBe(null)
  })
})

/**
 * 한글 IME: 조합 중 Escape는 IME가 조합을 끝내는 데 쓴다. 이때 keydown은
 * `isComposing: true`(WebKit/Chromium은 keyCode 229도 함께)로 온다. 제목칸처럼 자기
 * Escape가 없는 칸에서 이걸 패널 닫기로 받으면 음절 하나를 치다 패널이 사라진다.
 */
describe('IME 조합 중 Escape — 아무것도 닫지 않는다', () => {
  it('isComposing인 Escape는 선택을 해제하지 않는다', () => {
    const { container } = render(
      <>
        <ShortcutHarness />
        <input type="text" defaultValue="장보" />
      </>
    )
    const input = container.querySelector('input') as HTMLInputElement

    fireEvent.keyDown(input, { key: 'Escape', isComposing: true })

    expect(useStore.getState().selectedTaskId).toBe('task-1')
  })

  it('keyCode 229(조합 중 표지)인 Escape도 같다', () => {
    const { container } = render(
      <>
        <ShortcutHarness />
        <input type="text" defaultValue="장보" />
      </>
    )
    const input = container.querySelector('input') as HTMLInputElement

    fireEvent.keyDown(input, { key: 'Escape', keyCode: 229 })

    expect(useStore.getState().selectedTaskId).toBe('task-1')
  })

  it('습관 이름칸: 조합 중 Enter는 반쯤 조합된 이름을 추가하지 않는다', () => {
    const addHabit = vi.fn()
    useStore.setState({ habits: [] as never, habitLogs: [] as never, addHabit: addHabit as never })
    const { container } = render(<HabitTracker />)
    fireEvent.click(screen.getAllByRole('button', { name: new RegExp(i18n.t('habits.add')) })[0])
    const input = container.querySelector('input[type="text"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '운도' } })

    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })

    expect(addHabit).not.toHaveBeenCalled()
  })

  it('습관 이름칸: 조합 중 Escape는 폼을 닫지 않는다', () => {
    useStore.setState({ habits: [] as never, habitLogs: [] as never })
    const { container } = render(
      <>
        <ShortcutHarness />
        <HabitTracker />
      </>
    )
    fireEvent.click(screen.getAllByRole('button', { name: new RegExp(i18n.t('habits.add')) })[0])
    const input = container.querySelector('input[type="text"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '운도' } })

    fireEvent.keyDown(input, { key: 'Escape', isComposing: true })

    expect(container.querySelector('input[type="text"]')).not.toBeNull()
    expect(useStore.getState().selectedTaskId).toBe('task-1')
  })
})

describe('Escape를 자기 몫으로 쓰는 입력칸 — 상세 패널을 살려 둔다', () => {
  it('onKeyDown에서 preventDefault를 건 입력칸(계약 자체)', () => {
    const { container } = render(
      <>
        <ShortcutHarness />
        <input
          type="text"
          onKeyDown={(e) => {
            if (e.key === 'Escape') e.preventDefault()
          }}
        />
      </>
    )
    const input = container.querySelector('input') as HTMLInputElement

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(useStore.getState().selectedTaskId).toBe('task-1')
  })

  it('하위작업 입력칸(SubtaskList)은 글자만 지운다', () => {
    useStore.setState({ tasks: [] as never })
    const { container } = render(
      <>
        <ShortcutHarness />
        <SubtaskList taskId="task-1" />
      </>
    )
    const input = container.querySelector('input[type="text"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '초안 쓰기' } })

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(input.value).toBe('')
    expect(useStore.getState().selectedTaskId).toBe('task-1')
  })

  it('습관 추가칸(HabitTracker)은 폼만 닫는다', () => {
    useStore.setState({ habits: [] as never, habitLogs: [] as never })
    const { container } = render(
      <>
        <ShortcutHarness />
        <HabitTracker />
      </>
    )
    fireEvent.click(screen.getAllByRole('button', { name: new RegExp(i18n.t('habits.add')) })[0])
    const input = container.querySelector('input[type="text"]') as HTMLInputElement
    expect(input).not.toBeNull()

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(container.querySelector('input[type="text"]')).toBeNull()
    expect(useStore.getState().selectedTaskId).toBe('task-1')
  })

  it('새 폴더 이름칸(Sidebar)은 폼만 닫는다', () => {
    const { container } = render(
      <>
        <ShortcutHarness />
        <Sidebar />
      </>
    )
    fireEvent.click(screen.getByTitle(i18n.t('nav.addFolder')))
    const input = screen.getByPlaceholderText(i18n.t('nav.folderNamePlaceholder')) as HTMLInputElement

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(container.querySelector(`input[placeholder="${i18n.t('nav.folderNamePlaceholder')}"]`)).toBeNull()
    expect(useStore.getState().selectedTaskId).toBe('task-1')
  })
})
