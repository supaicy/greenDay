import { useState, useMemo } from 'react'
import {
  Inbox,
  CalendarDays,
  CalendarRange,
  ListTodo,
  CheckCircle2,
  Plus,
  Timer,
  Target,
  Calendar,
  MoreHorizontal,
  Trash2,
  Edit3,
  X,
  Check,
  Settings,
  FolderOpen,
  FolderPlus,
  ChevronDown,
  ChevronRight,
  BarChart3,
  Columns3,
  Clock,
  Grid2X2,
  CalendarClock,
  LayoutList,
  Hash,
  Trophy,
  Bot
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { SMART_LIST_PREDICATES, isTopLevel, tagListId } from '../../utils/smartLists'
import { levelFromScore, levelProgress } from '../../utils/score'
import type { SmartList, ViewType } from '../../types'

const SMART_LISTS: { id: SmartList; icon: React.ReactNode }[] = [
  { id: 'all', icon: <ListTodo size={18} /> },
  { id: 'today', icon: <CalendarDays size={18} /> },
  { id: 'tomorrow', icon: <CalendarClock size={18} /> },
  { id: 'next7days', icon: <CalendarRange size={18} /> },
  { id: 'inbox', icon: <Inbox size={18} /> },
  { id: 'summary', icon: <LayoutList size={18} /> },
  { id: 'completed', icon: <CheckCircle2 size={18} /> },
  { id: 'trash', icon: <Trash2 size={18} /> }
]

const VIEW_ITEMS: { type: ViewType; icon: React.ReactNode }[] = [
  { type: 'calendar', icon: <Calendar size={18} /> },
  { type: 'calendarWeekly', icon: <CalendarClock size={18} /> },
  { type: 'calendarDaily', icon: <Clock size={18} /> },
  { type: 'kanban', icon: <Columns3 size={18} /> },
  { type: 'timeline', icon: <CalendarRange size={18} /> },
  { type: 'eisenhower', icon: <Grid2X2 size={18} /> },
  { type: 'pomodoro', icon: <Timer size={18} /> },
  { type: 'habits', icon: <Target size={18} /> },
  { type: 'stats', icon: <BarChart3 size={18} /> }
]

export function Sidebar() {
  const { t } = useTranslation()
  const lists = useStore((s) => s.lists)
  const tasks = useStore((s) => s.tasks)
  const trashTasks = useStore((s) => s.trashTasks)
  const folders = useStore((s) => s.folders)
  const selectedListId = useStore((s) => s.selectedListId)
  const viewType = useStore((s) => s.viewType)
  const theme = useStore((s) => s.theme)
  const score = useStore((s) => s.score)
  const updateAvailable = useStore((s) => s.updateAvailable)
  const editingListId = useStore((s) => s.editingListId)
  const setSelectedList = useStore((s) => s.setSelectedList)
  const setViewType = useStore((s) => s.setViewType)
  const addList = useStore((s) => s.addList)
  const removeList = useStore((s) => s.removeList)
  const updateList = useStore((s) => s.updateList)
  const setEditingList = useStore((s) => s.setEditingList)
  const toggleSettings = useStore((s) => s.toggleSettings)
  const addFolder = useStore((s) => s.addFolder)
  const updateFolder = useStore((s) => s.updateFolder)
  const removeFolder = useStore((s) => s.removeFolder)

  const [showNewList, setShowNewList] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [newListColor, setNewListColor] = useState('#4A90D9')
  const [newListFolderId, setNewListFolderId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')

  const isDark = theme === 'dark'

  const taskCounts = useMemo(() => {
    // 하위작업은 목록에 독립 행으로 서지 않는다 — TaskList가 결과를 isTopLevel로
    // 한 번 더 거른다. 뱃지가 tasks를 그대로 세면 하위작업 3개 달린 할일 하나가
    // '기본함 4'로 뜨는데 열어 보면 1줄이다: 셋이 숨은 건지 사라진 건지 알 수
    // 없는 숫자가 되어 뱃지를 '남은 일' 표시로 못 쓴다.
    // 날짜 스마트 리스트(today/tomorrow/next7days/summary)는 판별식
    // (SMART_LIST_PREDICATES → isActiveTopLevel)이 이미 걸러 준다. 바로 아래
    // 태그 뱃지도 parentId를 거른다 — 여기만 빠져 있었다.
    const topLevel = tasks.filter(isTopLevel)
    const incomplete = topLevel.filter((t) => !t.completed)
    const counts: Record<string, number> = {
      // Badge counts share the SAME predicates as the list-view filters
      // (SMART_LIST_PREDICATES) so the sidebar number always matches the list.
      today: tasks.filter(SMART_LIST_PREDICATES.today).length,
      tomorrow: tasks.filter(SMART_LIST_PREDICATES.tomorrow).length,
      next7days: tasks.filter(SMART_LIST_PREDICATES.next7days).length,
      inbox: incomplete.filter((t) => t.listId === 'inbox').length,
      all: incomplete.length,
      summary: tasks.filter(SMART_LIST_PREDICATES.summary).length,
      completed: topLevel.filter((t) => t.completed).length,
      // trash 만 tasks 가 아니라 trashTasks 를 그대로 센다 — TrashView 는 하위작업까지
      // 전부 행으로 그리므로 이 뱃지는 걸러내면 오히려 목록과 어긋난다.
      trash: trashTasks.length
    }
    for (const list of lists) {
      if (!(list.id in counts)) counts[list.id] = incomplete.filter((t) => t.listId === list.id).length
    }
    return counts
  }, [tasks, trashTasks, lists])

  // 미완료 최상위 태스크에 쓰인 태그와 개수 (가나다순). 태그별 보기 섹션에 표시.
  // 하위작업(parentId)은 뷰에 top-level로 안 보이므로 개수에서도 제외 → 뱃지=목록 일치.
  const tagList = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of tasks) {
      if (t.completed || t.parentId) continue
      for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko'))
  }, [tasks])

  const handleAddList = async () => {
    if (!newListName.trim()) return
    await addList(newListName.trim(), newListColor, newListFolderId)
    setNewListName('')
    setNewListColor('#4A90D9')
    setShowNewList(false)
    setNewListFolderId(null)
  }

  const handleAddFolder = async () => {
    if (!newFolderName.trim()) return
    await addFolder(newFolderName.trim())
    setNewFolderName('')
    setShowNewFolder(false)
  }

  const startEdit = (id: string, name: string, color: string) => {
    setEditingList(id)
    setEditName(name)
    setEditColor(color)
  }

  const saveEdit = async () => {
    if (editingListId && editName.trim()) await updateList(editingListId, { name: editName.trim(), color: editColor })
    setEditingList(null)
  }

  const COLORS = ['#4A90D9', '#E74C3C', '#F39C12', '#2ECC71', '#9B59B6', '#1ABC9C', '#E91E63', '#FF5722']

  const btnClass = (active: boolean) =>
    `w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
      active
        ? isDark
          ? 'bg-sidebar-active text-white'
          : 'bg-primary-100 text-primary-700'
        : isDark
          ? 'text-sidebar-text hover:bg-sidebar-hover'
          : 'text-gray-600 hover:bg-gray-200'
    }`

  const mutedClass = isDark ? 'text-sidebar-muted' : 'text-gray-400'
  const level = levelFromScore(score.total)

  const listsWithoutFolder = lists.filter((l) => l.id !== 'inbox' && !l.folderId)
  const listsByFolder = (folderId: string) => lists.filter((l) => l.folderId === folderId)

  const renderList = (list: (typeof lists)[0]) => (
    <div key={list.id} className="relative group">
      {editingListId === list.id ? (
        <div className="flex items-center gap-2 px-3 py-1">
          {/* 색상 변경 버튼 (Pattern A: 순수 클릭 요소 → button) */}
          <button
            type="button"
            aria-label={t('common.changeColor')}
            className="w-3 h-3 rounded-full flex-shrink-0 cursor-pointer appearance-none border-0 p-0"
            style={{ backgroundColor: editColor }}
            onClick={() => {
              const idx = COLORS.indexOf(editColor)
              setEditColor(COLORS[(idx + 1) % COLORS.length])
            }}
          />
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
            className="flex-1 bg-sidebar-hover text-white text-sm px-2 py-1 rounded outline-none"
          />
          <button type="button" onClick={saveEdit} className="text-green-400">
            <Check size={14} />
          </button>
          <button type="button" onClick={() => setEditingList(null)} className={mutedClass}>
            <X size={14} />
          </button>
        </div>
      ) : (
        /* biome-ignore lint/a11y/useSemanticElements: 중첩 button(컨텍스트 메뉴 트리거) 포함으로 <button> 전환 불가 */
        <div
          role="button"
          tabIndex={0}
          onClick={() => setSelectedList(list.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setSelectedList(list.id)
            }
          }}
          className={btnClass(selectedListId === list.id && viewType === 'tasks')}
        >
          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: list.color }} />
          <span className="flex-1 text-left truncate">{list.name}</span>
          <span className={`text-xs ${mutedClass}`}>{taskCounts[list.id] || ''}</span>
          {/* 열림 상태·바깥 클릭·포커스 복귀는 Radix가 관리. data-[state=open]으로
              메뉴가 열려 있는 동안 트리거가 hover 밖에서도 보이게 한다. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 transition-opacity"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal size={14} className={`${mutedClass} hover:text-white`} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[120px]">
              <DropdownMenuItem onSelect={() => startEdit(list.id, list.name, list.color)} className="gap-2 text-sm">
                <Edit3 size={14} /> {t('common.edit')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => removeList(list.id)} className="gap-2 text-sm text-red-400">
                <Trash2 size={14} /> {t('common.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  )

  return (
    <div
      className={`w-64 h-full flex flex-col select-none ${isDark ? 'bg-sidebar-bg text-sidebar-text' : 'bg-gray-100 text-gray-700'}`}
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="h-12 flex-shrink-0" />

      <div className="flex-1 overflow-y-auto px-2 pb-4" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {/* 스마트 리스트 */}
        <div className="mb-3">
          {SMART_LISTS.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => setSelectedList(item.id)}
              className={btnClass(selectedListId === item.id && viewType === 'tasks')}
            >
              <span className={mutedClass}>{item.icon}</span>
              <span className="flex-1 text-left">{t(`nav.${item.id}`)}</span>
              <span className={`text-xs ${mutedClass}`}>{taskCounts[item.id] || ''}</span>
            </button>
          ))}
        </div>

        {/* 뷰 */}
        <div className={`mb-3 border-t pt-3 ${isDark ? 'border-sidebar-hover' : 'border-gray-300'}`}>
          <div className={`px-3 mb-1 text-xs font-semibold uppercase tracking-wider ${mutedClass}`}>
            {t('nav.sectionViews')}
          </div>
          {VIEW_ITEMS.map((item) => (
            <button
              type="button"
              key={item.type}
              onClick={() => setViewType(item.type)}
              className={btnClass(viewType === item.type)}
            >
              <span className={mutedClass}>{item.icon}</span>
              <span className="flex-1 text-left">{t(`views.${item.type}`)}</span>
            </button>
          ))}
        </div>

        {/* 태그 */}
        {tagList.length > 0 && (
          <div className={`mb-3 border-t pt-3 ${isDark ? 'border-sidebar-hover' : 'border-gray-300'}`}>
            <div className={`px-3 mb-1 text-xs font-semibold uppercase tracking-wider ${mutedClass}`}>
              {t('nav.sectionTags')}
            </div>
            {tagList.map(([tag, count]) => (
              <button
                type="button"
                key={tag}
                onClick={() => setSelectedList(tagListId(tag))}
                className={btnClass(selectedListId === tagListId(tag) && viewType === 'tasks')}
              >
                <span className={mutedClass}>
                  <Hash size={18} />
                </span>
                <span className="flex-1 text-left truncate">{tag}</span>
                <span className={`text-xs ${mutedClass}`}>{count}</span>
              </button>
            ))}
          </div>
        )}

        {/* 리스트 + 폴더 */}
        <div className={`border-t pt-3 ${isDark ? 'border-sidebar-hover' : 'border-gray-300'}`}>
          <div className="flex items-center justify-between px-3 mb-1">
            <span className={`text-xs font-semibold uppercase tracking-wider ${mutedClass}`}>
              {t('nav.sectionLists')}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setShowNewFolder(true)}
                className={`${mutedClass} hover:text-white transition-colors`}
                title={t('nav.addFolder')}
              >
                <FolderPlus size={14} />
              </button>
              <button
                type="button"
                onClick={() => setShowNewList(true)}
                className={`${mutedClass} hover:text-white transition-colors`}
                title={t('nav.addList')}
              >
                <Plus size={16} />
              </button>
            </div>
          </div>

          {/* 폴더 추가 */}
          {showNewFolder && (
            <div className="flex items-center gap-2 px-3 py-1 mb-1">
              <FolderOpen size={14} className={mutedClass} />
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return
                  if (e.key === 'Enter') handleAddFolder()
                  if (e.key === 'Escape') {
                    // 이 Escape는 여기서 쓴다 — 전역 단축키(useKeyboardShortcuts)가 선택까지
                    // 해제해 상세 패널을 닫지 않도록 알린다.
                    e.preventDefault()
                    setShowNewFolder(false)
                  }
                }}
                placeholder={t('nav.folderNamePlaceholder')}
                className={`flex-1 text-sm px-2 py-1 rounded outline-none ${isDark ? 'bg-sidebar-hover text-white placeholder-sidebar-muted' : 'bg-gray-200 text-gray-800 placeholder-gray-400'}`}
              />
              <button type="button" onClick={handleAddFolder} className="text-green-400">
                <Check size={14} />
              </button>
              <button type="button" onClick={() => setShowNewFolder(false)} className={mutedClass}>
                <X size={14} />
              </button>
            </div>
          )}

          {/* 폴더별 리스트 */}
          {folders.map((folder) => (
            <div key={folder.id} className="mb-1">
              <div className="flex items-center gap-2 px-3 py-1.5 group">
                <button
                  type="button"
                  onClick={() => updateFolder(folder.id, folder.name, !folder.collapsed)}
                  className={mutedClass}
                >
                  {folder.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                </button>
                <FolderOpen size={14} className={mutedClass} />
                <span className={`flex-1 text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {folder.name}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setNewListFolderId(folder.id)
                    setShowNewList(true)
                  }}
                  className={`opacity-0 group-hover:opacity-100 ${mutedClass}`}
                >
                  <Plus size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => removeFolder(folder.id)}
                  className="opacity-0 group-hover:opacity-100 text-red-400"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              {!folder.collapsed && listsByFolder(folder.id).map(renderList)}
            </div>
          ))}

          {/* 폴더 없는 리스트 */}
          {listsWithoutFolder.map(renderList)}

          {/* 리스트 추가 */}
          {showNewList && (
            <div className="flex items-center gap-2 px-3 py-1 mt-1">
              {/* 색상 변경 버튼 (Pattern A: 순수 클릭 요소 → button) */}
              <button
                type="button"
                aria-label={t('common.changeColor')}
                className="w-3 h-3 rounded-full flex-shrink-0 cursor-pointer appearance-none border-0 p-0"
                style={{ backgroundColor: newListColor }}
                onClick={() => {
                  const idx = COLORS.indexOf(newListColor)
                  setNewListColor(COLORS[(idx + 1) % COLORS.length])
                }}
              />
              <input
                type="text"
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return
                  if (e.key === 'Enter') handleAddList()
                  if (e.key === 'Escape') {
                    // 새 폴더 이름칸과 같다 — 이 Escape는 여기서 쓴다.
                    e.preventDefault()
                    setShowNewList(false)
                    setNewListFolderId(null)
                  }
                }}
                placeholder={t('nav.listNamePlaceholder')}
                className={`flex-1 text-sm px-2 py-1 rounded outline-none ${isDark ? 'bg-sidebar-hover text-white placeholder-sidebar-muted' : 'bg-gray-200 text-gray-800 placeholder-gray-400'}`}
              />
              <button type="button" onClick={handleAddList} className="text-green-400">
                <Check size={14} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowNewList(false)
                  setNewListFolderId(null)
                }}
                className={mutedClass}
              >
                <X size={14} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 하단: 점수 + 설정 */}
      <div
        className={`flex-shrink-0 px-3 py-2 border-t ${isDark ? 'border-sidebar-hover' : 'border-gray-300'}`}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2 px-3 py-1.5 mb-1">
          <Trophy size={16} className="text-yellow-500" />
          <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {t('nav.level', { level, score: score.total })}
          </span>
          <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-gray-700' : 'bg-gray-300'}`}>
            <div
              className="h-full bg-yellow-500 rounded-full transition-all"
              style={{ width: `${levelProgress(score.total)}%` }}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => useStore.getState().setShowAiChat(!useStore.getState().showAiChat)}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm w-full transition-colors ${isDark ? 'text-sidebar-muted hover:text-white hover:bg-sidebar-hover' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'}`}
        >
          <Bot size={18} className="text-blue-500" />
          <span>{t('nav.aiAssistant')}</span>
        </button>
        <button
          type="button"
          onClick={toggleSettings}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm w-full transition-colors ${isDark ? 'text-sidebar-muted hover:text-white hover:bg-sidebar-hover' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'}`}
        >
          <div className="relative">
            <Settings size={18} />
            {updateAvailable && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full" />}
          </div>
          <span>{t('nav.settings')}</span>
        </button>
      </div>
    </div>
  )
}
