import { useState, useEffect } from 'react'
import {
  Moon,
  Sun,
  X,
  Keyboard,
  ArrowUpCircle,
  CheckCircle2,
  Bot,
  Wifi,
  WifiOff,
  Download,
  Loader2,
  RefreshCw
} from 'lucide-react'
import { useStore } from '../../store/useStore'
import { isKoreanRecommendedModel, hasKoreanRecommendedModel } from '../../utils/aiModels'

const SHORTCUTS = [
  { keys: 'Cmd+N', desc: '할 일 추가' },
  { keys: 'Cmd+Shift+A', desc: '빠른 추가' },
  { keys: 'Cmd+F', desc: '검색' },
  { keys: 'Cmd+Z', desc: '되돌리기' },
  { keys: 'Cmd+E', desc: '데이터 내보내기' },
  { keys: 'Cmd+D', desc: '오늘 마감일 설정' },
  { keys: 'Delete', desc: '선택 태스크 삭제' },
  { keys: '1-4', desc: '우선순위 변경 (없음~높음)' },
  { keys: 'Esc', desc: '선택 해제 / 닫기' }
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
const fieldSurface = (isDark: boolean) => (isDark ? 'bg-gray-700 text-gray-100' : 'bg-gray-100 text-gray-800')
const successText = (isDark: boolean) => (isDark ? 'text-green-400' : 'text-green-700')
const errorText = (isDark: boolean) => (isDark ? 'text-red-400' : 'text-red-600')

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
      <p>한국어 답변 품질은 8B 이상 모델을 권장합니다.</p>

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
          <p>한국어 특화 모델(EXAONE)이 더 정확합니다.</p>
          <button
            type="button"
            onClick={onInstall}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary-500 text-white hover:bg-primary-600"
          >
            <Download size={12} /> 한국어 모델 설치 (exaone3.5)
          </button>
          {aiPull?.error && <p className={errorText(isDark)}>설치 실패: {aiPull.error}</p>}
        </div>
      )}

      {manualOnly && (
        <p>
          한국어 특화 모델(EXAONE, EEVE)이 더 정확합니다. Ollama 실행 후 설치 —{' '}
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
      {/* 모달 콘텐츠: 클릭/키보드 전파 차단 (role=dialog) */}
      <div
        className={`w-[480px] max-h-[80vh] overflow-y-auto rounded-xl shadow-2xl ${theme === 'dark' ? 'bg-[#2C2C2E] text-gray-100' : 'bg-white text-gray-800'}`}
        role="dialog"
        aria-modal="true"
        aria-label="설정"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div
          className={`flex items-center justify-between px-5 py-4 border-b ${dividerLine(isDark)}`}
        >
          <h2 className="text-base font-semibold">설정</h2>
          <button
            type="button"
            onClick={toggleSettings}
            className="text-gray-500 hover:text-gray-300 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* 테마 */}
          <div>
            <h3 className={`text-sm font-medium mb-3 ${headingText(isDark)}`}>테마</h3>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setTheme('dark')}
                className={`flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                  theme === 'dark' ? 'border-primary-500 bg-primary-500/10' : 'border-gray-300 hover:border-gray-400'
                }`}
              >
                <div className="w-16 h-10 rounded-lg bg-[#1C1C1E] border border-gray-600 flex items-center justify-center">
                  <Moon size={16} className="text-gray-400" />
                </div>
                <span className={`text-xs font-medium ${theme === 'dark' ? 'text-primary-400' : 'text-gray-500'}`}>
                  다크 모드
                </span>
              </button>
              <button
                type="button"
                onClick={() => setTheme('light')}
                className={`flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                  theme === 'light'
                    ? 'border-primary-500 bg-primary-500/10'
                    : theme === 'dark'
                      ? 'border-gray-600 hover:border-gray-500'
                      : 'border-gray-300 hover:border-gray-400'
                }`}
              >
                <div className="w-16 h-10 rounded-lg bg-white border border-gray-300 flex items-center justify-center">
                  <Sun size={16} className="text-yellow-500" />
                </div>
                <span
                  className={`text-xs font-medium ${theme === 'light' ? 'text-primary-500' : labelText(isDark)}`}
                >
                  라이트 모드
                </span>
              </button>
            </div>
          </div>

          {/* 데이터 */}
          <div className={`border-t pt-4 ${dividerLine(isDark)}`}>
            <h3 className={`text-sm font-medium mb-3 ${headingText(isDark)}`}>
              데이터
            </h3>
            <button
              type="button"
              onClick={() => {
                exportData()
                toggleSettings()
              }}
              className={`flex items-center gap-3 w-full px-4 py-3 rounded-lg transition-colors ${
                theme === 'dark'
                  ? 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
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
            <h3
              className={`flex items-center gap-2 text-sm font-medium mb-3 ${headingText(isDark)}`}
            >
              <Bot size={16} className="text-blue-500" /> AI 어시스턴트
              {aiConnected === true && <Wifi size={14} className={successText(isDark)} />}
              {aiConnected === false && <WifiOff size={14} className={errorText(isDark)} />}
            </h3>
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
                  <span>⚠️</span>
                  <span>
                    이 제공자를 사용하면 <b>대화·할일 내용이 외부 서버로 전송</b>됩니다. 프라이버시가 중요하면
                    Ollama(로컬)를 사용하세요.
                  </span>
                </div>
              )}

              {/* 로컬 전용 잠금 (프라이버시 모드) */}
              <label className="flex items-start gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={aiLocalOnly} onChange={toggleLocalOnly} className="mt-0.5" />
                <span>
                  <span className={`text-sm ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
                    🔒 로컬 전용 (외부 AI 차단)
                  </span>
                  <span className={`block text-xs mt-0.5 ${hintText(isDark)}`}>
                    켜면 외부 제공자를 선택할 수 없어, 데이터가 절대 기기를 벗어나지 않습니다.
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
                      className={`px-2.5 rounded-lg ${theme === 'dark' ? 'bg-gray-700 text-gray-400 hover:text-gray-200' : 'bg-gray-100 text-gray-500 hover:text-gray-700'}`}
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
                    isDark={theme === 'dark'}
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
                className="w-full px-3 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                저장 및 연결 테스트
              </button>
              {aiConnected === true && <p className={`text-xs ${successText(isDark)}`}>AI 서비스에 연결되었습니다</p>}
              {aiConnected === false && (
                <p className={`text-xs ${errorText(isDark)}`}>
                  연결 실패 — {aiProvider === 'ollama' ? 'Ollama 실행 상태를 확인하세요' : 'API URL과 키를 확인하세요'}
                </p>
              )}
            </div>
          </div>

          {/* 키보드 단축키 */}
          <div className={`border-t pt-4 ${dividerLine(isDark)}`}>
            <h3
              className={`flex items-center gap-2 text-sm font-medium mb-3 ${headingText(isDark)}`}
            >
              <Keyboard size={16} /> 키보드 단축키
            </h3>
            <div className="space-y-1.5">
              {SHORTCUTS.map((s) => (
                <div key={s.keys} className="flex items-center justify-between">
                  <span className={`text-xs ${labelText(isDark)}`}>{s.desc}</span>
                  <kbd
                    className={`text-xs px-2 py-0.5 rounded font-mono ${
                      theme === 'dark' ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'
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
            <h3 className={`text-sm font-medium mb-3 ${headingText(isDark)}`}>
              버전 정보
            </h3>
            <div className={`rounded-lg px-4 py-3 mb-3 ${theme === 'dark' ? 'bg-gray-700/50' : 'bg-gray-100'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
                  haru v{__APP_VERSION__}
                </span>
                <span className={`text-xs ${hintText(isDark)}`}>
                  Electron + React
                </span>
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
                    업데이트 확인 중...
                  </span>
                </div>
              ) : null}
            </div>
            {!isMas && updateAvailable && (
              <button
                type="button"
                onClick={() => window.api.openExternal(updateAvailable.downloadUrl)}
                className={`flex items-center gap-3 w-full px-4 py-3 rounded-lg transition-colors ${
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
