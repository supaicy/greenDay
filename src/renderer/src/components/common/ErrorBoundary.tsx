import { Component, type ErrorInfo, type ReactNode } from 'react'
import i18n from '../../i18n'

/**
 * 렌더 예외를 여기서 잡는다. **없으면 예외 하나가 앱을 통째로 언마운트한다.**
 *
 * 2026-09-25 진단에서 실측한 것:
 *   - 할일 제목에 "constructor"를 치면 자연어 날짜 파싱이 던졌고(`naturalDate.ts`),
 *     타이핑 도중 창이 완전히 비었다(root 자식 0개).
 *   - `tags`가 배열로 파싱되지 않는 행이 하나라도 디스크에 있으면 `.tags.map`이
 *     던져 같은 결과가 됐다. **이쪽은 데이터가 디스크에 있으므로 재시작해도
 *     같은 자리에서 다시 죽는다** — 앱 안에서 복구할 방법이 아예 없었다.
 *
 * 그 두 원인은 각각 따로 고쳤지만, 고쳐야 할 진짜 문제는 "어떤 렌더 예외든
 * 결과가 영구 백지"라는 쪽이다. 이 저장소는 쓰기 경로의 내구성에 많은 공을
 * 들여 놨는데(백업 회전, 손상본 격리, 읽기 전용 강등), 그렇게 지킨 데이터를
 * 화면이 못 그리면 사용자는 어차피 못 꺼낸다. 여기가 그 대칭을 맞추는 자리다.
 *
 * **스토어에 기대지 않는다.** 깨진 것이 스토어일 수 있다. 테마는 localStorage에서
 * 직접 읽고, 내보내기는 `window.api`를 바로 부른다(무료 채널이라 잠긴 상태에서도
 * 열린다 — 데이터를 인질로 잡지 않는다는 규칙과 같은 이유다).
 */

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  info: ErrorInfo | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 메인 프로세스 로그로 남는다 — 사용자가 화면을 캡처해 보내지 않아도 흔적이 남게.
    console.error('[renderer] 렌더 중 예외로 화면을 대체했습니다:', error, info.componentStack)
    this.setState({ info })
    // App의 테마 효과가 돌기 전에 죽었을 수 있으니 여기서 한 번 맞춘다.
    try {
      const theme = localStorage.getItem('ticktick-theme') ?? 'dark'
      document.documentElement.classList.toggle('dark', theme !== 'light')
    } catch {
      /* localStorage가 막혀 있어도 화면은 떠야 한다 */
    }
  }

  private handleExport = (): void => {
    // 실패해도 화면을 또 무너뜨리지 않는다.
    void Promise.resolve(window.api?.exportData?.()).catch((e) =>
      console.error('[renderer] 복구 화면에서 내보내기 실패:', e)
    )
  }

  private handleRetry = (): void => {
    this.setState({ error: null, info: null })
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    const { error, info } = this.state
    if (!error) return this.props.children

    // i18n이 아직 안 붙었을 가능성까지 본다 — 이 화면만은 무조건 읽혀야 한다.
    const t = (key: string, fallback: string): string => {
      try {
        const value = i18n.t(key)
        return value === key ? fallback : value
      } catch {
        return fallback
      }
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-8 dark:bg-[#1C1C1E]">
        <div className="w-full max-w-xl">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            {t('crash.title', '화면을 그리다 문제가 생겼습니다')}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
            {t('crash.body', '앱이 멈춘 것은 아니고, 이 화면을 그리는 중에 오류가 났습니다. 할 일 데이터는 그대로 디스크에 있습니다.')}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
            {t('crash.exportHint', '먼저 데이터를 내보내 두시면 안전합니다. 잠긴 화면에서도 내보내기는 항상 됩니다.')}
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={this.handleExport}
              className="rounded-md bg-primary-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600"
            >
              {t('crash.export', '데이터 내보내기')}
            </button>
            <button
              type="button"
              onClick={this.handleRetry}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              {t('crash.retry', '다시 시도')}
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              {t('crash.reload', '앱 새로고침')}
            </button>
          </div>

          <details className="mt-6">
            <summary className="cursor-pointer text-xs text-gray-500 dark:text-gray-500">
              {t('crash.details', '오류 자세히 보기')}
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-gray-100 p-3 text-[11px] leading-relaxed text-gray-700 dark:bg-gray-900 dark:text-gray-300">
              {String(error.stack || error.message)}
              {info?.componentStack ?? ''}
            </pre>
          </details>
        </div>
      </div>
    )
  }
}
