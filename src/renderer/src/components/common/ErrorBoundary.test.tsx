// @vitest-environment jsdom

/**
 * Regression: 진단 2.3 — 렌더 예외 하나가 앱을 통째로 언마운트했다.
 * Found by /qa on 2026-09-25
 * Report: docs/reports/2026-09-25-전체-진단.html
 *
 * 실측: 할일 제목에 "constructor"를 치는 것만으로 root의 자식이 0개가 됐고,
 * 원인이 디스크의 데이터일 때(어긋난 tags 행)는 재시작해도 같은 자리에서
 * 다시 죽어 앱 안에서 복구할 방법이 없었다.
 *
 * 개별 원인은 각각 고쳤지만, 여기서 못박는 것은 그 위의 성질이다 —
 * **무엇이 던지든 사용자는 화면과 자기 데이터를 되찾을 수 있어야 한다.**
 */

import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { ErrorBoundary } from './ErrorBoundary'

function Boom({ when = true }: { when?: boolean }): React.JSX.Element {
  if (when) throw new Error('터졌다: a.tags.map is not a function')
  return <div>정상 화면</div>
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  await i18n.changeLanguage('ko')
  // React는 경계가 잡은 예외도 콘솔에 한 번 더 찍는다 — 테스트 출력만 조용히 한다.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  ;(window as unknown as Record<string, unknown>).api = { exportData: vi.fn() }
})

afterEach(() => {
  cleanup()
  consoleError.mockRestore()
})

describe('ErrorBoundary', () => {
  it('아이가 던져도 앱이 백지가 되지 않는다', () => {
    const { container } = render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    )

    // 경계가 없던 동안의 증상이 정확히 이것이었다: container가 통째로 빈다.
    expect(container).not.toBeEmptyDOMElement()
    expect(screen.getByText('화면을 그리다 문제가 생겼습니다')).toBeInTheDocument()
  })

  it('데이터를 꺼낼 길을 준다 — 내보내기는 잠긴 화면에서도 되는 무료 채널이다', async () => {
    const user = userEvent.setup()
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    )

    await user.click(screen.getByRole('button', { name: '데이터 내보내기' }))

    expect(window.api.exportData).toHaveBeenCalledTimes(1)
  })

  it('오류 내용을 숨기지 않는다 — 사용자가 그대로 옮겨 적을 수 있어야 한다', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    )

    expect(screen.getByText(/a\.tags\.map is not a function/)).toBeInTheDocument()
  })

  it('"다시 시도"가 경계를 초기화한다 — 일시적인 오류면 그대로 돌아온다', async () => {
    const user = userEvent.setup()

    // 렌더 횟수로 세지 않는다 — React는 포기하기 전에 루트를 동기로 한 번 더
    // 그려 보므로, "첫 렌더만 던진다"는 컴포넌트는 그 재시도에서 이미 정상이 된다.
    // 바깥 플래그를 우리가 직접 뒤집어 "고쳐진 뒤 다시 시도"를 결정적으로 만든다.
    let shouldThrow = true
    function Flaky(): React.JSX.Element {
      return <Boom when={shouldThrow} />
    }

    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>
    )
    expect(screen.getByText('화면을 그리다 문제가 생겼습니다')).toBeInTheDocument()

    // 원인이 사라진 뒤 다시 시도한다.
    shouldThrow = false
    await user.click(screen.getByRole('button', { name: '다시 시도' }))

    expect(screen.getByText('정상 화면')).toBeInTheDocument()
  })

  it('아무도 던지지 않으면 아이를 그대로 그린다', () => {
    render(
      <ErrorBoundary>
        <div>평범한 화면</div>
      </ErrorBoundary>
    )

    expect(screen.getByText('평범한 화면')).toBeInTheDocument()
  })

  it('영어에서는 영어로 나온다', async () => {
    await i18n.changeLanguage('en')
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    )

    expect(screen.getByText('Something broke while drawing this screen')).toBeInTheDocument()
    await i18n.changeLanguage('ko')
  })
})
