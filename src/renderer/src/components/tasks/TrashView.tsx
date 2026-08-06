import { useState } from 'react'
import { Trash2, RotateCcw, AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import { ConfirmDialog } from '../common/ConfirmDialog'

// 확인이 필요한 파괴적 동작. null이면 확인 창이 없는 상태.
type PendingAction = { kind: 'empty' } | { kind: 'delete'; id: string; title: string } | null

export function TrashView() {
  const { t, i18n } = useTranslation()
  const dateLocale = i18n.language?.startsWith('en') ? 'en-US' : 'ko-KR'
  const { trashTasks, restoreTask, permanentDeleteTask, emptyTrash, theme } = useStore()
  const isDark = theme === 'dark'
  const [pending, setPending] = useState<PendingAction>(null)

  const runPending = () => {
    if (!pending) return
    if (pending.kind === 'empty') emptyTrash()
    else permanentDeleteTask(pending.id)
    setPending(null)
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* 헤더 */}
      <div
        className={`flex items-center justify-between px-6 py-4 border-b ${
          isDark ? 'border-gray-800' : 'border-gray-200'
        }`}
      >
        <div className="flex items-center gap-2">
          <Trash2 size={20} className={isDark ? 'text-gray-400' : 'text-gray-500'} />
          <h2 className={`text-lg font-semibold ${isDark ? 'text-gray-100' : 'text-gray-800'}`}>{t('trash.title')}</h2>
          {trashTasks.length > 0 && (
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                isDark ? 'bg-gray-700 text-gray-400' : 'bg-gray-200 text-gray-500'
              }`}
            >
              {trashTasks.length}
            </span>
          )}
        </div>

        {trashTasks.length > 0 && (
          <button
            type="button"
            onClick={() => setPending({ kind: 'empty' })}
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <AlertTriangle size={14} />
            {t('trash.empty')}
          </button>
        )}
      </div>

      {/* 목록 */}
      <div className="flex-1 overflow-y-auto">
        {trashTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <Trash2 size={48} className={isDark ? 'text-gray-700' : 'text-gray-300'} />
            <p className={`mt-3 text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{t('trash.isEmpty')}</p>
          </div>
        ) : (
          <div className="py-2">
            {trashTasks.map((task) => (
              <div
                key={task.id}
                className={`group flex items-center gap-3 px-6 py-3 transition-colors ${
                  isDark
                    ? 'border-b border-gray-800/50 hover:bg-gray-800/30'
                    : 'border-b border-gray-100 hover:bg-gray-50'
                }`}
              >
                {/* 태스크 정보 */}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{task.title}</p>
                  {task.deletedAt && (
                    <p className={`text-xs mt-0.5 ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
                      {t('trash.deletedAt', { date: new Date(task.deletedAt).toLocaleDateString(dateLocale) })}
                    </p>
                  )}
                </div>

                {/* 액션 버튼 */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => restoreTask(task.id)}
                    className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg transition-colors ${
                      isDark ? 'text-primary-400 hover:bg-primary-900/30' : 'text-primary-500 hover:bg-primary-50'
                    }`}
                  >
                    <RotateCcw size={13} />
                    {t('trash.restore')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPending({ kind: 'delete', id: task.id, title: task.title })}
                    className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 size={13} />
                    {t('trash.deleteForever')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {pending && (
        <ConfirmDialog
          title={pending.kind === 'empty' ? t('trash.confirmEmptyTitle') : t('trash.confirmDeleteTitle')}
          body={
            pending.kind === 'empty'
              ? t('trash.confirmEmptyBody', { count: trashTasks.length })
              : t('trash.confirmDeleteBody', { title: pending.title })
          }
          confirmLabel={pending.kind === 'empty' ? t('trash.empty') : t('trash.deleteForever')}
          onConfirm={runPending}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  )
}
