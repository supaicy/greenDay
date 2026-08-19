import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, ExternalLink, Loader2, Unlink, WifiOff } from 'lucide-react'
import { useActivation } from '../../licensing/useActivation'
import { daysLeft, refreshLicense, useLicense } from '../../licensing/useLicense'
import type { DeactivateFailure } from '../../../../shared/license'

interface Props {
  isDark: boolean
  focusRing: string
  fieldSurface: string
  labelText: string
  hintText: string
  successText: string
  errorText: string
}

/**
 * 설정의 라이선스 칸.
 *
 * **기기 해제 버튼이 이 화면의 존재 이유 절반이다.** 기기 한도에 걸린 사람에게
 * 안내만 하고 푸는 방법을 주지 않으면, 두 번째 기기를 사는 순간 그 한도가 벽이
 * 되고 지원 메일함이 그 벽의 유일한 출구가 된다.
 *
 * 스토어 빌드에서는 아예 그려지지 않는다 — Apple 가이드라인 3.1.1은 앱 안에서
 * 외부 결제로 유도하는 것을 금지하고, 키 입력 칸이 그 유도로 읽힌다.
 * 판정은 `shared/capabilities.ts`의 `needsLicenseKey`가 한다.
 */
export function LicenseSection({
  isDark,
  focusRing,
  fieldSurface,
  labelText,
  hintText,
  successText,
  errorText
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const license = useLicense()
  // 활성화 흐름은 잠금 화면과 공유한다 — 두 화면이 같은 키에 대해 다르게
  // 실패하면 안 된다(licensing/useActivation.ts).
  const activation = useActivation()
  const [releasing, setReleasing] = useState(false)
  const [releaseError, setReleaseError] = useState<DeactivateFailure | null>(null)
  const [done, setDone] = useState<'activated' | 'deactivated' | null>(null)

  const busy = activation.busy || releasing
  const error = activation.error ?? releaseError

  /** 새 시도를 시작하기 전에 지난 결과를 치운다. */
  function resetOutcome(): void {
    setReleaseError(null)
    setDone(null)
  }

  async function activate(): Promise<void> {
    resetOutcome()
    if (await activation.activate()) setDone('activated')
  }

  async function deactivate(): Promise<void> {
    setReleasing(true)
    resetOutcome()
    const failure = await window.api.licenseDeactivate()
    setReleasing(false)
    if (failure) return setReleaseError(failure)
    setDone('deactivated')
    await refreshLicense()
  }

  const button = `px-3 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-50 ${focusRing}`
  const neutralButton = `${button} ${isDark ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`

  return (
    <div className="space-y-3">
      <p className={`text-sm ${labelText}`}>
        <StatusLine license={license} hintText={hintText} successText={successText} />
      </p>

      {license.maskedKey && (
        <p className={`text-xs ${hintText}`}>
          {t('license.registeredKey')}: <code>{license.maskedKey}</code>
        </p>
      )}

      {license.status !== 'licensed' && (
        <div className="space-y-1.5">
          <label htmlFor="license-key" className={`block text-xs ${labelText}`}>
            {t('license.keyLabel')}
          </label>
          <div className="flex gap-2">
            <input
              id="license-key"
              value={activation.key}
              onChange={(e) => activation.setKey(e.target.value)}
              placeholder={t('license.keyPlaceholder')}
              spellCheck={false}
              autoCapitalize="characters"
              className={`flex-1 px-3 py-1.5 rounded-lg text-sm font-mono ${fieldSurface}`}
            />
            <button
              type="button"
              onClick={() => void activate()}
              disabled={busy || !activation.canSubmit}
              className={`${button} ${isDark ? 'bg-primary-600 hover:bg-primary-500 text-white' : 'bg-primary-500 hover:bg-primary-600 text-white'}`}
            >
              {activation.busy ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 size={13} className="animate-spin" /> {t('license.activating')}
                </span>
              ) : (
                t('license.activate')
              )}
            </button>
          </div>
        </div>
      )}

      {license.status !== 'licensed' && license.deviceName && (
        // 서버로 가는 값을 보내기 전에 같은 화면에 적어 둔다. 기기 목록에서 골라
        // 해제하려면 이 이름이 필요하지만, 뭐가 나가는지 숨기지는 않는다.
        <p className={`text-xs ${hintText}`}>
          {t('license.deviceNameNotice')}: <code>{license.deviceName}</code>
        </p>
      )}

      {error && <p className={`text-xs ${errorText}`}>{t(`license.error.${error}`)}</p>}
      {done && (
        <p className={`flex items-center gap-1.5 text-xs ${successText}`}>
          <CheckCircle2 size={13} /> {t(`license.${done}`)}
        </p>
      )}

      {license.maskedKey && (
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => void deactivate()}
            disabled={busy}
            className={`${neutralButton} flex items-center gap-1.5`}
          >
            {releasing ? <Loader2 size={13} className="animate-spin" /> : <Unlink size={13} />}
            {t(releasing ? 'license.deactivating' : 'license.deactivate')}
          </button>
          <p className={`text-xs ${hintText}`}>{t('license.deactivateDesc')}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1">
        <button
          type="button"
          onClick={() => void window.api.licenseOpenPurchase('settings')}
          className={`flex items-center gap-1 text-xs underline ${labelText} ${focusRing} rounded`}
        >
          {t('license.buy')} <ExternalLink size={11} />
        </button>
        <button
          type="button"
          onClick={() => void window.api.licenseOpenRecover()}
          className={`flex items-center gap-1 text-xs underline ${hintText} ${focusRing} rounded`}
        >
          {t('license.lost')} <ExternalLink size={11} />
        </button>
      </div>
      <p className={`text-xs ${hintText}`}>{t('license.buyDesc')}</p>
    </div>
  )
}

/**
 * 지금이 어떤 상태인지 한 줄로.
 *
 * enforcement 전에는 트라이얼 얘기를 아예 꺼내지 않는다 — 아직 아무것도 타들어가지
 * 않는데 "n일 남음"이라고 쓰면 없는 마감을 만들어낸다.
 */
function StatusLine({
  license,
  hintText,
  successText
}: {
  license: ReturnType<typeof useLicense>
  hintText: string
  successText: string
}): React.JSX.Element {
  const { t } = useTranslation()

  if (license.status === 'licensed') {
    return (
      <span className={`flex items-center gap-1.5 ${successText}`}>
        <CheckCircle2 size={14} /> {t('license.licensed')}
      </span>
    )
  }
  if (!license.enforced) {
    return (
      <span>
        {t('license.free')}
        <span className={`block text-xs mt-0.5 ${hintText}`}>
          {t('license.freeDesc')}
        </span>
      </span>
    )
  }
  if (license.status === 'grace') {
    return (
      <span className="flex items-center gap-1.5">
        <WifiOff size={14} /> {t('license.grace', { days: daysLeft(license.untilMs) })}
      </span>
    )
  }
  if (license.status === 'trial') {
    const days = daysLeft(license.untilMs)
    return <span>{days === 0 ? t('license.trialLastDay') : t('license.trial', { days })}</span>
  }
  return <span>{t('license.trialExpired')}</span>
}
