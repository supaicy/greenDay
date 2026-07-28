import { useState, useEffect } from 'react'
import { X, ArrowUpCircle, CheckCircle2, Wifi, WifiOff, Download, Loader2, RefreshCw, Lock, AlertTriangle } from 'lucide-react'
import { useStore, type Theme } from '../../store/useStore'
import { isKoreanRecommendedModel, hasKoreanRecommendedModel } from '../../utils/aiModels'

// 설명은 실제 동작과 1:1로 맞춘다. Cmd+N/Cmd+Shift+A는 토글이고,
// Cmd+D·Delete·1-4는 할 일이 선택돼 있어야만 동작한다(선택이 없으면 아무 일도
// 일어나지 않는데 이전 문구에는 그 전제가 없었다).
const SHORTCUTS = [
  { keys: 'Cmd+N', desc: '할 일 추가 열기/닫기' },
  { keys: 'Cmd+Shift+A', desc: '빠른 추가 열기/닫기' },
  { keys: 'Cmd+F', desc: '검색' },
  { keys: 'Cmd+Z', desc: '되돌리기' },
  { keys: 'Cmd+E', desc: '데이터 내보내기' },
  { keys: 'Cmd+D', desc: '선택한 할 일을 오늘 마감으로' },
  { keys: 'Delete', desc: '선택한 할 일 삭제' },
  { keys: '1-4', desc: '선택한 할 일 우선순위 (없음~높음)' },
  { keys: 'Esc', desc: '선택 해제 / 닫기' }
]

const THEMES: { value: Theme; label: string }[] = [
  { value: 'dark', label: '다크' },
  { value: 'light', label: '라이트' }
]

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
  isDark
    ? `bg-gray-700 text-gray-100 ${FIELD_FOCUS_DARK}`
    : `bg-gray-100 text-gray-800 ${FIELD_FOCUS_LIGHT}`

