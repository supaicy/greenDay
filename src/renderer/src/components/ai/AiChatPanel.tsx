import { useState, useRef, useEffect } from 'react'
import { useStore } from '../../store/useStore'
import { Bot, Send, X, Trash2, Loader2, WifiOff, ListPlus, Check } from 'lucide-react'
import { shouldSendOnEnter, isNearBottom } from '../../utils/chatInput'

export function AiChatPanel() {
  const [input, setInput] = useState('')
  // 채팅 메시지 → 할일 추가 상태 (메시지 id별)
  const [taskAdds, setTaskAdds] = useState<Record<string, 'adding' | 'added' | 'error'>>({})
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
  const aiSendMessage = useStore((s) => s.aiSendMessage)
  const aiClearMessages = useStore((s) => s.aiClearMessages)
  const aiCheckConnection = useStore((s) => s.aiCheckConnection)
  const aiAddTaskFromText = useStore((s) => s.aiAddTaskFromText)

  const isDark = theme === 'dark'

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
    aiSendMessage(trimmed)
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
          <span className="font-medium text-sm">AI 어시스턴트</span>
          {aiConnected === true && <span className="w-2 h-2 rounded-full bg-green-500" title="연결됨" />}
          {aiConnected === false && <span className="w-2 h-2 rounded-full bg-red-500" title="연결 안 됨" />}
        </div>
        <div className="flex items-center gap-1">
          {aiMessages.length > 0 && (
            <button
              type="button"
              onClick={aiClearMessages}
              className={`p-1 rounded hover:${isDark ? 'bg-gray-600' : 'bg-gray-200'}`}
              title="대화 지우기"
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

      {/* Messages */}
      <div ref={messagesContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {aiConnected === false && (
          <div
            className={`flex flex-col items-center gap-2 py-8 text-center ${isDark ? 'text-gray-400' : 'text-gray-500'}`}
          >
            <WifiOff size={32} className="opacity-50" />
            <p className="text-sm font-medium">AI 서비스에 연결할 수 없습니다</p>
            <p className="text-xs opacity-70">
              {aiConfig?.provider === 'ollama' ? (
                <>
                  Ollama가 실행 중인지 확인하세요.
                  <br />
                  설치: <span className="text-blue-400">ollama.com</span>
                </>
              ) : (
                '설정에서 API URL과 키를 확인하세요.'
              )}
            </p>
            <button type="button" onClick={aiCheckConnection} className="mt-2 text-xs text-blue-500 hover:underline">
              다시 연결 시도
            </button>
          </div>
        )}

        {aiConnected !== false && aiMessages.length === 0 && (
          <div
            className={`flex flex-col items-center gap-3 py-8 text-center ${isDark ? 'text-gray-400' : 'text-gray-500'}`}
          >
            <Bot size={40} className="opacity-30" />
            <p className="text-sm">무엇이든 물어보세요</p>
            <div className="space-y-1">
              {['이번 주에 뭐 해야 하지?', '가장 급한 거 3개 알려줘', '오늘 뭘 완료했지?'].map((q) => (
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
                    <Check size={11} /> 할일 추가됨
                  </span>
                ) : taskAdds[msg.id] === 'error' ? (
                  <button
                    type="button"
                    onClick={() => handleAddTask(msg.id, msg.content)}
                    className="flex items-center gap-1 text-[11px] text-red-400 hover:text-red-300"
                  >
                    <ListPlus size={11} /> 추가 실패 · 다시 시도
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
                    할일로 추가
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className={`px-3 py-2 border-t ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`}>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="메시지를 입력하세요..."
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
