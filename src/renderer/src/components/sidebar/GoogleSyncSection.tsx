import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw, Loader2, CheckCircle2, AlertTriangle, Unlink, LogIn } from 'lucide-react'

interface GooglePublicConfig {
  calendarId: string | null
  calendarName: string | null
  account: string | null
  enabled: boolean
  lastSyncAt: string | null
  lastError: string | null
  connected: boolean
  syncedCount: number
  clientIdConfigured: boolean
}

interface SyncSummary {
  created: number
  updated: number
  deleted: number
  skippedNoDate: number
  failures: { taskId: string; message: string }[]
}

interface Props {
  isDark: boolean
  focusRing: string
  labelText: string
  hintText: string
  successText: string
  errorText: string
}

/**
 * 캘린더를 고르는 단계가 없다. `calendar.app.created` 범위는 앱이 만든 캘린더에만
 * 닿으므로, 연결하면 메인이 `Greenday` 캘린더를 찾거나 만들어 거기에만 쓴다.
 */
export function GoogleSyncSection({
  isDark,
  focusRing,
  hintText,
  successText,
  errorText
}: Props) {
  const { t, i18n } = useTranslation()
  const [config, setConfig] = useState<GooglePublicConfig | null>(null)
  const [busy, setBusy] = useState<'connect' | 'sync' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [summary, setSummary] = useState<SyncSummary | null>(null)

  const load = useCallback(async () => {
    const loaded = (await window.api.googleGetConfig?.()) as GooglePublicConfig | undefined
    if (loaded) setConfig(loaded)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (!config) return null

  const handleConnect = async (): Promise<void> => {
    setBusy('connect')
    setMessage(null)
    try {
      const response = (await window.api.googleConnect?.()) as
        | { ok: boolean; message: string | null }
        | undefined
      if (response && !response.ok) setMessage(response.message)
      await load()
    } finally {
      setBusy(null)
    }
  }

  const handleSync = async (): Promise<void> => {
    setBusy('sync')
    setMessage(null)
    try {
      const response = (await window.api.googleSyncNow?.()) as
        | { ok: boolean; message: string | null; result: SyncSummary | null }
        | undefined
      if (!response) return
      if (!response.ok) setMessage(response.message)
      setSummary(response.result)
      await load()
    } finally {
      setBusy(null)
    }
  }

  const handleDisconnect = async (): Promise<void> => {
    await window.api.googleDisconnect?.()
    setSummary(null)
    setMessage(null)
    await load()
  }

  const formatWhen = (iso: string): string =>
    new Date(iso).toLocaleString(i18n.language?.startsWith('en') ? 'en-US' : 'ko-KR')

  if (!config.clientIdConfigured && !config.connected) {
    return <p className={`text-xs ${hintText}`}>{t('googleSync.notConfigured')}</p>
  }

  return (
    <div className="space-y-3">
      <p className={`text-xs ${hintText}`}>{t('googleSync.desc')}</p>
      <p className={`text-xs ${hintText}`}>{t('googleSync.scopeNote')}</p>

      {!config.connected ? (
        <>
          <button
            type="button"
            onClick={handleConnect}
            disabled={busy !== null}
            className={`flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-sm bg-primary-700 text-white hover:bg-primary-800 disabled:opacity-40 transition-colors ${focusRing}`}
          >
            {busy === 'connect' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <LogIn size={14} />
            )}
            {busy === 'connect' ? t('googleSync.connecting') : t('googleSync.connect')}
          </button>
          <p className={`text-xs ${hintText}`}>{t('googleSync.connectHint')}</p>
        </>
      ) : (
        <div className={`flex items-center gap-1.5 text-xs ${successText}`}>
          <CheckCircle2 size={13} />
          {config.account
            ? t('googleSync.connectedAccount', { account: config.account })
            : t('googleSync.connected', { name: config.calendarName ?? 'Greenday' })}
        </div>
      )}

      {message && (
        <p className={`flex items-start gap-1.5 text-xs ${errorText}`}>
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>{message}</span>
        </p>
      )}

      {config.connected && (
        <div className={`rounded-lg px-3 py-2.5 space-y-2 ${isDark ? 'bg-gray-700/50' : 'bg-gray-100'}`}>
          <p className={`text-xs ${hintText}`}>
            {config.lastSyncAt
              ? t('calendarSync.lastSync', { when: formatWhen(config.lastSyncAt) })
              : t('calendarSync.neverSynced')}
          </p>
          <button
            type="button"
            onClick={handleSync}
            disabled={busy !== null}
            className={`flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-sm transition-colors disabled:opacity-40 ${focusRing} ${
              isDark
                ? 'bg-gray-600 hover:bg-gray-500 text-gray-100'
                : 'bg-white hover:bg-gray-50 text-gray-800 border border-gray-300'
            }`}
          >
            {busy === 'sync' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            {busy === 'sync' ? t('googleSync.syncing') : t('googleSync.syncNow')}
          </button>

          {summary && (
            <div className={`text-xs space-y-0.5 ${hintText}`}>
              <p>
                {t('calendarSync.syncResult', {
                  created: summary.created,
                  updated: summary.updated,
                  deleted: summary.deleted
                })}
              </p>
              {summary.skippedNoDate > 0 && (
                <p>{t('calendarSync.syncSkipped', { count: summary.skippedNoDate })}</p>
              )}
              {summary.failures.length > 0 && (
                <p className={errorText}>
                  {t('calendarSync.syncFailures', { count: summary.failures.length })}
                </p>
              )}
            </div>
          )}

          <p className={`text-xs ${hintText}`}>{t('calendarSync.oneWayNote')}</p>
        </div>
      )}

      {config.connected && (
        <div>
          <button
            type="button"
            onClick={handleDisconnect}
            className={`inline-flex items-center gap-1.5 text-xs rounded transition-colors ${focusRing} ${
              isDark ? 'text-gray-400 hover:text-red-400' : 'text-gray-500 hover:text-red-600'
            }`}
          >
            <Unlink size={12} /> {t('googleSync.disconnect')}
          </button>
          <p className={`text-xs mt-0.5 ${hintText}`}>{t('googleSync.disconnectHint')}</p>
        </div>
      )}
    </div>
  )
}
