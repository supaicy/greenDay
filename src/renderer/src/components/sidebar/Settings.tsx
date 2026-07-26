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
    aiLoadConfig,
    aiCheckConnection,
    aiSaveConfig
  } = useStore()

  const [aiBaseUrl, setAiBaseUrl] = useState('')
  const [aiModel, setAiModel] = useState('')
  const [aiApiKey, setAiApiKey] = useState('')
  const [aiProvider, setAiProvider] = useState<'ollama' | 'openai' | 'custom'>('ollama')
  const [aiMaxHistory, setAiMaxHistory] = useState(200)
  const [aiLocalOnly, setAiLocalOnly] = useState(false)

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
          className={`flex items-center justify-between px-5 py-4 border-b ${theme === 'dark' ? 'border-gray-700' : 'border-gray-200'}`}
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
            <h3 className={`text-sm font-medium mb-3 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>테마</h3>
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
                  className={`text-xs font-medium ${theme === 'light' ? 'text-primary-500' : theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}
                >
                  라이트 모드
                </span>
              </button>
            </div>
          </div>

          {/* 데이터 */}
          <div className={`border-t pt-4 ${theme === 'dark' ? 'border-gray-700' : 'border-gray-200'}`}>
            <h3 className={`text-sm font-medium mb-3 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
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
                <div className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                  JSON 또는 CSV로 백업
                </div>
              </div>
            </button>
          </div>

          {/* AI 설정 */}
          <div className={`border-t pt-4 ${theme === 'dark' ? 'border-gray-700' : 'border-gray-200'}`}>
            <h3
              className={`flex items-center gap-2 text-sm font-medium mb-3 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}
            >
              <Bot size={16} className="text-blue-500" /> AI 어시스턴트
              {aiConnected === true && <Wifi size={14} className="text-green-500" />}
              {aiConnected === false && <WifiOff size={14} className="text-red-500" />}
            </h3>
            <div className="space-y-3">
              <div>
                <label
                  htmlFor="ai-provider"
                  className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}
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
                  className={`w-full mt-1 px-3 py-2 rounded-lg text-sm ${theme === 'dark' ? 'bg-gray-700 text-gray-200' : 'bg-gray-100 text-gray-700'}`}
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
                <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs bg-amber-500/10 text-amber-700 border border-amber-500/30">
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
                  <span className={`text-sm ${theme === 'dark' ? 'text-gray-200' : 'text-gray-700'}`}>
                    🔒 로컬 전용 (외부 AI 차단)
                  </span>
                  <span className={`block text-xs mt-0.5 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
                    켜면 외부 제공자를 선택할 수 없어, 데이터가 절대 기기를 벗어나지 않습니다.
                  </span>
                </span>
              </label>
              <div>
                <label
                  htmlFor="ai-base-url"
                  className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}
                >
                  API URL
                </label>
                <input
                  id="ai-base-url"
                  type="text"
                  value={aiBaseUrl}
                  onChange={(e) => setAiBaseUrl(e.target.value)}
                  className={`w-full mt-1 px-3 py-2 rounded-lg text-sm ${theme === 'dark' ? 'bg-gray-700 text-gray-200' : 'bg-gray-100 text-gray-700'}`}
                />
              </div>
              <div>
                <label htmlFor="ai-model" className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                  모델
                </label>
                {aiProvider === 'ollama' && aiModels.length > 0 ? (
                  // Ollama: 설치된 모델을 드롭다운으로. 저장값이 목록에 없으면 맨 위에 표시.
                  <div className="flex gap-2 mt-1">
                    <select
                      id="ai-model"
                      value={aiModel}
                      onChange={(e) => setAiModel(e.target.value)}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm ${theme === 'dark' ? 'bg-gray-700 text-gray-200' : 'bg-gray-100 text-gray-700'}`}
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
                    className={`w-full mt-1 px-3 py-2 rounded-lg text-sm ${theme === 'dark' ? 'bg-gray-700 text-gray-200' : 'bg-gray-100 text-gray-700'}`}
                  />
                )}
                {aiProvider === 'ollama' && (
                  <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
                    한국어 답변 품질은 8B 이상 모델을 권장합니다.
                    {!hasKoreanRecommendedModel(aiModels) && (
                      <>
                        {' '}
                        한국어 특화 모델(EXAONE, EEVE)이 더 정확합니다 —{' '}
                        <code className={theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}>ollama pull exaone3.5</code>
                      </>
                    )}
                  </p>
                )}
              </div>
              {aiProvider !== 'ollama' && (
                <div>
                  <label
                    htmlFor="ai-api-key"
                    className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}
                  >
                    API 키
                  </label>
                  <input
                    id="ai-api-key"
                    type="password"
                    value={aiApiKey}
                    onChange={(e) => setAiApiKey(e.target.value)}
                    placeholder="sk-..."
                    className={`w-full mt-1 px-3 py-2 rounded-lg text-sm ${theme === 'dark' ? 'bg-gray-700 text-gray-200' : 'bg-gray-100 text-gray-700'}`}
                  />
                </div>
              )}
              <div>
                <label
                  htmlFor="ai-max-history"
                  className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}
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
                  className={`w-full mt-1 px-3 py-2 rounded-lg text-sm ${theme === 'dark' ? 'bg-gray-700 text-gray-200' : 'bg-gray-100 text-gray-700'}`}
                />
                <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
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
              {aiConnected === true && <p className="text-xs text-green-500">AI 서비스에 연결되었습니다</p>}
              {aiConnected === false && (
                <p className="text-xs text-red-500">
                  연결 실패 — {aiProvider === 'ollama' ? 'Ollama 실행 상태를 확인하세요' : 'API URL과 키를 확인하세요'}
                </p>
              )}
            </div>
          </div>

          {/* 키보드 단축키 */}
          <div className={`border-t pt-4 ${theme === 'dark' ? 'border-gray-700' : 'border-gray-200'}`}>
            <h3
              className={`flex items-center gap-2 text-sm font-medium mb-3 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}
            >
              <Keyboard size={16} /> 키보드 단축키
            </h3>
            <div className="space-y-1.5">
              {SHORTCUTS.map((s) => (
                <div key={s.keys} className="flex items-center justify-between">
                  <span className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>{s.desc}</span>
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
          <div className={`border-t pt-4 ${theme === 'dark' ? 'border-gray-700' : 'border-gray-200'}`}>
            <h3 className={`text-sm font-medium mb-3 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
              버전 정보
            </h3>
            <div className={`rounded-lg px-4 py-3 mb-3 ${theme === 'dark' ? 'bg-gray-700/50' : 'bg-gray-100'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-sm font-medium ${theme === 'dark' ? 'text-gray-200' : 'text-gray-700'}`}>
                  haru v{__APP_VERSION__}
                </span>
                <span className={`text-xs ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
                  Electron + React
                </span>
              </div>
              {updateChecked && !updateAvailable && (
                <div className="flex items-center gap-1.5 mt-1">
                  <CheckCircle2 size={13} className="text-green-500" />
                  <span className={`text-xs ${theme === 'dark' ? 'text-green-400' : 'text-green-600'}`}>
                    최신 버전입니다
                  </span>
                </div>
              )}
              {!updateChecked && (
                <div className="flex items-center gap-1.5 mt-1">
                  <span className={`text-xs ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
                    업데이트 확인 중...
                  </span>
                </div>
              )}
            </div>
            {updateAvailable && (
              <button
                type="button"
                onClick={() => window.api.openExternal(updateAvailable.downloadUrl)}
                className={`flex items-center gap-3 w-full px-4 py-3 rounded-lg transition-colors ${
                  theme === 'dark'
                    ? 'bg-primary-500/20 hover:bg-primary-500/30 text-primary-300'
                    : 'bg-primary-50 hover:bg-primary-100 text-primary-600'
                }`}
              >
                <ArrowUpCircle size={18} />
                <div className="text-left flex-1">
                  <div className="text-sm font-medium">새 버전 사용 가능</div>
                  <div className={`text-xs ${theme === 'dark' ? 'text-primary-400' : 'text-primary-500'}`}>
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
