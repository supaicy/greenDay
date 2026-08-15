import { useState } from 'react'
import { CheckCircle2, Trash2, ArrowRight, Flag, XCircle, CheckSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import { PRIORITY_OPTIONS } from '../../utils/priority'

export function BatchBar() {
  const { t } = useTranslation()
  const batchMode = useStore((s) => s.batchMode)
  const batchSelectedIds = useStore((s) => s.batchSelectedIds)
  const selectAllBatch = useStore((s) => s.selectAllBatch)
  const batchComplete = useStore((s) => s.batchComplete)
  const batchDelete = useStore((s) => s.batchDelete)
  const batchMove = useStore((s) => s.batchMove)
  const batchSetPriority = useStore((s) => s.batchSetPriority)
  const toggleBatchMode = useStore((s) => s.toggleBatchMode)
  const lists = useStore((s) => s.lists)
  const theme = useStore((s) => s.theme)
  const isDark = theme === 'dark'
  const [showMoveMenu, setShowMoveMenu] = useState(false)
  const [showPriorityMenu, setShowPriorityMenu] = useState(false)

  if (!batchMode) return null

  const count = batchSelectedIds.length

  return (
    <div
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 px-4 py-2 rounded-xl shadow-2xl border ${
        isDark ? 'bg-[#2C2C2E] border-gray-700' : 'bg-white border-gray-200 shadow-lg'
      }`}
    >
      {/* 선택 개수 */}
      <span className={`text-sm mr-2 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{t('batch.selected', { n: count })}</span>

      {/* 전체 선택 */}
      <button
        type="button"
        onClick={selectAllBatch}
        className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg transition-colors ${
          isDark ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-600 hover:bg-gray-100'
        }`}
        title={t('batch.selectAll')}
      >
        <CheckSquare size={15} />
        {t('batch.selectAll')}
      </button>

      {/* 구분선 */}
      <div className={`w-px h-5 mx-1 ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`} />

      {/* 완료 */}
      <button
        type="button"
        onClick={batchComplete}
        disabled={count === 0}
        className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-30 ${
          isDark ? 'text-green-400 hover:bg-green-900/30' : 'text-green-600 hover:bg-green-50'
        }`}
        title={t('batch.complete')}
      >
        <CheckCircle2 size={15} />
        {t('batch.complete')}
      </button>

      {/* 이동 */}
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setShowMoveMenu(!showMoveMenu)
            setShowPriorityMenu(false)
          }}
          disabled={count === 0}
          className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-30 ${
            isDark ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-600 hover:bg-gray-100'
          }`}
          title={t('batch.move')}
        >
          <ArrowRight size={15} />
          {t('batch.move')}
        </button>
        {showMoveMenu && (
          <div
            className={`absolute bottom-full mb-1 left-0 rounded-lg shadow-2xl border py-1 min-w-[140px] ${
              isDark ? 'bg-[#2C2C2E] border-gray-700' : 'bg-white border-gray-200'
            }`}
          >
            {lists.map((list) => (
              <button
                type="button"
                key={list.id}
                onClick={() => {
                  batchMove(list.id)
                  setShowMoveMenu(false)
                }}
                className={`w-full flex items-center gap-2 px-4 py-2 text-sm ${
                  isDark ? 'text-gray-200 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: list.color }} />
                {list.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 우선순위 */}
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setShowPriorityMenu(!showPriorityMenu)
            setShowMoveMenu(false)
          }}
          disabled={count === 0}
          className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-30 ${
            isDark ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-600 hover:bg-gray-100'
          }`}
          title={t('priority.label')}
        >
          <Flag size={15} />
          {t('priority.label')}
        </button>
        {showPriorityMenu && (
          <div
            className={`absolute bottom-full mb-1 left-0 rounded-lg shadow-2xl border py-1 min-w-[120px] ${
              isDark ? 'bg-[#2C2C2E] border-gray-700' : 'bg-white border-gray-200'
            }`}
          >
            {PRIORITY_OPTIONS.map((opt) => (
              <button
                type="button"
                key={opt.value}
                onClick={() => {
                  batchSetPriority(opt.value)
                  setShowPriorityMenu(false)
                }}
                className={`w-full text-left px-4 py-2 text-sm ${opt.color} ${
                  isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-100'
                }`}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 구분선 */}
      <div className={`w-px h-5 mx-1 ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`} />

      {/* 삭제 */}
      <button
        type="button"
        onClick={batchDelete}
        disabled={count === 0}
        className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-30"
        title={t('common.delete')}
      >
        <Trash2 size={15} />
        {t('common.delete')}
      </button>

      {/* 취소 */}
      <button
        type="button"
        onClick={toggleBatchMode}
        className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg transition-colors ${
          isDark ? 'text-gray-400 hover:bg-gray-700' : 'text-gray-500 hover:bg-gray-100'
        }`}
        title={t('common.cancel')}
      >
        <XCircle size={15} />
        {t('common.cancel')}
      </button>
    </div>
  )
}
