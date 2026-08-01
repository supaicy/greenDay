import { useState, useRef, useEffect, useMemo } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import {
  Bot,
  Send,
  X,
  Trash2,
  Loader2,
  WifiOff,
  ListPlus,
  Check,
  ShieldCheck,
  Cloud,
  Database,
  ChevronDown,
  ChevronRight
} from 'lucide-react'
import { shouldSendOnEnter, isNearBottom } from '../../utils/chatInput'
import { aiDestination } from '../../../../shared/ai-config'
import { buildAiTaskContext } from '../../utils/aiContext'
import { actionOpLabel } from '../../utils/aiActions'

export function AiChatPanel() {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  // 채팅 메시지 → 할일 추가 상태 (메시지 id별)
  const [taskAdds, setTaskAdds] = useState<Record<string, 'adding' | 'added' | 'error'>>({})
  // 전송 데이터 미리보기(투명성) 펼침 여부
  const [showContext, setShowContext] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // 바닥 근처면 새 메시지/토큰마다 자동으로 따라 내려간다. 사용자가 위로
  // 스크롤해 읽는 중이면 false가 되어 자동 스크롤을 멈춘다.
  const stickToBottomRef = useRef(true)

  const theme = useStore((s) => s.theme)
  const showAiChat = useStore((s) => s.showAiChat)
  const setShowAiChat = useStore((s) => s.setShowAiChat)
  const aiMessages = useStore((s) => s.aiMessages)
  const aiLoading = useStore((s) => s.aiLoading)
  const aiConnected = useStore((s) => s.aiConnected)
  const aiConfig = useStore((s) => s.aiConfig)
  const aiSubmit = useStore((s) => s.aiSubmit)
  const aiClearMessages = useStore((s) => s.aiClearMessages)
  const aiCheckConnection = useStore((s) => s.aiCheckConnection)
  const aiLoadConfig = useStore((s) => s.aiLoadConfig)
  const aiWarmup = useStore((s) => s.aiWarmup)
  const aiAddTaskFromText = useStore((s) => s.aiAddTaskFromText)
  const tasks = useStore((s) => s.tasks)
  const aiPendingAction = useStore((s) => s.aiPendingAction)
  const aiConfirmAction = useStore((s) => s.aiConfirmAction)
  const aiCancelAction = useStore((s) => s.aiCancelAction)

  const isDark = theme === 'dark'
  // 모델에 실제로 전송되는 태스크 컨텍스트(스토어 전송 경로와 동일한 buildAiTaskContext).
  // 사용자가 무엇이 기기를 떠나는지 직접 확인할 수 있게 투명하게 노출한다.
  // 패널이 닫혀 있으면(항상 마운트됨) 계산하지 않아 태스크 변경마다의 낭비를 막는다.
  const sentContext = useMemo(() => (showAiChat ? buildAiTaskContext(tasks) : []), [showAiChat, tasks])
  // 이그레스 가시성: 배지에 표시할 호출 목적지(host/로컬 여부).
  const dest = aiConfig ? aiDestination(aiConfig) : null

  const handleAddTask = async (id: string, content: string) => {
    setTaskAdds((s) => ({ ...s, [id]: 'adding' }))
    const title = await aiAddTaskFromText(content)
    setTaskAdds((s) => ({ ...s, [id]: title ? 'added' : 'error' }))
  }

  useEffect(() => {
    if (showAiChat && aiConnected === null) {
      aiCheckConnection()
    }
  }, [showAiChat, aiConnected, aiCheckConnection])

  // 온디바이스 배지 판정에 aiConfig(provider/baseUrl)가 필요하므로 패널 열 때 로드
  useEffect(() => {
    if (showAiChat && !aiConfig) aiLoadConfig()
  }, [showAiChat, aiConfig, aiLoadConfig])

  // 패널을 열면 로컬 모델을 미리 로드(warmup)해 첫 메시지의 콜드 지연을 없앤다.
  useEffect(() => {
    if (showAiChat) aiWarmup()
  }, [showAiChat, aiWarmup])

  // 새 메시지가 추가되거나 스트리밍 토큰이 들어올 때(aiMessages 변경)마다,
  // 바닥을 따라가는 중이면 맨 아래로 스크롤한다. 스트리밍은 초당 여러 토큰이라
  // 'smooth'는 애니메이션이 겹치며 onScroll을 중간 위치로 발생시켜 추적이 풀린다.
  // 'auto'(즉시)로 바닥에 딱 붙여, 실제 사용자 스크롤에만 추적이 해제되게 한다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: aiMessages 변경(토큰 포함) 시마다 재실행이 목적
  useEffect(() => {
    if (stickToBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
    }
  }, [aiMessages])

  const handleScroll = () => {
    const el = messagesContainerRef.current
    if (el) stickToBottomRef.current = isNearBottom(el.scrollHeight, el.scrollTop, el.clientHeight)
  }

  useEffect(() => {
    if (showAiChat) inputRef.current?.focus()
  }, [showAiChat])

  if (!showAiChat) return null

  const handleSend = () => {
    const trimmed = input.trim()
    if (!trimmed || aiLoading) return
    setInput('')
    stickToBottomRef.current = true // 전송하면 다시 바닥을 따라간다
    // 액션 라우팅(액션 해석 vs 일반 채팅)은 store의 aiSubmit이 판단한다.
    aiSubmit(trimmed)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // IME 조합 중(한글 마지막 글자 조합)에는 전송하지 않는다. 조합 중 전송하면
    // 입력창을 비운 뒤 확정된 글자가 다시 들어가 "마지막 글자가 남는" 현상이 생김.
    if (shouldSendOnEnter(e)) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div
      className={`flex flex-col w-80 border-l ${isDark ? 'bg-[#2C2C2E] border-gray-700' : 'bg-gray-50 border-gray-200'}`}
    >
      {/* Header */}
      <div
        className={`flex items-center justify-between px-4 py-3 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}
      >
        <div className="flex items-center gap-2">
          <Bot size={18} className="text-blue-500" />
          <span className="font-medium text-sm">{t('ai.title')}</span>
          {aiConnected === true && <span className="w-2 h-2 rounded-full bg-green-500" title={t('ai.connected')} />}
          {aiConnected === false && <span className="w-2 h-2 rounded-full bg-red-500" title={t('ai.disconnected')} />}
          {dest && (
            <span
              title={
                dest.isLocal
                  ? t('ai.destLocal', { host: dest.host })
                  : t('ai.destExternal', { host: dest.host })
              }
              className={`flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                dest.isLocal ? 'bg-green-500/15 text-green-600' : 'bg-amber-500/15 text-amber-600'
              }`}
            >
              {dest.isLocal ? <ShieldCheck size={11} /> : <Cloud size={11} />}{' '}
              {dest.isLocal ? t('ai.onDevice') : t('ai.external', { host: dest.host })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {aiMessages.length > 0 && (
            <button
              type="button"
              onClick={aiClearMessages}
              className={`p-1 rounded hover:${isDark ? 'bg-gray-600' : 'bg-gray-200'}`}
              title={t('ai.clearChat')}
            >
              <Trash2 size={14} className="opacity-50" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowAiChat(false)}
            className={`p-1 rounded hover:${isDark ? 'bg-gray-600' : 'bg-gray-200'}`}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* 전송 데이터 미리보기(투명성) — 모델에 나가는 태스크 컨텍스트를 그대로 노출 */}
      <div className={`border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
        <button
          type="button"
          onClick={() => setShowContext((v) => !v)}
          className={`flex items-center gap-1.5 w-full px-4 py-1.5 text-[11px] ${isDark ? 'text-gray-400 hover:bg-gray-700/40' : 'text-gray-500 hover:bg-gray-200/60'}`}
          title={t('ai.contextTitle')}
        >
          {showContext ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Database size={11} />
          {t('ai.contextToggle', { n: sentContext.length })}
        </button>
        {showContext && (
          <div className={`max-h-40 overflow-y-auto px-4 pb-2 text-[11px] ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            <p className="mb-1 opacity-70">{t('ai.contextDesc')}</p>
            {sentContext.length === 0 ? (
              <p className="opacity-70">{t('ai.contextEmpty')}</p>
            ) : (
              <ul className="space-y-0.5">
                {sentContext.map((c, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: 읽기 전용 미리보기 목록 — 행별 state가 없고 제목 중복 가능해 index가 안정적
                  <li key={`${c.title}-${i}`} className="flex items-start gap-1">
                    <span className={c.completed ? 'line-through opacity-50' : ''}>{c.title || t('ai.untitled')}</span>
                    {c.dueDate && <span className="opacity-60">· {c.dueDate}</span>}
                    {c.priority !== 'none' && <span className="opacity-60">· {c.priority}</span>}
                    {c.tags.length > 0 && <span className="opacity-60">· #{c.tags.join(' #')}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Messages */}
      <div ref={messagesContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {aiConnected === false && (
          <div
            className={`flex flex-col items-center gap-2 py-8 text-center ${isDark ? 'text-gray-400' : 'text-gray-500'}`}
          >
            <WifiOff size={32} className="opacity-50" />
            <p className="text-sm font-medium">{t('ai.unreachable')}</p>
            <p className="text-xs opacity-70">
              {aiConfig?.provider === 'ollama' ? (
                <>
                  {t('ai.checkOllama')}
                  <br />
                  {t('ai.install')} <span className="text-blue-400">ollama.com</span>
                </>
              ) : (
                t('ai.checkApiSettings')
              )}
            </p>
            <button type="button" onClick={aiCheckConnection} className="mt-2 text-xs text-blue-500 hover:underline">
              {t('ai.reconnect')}
            </button>
          </div>
        )}

        {aiConnected !== false && aiMessages.length === 0 && (
          <div
            className={`flex flex-col items-center gap-3 py-8 text-center ${isDark ? 'text-gray-400' : 'text-gray-500'}`}
          >
            <Bot size={40} className="opacity-30" />
            <p className="text-sm">{t('ai.askAnything')}</p>
            <div className="space-y-1">
              {[t('ai.suggestion1'), t('ai.suggestion2'), t('ai.suggestion3')].map((q) => (
                <button
                  type="button"
                  key={q}
                  onClick={() => {
                    setInput(q)
                    inputRef.current?.focus()
                  }}
                  className={`block w-full text-left text-xs px-3 py-1.5 rounded ${isDark ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}`}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {aiMessages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`max-w-[85%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : isDark
                    ? 'bg-gray-700 text-gray-100'
                    : 'bg-gray-200 text-gray-800'
              }`}
            >
              {msg.content ||
                (aiLoading && msg.role === 'assistant' ? <Loader2 size={14} className="animate-spin" /> : null)}
            </div>
            {/* 사용자 메시지를 할일로 추가 (안전한 추가 액션) */}
            {msg.role === 'user' && msg.content && aiConnected !== false && (
              <div className="mt-1">
                {taskAdds[msg.id] === 'added' ? (
                  <span className="flex items-center gap-1 text-[11px] text-green-500">
                    <Check size={11} /> {t('ai.taskAdded')}
                  </span>
                ) : taskAdds[msg.id] === 'error' ? (
                  <button
                    type="button"
                    onClick={() => handleAddTask(msg.id, msg.content)}
                    className="flex items-center gap-1 text-[11px] text-red-400 hover:text-red-300"
                  >
                    <ListPlus size={11} /> {t('ai.taskAddFailed')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleAddTask(msg.id, msg.content)}
                    disabled={taskAdds[msg.id] === 'adding'}
                    className={`flex items-center gap-1 text-[11px] transition-colors ${isDark ? 'text-gray-500 hover:text-blue-400' : 'text-gray-400 hover:text-blue-500'}`}
                  >
                    {taskAdds[msg.id] === 'adding' ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <ListPlus size={11} />
                    )}
                    {t('ai.addAsTask')}
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* 기존 할일 액션 확인 카드 (파괴적 액션 안전장치) — 확인해야만 실행 */}
      {aiPendingAction && (
        <div className={`mx-3 mb-2 rounded-lg border p-3 ${isDark ? 'border-amber-500/30 bg-amber-500/10' : 'border-amber-300 bg-amber-50'}`}>
          <p className={`text-xs ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
            <Trans
              i18nKey="ai.confirmAction"
              values={{ action: actionOpLabel(aiPendingAction.op, aiPendingAction.dueDate) }}
            />
          </p>
          <p className={`text-sm font-medium mt-0.5 truncate ${isDark ? 'text-gray-100' : 'text-gray-800'}`}>
            “{aiPendingAction.taskTitle}”
          </p>
          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              onClick={aiConfirmAction}
              className={`flex items-center gap-1 text-xs px-3 py-1 rounded-md text-white ${
                aiPendingAction.op === 'delete' ? 'bg-red-600 hover:bg-red-700' : 'bg-primary-500 hover:bg-primary-600'
              }`}
            >
              <Check size={12} /> {t('common.confirm')}
            </button>
            <button
              type="button"
              onClick={aiCancelAction}
              className={`text-xs px-3 py-1 rounded-md ${isDark ? 'bg-gray-700 hover:bg-gray-600 text-gray-300' : 'bg-gray-200 hover:bg-gray-300 text-gray-600'}`}
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className={`px-3 py-2 border-t ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`}>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('ai.inputPlaceholder')}
            disabled={aiConnected === false}
            className={`flex-1 bg-transparent text-sm outline-none placeholder-gray-500 ${isDark ? 'text-white' : 'text-gray-800'}`}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim() || aiLoading || aiConnected === false}
            className={`p-1 rounded ${input.trim() && !aiLoading ? 'text-blue-500 hover:bg-blue-500/20' : 'text-gray-500 opacity-50'}`}
          >
            {aiLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
      </div>
    </div>
  )
}
