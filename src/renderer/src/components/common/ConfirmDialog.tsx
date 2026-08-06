import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { useStore } from '../../store/useStore'

/**
 * 되돌릴 수 없는 동작 앞에 세우는 확인 창.
 * 휴지통 비우기·영구삭제는 Undo 스택에도 남지 않아, 오클릭이 곧 데이터 소실이었다.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel
}: {
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const isDark = useStore((s) => s.theme) === 'dark'
  const cancelRef = useRef<HTMLButtonElement>(null)

  // 파괴적 동작이므로 취소에 포커스를 둔다 — Enter를 눌러도 삭제되지 않게.
  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  // 확인 창이 떠 있는 동안 키 입력을 전부 삼킨다. Esc만 막았을 때는 Backspace가
  // 뒤에 선택돼 있던 할일을 삭제하고, 1-4가 우선순위를 바꾸고, Cmd+Z가 되돌리기를
  // 실행했다 — 파괴적 확인 창 앞에서 특히 나쁘다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center">
      {/* 배경: 클릭으로 취소. 키보드는 위 capture 리스너의 Esc가 담당한다. */}
      <button
        type="button"
        aria-label={t('common.cancel')}
        className="absolute inset-0 bg-black/50"
        onClick={onCancel}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className={`relative w-[380px] rounded-xl shadow-2xl p-5 ${isDark ? 'bg-[#2C2C2E] text-gray-100' : 'bg-white text-gray-800'}`}
      >
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="mt-0.5 shrink-0 text-red-500" />
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{title}</h2>
            <p className={`mt-1 text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>{body}</p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            ref={cancelRef}
            onClick={onCancel}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
              isDark ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
            }`}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-3 py-1.5 rounded-lg text-sm bg-red-600 text-white hover:bg-red-700 transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