// 섹션 제목. 다섯 개가 아이콘 유무로 제각각이었는데, 장식을 더하는 대신 걷어내는 쪽으로
// 통일했다. children은 연결 상태처럼 '정보'인 것만 받는다.
function SectionHeading({
  isDark,
  label,
  children
}: {
  isDark: boolean
  label: string
  children?: React.ReactNode
}) {
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
  const hasRecommended = hasKoreanRecommendedModel(aiModels)
  const installing = !hasRecommended && aiPull?.active
  const canInstall = !hasRecommended && !aiPull?.active && aiConnected === true
  const manualOnly = !hasRecommended && !aiPull?.active && aiConnected !== true
  return (
    <div className={`mt-1 space-y-1.5 text-xs ${hintText(isDark)}`}>
      {!canInstall && <p>한국어 답변은 8B 이상 모델을 권장합니다.</p>}

      {installing && aiPull && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" />
            <span>
              설치 중: <b>{aiPull.model}</b> · {aiPull.status}
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
          <p>한국어 답변은 8B 이상, 그중 한국어 특화 모델(EXAONE)이 가장 정확합니다.</p>
          <button
            type="button"
            onClick={onInstall}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary-700 text-white hover:bg-primary-800 ${focusRing(isDark)}`}
          >
            <Download size={12} /> 한국어 모델 설치 (exaone3.5)
          </button>
          {aiPull?.error && <p className={errorText(isDark)}>설치 실패: {aiPull.error}</p>}
        </div>
      )}

      {manualOnly && (
        <p>
          한국어 특화 모델(EXAONE)이 더 정확합니다. Ollama 실행 후 설치 —{' '}
          <code className={labelText(isDark)}>ollama pull exaone3.5</code>
        </p>
      )}

      {hasRecommended && aiPull && !aiPull.active && !aiPull.error && (
        <p className={successText(isDark)}>✓ {aiPull.model} 설치 완료 — 모델로 선택됨</p>
      )}
    </div>
  )
}

export function Settings() {
  const {
    theme,
    setTheme,
    showSettings,
    toggleSettings,
    exportData,
    updateAvailable,
    updateChecked,
    aiConfig,
    aiConnected,
    aiModels,
    aiPull,
    aiPullModel,
    aiLoadConfig,
    aiCheckConnection,
    aiSaveConfig
  } = useStore()

  const isDark = theme === 'dark'

  const [aiBaseUrl, setAiBaseUrl] = useState('')
  const [aiModel, setAiModel] = useState('')
  const [aiApiKey, setAiApiKey] = useState('')
  const [aiProvider, setAiProvider] = useState<'ollama' | 'openai' | 'custom'>('ollama')
  const [aiMaxHistory, setAiMaxHistory] = useState(200)
  const [aiLocalOnly, setAiLocalOnly] = useState(false)
  // Mac App Store(샌드박스) 빌드면 앱 내 업데이트가 아니라 App Store가 업데이트를 담당한다.
  const [isMas, setIsMas] = useState(false)

  useEffect(() => {
    window.api.isMas?.().then(setIsMas)
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

  // Close on Escape. Uses a capture-phase document listener because the modal
  // content stops keydown propagation, so the backdrop's onKeyDown never fires
  // when focus is inside the modal (which is almost always).
  useEffect(() => {
    if (!showSettings) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        // 상세 패널이 함께 열려 있을 때 window 단축키(useKeyboardShortcuts)까지
        // 전파돼 태스크 선택이 같이 해제되는 이중발화를 막는다.
        e.stopPropagation()
        toggleSettings()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [showSettings, toggleSettings])

  if (!showSettings) return null

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
    // biome-ignore lint/a11y/noStaticElementInteractions: 모달 배경 — 클릭/키보드 모두 지원
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={toggleSettings}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          toggleSettings()
        }
      }}
    >
      {/* 모달 콘텐츠: 클릭/키보드 전파 차단 (role=dialog).
          헤더는 고정하고 본문만 스크롤한다. 이전에는 카드 전체가 스크롤 컨테이너라
          내용이 뷰포트의 ~2.8배인 이 패널에서 아래로 내려가면 닫기 버튼이 사라졌다. */}
      <div
        className={`flex w-[480px] max-h-[80vh] flex-col overflow-hidden rounded-xl shadow-2xl ${isDark ? 'bg-[#2C2C2E] text-gray-100' : 'bg-white text-gray-800'}`}
        role="dialog"
        aria-modal="true"
        aria-label="설정"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div
          className={`flex shrink-0 items-center justify-between px-5 py-4 border-b ${dividerLine(isDark)}`}
        >
          <h2 className="text-base font-semibold">설정</h2>
          <button
            type="button"
            onClick={toggleSettings}
            aria-label="설정 닫기"
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
            <SectionHeading isDark={isDark} label="테마" />
            <fieldset className={`inline-flex rounded-lg p-0.5 ${isDark ? 'bg-black/20' : 'bg-gray-100'}`}>
              <legend className="sr-only">테마</legend>
              {THEMES.map(({ value, label }) => (
                <label key={value} className={segment(theme === value)}>
                  <input
                    type="radio"
                    name="theme"
                    value={value}
                    checked={theme === value}
                    onChange={() => setTheme(value)}
                    className="sr-only peer"
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          </div>

          {/* 데이터 */}
          <div className={`border-t pt-4 ${dividerLine(isDark)}`}>
            <SectionHeading isDark={isDark} label="데이터" />
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
                <div className="text-sm font-medium">데이터 내보내기</div>
                <div className={`text-xs ${labelText(isDark)}`}>
                  JSON 또는 CSV로 백업
                </div>
              </div>
            </button>
          </div>

          {/* AI 설정 */}
          <div className={`border-t pt-4 ${dividerLine(isDark)}`}>
            <SectionHeading isDark={isDark} label="AI 어시스턴트">
              {aiConnected === true && <Wifi size={14} className={successText(isDark)} />}
              {aiConnected === false && <WifiOff size={14} className={errorText(isDark)} />}
            </SectionHeading>
            <div className="space-y-3">
              <div>
                <label
                  htmlFor="ai-provider"
                  className={`text-xs ${labelText(isDark)}`}
                >
                  AI 제공자
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
                  <option value="ollama">Ollama (로컬)</option>
                  <option value="openai" disabled={aiLocalOnly}>
                    OpenAI{aiLocalOnly ? ' (로컬 전용 잠금됨)' : ''}
                  </option>
                  <option value="custom" disabled={aiLocalOnly}>
                    커스텀 API{aiLocalOnly ? ' (로컬 전용 잠금됨)' : ''}
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
                    이 제공자를 사용하면 <b>대화·할일 내용이 외부 서버로 전송</b>됩니다. 프라이버시가 중요하면
                    Ollama(로컬)를 사용하세요.
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
                    <Lock size={13} /> 로컬 전용
                  </span>
                  <span className={`block text-xs mt-0.5 ${hintText(isDark)}`}>
                    외부 AI 제공자를 차단해 데이터가 기기를 벗어나지 않습니다.
                  </span>
                </span>
              </label>
              <div>
                <label
                  htmlFor="ai-base-url"
                  className={`text-xs ${labelText(isDark)}`}
                >
                  API URL
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
                  모델
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
                        <option value={aiModel}>{aiModel} (미설치)</option>
                      )}
                      {aiModels.map((m) => (
                        <option key={m} value={m}>
                          {isKoreanRecommendedModel(m) ? `${m} · 한국어 추천` : m}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={aiCheckConnection}
                      title="모델 목록 새로고침"
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
                  <label
                    htmlFor="ai-api-key"
                    className={`text-xs ${labelText(isDark)}`}
                  >
                    API 키
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
                <label
                  htmlFor="ai-max-history"
                  className={`text-xs ${labelText(isDark)}`}
                >
                  채팅 기록 보관 개수
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
                <p className={`text-xs mt-1 ${hintText(isDark)}`}>
                  오래된 메시지부터 자동 삭제됩니다. 0이면 보관 안 함.
                </p>
              </div>
              <button
                type="button"
                onClick={handleAiSave}
                className={`w-full px-3 py-2 rounded-lg text-sm bg-primary-700 text-white hover:bg-primary-800 transition-colors ${focusRing(isDark)}`}
              >
                저장 및 연결 테스트
              </button>
              {aiConnected === true && <p className={`text-xs ${successText(isDark)}`}>AI 어시스턴트에 연결되었습니다</p>}
              {aiConnected === false && (
                <p className={`text-xs ${errorText(isDark)}`}>
                  연결 실패 — {aiProvider === 'ollama' ? 'Ollama 실행 상태를 확인하세요' : 'API URL과 키를 확인하세요'}
                </p>
              )}
            </div>
          </div>

          {/* 키보드 단축키 */}
          <div className={`border-t pt-4 ${dividerLine(isDark)}`}>
            <SectionHeading isDark={isDark} label="키보드 단축키" />
            <div className="space-y-1.5">
              {SHORTCUTS.map((s) => (
                <div key={s.keys} className="flex items-center justify-between">
                  <span className={`text-xs ${labelText(isDark)}`}>{s.desc}</span>
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
            <SectionHeading isDark={isDark} label="버전 정보" />
            <div className={`rounded-lg px-4 py-3 mb-3 ${isDark ? 'bg-gray-700/50' : 'bg-gray-100'}`}>
              <div className={`text-sm font-medium mb-1 ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
                haru v{__APP_VERSION__}
              </div>
              {isMas ? (
                // App Store 빌드: 앱 내 업데이트 확인/다운로드는 비활성(App Store가 담당)
                <div className="flex items-center gap-1.5 mt-1">
                  <CheckCircle2 size={13} className={successText(isDark)} />
                  <span className={`text-xs ${labelText(isDark)}`}>
                    Mac App Store를 통해 자동으로 업데이트됩니다
                  </span>
                </div>
              ) : updateChecked && !updateAvailable ? (
                <div className="flex items-center gap-1.5 mt-1">
                  <CheckCircle2 size={13} className={successText(isDark)} />
                  <span className={`text-xs ${successText(isDark)}`}>최신 버전입니다</span>
                </div>
              ) : !updateChecked ? (
                <div className="flex items-center gap-1.5 mt-1">
                  <span className={`text-xs ${hintText(isDark)}`}>
                    업데이트 확인 중…
                  </span>
                </div>
              ) : null}
            </div>
            {!isMas && updateAvailable && (
              <button
                type="button"
                onClick={() => window.api.openExternal(updateAvailable.downloadUrl)}
                className={`flex items-center gap-3 w-full px-4 py-3 rounded-lg transition-colors ${focusRing(isDark)} ${
                  isDark
                    ? 'bg-primary-500/20 hover:bg-primary-500/30 text-primary-200'
                    : 'bg-primary-50 hover:bg-primary-100 text-primary-800'
                }`}
              >
                <ArrowUpCircle size={18} />
                <div className="text-left flex-1">
                  <div className="text-sm font-medium">새 버전 사용 가능</div>
                  <div className={`text-xs ${isDark ? 'text-primary-300' : 'text-primary-700'}`}>
                    haru v{updateAvailable.version} — 클릭하여 다운로드 페이지 열기
                  </div>
                </div>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
