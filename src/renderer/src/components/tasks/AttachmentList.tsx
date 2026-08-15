import { Paperclip, X, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'

function parseAttachment(entry: string): { name: string; path: string } {
  const separatorIndex = entry.indexOf('|')
  if (separatorIndex === -1) return { name: entry, path: entry }
  return {
    name: entry.substring(0, separatorIndex),
    path: entry.substring(separatorIndex + 1)
  }
}

function formatAttachment(name: string, path: string): string {
  return `${name}|${path}`
}

export function AttachmentList({
  taskId,
  attachments,
  onUpdate
}: {
  taskId: string
  attachments: string[]
  onUpdate: (attachments: string[]) => void
}) {
  const { t } = useTranslation()
  const pickAttachment = useStore((s) => s.pickAttachment)
  const theme = useStore((s) => s.theme)
  const isDark = theme === 'dark'

  const handleAdd = async () => {
    try {
      const files = await pickAttachment()
      if (files && files.length > 0) {
        const newAttachments = [...attachments, ...files.map((f) => formatAttachment(f.name, f.path))]
        onUpdate(newAttachments)
      }
    } catch {
      // 사용자가 파일 선택을 취소한 경우
    }
  }

  const handleRemove = (index: number) => {
    const newAttachments = attachments.filter((_, i) => i !== index)
    onUpdate(newAttachments)
  }

  return (
    <div className="mt-3">
      {/* 첨부 파일 목록 */}
      {attachments.length > 0 && (
        <div className="space-y-1 mb-2">
          {attachments.map((entry, index) => {
            const att = parseAttachment(entry)
            return (
              <div
                key={`${taskId}-${entry}`}
                className={`group flex items-center gap-2 px-2 py-1.5 rounded transition-colors ${
                  isDark ? 'hover:bg-gray-700/50' : 'hover:bg-gray-100'
                }`}
              >
                <Paperclip
                  size={14}
                  className={isDark ? 'text-gray-500 flex-shrink-0' : 'text-gray-400 flex-shrink-0'}
                />
                {/* 파일명 클릭 시 시스템 기본 앱으로 첨부파일 열기 */}
                <button
                  type="button"
                  title={att.name}
                  onClick={() => window.api.openAttachment(att.path)}
                  className={`flex-1 text-sm text-left truncate ${isDark ? 'text-gray-300 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
                >
                  {att.name}
                </button>
                <button
                  type="button"
                  onClick={() => handleRemove(index)}
                  className={`opacity-0 group-hover:opacity-100 flex-shrink-0 transition-opacity ${
                    isDark ? 'text-gray-500 hover:text-red-400' : 'text-gray-400 hover:text-red-500'
                  }`}
                >
                  <X size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* 파일 추가 버튼 */}
      <button
        type="button"
        onClick={handleAdd}
        className={`flex items-center gap-2 px-2 py-1.5 text-sm rounded transition-colors w-full ${
          isDark
            ? 'text-gray-500 hover:text-gray-300 hover:bg-gray-700/50'
            : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
        }`}
      >
        <Plus size={16} />
        {t('detail.addAttachment')}
      </button>
    </div>
  )
}
