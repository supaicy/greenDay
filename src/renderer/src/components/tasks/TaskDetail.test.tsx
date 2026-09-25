// @vitest-environment jsdom

/**
 * 상세 패널이 **스토어를 그대로 읽는지** 보는 테스트.
 *
 * Regression: 패널이 dueDate/dueTime/priority/listId를 로컬 state로 복사해 두고
 * `task.id`가 바뀔 때만 다시 채웠다. 같은 할일을 바깥에서 고치는 문(Cmd+D,
 * 캘린더 드래그, 1-4, 우클릭 '이동')이 여럿이라, 패널은 옛 값을 든 채 남았고
 * 다음 편집이 그 옛 값을 새 값 위에 덮어썼다 — 마감일 팝오버에서 '시각'만
 * 채워도 방금 정한 마감일이 말없이 사라졌다.
 *
 * TaskDetail만 따로 파일을 두는 이유: 메모 편집기 패키지를 모듈 단위로 목킹해야
 * 하는데, overlays.test.tsx는 그 목킹 없이 도는 파일이라 섞으면 서로를 끌고 간다.
 * vitest.config.ts의 TZ_SENSITIVE에는 넣지 않는다 — 쓰는 날짜와 기대하는 날짜가
 * 같은 `todayString()`이라 시간대에 무관하다.
 */

import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// 메모 편집기는 이 테스트의 관심사가 아니고, 패키지의 dist가 확장자 없는 내부
// import를 써서 vitest의 노드 해석기에서 그대로는 로드되지 않는다.
vi.mock('@atomic-editor/editor', () => ({ AtomicCodeMirrorEditor: () => null }))

import i18n from '../../i18n'
import { useStore } from '../../store/useStore'
import { todayString } from '../../utils/date'
import { PRIORITY_COLOR } from '../../utils/priority'
import { TaskDetail } from './TaskDetail'

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

/** 패널이 열린 시점의 마감일. 바깥 변경이 이걸 밀어낸 뒤에도 살아남는지 본다. */
const OLD_DUE = '2026-10-01'

// setState로 심은 값은 모듈 싱글턴에 남아 뒤 테스트로 샌다 — 스냅샷을 떠 두고 되돌린다.
const STORE_KEYS = ['tasks', 'lists', 'selectedTaskId'] as const
let storeSnapshot: Record<string, unknown>

beforeEach(() => {
  // window.api가 없으면 스토어 쓰기가 unhandled rejection으로 죽어, 가드가
  // 회귀했을 때 깔끔한 실패 대신 에러로 터진다.
  ;(window as unknown as Record<string, unknown>).api = {
    updateTask: vi.fn().mockResolvedValue(undefined),
    createTask: vi.fn().mockResolvedValue(undefined),
    deleteTask: vi.fn().mockResolvedValue(undefined),
    batchUpdateTasks: vi.fn().mockResolvedValue(undefined),
    addScoreEvent: vi.fn().mockResolvedValue(undefined),
    addScoreEvents: vi.fn().mockResolvedValue(undefined),
    reorderTasks: vi.fn().mockResolvedValue(undefined),
    openExternal: vi.fn()
  }
  const s = useStore.getState() as unknown as Record<string, unknown>
  storeSnapshot = Object.fromEntries(STORE_KEYS.map((k) => [k, s[k]]))
  useStore.setState({
    lists: [
      { id: 'inbox', name: '기본함', color: '#000', icon: 'inbox', folderId: null, sortOrder: 0, createdAt: '2026-09-01T00:00:00.000Z' },
      { id: 'work', name: '업무', color: '#111', icon: 'inbox', folderId: null, sortOrder: 1, createdAt: '2026-09-01T00:00:00.000Z' }
    ],
    tasks: [
      {
        id: 'task-1',
        title: '보고서',
        description: '',
        completed: false,
        priority: 'none',
        dueDate: OLD_DUE,
        dueTime: null,
        startDate: null,
        reminderAt: null,
        pinned: false,
        listId: 'inbox',
        parentId: null,
        tags: [],
        createdAt: '2026-09-01T00:00:00.000Z',
        completedAt: null,
        deletedAt: null,
        sortOrder: 0,
        isRecurring: false,
        recurringPattern: null,
        attachments: [],
        scheduledStart: null,
        scheduledEnd: null
      }
    ],
    selectedTaskId: 'task-1'
  } as never)
})

afterEach(() => {
  cleanup()
  useStore.setState(storeSnapshot as never)
})

/** 마감일 팝오버 트리거 — 상단바에 있어 이 패널에서 첫 aria-haspopup="dialog" 버튼이다. */
function dueTrigger(): HTMLElement {
  const el = document.querySelector('button[aria-haspopup="dialog"]')
  if (!el) throw new Error('마감일 팝오버 트리거를 찾지 못했다')
  return el as HTMLElement
}

/** Cmd+D가 부르는 바로 그 액션. 캘린더 드래그·AI 재예약도 같은 문으로 들어온다. */
async function updateFromOutside(patch: Record<string, unknown>): Promise<void> {
  await act(async () => {
    await useStore.getState().updateTask({ id: 'task-1', ...patch } as never)
  })
}

describe('TaskDetail — 바깥에서 바뀐 값', () => {
  it('마감일이 바깥에서 바뀐 뒤 시각만 고쳐도 새 마감일이 남는다', async () => {
    const user = userEvent.setup()
    render(<TaskDetail />)
    const today = todayString()
    await updateFromOutside({ dueDate: today })

    await user.click(dueTrigger())
    fireEvent.change(await screen.findByLabelText('마감 시각'), { target: { value: '18:00' } })

    const saved = useStore.getState().tasks.find((t) => t.id === 'task-1')
    expect(saved?.dueTime).toBe('18:00')
    // 시각만 건드렸는데 마감일이 옛 값으로 되돌아가면, 사용자가 방금 정한
    // 마감일이 경고 한 줄 없이 사라진 것이다.
    expect(saved?.dueDate).toBe(today)
  })

  it('마감일이 바깥에서 바뀌면 팝오버도 새 날짜를 보여준다', async () => {
    const user = userEvent.setup()
    render(<TaskDetail />)
    const today = todayString()
    await updateFromOutside({ dueDate: today })

    await user.click(dueTrigger())
    expect((await screen.findByLabelText('마감일')) as HTMLInputElement).toHaveValue(today)
  })

  it('목록을 바깥에서 옮기면 하단바가 새 목록을 말한다', async () => {
    render(<TaskDetail />)
    await updateFromOutside({ listId: 'work' })
    expect(screen.getByText('업무')).toBeInTheDocument()
  })

  it('우선순위가 바깥에서 바뀌면 깃발 색도 따라간다', async () => {
    render(<TaskDetail />)
    await updateFromOutside({ priority: 'high' })
    expect(screen.getByRole('button', { name: '우선순위' }).className).toContain(PRIORITY_COLOR.high)
  })
})
