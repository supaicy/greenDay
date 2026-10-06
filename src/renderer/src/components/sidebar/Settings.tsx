import { useState, useEffect } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import {
  X,
  ArrowUpCircle,
  CheckCircle2,
  Wifi,
  WifiOff,
  Download,
  Loader2,
  RefreshCw,
  Lock,
  AlertTriangle,
  Shield
} from 'lucide-react'
import { useStore, type Theme } from '../../store/useStore'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { LANGUAGES, type Language } from '../../i18n'
import { isKoreanRecommendedModel, hasKoreanRecommendedModel } from '../../utils/aiModels'
import { CalendarSyncSection } from './CalendarSyncSection'
import { GoogleSyncSection } from './GoogleSyncSection'
import { LicenseSection } from './LicenseSection'
import type { Capabilities } from '../../../../shared/capabilities'

// 설명은 실제 동작과 1:1로 맞춘다. Cmd+N/Cmd+Shift+A는 토글이고,
// Cmd+D·Delete·1-4는 할 일이 선택돼 있어야만 동작한다(선택이 없으면 아무 일도
// 일어나지 않는데 이전 문구에는 그 전제가 없었다).
const SHORTCUTS = [
  { keys: 'Cmd+N', key: 'addTask' },
  { keys: 'Cmd+Shift+A', key: 'quickAdd' },
  { keys: 'Cmd+F', key: 'search' },
  { keys: 'Cmd+Z', key: 'undo' },
  { keys: 'Cmd+E', key: 'export' },
  { keys: 'Cmd+D', key: 'dueToday' },
  { keys: 'Delete', key: 'deleteSelected' },
  { keys: '1-4', key: 'priority' },
  { keys: 'Esc', key: 'escape' }
]

const THEMES: { value: Theme; key: string }[] = [
  { value: 'dark', key: 'settings.themeDark' },
  { value: 'light', key: 'settings.themeLight' }
]

// 언어 이름은 번역하지 않는다 — 영어 UI에서 '한국어'를 'Korean'으로 바꿔 두면
// 한국어를 찾는 사람이 자기 언어의 이름을 못 알아본다.
const LANGUAGE_LABELS: Record<Language, string> = { ko: '한국어', en: 'English' }

// 진행률 불확정(manifest/verify 등 percent=null) 단계에서 보여줄 바 폭(%).
const INDETERMINATE_BAR_PCT = 8

// 텍스트 역할별 색상. 제목 > 라벨 > 힌트 3단계 위계를 유지하면서, 두 테마 모두
// WCAG AA(본문 4.5:1)를 넘는 조합만 쓴다. 이전에는 힌트가 다크 2.88:1 /
// 라이트 2.54:1로 양쪽 다 기준 미달이었다.
const headingText = (isDark: boolean) => (isDark ? 'text-gray-200' : 'text-gray-700')
const labelText = (isDark: boolean) => (isDark ? 'text-gray-300' : 'text-gray-600')
const hintText = (isDark: boolean) => (isDark ? 'text-gray-400' : 'text-gray-500')
const dividerLine = (isDark: boolean) => (isDark ? 'border-gray-700' : 'border-gray-200')
const successText = (isDark: boolean) => (isDark ? 'text-green-400' : 'text-green-700')
const errorText = (isDark: boolean) => (isDark ? 'text-red-400' : 'text-red-600')

// 키보드 포커스 링. 렌더러 전체에 focus 스타일이 하나도 없어서 Tab으로 이동하면
// 지금 어디에 있는지 전혀 보이지 않았다. 버튼은 focus-visible(마우스 클릭 시 링 없음),
// 입력 필드는 focus로 항상 표시한다.
// Tailwind JIT는 소스에 그대로 적힌 클래스만 생성하므로 문자열을 조합하지 않고 전부 적어 둔다.
const FOCUS_RING_DARK =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#2C2C2E]'
const FOCUS_RING_LIGHT =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white'
const FIELD_FOCUS_DARK =
  'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-[#2C2C2E]'
const FIELD_FOCUS_LIGHT =
  'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-white'
const PEER_FOCUS_DARK =
  'peer-focus-visible:ring-2 peer-focus-visible:ring-primary-500 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[#2C2C2E]'
const PEER_FOCUS_LIGHT =
  'peer-focus-visible:ring-2 peer-focus-visible:ring-primary-500 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-white'
