import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import type { ArrivalStatus, MigrationStatus } from '../../../../shared/migration'

/**
 * 새 앱(com.begreen.greenday) 첫 실행 뒤의 상태 배너 — 셋 중 해당하는 것만 그린다.
 *   1. 보호 모드: Keychain 거부로 비밀값을 못 읽었다. 암호문은 그대로 있다.
 *   2. Google 재연결
 *   3. 옛 앱 지워도 됨 (정상 확인 뒤에만)
 */
export function MigrationBanner() {
  const { t } = useTranslation()
  const theme = useStore((s) => s.theme)
  const toggleSettings = useStore((s) => s.toggleSettings)
  const isDark = theme === 'dark'
  const [status, setStatus] = useState<ArrivalStatus | null>(null)
  const [googleDismissed, setGoogleDismissed] = useState(false)

  useEffect(() => {
    let alive = true
    window.api.migrationStatus?.().then((s: MigrationStatus) => {
      if (alive && s.mode === 'arrival') setStatus(s)
    })
    return () => {
      alive = false
    }
  }, [])

  if (!status) return null
  const showLocked = status.secretsLocked
  const showGoogle = status.googleReconnect && !googleDismissed
  const showOldApp = status.oldAppRemovable && !status.oldAppHintDismissed
  if (!showLocked && !showGoogle && !showOldApp) return null

  const surface = isDark ? 'bg-[#2C2C2E] border-white/10 text-gray-100' : 'bg-white border-gray-200 text-gray-800'
  const dim = isDark ? 'text-gray-300' : 'text-gray-600'
  const ghost = isDark ? 'text-gray-300 hover:bg-white/10' : 'text-gray-600 hover:bg-gray-100'

  const apply = (p: Promise<MigrationStatus> | undefined): void => {
    p?.then((s) => {
      if (s.mode === 'arrival') setStatus(s)
    })
  }

  return (
    <div className="fixed bottom-4 right-4 z-[110] w-[26rem] max-w-[calc(100vw-2rem)] space-y-2" role="status">
      {showLocked && (
        <section className={`rounded-xl border p-4 shadow-lg ${surface}`}>
          <h3 className="text-sm font-semibold mb-1">{t('migration.arrival.lockedTitle')}</h3>
          <p className={`text-xs leading-relaxed ${dim}`}>
            {status.lockReason === 'missing' ? t('migration.arrival.lockedMissing') : t('migration.arrival.lockedBody')}
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => toggleSettings()} className={`px-3 py-1.5 rounded-lg text-xs ${ghost}`}>
              {t('migration.arrival.openSettings')}
            </button>
            <button
              type="button"
              onClick={() => apply(window.api.migrationReleaseLock?.())}
              className={`px-3 py-1.5 rounded-lg text-xs ${ghost}`}
            >
              {t('migration.arrival.releaseLock')}
            </button>
          </div>
        </section>
      )}
      {showGoogle && (
        <section className={`rounded-xl border p-4 shadow-lg ${surface}`}>
          <h3 className="text-sm font-semibold mb-1">{t('migration.arrival.googleTitle')}</h3>
          <p className={`text-xs leading-relaxed ${dim}`}>{t('migration.arrival.googleBody')}</p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => setGoogleDismissed(true)} className={`px-3 py-1.5 rounded-lg text-xs ${ghost}`}>
              {t('migration.arrival.dismiss')}
            </button>
            <button
              type="button"
              onClick={() => {
                setGoogleDismissed(true)
                toggleSettings()
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-primary hover:opacity-90"
            >
              {t('migration.arrival.openSettings')}
            </button>
          </div>
        </section>
      )}
      {showOldApp && (
        <section className={`rounded-xl border p-4 shadow-lg ${surface}`}>
          <h3 className="text-sm font-semibold mb-1">{t('migration.arrival.oldAppTitle')}</h3>
          <p className={`text-xs leading-relaxed ${dim}`}>{t('migration.arrival.oldAppBody')}</p>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => apply(window.api.migrationDismissOldApp?.())}
              className={`px-3 py-1.5 rounded-lg text-xs ${ghost}`}
            >
              {t('migration.arrival.dismiss')}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
