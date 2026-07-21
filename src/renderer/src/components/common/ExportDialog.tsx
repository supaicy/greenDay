import { useState } from 'react'
import { X, FileJson, FileSpreadsheet, Check, AlertCircle } from 'lucide-react'
import { useStore } from '../../store/useStore'

type ExportStatus = 'idle' | 'loading' | 'success' | 'error'

export function ExportDialog() {
  const { showExport, setShowExport, exportData, theme } = useStore()
  const isDark = theme === 'dark'
  const [status, setStatus] = useState<ExportStatus>('idle')

  if (!showExport) return null

  const handleExport = async () => {
    setStatus('loading')
    try {
      const result = await exportData()
      setStatus(result ? 'success' : 'idle')
      if (result) {
        setTimeout(() => {
          setShowExport(false)
          setStatus('idle')
        }, 1500)
      }
    } catch {
      setStatus('error')
      setTimeout(() => setStatus('idle'), 3000)
    }
  }

  const handleClose = () => {
    setShowExport(false)
    setStatus('idle')
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 모달 배경 — 클릭/키보드 모두 지원
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          handleClose()
        }
      }}
    >
      {/* 모달 콘텐츠: 클릭 전파 차단 */}
      <div
        className={`w-[400px] rounded-xl shadow-2xl overflow-hidden ${
          isDark ? 'bg-[#2C2C2E] text-gray-100' : 'bg-white text-gray-800'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="데이터 내보내기"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div
          className={`flex items-center justify-between px-5 py-4 border-b ${
            isDark ? 'border-gray-700' : 'border-gray-200'
          }`}
        >
          <h2 className="text-base font-semibold">데이터 내보내기</h2>
          <button
            type="button"
            onClick={handleClose}
            className={`transition-colors ${
              isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <X size={18} />
          </button>
        </div>

        {/* 본문 */}
        <div className="p-5 space-y-3">
          <p className={`text-sm mb-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            모든 태스크, 리스트, 습관 데이터를 파일로 내보냅니다.
          </p>

          {/* JSON 내보내기 */}
          <button
            type="button"
            onClick={handleExport}
            disabled={status === 'loading'}
            className={`w-full flex items-center gap-3 p-4 rounded-xl border-2 transition-all ${
              isDark
                ? 'border-gray-600 hover:border-primary-500 hover:bg-primary-500/10'
                : 'border-gray-200 hover:border-primary-400 hover:bg-primary-50'
            } ${status === 'loading' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <div
              className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                isDark ? 'bg-blue-500/20' : 'bg-blue-50'
              }`}
            >
              <FileJson size={20} className="text-blue-400" />
            </div>
            <div className="text-left flex-1">
              <div className="text-sm font-medium">JSON 내보내기</div>
              <div className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                전체 데이터를 JSON 형식으로 저장
              </div>
            </div>
          </button>

          {/* CSV 내보내기 */}
          <button
            type="button"
            onClick={handleExport}
            disabled={status === 'loading'}
            className={`w-full flex items-center gap-3 p-4 rounded-xl border-2 transition-all ${
              isDark
                ? 'border-gray-600 hover:border-primary-500 hover:bg-primary-500/10'
                : 'border-gray-200 hover:border-primary-400 hover:bg-primary-50'
            } ${status === 'loading' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <div
              className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                isDark ? 'bg-green-500/20' : 'bg-green-50'
              }`}
            >
              <FileSpreadsheet size={20} className="text-green-400" />
            </div>
            <div className="text-left flex-1">
              <div className="text-sm font-medium">CSV 내보내기</div>
              <div className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                태스크 목록을 스프레드시트 형식으로 저장
              </div>
            </div>
          </button>

          {/* 상태 표시 */}
          {status === 'success' && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 text-green-400 text-sm">
              <Check size={16} />
              내보내기가 완료되었습니다.
            </div>
          )}

          {status === 'error' && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 text-red-400 text-sm">
              <AlertCircle size={16} />
              내보내기에 실패했습니다. 다시 시도해주세요.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