const focusRing = (isDark: boolean) => (isDark ? FOCUS_RING_DARK : FOCUS_RING_LIGHT)
const peerFocusRing = (isDark: boolean) => (isDark ? PEER_FOCUS_DARK : PEER_FOCUS_LIGHT)
const fieldSurface = (isDark: boolean) =>
  isDark ? `bg-gray-700 text-gray-100 ${FIELD_FOCUS_DARK}` : `bg-gray-100 text-gray-800 ${FIELD_FOCUS_LIGHT}`

// 섹션 제목. 다섯 개가 아이콘 유무로 제각각이었는데, 장식을 더하는 대신 걷어내는 쪽으로
// 통일했다. children은 연결 상태처럼 '정보'인 것만 받는다.
function SectionHeading({ isDark, label, children }: { isDark: boolean; label: string; children?: React.ReactNode }) {
  return (
    <h3 className={`flex items-center gap-2 text-sm font-medium mb-3 ${headingText(isDark)}`}>
      {label}
      {children}
    </h3>
  )
}

// Ollama 모델 안내 + 한국어 추천 모델 원클릭 설치. 설치 상태(진행/연결됨/미연결/완료)를
// 중첩 삼항 대신 상호배타 가드 블록으로 나눠 스캔하기 쉽게 한다.
function OllamaModelHint({
  aiModels,
  aiConnected,
  aiPull,
  isDark,
  onInstall
}: {
  aiModels: string[]
  aiConnected: boolean | null
  aiPull: { model: string; status: string; percent: number | null; error: string | null; active: boolean } | null
  isDark: boolean
  onInstall: () => void
}) {
  const { t } = useTranslation()
  const hasRecommended = hasKoreanRecommendedModel(aiModels)
  const installing = !hasRecommended && aiPull?.active
  const canInstall = !hasRecommended && !aiPull?.active && aiConnected === true
  const manualOnly = !hasRecommended && !aiPull?.active && aiConnected !== true
  return (
    <div className={`mt-1 space-y-1.5 text-xs ${hintText(isDark)}`}>
      {!canInstall && <p>{t('settings.modelHint8b')}</p>}

      {installing && aiPull && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" />
            <span>
              {t('settings.modelInstalling')}: <b>{aiPull.model}</b> · {aiPull.status}
              {aiPull.percent != null ? ` ${aiPull.percent}%` : ''}
            </span>
          </div>
          <div className={`h-1.5 rounded-full ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`}>
            <div
              className="h-1.5 rounded-full bg-primary-500 transition-all"
              style={{ width: `${aiPull.percent ?? INDETERMINATE_BAR_PCT}%` }}
            />
          </div>
        </div>
      )}

      {canInstall && (
        <div className="space-y-1">
          <p>{t('settings.modelHintExaone')}</p>
          <button
            type="button"
            onClick={onInstall}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary-700 text-white hover:bg-primary-800 ${focusRing(isDark)}`}
          >
            <Download size={12} /> {t('settings.modelInstall')}
          </button>
          {aiPull?.error && (
            <p className={errorText(isDark)}>
              {t('settings.modelInstallFailed')}: {aiPull.error}
            </p>
          )}
        </div>
      )}

      {manualOnly && (
        <p>
          {t('settings.modelHintManual')} <code className={labelText(isDark)}>ollama pull exaone3.5</code>
        </p>
      )}

      {hasRecommended && aiPull && !aiPull.active && !aiPull.error && (
        <p className={successText(isDark)}>✓ {t('settings.modelInstallDone', { model: aiPull.model })}</p>
      )}
    </div>
  )
}

/**
 * 알림 권한 안내. macOS는 앱이 처음 알림을 띄울 때 권한을 묻고 그 첫 알림은 사라지므로,
 * 사용자는 "리마인더가 안 온다"로만 겪는다(2026-08-05 검증). 여기서 미리 요청하게 한다.
 */
function NotificationSection({ isDark }: { isDark: boolean }) {
  const { t } = useTranslation()
  const [supported, setSupported] = useState<boolean | null>(null)
  const [asked, setAsked] = useState(false)

  useEffect(() => {
    // 실패해도 섹션을 감추지 않는다 — 감추면 "리마인더가 안 온다"의 원인을
    // 알려 주려고 만든 안내가 조용히 사라진다.
    window.api
      .notificationPermission?.()
      .then((v) => setSupported(v === 'supported'))
      .catch(() => setSupported(true))
  }, [])

  // 플랫폼이 알림 자체를 못 띄우면 요청 버튼은 확실한 no-op이라 감춘다.
  // 다만 isSupported()는 '플랫폼 지원'만 답한다 — 사용자가 허용했는지는 알 수 없으므로,
  // 지원되는 경우에는 상태를 아는 척하지 않고 무엇이 필요한지만 말한다.
  const canRequest = supported !== false

  return (
    <div className="space-y-2">
      <p className={`text-xs ${hintText(isDark)}`}>
        {t(canRequest ? 'settings.notifPermDefault' : 'settings.notifPermUnsupported')}
      </p>
      <div className="flex flex-wrap gap-2">
        {canRequest && !asked && (
          <button
            type="button"
            onClick={() => {
              void window.api.requestNotificationPermission?.().catch(() => {})
              setAsked(true)
            }}
            className={`px-3 py-1.5 rounded-lg text-sm bg-primary-700 text-white hover:bg-primary-800 transition-colors ${focusRing(isDark)}`}
          >
            {t('settings.notifPermRequest')}
          </button>
        )}
        <button
          type="button"
          onClick={() => void window.api.openNotificationSettings?.().catch(() => {})}
          className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${focusRing(isDark)} ${
            isDark ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
          }`}
        >
          {t('settings.notifPermOpenSettings')}
        </button>
      </div>
      {asked && <p className={`text-xs ${hintText(isDark)}`}>{t('settings.notifPermProbeSent')}</p>}
    </div>
  )
}

