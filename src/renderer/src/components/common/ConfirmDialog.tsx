import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

/**
 * 되돌릴 수 없는 동작 앞에 세우는 확인 창.
 * 휴지통 비우기·영구삭제는 Undo 스택에도 남지 않아, 오클릭이 곧 데이터 소실이었다.
 * 창이 떠 있는 동안 앱 단축키(Backspace 삭제, 1-4 우선순위, Cmd+Z)가 스크림 뒤로
 * 새는 것은 useKeyboardShortcuts의 열린-모달 가드가 모든 모달에 대해 막는다 —
 * 예전에는 이 컴포넌트만 자기 캡처 리스너로 막아, 나머지 모달은 뚫려 있었다.
 * 호출처가 페이로드와 함께 mount하는 명령형 API — 배경·포커스 트랩·복원은 Radix가 맡는다.
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

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        role="alertdialog"
        showCloseButton={false}
        className="w-[380px] rounded-xl p-5 gap-0"
        // 파괴적 동작이므로 취소에 포커스를 둔다 — Enter를 눌러도 삭제되지 않게.
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          cancelRef.current?.focus()
        }}
      >
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="mt-0.5 shrink-0 text-red-500" />
          <div className="min-w-0">
            <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
            <DialogDescription className={`mt-1 text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
              {body}
            </DialogDescription>
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
      </DialogContent>
    </Dialog>
  )
}
