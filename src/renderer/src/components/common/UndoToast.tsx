import { useEffect, useState } from 'react'
import { Undo2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'

export function UndoToast() {
  const { t } = useTranslation()
  const { undoStack, popUndo, theme } = useStore()
  const isDark = theme === 'dark'
  const [visible, setVisible] = useState(false)
  const [leaving, setLeaving] = useState(false)

  const lastAction = undoStack.length > 0 ? undoStack[undoStack.length - 1] : null

  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-run on new action timestamp, not on every lastAction reference change
  useEffect(() => {
    if (lastAction) {
      setLeaving(false)
      setVisible(true)

      // 5초 후 자동 숨김
      const timer = setTimeout(() => {
        setLeaving(true)
        setTimeout(() => setVisible(false), 300)
      }, 5000)

      return () => clearTimeout(timer)
    } else {
      setLeaving(true)
      const timer = setTimeout(() => setVisible(false), 300)
      return () => clearTimeout(timer)
    }
  }, [lastAction?.timestamp])

  if (!visible || !lastAction) return null

  const handleUndo = async () => {
    await popUndo()
    setLeaving(true)
    setTimeout(() => setVisible(false), 300)
  }

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[90] pointer-events-none">
      <div
        className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl transition-all duration-300 ${
          leaving ? 'opacity-0 translate-y-4' : 'opacity-100 translate-y-0'
        } ${
          isDark
            ? 'bg-[#3A3A3C] text-gray-100 border border-gray-600'
            : 'bg-white text-gray-800 border border-gray-200 shadow-lg'
        }`}
      >
        <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{lastAction.description}</span>

        <button
          type="button"
          onClick={handleUndo}
          className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1 rounded-lg transition-colors ${
            isDark ? 'text-primary-400 hover:bg-primary-500/20' : 'text-primary-600 hover:bg-primary-50'
          }`}
        >
          <Undo2 size={14} />
          {t('undo.label')}
        </button>
      </div>
    </div>
  )
}