/** 개인정보처리방침. 앱스토어에도 이 주소를 **언어별로** 제출한다 —
    원본이 하나여야 갈라지지 않는다(회사 사이트가 결제 사이트 법적 문서와 같은 곳이다). */
const PRIVACY_URL: Record<string, string> = {
  ko: 'https://begreen.dev/ko/privacy',
  en: 'https://begreen.dev/privacy'
}

export function Settings() {
  const { t } = useTranslation()
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const language = useStore((s) => s.language)
  const setLanguage = useStore((s) => s.setLanguage)
  const showSettings = useStore((s) => s.showSettings)
  const toggleSettings = useStore((s) => s.toggleSettings)
  const exportData = useStore((s) => s.exportData)
  const updateAvailable = useStore((s) => s.updateAvailable)
  const updateChecked = useStore((s) => s.updateChecked)
  const updateFailed = useStore((s) => s.updateFailed)
  const updateDownloadProgress = useStore((s) => s.updateDownloadProgress)
  const updateDownloadFailed = useStore((s) => s.updateDownloadFailed)
  const updateReady = useStore((s) => s.updateReady)
  const aiConfig = useStore((s) => s.aiConfig)
  const aiConnected = useStore((s) => s.aiConnected)
  const aiModels = useStore((s) => s.aiModels)
  const aiPull = useStore((s) => s.aiPull)
  const aiPullModel = useStore((s) => s.aiPullModel)
  const aiLoadConfig = useStore((s) => s.aiLoadConfig)
  const aiCheckConnection = useStore((s) => s.aiCheckConnection)
  const aiSaveConfig = useStore((s) => s.aiSaveConfig)

  const isDark = theme === 'dark'

  const [aiBaseUrl, setAiBaseUrl] = useState('')
  const [aiModel, setAiModel] = useState('')
  const [aiApiKey, setAiApiKey] = useState('')
  const [aiProvider, setAiProvider] = useState<'ollama' | 'openai' | 'custom'>('ollama')
  const [aiMaxHistory, setAiMaxHistory] = useState(200)
  const [aiLocalOnly, setAiLocalOnly] = useState(false)
  // 이 빌드가 무엇을 할 수 있는가 (shared/capabilities.ts).
  // 스토어 빌드면 업데이트를 스토어가 담당하므로 앱 내 업데이트 UI를 숨긴다.
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const updatesViaStore = caps?.updatesViaStore ?? false
  const canSelfUpdate = caps?.canSelfUpdate ?? false
  // 브리지 릴리스(옛 번들 ID의 마지막 버전): 업데이트 대신 "새 앱으로 옮겨가세요".
  const isBridge = caps?.isBridge ?? false

  useEffect(() => {
    window.api.capabilities?.().then(setCaps)
  }, [])

  useEffect(() => {
    if (showSettings && !aiConfig) aiLoadConfig()
  }, [showSettings, aiConfig, aiLoadConfig])

  // 설정을 열 때마다 연결 상태 + 모델 목록을 새로고침 (드롭다운 최신화)
  useEffect(() => {
    if (showSettings) aiCheckConnection()
  }, [showSettings, aiCheckConnection])

  useEffect(() => {
    if (aiConfig) {
      setAiBaseUrl(aiConfig.baseUrl)
      setAiModel(aiConfig.model)
      setAiApiKey(aiConfig.apiKey || '')
      setAiProvider(aiConfig.provider)
      setAiMaxHistory(aiConfig.maxHistoryMessages ?? 200)
      setAiLocalOnly(aiConfig.localOnly ?? false)
    }
  }, [aiConfig])

  const handleAiSave = () => {
    aiSaveConfig({
      provider: aiProvider,
      baseUrl: aiBaseUrl,
      model: aiModel,
      apiKey: aiApiKey || null,
      maxHistoryMessages: aiMaxHistory,
      localOnly: aiLocalOnly
    })
    aiCheckConnection()
  }

  // 세그먼티드 컨트롤의 각 칸. 선택된 칸만 떠 보이게 하고 나머지는 트랙에 잠기게 한다.
  // 라이트 비선택은 gray-500이면 트랙(gray-100) 위에서 4.39:1로 미달이라 gray-600을 쓴다.
  const segment = (active: boolean) =>
    `cursor-pointer select-none px-4 py-1 rounded-md text-sm transition-colors ${peerFocusRing(isDark)} ${
      active
        ? isDark
          ? 'bg-gray-600 text-white font-medium'
          : 'bg-white text-gray-900 font-medium shadow-sm'
        : isDark
          ? 'text-gray-400 hover:text-gray-200'
          : 'text-gray-600 hover:text-gray-900'
    }`

  // 로컬 전용 잠금을 켜면 외부 제공자를 쓸 수 없으므로, 외부였다면 Ollama 로컬로 되돌린다.
  const toggleLocalOnly = () => {
    const next = !aiLocalOnly
    setAiLocalOnly(next)
    if (next && aiProvider !== 'ollama') {
      setAiProvider('ollama')
      setAiBaseUrl('http://localhost:11434')
      setAiModel('llama3.2:latest')
      setAiApiKey('')
    }
  }

  return (
    // 배경·Escape·포커스 트랩은 Radix Dialog가 담당. toggleSettings는 인자를
    // 무시하는 토글이라 닫힘 신호만 받는다(open(true)에 뒤집히지 않게).
    // **열려 있을 때만** 뒤집는다. Radix는 닫힘 애니메이션 동안 콘텐츠를 남겨 두고
    // Escape·바깥 클릭을 계속 받아서, 그 사이 두 번째 닫힘 신호가 토글을 다시 뒤집어
    // 다이얼로그를 도로 열었다(settingsDismiss.test.tsx).
    <Dialog open={showSettings} onOpenChange={(open) => !open && showSettings && toggleSettings()}>
      {/* 헤더는 고정하고 본문만 스크롤한다. 이전에는 카드 전체가 스크롤 컨테이너라
          내용이 뷰포트의 ~2.8배인 이 패널에서 아래로 내려가면 닫기 버튼이 사라졌다. */}
      <DialogContent
        showCloseButton={false}
        className="flex w-[480px] max-h-[80vh] flex-col overflow-hidden rounded-xl p-0 gap-0"
      >
        <div className={`flex shrink-0 items-center justify-between px-5 py-4 border-b ${dividerLine(isDark)}`}>
          <DialogTitle className="text-base font-semibold">{t('settings.title')}</DialogTitle>
          <DialogDescription className="sr-only">{t('settings.title')}</DialogDescription>
          <button
            type="button"
            onClick={toggleSettings}
            aria-label={t('settings.close')}
            // 라이트 모드에서 hover:text-gray-300은 흰 배경 위 1.6:1 — 마우스를 올리면
            // 오히려 사라졌다. 두 테마 모두 hover 시 더 진해지도록.
            className={`rounded transition-colors ${focusRing(isDark)} ${isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-800'}`}
          >
            <X size={18} />
          </button>
        </div>

        {/* 섹션 사이 32px + 구분선 아래 16px. 이전에는 24/16이라 위아래 여백 차이가
            8px뿐이어서 구분선이 어느 섹션에 속하는지 눈에 안 잡혔다. */}
        <div className="overflow-y-auto p-5 space-y-8">
          {/* 테마 */}
          <div>
            <SectionHeading isDark={isDark} label={t('settings.theme')} />
            <fieldset className={`inline-flex rounded-lg p-0.5 ${isDark ? 'bg-black/20' : 'bg-gray-100'}`}>
              <legend className="sr-only">{t('settings.theme')}</legend>
              {THEMES.map(({ value, key }) => (
                <label key={value} className={segment(theme === value)}>
                  <input
                    type="radio"
                    name="theme"
                    value={value}
                    checked={theme === value}
                    onChange={() => setTheme(value)}
                    className="sr-only peer"
                  />
                  {t(key)}
                </label>
              ))}
            </fieldset>
          </div>

          {/* 언어 */}
          <div className={`border-t pt-4 ${dividerLine(isDark)}`}>
            <SectionHeading isDark={isDark} label={t('settings.language')} />
            <fieldset className={`inline-flex rounded-lg p-0.5 ${isDark ? 'bg-black/20' : 'bg-gray-100'}`}>
              <legend className="sr-only">{t('settings.language')}</legend>
              {LANGUAGES.map((value) => (
                <label key={value} className={segment(language === value)}>
                  <input
                    type="radio"
                    name="language"
                    value={value}
                    checked={language === value}
                    onChange={() => setLanguage(value)}
                    className="sr-only peer"
                  />
                  {LANGUAGE_LABELS[value]}
                </label>
              ))}
            </fieldset>
          </div>

          {/* 데이터 */}
          <div className={`border-t pt-4 ${dividerLine(isDark)}`}>
            <SectionHeading isDark={isDark} label={t('settings.data')} />
            <button
              type="button"
              onClick={() => {
                exportData()
                toggleSettings()
              }}
              className={`flex items-center gap-3 w-full px-4 py-3 rounded-lg transition-colors ${focusRing(isDark)} ${
                isDark ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
              }`}
            >
              <Download size={18} />
              <div className="text-left">
                <div className="text-sm font-medium">{t('settings.exportData')}</div>
                <div className={`text-xs ${labelText(isDark)}`}>{t('settings.exportDesc')}</div>
              </div>
            </button>

              {/* 심사 지침 5.1.1 — 개인정보처리방침은 **앱 안에서도** 닿을 수 있어야 한다.
                  메타데이터의 URL만으로는 부족하다. 언어에 따라 갈라 준다. */}
              <button
                type="button"
                onClick={() => window.api.openExternal(PRIVACY_URL[language] ?? PRIVACY_URL.en)}
                className={`mt-2 flex items-center gap-3 w-full px-4 py-3 rounded-lg transition-colors ${focusRing(isDark)} ${
                  isDark ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-100 text-gray-600'
                }`}
              >
                <Shield size={18} />
                <div className="text-left">
                  <div className="text-sm font-medium">{t('settings.privacyTitle')}</div>
                  <div className={`text-xs ${labelText(isDark)}`}>{t('settings.privacyDesc')}</div>
                </div>
              </button>
          </div>

          {/* 라이선스. 스토어 빌드에서는 통째로 안 그린다 — 키 입력 칸이 남으면
              Apple 가이드라인 3.1.1(외부 결제 유도)로 심사에서 거절된다. */}
          {caps?.needsLicenseKey && (
            <div className={`border-t pt-4 ${dividerLine(isDark)}`}>
              <SectionHeading isDark={isDark} label={t('license.title')} />
              <LicenseSection
                isDark={isDark}
                focusRing={focusRing(isDark)}
                fieldSurface={fieldSurface(isDark)}
                labelText={labelText(isDark)}
                hintText={hintText(isDark)}
                successText={successText(isDark)}
                errorText={errorText(isDark)}
              />
            </div>
          )}

          {/* 캘린더 동기화 */}
          <div className={`border-t pt-4 ${dividerLine(isDark)}`}>
            <SectionHeading isDark={isDark} label={t('calendarSync.title')} />
            <CalendarSyncSection
              isDark={isDark}
              focusRing={focusRing(isDark)}
              fieldSurface={fieldSurface(isDark)}
              labelText={labelText(isDark)}
              hintText={hintText(isDark)}
              successText={successText(isDark)}
              errorText={errorText(isDark)}
            />
          </div>

          {/* Google 캘린더 */}
          <div className={`border-t pt-4 ${dividerLine(isDark)}`}>
            <SectionHeading isDark={isDark} label={t('googleSync.title')} />
            <GoogleSyncSection
              isDark={isDark}
              focusRing={focusRing(isDark)}
              labelText={labelText(isDark)}
              hintText={hintText(isDark)}
              successText={successText(isDark)}
              errorText={errorText(isDark)}
            />
          </div>

          {/* AI 설정 */}
          <div className={`border-t pt-4 ${dividerLine(isDark)}`}>
            <SectionHeading isDark={isDark} label={t('settings.ai')}>
              {aiConnected === true && <Wifi size={14} className={successText(isDark)} />}
              {aiConnected === false && <WifiOff size={14} className={errorText(isDark)} />}
            </SectionHeading>
            <div className="space-y-3">
              <div>
                <label htmlFor="ai-provider" className={`text-xs ${labelText(isDark)}`}>
                  {t('settings.aiProvider')}
                </label>
                <select
                  id="ai-provider"
                  value={aiProvider}
                  onChange={(e) => {
                    const v = e.target.value as 'ollama' | 'openai' | 'custom'
                    if (aiLocalOnly && v !== 'ollama') return // 로컬 전용 잠금 시 외부 선택 차단
                    setAiProvider(v)
                    if (v === 'ollama') {
                      setAiBaseUrl('http://localhost:11434')
                      setAiModel('llama3.2:latest')
                    } else if (v === 'openai') {
                      setAiBaseUrl('https://api.openai.com')
                      setAiModel('gpt-4o-mini')
                    }
                  }}
                  className={`w-full mt-1 px-3 py-2 rounded-lg text-sm ${fieldSurface(isDark)}`}
                >
                  <option value="ollama">{t('settings.aiProviderOllama')}</option>
                  <option value="openai" disabled={aiLocalOnly}>
                    OpenAI{aiLocalOnly ? t('settings.localOnlyLocked') : ''}
                  </option>
                  <option value="custom" disabled={aiLocalOnly}>
                    {t('settings.aiProviderCustom')}
                    {aiLocalOnly ? t('settings.localOnlyLocked') : ''}
                  </option>
                </select>
              </div>

              {/* 외부 전송 경고 */}
              {aiProvider !== 'ollama' && (
                <div
                  className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs bg-amber-500/10 border border-amber-500/30 ${
                    // amber-700은 다크 배경(#40372A 상당)에서 2.33:1로, 패널에서 가장 중요한
                    // 프라이버시 경고가 가장 안 읽히는 상태였다. 다크에서는 amber-300으로.
                    isDark ? 'text-amber-300' : 'text-amber-800'
                  }`}
                >
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>
                    <Trans i18nKey="settings.externalWarning" components={{ strong: <strong /> }} />
                  </span>
                </div>
              )}

              {/* 로컬 전용 잠금 (프라이버시 모드) */}
              <label className="flex items-start gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={aiLocalOnly}
                  onChange={toggleLocalOnly}
                  className={`mt-0.5 accent-primary-600 ${focusRing(isDark)}`}
                />
                <span>
                  {/* 라벨의 '(외부 AI 차단)'과 설명이 같은 말을 두 번 하고 있었다. 라벨은 짧게,
                      설명이 한 번만 말하게 한다. */}
                  <span className={`flex items-center gap-1.5 text-sm ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
                    <Lock size={13} /> {t('settings.localOnly')}
                  </span>
                  <span className={`block text-xs mt-0.5 ${hintText(isDark)}`}>{t('settings.localOnlyDesc')}</span>
                </span>
              </label>
              <div>
                <label htmlFor="ai-base-url" className={`text-xs ${labelText(isDark)}`}>
                  {t('settings.apiUrl')}
                </label>
                <input
                  id="ai-base-url"
                  type="text"
                  value={aiBaseUrl}
                  onChange={(e) => setAiBaseUrl(e.target.value)}
                  className={`w-full mt-1 px-3 py-2 rounded-lg text-sm ${fieldSurface(isDark)}`}
                />
              </div>
              <div>
                <label htmlFor="ai-model" className={`text-xs ${labelText(isDark)}`}>
                  {t('settings.model')}
                </label>
                {aiProvider === 'ollama' && aiModels.length > 0 ? (
                  // Ollama: 설치된 모델을 드롭다운으로. 저장값이 목록에 없으면 맨 위에 표시.
                  <div className="flex gap-2 mt-1">
                    <select
                      id="ai-model"
                      value={aiModel}
                      onChange={(e) => setAiModel(e.target.value)}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm ${fieldSurface(isDark)}`}
                    >
                      {aiModel && !aiModels.includes(aiModel) && (
                        <option value={aiModel}>
                          {aiModel}
                          {t('settings.modelNotInstalled')}
                        </option>
                      )}
                      {aiModels.map((m) => (
                        <option key={m} value={m}>
                          {isKoreanRecommendedModel(m) ? `${m}${t('settings.modelKoRecommended')}` : m}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={aiCheckConnection}
                      title={t('settings.modelRefresh')}
                      className={`px-2.5 rounded-lg ${focusRing(isDark)} ${isDark ? 'bg-gray-700 text-gray-400 hover:text-gray-200' : 'bg-gray-100 text-gray-500 hover:text-gray-700'}`}
                    >
                      <RefreshCw size={14} />
                    </button>
                  </div>
                ) : (
                  // 비-Ollama이거나 아직 모델 목록을 못 불러왔으면 자유 입력 폴백.
                  <input
                    id="ai-model"
                    type="text"
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value)}
                    className={`w-full mt-1 px-3 py-2 rounded-lg text-sm ${fieldSurface(isDark)}`}
                  />
                )}
                {aiProvider === 'ollama' && (
                  <OllamaModelHint
                    aiModels={aiModels}
                    aiConnected={aiConnected}
                    aiPull={aiPull}
                    isDark={isDark}
                    onInstall={() => aiPullModel('exaone3.5')}
                  />
                )}
              </div>
              {aiProvider !== 'ollama' && (
                <div>
                  <label htmlFor="ai-api-key" className={`text-xs ${labelText(isDark)}`}>
                    {t('settings.apiKey')}
                  </label>
                  <input
                    id="ai-api-key"
                    type="password"
                    value={aiApiKey}
                    onChange={(e) => setAiApiKey(e.target.value)}
                    placeholder="sk-..."
                    className={`w-full mt-1 px-3 py-2 rounded-lg text-sm ${fieldSurface(isDark)}`}
                  />
                </div>
              )}
              <div>
                <label htmlFor="ai-max-history" className={`text-xs ${labelText(isDark)}`}>
                  {t('settings.chatHistoryLimit')}
                </label>
                <input
                  id="ai-max-history"
                  type="number"
                  min={0}
                  max={10000}
                  value={aiMaxHistory}
                  onChange={(e) => setAiMaxHistory(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className={`w-full mt-1 px-3 py-2 rounded-lg text-sm ${fieldSurface(isDark)}`}
                />
                <p className={`text-xs mt-1 ${hintText(isDark)}`}>{t('settings.chatHistoryDesc')}</p>
              </div>
              <button
                type="button"
                onClick={handleAiSave}
                className={`w-full px-3 py-2 rounded-lg text-sm bg-primary-700 text-white hover:bg-primary-800 transition-colors ${focusRing(isDark)}`}
              >
                {t('settings.saveAndTest')}
              </button>
              {aiConnected === true && <p className={`text-xs ${successText(isDark)}`}>{t('settings.connected')}</p>}
              {aiConnected === false && (
                <p className={`text-xs ${errorText(isDark)}`}>
                  {aiProvider === 'ollama' ? t('settings.connectFailedOllama') : t('settings.connectFailedApi')}
                </p>
              )}
            </div>
          </div>

          {/* 알림 권한 — 없으면 리마인더가 조용히 사라지므로 상태를 드러낸다 */}
          <div className={`border-t pt-4 ${dividerLine(isDark)}`}>
            <SectionHeading isDark={isDark} label={t('settings.notifications')} />
            <NotificationSection isDark={isDark} />
          </div>

          {/* 키보드 단축키 */}
          <div className={`border-t pt-4 ${dividerLine(isDark)}`}>
            <SectionHeading isDark={isDark} label={t('settings.shortcuts')} />
            <div className="space-y-1.5">
              {SHORTCUTS.map((s) => (
                <div key={s.keys} className="flex items-center justify-between">
                  <span className={`text-xs ${labelText(isDark)}`}>{t(`shortcuts.${s.key}`)}</span>
                  <kbd
                    className={`text-xs px-2 py-0.5 rounded font-mono ${
                      isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'
                    }`}
                  >
                    {s.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>

          {/* 버전 및 업데이트 */}
          <div className={`border-t pt-4 ${dividerLine(isDark)}`}>
            <SectionHeading isDark={isDark} label={t('settings.version')} />
            <div className={`rounded-lg px-4 py-3 mb-3 ${isDark ? 'bg-gray-700/50' : 'bg-gray-100'}`}>
              <div className={`text-sm font-medium mb-1 ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
                Greenday v{__APP_VERSION__}
              </div>
              {isBridge ? (
                <div className="mt-1 space-y-2">
                  <span className={`block text-xs ${labelText(isDark)}`}>{t('migration.bridge.settingsRow')}</span>
                  <button
                    type="button"
                    onClick={() => window.dispatchEvent(new Event('greenday:bridge-reopen'))}
                    className={`text-xs underline ${labelText(isDark)}`}
                  >
                    {t('migration.bridge.settingsOpen')}
                  </button>
                </div>
              ) : updatesViaStore ? (
                // 스토어 빌드: 앱 내 업데이트 확인/다운로드는 비활성(스토어가 담당)
                <div className="flex items-center gap-1.5 mt-1">
                  <CheckCircle2 size={13} className={successText(isDark)} />
                  <span className={`text-xs ${labelText(isDark)}`}>{t('settings.updateViaAppStore')}</span>
                </div>
              ) : updateFailed && !updateAvailable ? (
                // **실패 가지가 '최신' 가지보다 먼저다.** 뒤에 두면 확인이 실패한
                // 상태가 `updateChecked && !updateAvailable`에 먼저 걸려 "최신
                // 버전입니다"라고 거짓말한다 — 버전을 한 번도 못 물어본 채로.
                // 새 버전을 이미 알고 있으면 띄우지 않는다: 아래 카드가 그 답이고,
                // 한 시간 뒤 재확인이 실패했다고 그 답이 거짓이 되지는 않는다.
                <div className="flex items-center gap-1.5 mt-1">
                  <AlertTriangle size={13} className={errorText(isDark)} />
                  <span className={`text-xs ${errorText(isDark)}`}>{t('settings.updateCheckFailed')}</span>
                </div>
              ) : updateChecked && !updateAvailable ? (
                <div className="flex items-center gap-1.5 mt-1">
                  <CheckCircle2 size={13} className={successText(isDark)} />
                  <span className={`text-xs ${successText(isDark)}`}>{t('settings.upToDate')}</span>
                </div>
              ) : !updateChecked ? (
                <div className="flex items-center gap-1.5 mt-1">
                  <span className={`text-xs ${hintText(isDark)}`}>{t('settings.checkingUpdate')}</span>
                </div>
              ) : null}
            </div>
            {canSelfUpdate && updateAvailable && (
              <div className="space-y-2">
                <div
                  className={`flex items-center gap-3 w-full px-4 py-3 rounded-lg ${
                    isDark ? 'bg-primary-500/20 text-primary-200' : 'bg-primary-50 text-primary-800'
                  }`}
                >
                  <ArrowUpCircle size={18} />
                  <div className="text-left flex-1">
                    <div className="text-sm font-medium">{t('settings.updateAvailable')}</div>
                    <div className={`text-xs ${isDark ? 'text-primary-300' : 'text-primary-700'}`}>
                      {t('settings.updateDownload', { version: updateAvailable.version })}
                    </div>
                  </div>
                </div>

                {/* 앱 안에서 받아 설치한다. 예전에는 이 IPC를 아무도 부르지 않아
                    새 버전이 떠도 GitHub 페이지를 여는 것 말고는 할 수 있는 게 없었다. */}
                {updateDownloadProgress != null && !updateReady ? (
                  <div>
                    <div className={`h-1.5 rounded-full ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`}>
                      <div
                        className="h-1.5 rounded-full bg-primary-500 transition-all"
                        style={{ width: `${updateDownloadProgress}%` }}
                      />
                    </div>
                    <p className={`mt-1 text-xs ${hintText(isDark)}`}>
                      {t('settings.updateDownloading', { percent: updateDownloadProgress })}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {/* 다운로드가 끊겼다. 막대는 App.tsx가 내렸고, 여기서 무엇이 실패했는지
                        말하고 같은 버튼을 '다시 받기'로 돌려준다. 확인 실패 문구를 빌려 쓰면
                        새 버전 카드 옆에서 "확인 실패"라고 말하게 된다. */}
                    {updateDownloadFailed && !updateReady && (
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle size={13} className={errorText(isDark)} />
                        <span className={`text-xs ${errorText(isDark)}`}>{t('settings.updateDownloadFailed')}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        updateReady
                          ? window.api.installUpdate?.()
                          : // 실패는 'update-download-error'로 따로 온다. invoke의 거절까지
                            // 버리지 않으면 렌더러 콘솔에 처리되지 않은 rejection이 남는다.
                            window.api.downloadUpdate?.()?.catch(() => {})
                      }
                      className={`w-full px-3 py-2 rounded-lg text-sm bg-primary-700 text-white hover:bg-primary-800 transition-colors ${focusRing(isDark)}`}
                    >
                      {t(
                        updateReady
                          ? 'settings.updateInstall'
                          : updateDownloadFailed
                            ? 'settings.updateDownloadRetry'
                            : 'settings.updateDownloadNow'
                      )}
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => window.api.openExternal(updateAvailable.downloadUrl)}
                  className={`text-xs rounded ${focusRing(isDark)} ${
                    isDark ? 'text-primary-300 hover:text-primary-200' : 'text-primary-700 hover:text-primary-800'
                  }`}
                >
                  {t('settings.updateViewRelease')}
                </button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
