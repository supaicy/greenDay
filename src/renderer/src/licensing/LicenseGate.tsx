import { useTranslation } from 'react-i18next'
import { ExternalLink, Loader2, Lock } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useStore } from '../store/useStore'
import { useActivation } from './useActivation'
import { useLicense } from './useLicense'

/**
 * 유료 기능 게이트 — 앱 전체에서 **단 한 곳**이다.
 *
 * 무료 티어 없이 "체험 후 전면 잠금"으로 정해졌으므로 잠글 지점도 하나다. 기능마다
 * 게이트를 심으면 지점이 일곱 곳이 되고, 앞으로 만드는 기능마다 "이건 어느
 * 쪽인가"를 정해야 한다.
 *
 * **데이터를 인질로 잡지 않는다.** 잠긴 화면에서도 내보내기가 바로 눌린다.
 * 자기 할일을 꺼낼 수 없게 만드는 것은 환불이 아니라 신고를 부르는 종류의 실패다.
 *
 * `enforced`가 false인 동안 이 컴포넌트는 아무것도 그리지 않는다. 출하 시점이
 * 그 상태다 — 배관은 잠들어 있고, 유료 전환은 플래그 하나로 깨어난다.
 *
 * 손수 만든 `<div>` 오버레이가 아니라 Radix Dialog인 이유는 CLAUDE.md의 오버레이
 * 규칙이기도 하지만, 여기서는 특히 **키보드가 뒤로 새지 않게** 하기 위해서다.
 * Tab은 다이얼로그 안에 갇히고 Escape는 Radix가 캡처 단계에서 소비한다 —
 * 손수 만든 div였다면 잠금 화면 위에서 누른 Escape가 뒤에 있는 목록의 선택을
 * 지우고, Tab으로 보이지 않는 할일을 편집할 수 있다.
 *
 * 닫히지 않는 것은 `open`이 고정이고 `onOpenChange`가 없기 때문이다 — Radix의
 * 해제 경로는 전부 그 콜백으로 흐른다. onEscapeKeyDown·onInteractOutside에
 * preventDefault를 거는 것은 여기서 아무 일도 하지 않는다(실제로 걸어 뒀다가
 * 뮤테이션으로 죽은 코드임을 확인하고 지웠다).
 */
export function LicenseGate(): React.JSX.Element | null {
  const { t } = useTranslation()
  const license = useLicense()
  const exportData = useStore((s) => s.exportData)
  const { key, setKey, busy, error, activate, canSubmit } = useActivation()

  if (!license.enforced || license.allowsPaidFeatures) return null

  return (
    <Dialog open>
      <DialogContent showCloseButton={false} className="w-[440px] max-w-[calc(100vw-3rem)] gap-0 rounded-2xl">
        {/* **제목이 이 화면에서 확실히 읽히는 유일한 줄이다.** 기본값은 "체험 기간이
            끝났습니다"인데, 취소된 키로 막힌 사람에게 그건 거짓말이다 — 그 사람은
            돈을 냈고, 여기서 구매를 권하면 같은 것을 두 번 사게 만든다. 서버가
            말해 준 이유가 있으면 그걸 제목으로 올린다(문구는 활성화 실패와 같은 표). */}
        <DialogTitle className="flex items-center gap-2 text-base font-semibold">
          <Lock size={18} />
          {license.blockedReason ? t(`license.error.${license.blockedReason}`) : t('license.lockedTitle')}
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm text-muted-foreground">{t('license.lockedBody')}</DialogDescription>

        <div className="mt-5 flex gap-2">
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t('license.keyPlaceholder')}
            aria-label={t('license.keyLabel')}
            spellCheck={false}
            autoCapitalize="characters"
            className="flex-1 rounded-lg bg-muted px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="button"
            onClick={() => void activate()}
            disabled={!canSubmit}
            className="rounded-lg bg-primary-700 px-3 py-2 text-sm text-white transition-colors hover:bg-primary-600 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            {/* 스피너만 남기면 접근성 이름이 비어 "버튼"으로만 읽히고, 폭이 14px로
                줄면서 옆 입력창이 밀린다. LicenseSection 쪽은 처음부터 문구를 남겼다. */}
            {busy ? (
              <span className="flex items-center gap-1.5">
                <Loader2 size={14} className="animate-spin" /> {t('license.activating')}
              </span>
            ) : (
              t('license.activate')
            )}
          </button>
        </div>
        {/* 라이트 모드의 카드 배경은 흰색이라 `text-red-400`은 2.77:1로 AA에 못 미친다.
            잠긴 사용자가 빠져나오려면 반드시 읽어야 하는 한 줄이다. */}
        {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{t(`license.error.${error}`)}</p>}

        {/* 무엇이 나가는지 **보내기 전에** 적어 둔다. 설정 패널에는 있었는데 이 화면에는
            없었다 — 트라이얼이 끝난 사람이 실제로 키를 넣는 곳은 여기다. */}
        {license.deviceName && (
          <p className="mt-3 text-xs text-muted-foreground">
            {t('license.deviceNameNotice')}: <code className="font-mono">{license.deviceName}</code>
          </p>
        )}

        <button
          type="button"
          onClick={() => void window.api.licenseOpenPurchase('locked')}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary-700 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        >
          {t('license.buy')} <ExternalLink size={13} />
        </button>
        <p className="mt-1.5 text-center text-xs text-muted-foreground">{t('license.buyDesc')}</p>

        <div className="mt-5 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => exportData()}
            className="w-full rounded-lg bg-muted px-4 py-2 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            {t('license.lockedExport')}
          </button>
          <button
            type="button"
            onClick={() => void window.api.licenseOpenRecover()}
            className="mt-2 flex w-full items-center justify-center gap-1 text-xs text-muted-foreground underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-card rounded"
          >
            {t('license.lost')} <ExternalLink size={11} />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
