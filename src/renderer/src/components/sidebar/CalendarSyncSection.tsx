import { useCallback, useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { RefreshCw, Loader2, CheckCircle2, AlertTriangle, ExternalLink, Unlink } from 'lucide-react'

const APP_PASSWORD_URL = 'https://account.apple.com/account/manage'

export interface CalendarPublicConfig {
  provider: 'icloud' | 'caldav'
  serverUrl: string
  username: string
  hasPassword: boolean
  calendarUrl: string | null
  calendarName: string | null
  enabled: boolean
  lastSyncAt: string | null
  lastError: string | null
  syncedCount: number
}

interface RemoteCalendar {
  url: string
  displayName: string
  color: string | null
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
  fieldSurface: string
  labelText: string
  hintText: string
  successText: string
  errorText: string
}

export function CalendarSyncSection({
  isDark,
  focusRing,
  fieldSurface,
  labelText,
  hintText,
  successText,
  errorText
}: Props) {
  const { t, i18n } = useTranslation()
  const [config, setConfig] = useState<CalendarPublicConfig | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [calendars, setCalendars] = useState<RemoteCalendar[]>([])
  const [busy, setBusy] = useState<'connect' | 'sync' | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [summary, setSummary] = useState<SyncSummary | null>(null)

  const load = useCallback(async () => {
    const loaded = (await window.api.calendarGetConfig?.()) as CalendarPublicConfig | undefined
    if (!loaded) return
    setConfig(loaded)
    setUsername(loaded.username)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (!config) return null

  const handleConnect = async (): Promise<void> => {
    setBusy('connect')
    setMessage(null)
    try {
      await window.api.calendarSaveCredentials?.({
        serverUrl: config.serverUrl,
        username,
        password
      })
      // 저장한 뒤에는 화면에 비밀번호를 남겨 두지 않는다.
      setPassword('')
      const response = (await window.api.calendarTestConnection?.()) as
        | { ok: boolean; message: string | null; calendars: RemoteCalendar[] }
        | undefined
      if (!response) return
      setCalendars(response.calendars ?? [])
      if (!response.ok) {
        setMessage({ kind: 'error', text: response.message ?? '' })
      } else if ((response.calendars ?? []).length === 0) {
        setMessage({ kind: 'error', text: t('calendarSync.noWritableCalendar') })
      }
      await load()
    } finally {
      setBusy(null)
    }
  }

  const handleSelect = async (calendar: RemoteCalendar): Promise<void> => {
    await window.api.calendarSelect?.(calendar.url, calendar.displayName)
    setSummary(null)
    await load()
  }

  const handleSync = async (): Promise<void> => {
    setBusy('sync')
    setMessage(null)
    try {
      const response = (await window.api.calendarSyncNow?.()) as
        | { ok: boolean; message: string | null; result: SyncSummary | null }
        | undefined
      if (!response) return
      if (!response.ok) setMessage({ kind: 'error', text: response.message ?? '' })
      setSummary(response.result)
      await load()
    } finally {
      setBusy(null)
    }
  }

  const handleDisconnect = async (): Promise<void> => {
    await window.api.calendarDisconnect?.()
    setPassword('')
    setCalendars([])
    setSummary(null)
    setMessage(null)
    await load()
  }

  const formatWhen = (iso: string): string =>
    new Date(iso).toLocaleString(i18n.language?.startsWith('en') ? 'en-US' : 'ko-KR')

  return (
    <div className="space-y-3">
      <p className={`text-xs ${hintText}`}>{t('calendarSync.desc')}</p>

      <div>
        <label htmlFor="cal-username" className={`text-xs ${labelText}`}>
          {t('calendarSync.appleId')}
        </label>
        <input
          id="cal-username"
          type="email"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="you@icloud.com"
          className={`w-full mt-1 px-3 py-2 rounded-lg text-sm ${fieldSurface}`}
        />
      </div>

      <div>
        <label htmlFor="cal-password" className={`text-xs ${labelText}`}>
          {t('calendarSync.appPassword')}
        </label>
        <input
          id="cal-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={config.hasPassword ? t('calendarSync.appPasswordSaved') : 'xxxx-xxxx-xxxx-xxxx'}
          className={`w-full mt-1 px-3 py-2 rounded-lg text-sm ${fieldSurface}`}
        />
        <p className={`text-xs mt-1 ${hintText}`}>
          <Trans i18nKey="calendarSync.appPasswordHint" components={{ strong: <strong /> }} />
        </p>
        <button
          type="button"
          onClick={() => window.api.openExternal(APP_PASSWORD_URL)}
          className={`mt-1 inline-flex items-center gap-1 text-xs rounded ${focusRing} ${
            isDark ? 'text-primary-300 hover:text-primary-200' : 'text-primary-700 hover:text-primary-800'
          }`}
        >
          <ExternalLink size={11} /> {t('calendarSync.appPasswordLink')}
        </button>
      </div>

      <button
        type="button"
        onClick={handleConnect}
        disabled={busy !== null || !username}
        className={`w-full px-3 py-2 rounded-lg text-sm bg-primary-700 text-white hover:bg-primary-800 disabled:opacity-40 transition-colors ${focusRing}`}
      >
        {busy === 'connect' ? t('calendarSync.connecting') : t('calendarSync.connect')}
      </button>

      {message && (
        <p className={`flex items-start gap-1.5 text-xs ${message.kind === 'ok' ? successText : errorText}`}>
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>{message.text}</span>
        </p>
      )}

      {calendars.length > 0 && (
        <div>
          <span className={`text-xs ${labelText}`}>{t('calendarSync.pickCalendar')}</span>
          <div className="mt-1 space-y-1">
            {calendars.map((calendar) => {
              const selected = config.calendarUrl === calendar.url
              return (
                <button
                  type="button"
                  key={calendar.url}
                  onClick={() => handleSelect(calendar)}
                  className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-left transition-colors ${focusRing} ${
                    selected
                      ? isDark
                        ? 'bg-primary-500/20 text-primary-200'
                        : 'bg-primary-50 text-primary-800'
                      : isDark
                        ? 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                        : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: calendar.color ?? '#8E8E93' }}
                  />
                  <span className="flex-1 truncate">{calendar.displayName}</span>
                  {selected && <CheckCircle2 size={14} className="shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {config.calendarUrl && (
        <div className={`rounded-lg px-3 py-2.5 space-y-2 ${isDark ? 'bg-gray-700/50' : 'bg-gray-100'}`}>
          <div className={`flex items-center gap-1.5 text-xs ${successText}`}>
            <CheckCircle2 size={13} />
            {t('calendarSync.connected', { name: config.calendarName ?? '' })}
          </div>
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
              isDark ? 'bg-gray-600 hover:bg-gray-500 text-gray-100' : 'bg-white hover:bg-gray-50 text-gray-800 border border-gray-300'
            }`}
          >
            {busy === 'sync' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            {busy === 'sync' ? t('calendarSync.syncing') : t('calendarSync.syncNow')}
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

      {(config.hasPassword || config.calendarUrl) && (
        <div>
          <button
            type="button"
            onClick={handleDisconnect}
            className={`inline-flex items-center gap-1.5 text-xs rounded transition-colors ${focusRing} ${
              isDark ? 'text-gray-400 hover:text-red-400' : 'text-gray-500 hover:text-red-600'
            }`}
          >
            <Unlink size={12} /> {t('calendarSync.disconnect')}
          </button>
          <p className={`text-xs mt-0.5 ${hintText}`}>{t('calendarSync.disconnectHint')}</p>
        </div>
      )}
    </div>
  )
}
