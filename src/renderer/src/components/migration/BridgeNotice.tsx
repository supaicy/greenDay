import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import type { BridgeStatus, MigrationStatus } from '../../../../shared/migration'

/**
 * 브리지 릴리스(v1.5.0, 옛 번들 ID)의 안내 — "Greenday가 새 앱으로 옮겨갑니다".
 *
 * 문구는 docs/reports/2026-09-07-bridge-copy.md 에서 사용자가 검토한다. 평문 handoff
 * 파일은 만들지 않고, 링크 하나(begreen.dev/greenday)와 "나중에"뿐이다.
 */
export function BridgeNotice() {
  const { t } = useTranslation()
  const theme = useStore((s) => s.theme)
  const isDark = theme === 'dark'
  const [status, setStatus] = useState<BridgeStatus | null>(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let alive = true
    window.api.migrationStatus?.().then((s: MigrationStatus) => {
      if (alive && s.mode === 'bridge') setStatus(s)
    })
    // 설정의 "안내 다시 보기"가 여기로 온다.
    const onReopen = (): void => {
      window.api.migrationReopen?.().then((s: MigrationStatus) => {
        if (s.mode === 'bridge') {
          setStatus(s)
          setHidden(false)
        }
      })
    }
    window.addEventListener('greenday:bridge-reopen', onReopen)
    return () => {
      alive = false
      window.removeEventListener('greenday:bridge-reopen', onReopen)
    }
  }, [])

  if (!status || hidden || !status.noticeDue) return null

  const later = (): void => {
    setHidden(true)
    void window.api.migrationSnooze?.()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bridge-title"
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 px-6"
    >
      <div
        className={`w-full max-w-lg rounded-2xl p-6 shadow-2xl ${isDark ? 'bg-[#2C2C2E] text-gray-100' : 'bg-white text-gray-800'}`}
      >
        <h2 id="bridge-title" className="text-lg font-semibold mb-3">
          {t('migration.bridge.title')}
        </h2>
        <p className={`text-sm leading-relaxed mb-3 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
          {t('migration.bridge.lead')}
        </p>
        <p className="text-sm leading-relaxed mb-3">{t('migration.bridge.keeps')}</p>
        <p className={`text-sm leading-relaxed mb-3 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
          {status.integrity === 'corrupt'
            ? t('migration.bridge.integrityCorrupt')
            : status.backupReady
              ? t('migration.bridge.backupDone')
              : t('migration.bridge.backupPending')}
        </p>
        {status.sentinelReady && (
          <p className={`text-sm leading-relaxed mb-5 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
            {t('migration.bridge.keychain')}
          </p>
        )}
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={later}
            title={t('migration.bridge.laterHint')}
            className={`px-4 py-2 rounded-lg text-sm ${isDark ? 'text-gray-300 hover:bg-white/10' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            {t('migration.bridge.later')}
          </button>
          <button
            type="button"
            onClick={() => window.api.openExternal(status.downloadUrl)}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-primary hover:opacity-90"
          >
            {t('migration.bridge.download')}
          </button>
        </div>
      </div>
    </div>
  )
}
