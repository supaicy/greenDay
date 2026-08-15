import { useMemo, useCallback } from 'react'
import { Plus, Search, ArrowUpDown, CheckSquare } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { TaskItem } from './TaskItem'
import { AddTask } from './AddTask'
import { TrashView } from './TrashView'
import { SortMenu } from './SortMenu'
import { BatchBar } from './BatchBar'
import { isDueToday, isDueTomorrow, isDueInNext7Days, isOverdue } from '../../utils/date'
import { useTranslation } from 'react-i18next'
import { SMART_LIST_PREDICATES, isTopLevel, tagFromListId } from '../../utils/smartLists'
import { DND_MIME } from '../../utils/dnd'
import { matchesSearch } from '../../utils/search'
import type { Task, SortBy, SortDir } from '../../types'

const SMART_LIST_IDS = ['all', 'today', 'tomorrow', 'next7days', 'inbox', 'summary', 'completed', 'trash']

// '요약' 뷰의 시간대 그룹 정의 (위→아래 표시 순서). 각 태스크는 첫 매칭 그룹에 들어간다.
const SUMMARY_GROUPS: { key: string; labelKey: string; match: (dueDate: string | null) => boolean }[] = [
  { key: 'overdue', labelKey: 'task.groupOverdue', match: isOverdue },
  { key: 'today', labelKey: 'task.groupToday', match: isDueToday },
  { key: 'tomorrow', labelKey: 'task.groupTomorrow', match: isDueTomorrow },
  { key: 'upcoming', labelKey: 'task.groupUpcoming', match: isDueInNext7Days }
]

function sortTasks(tasks: Task[], sortBy: SortBy, sortDir: SortDir): Task[] {
  if (sortBy === 'default') return tasks
  const dir = sortDir === 'asc' ? 1 : -1
  return [...tasks].sort((a, b) => {
    switch (sortBy) {
      case 'dueDate': {
        if (!a.dueDate && !b.dueDate) return 0
        if (!a.dueDate) return 1
        if (!b.dueDate) return -1
        return a.dueDate.localeCompare(b.dueDate) * dir
      }
      case 'priority': {
        const p = { high: 3, medium: 2, low: 1, none: 0 }
        return (p[b.priority] - p[a.priority]) * dir
      }
      case 'title':
        return a.title.localeCompare(b.title, 'ko') * dir
      case 'createdAt':
        return (new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) * dir
      default:
        return 0
    }
  })
}

export function TaskListView() {
  const { t } = useTranslation()
  const tasks = useStore((s) => s.tasks)
  const lists = useStore((s) => s.lists)
  const selectedListId = useStore((s) => s.selectedListId)
  const searchQuery = useStore((s) => s.searchQuery)
  const setSearchQuery = useStore((s) => s.setSearchQuery)
  const showAddTask = useStore((s) => s.showAddTask)
  const setShowAddTask = useStore((s) => s.setShowAddTask)
  const theme = useStore((s) => s.theme)
  const sortBy = useStore((s) => s.sortBy)
  const sortDir = useStore((s) => s.sortDir)
  const batchMode = useStore((s) => s.batchMode)
  const toggleBatchMode = useStore((s) => s.toggleBatchMode)
  const dragTaskId = useStore((s) => s.dragTaskId)
  const setDragTaskId = useStore((s) => s.setDragTaskId)
  const reorderTasks = useStore((s) => s.reorderTasks)
  const isDark = theme === 'dark'

  const listName = useMemo(() => {
    const tag = tagFromListId(selectedListId as string)
    if (tag) return `#${tag}`
    if (SMART_LIST_IDS.includes(selectedListId as string)) return t(`nav.${selectedListId}`)
    return lists.find((l) => l.id === selectedListId)?.name || ''
  }, [selectedListId, lists, t])

  const filteredTasks = useMemo(() => {
    const tag = tagFromListId(selectedListId as string)
    let result: Task[]
    if (tag) {
      result = tasks.filter((t) => !t.completed && t.tags.includes(tag))
    } else {
      switch (selectedListId) {
        case 'today':
          result = tasks.filter(SMART_LIST_PREDICATES.today)
          break
        case 'tomorrow':
          result = tasks.filter(SMART_LIST_PREDICATES.tomorrow)
          break
        case 'next7days':
          result = tasks.filter(SMART_LIST_PREDICATES.next7days)
          break
        case 'summary':
          result = tasks.filter(SMART_LIST_PREDICATES.summary)
          break
        case 'inbox':
          result = tasks.filter((t) => t.listId === 'inbox')
          break
        case 'all':
          result = tasks.filter((t) => !t.completed)
          break
        case 'completed':
          result = tasks.filter((t) => t.completed)
          break
        default:
          result = tasks.filter((t) => t.listId === selectedListId)
          break
      }
    }
    result = result.filter(isTopLevel)
    if (searchQuery) result = result.filter((t) => matchesSearch(t, searchQuery))
    return sortTasks(result, sortBy, sortDir)
  }, [tasks, selectedListId, searchQuery, sortBy, sortDir])

  const incompleteTasks = filteredTasks.filter((t) => !t.completed)
  const completedTasks = filteredTasks.filter((t) => t.completed)

  // '요약' 뷰: 마감일 기준 시간대 그룹으로 분할 (빈 그룹은 숨김). 각 태스크는 첫 매칭 그룹에만.
  // 태스크당 한 번만 그룹을 찾아(single pass) 버킷에 담는다.
  const summaryGroups = useMemo(() => {
    if (selectedListId !== 'summary') return []
    const buckets = new Map<string, Task[]>()
    for (const t of filteredTasks) {
      const g = SUMMARY_GROUPS.find((x) => x.match(t.dueDate))
      if (!g) continue
      const arr = buckets.get(g.key)
      if (arr) arr.push(t)
      else buckets.set(g.key, [t])
    }
    return SUMMARY_GROUPS.map((g) => ({ ...g, tasks: buckets.get(g.key) ?? [] })).filter((g) => g.tasks.length > 0)
  }, [selectedListId, filteredTasks])

  // 정렬이 걸려 있으면 화면 순서는 sortBy가 정한다. 그 상태에서 드래그를 허용하면
  // 정렬 결과가 sortOrder에 그대로 구워져 사용자의 수동 순서가 말없이 사라진다.
  const canReorder = sortBy === 'default'
  const handleDrop = useCallback(
    (targetId: string) => {
      if (!dragTaskId || dragTaskId === targetId) return
      const ids = filteredTasks.map((t) => t.id)
      const fromIdx = ids.indexOf(dragTaskId)
      const toIdx = ids.indexOf(targetId)
      if (fromIdx < 0 || toIdx < 0) return
      ids.splice(fromIdx, 1)
      ids.splice(toIdx, 0, dragTaskId)
      reorderTasks(ids)
      setDragTaskId(null)
    },
    [dragTaskId, filteredTasks, reorderTasks, setDragTaskId]
  )


  if (selectedListId === 'trash') return <TrashView />

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 태스크 목록 컨테이너 — 드래그 드롭 수신 영역
    <div
      className={`flex-1 flex flex-col min-h-0 ${isDark ? 'bg-[#1C1C1E]' : 'bg-white'}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DND_MIME.TASK_BLOCK)) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
        }
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(DND_MIME.TASK_BLOCK)
        if (!id) return
        // 배정 해제 — 반복 회차 오버라이드도 함께 지워 유령 블록을 남기지 않는다.
        void useStore.getState().updateTask({ id, scheduledStart: null, scheduledEnd: null, scheduledOverrides: null })
      }}
    >
      <div
        className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? 'border-gray-800' : 'border-gray-200'}`}
      >
        <h1 className={`text-xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-800'}`}>{listName}</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              // Cmd+F 핸들러가 이 속성으로 찾아 포커스한다. 지우면 단축키가 조용히 죽는다.
              data-search-input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('task.search')}
              className={`text-sm rounded-lg pl-8 pr-3 py-1.5 outline-none border focus:border-primary-500 w-48 ${
                isDark
                  ? 'bg-gray-800 text-gray-300 border-gray-700 placeholder-gray-600'
                  : 'bg-gray-100 text-gray-700 border-gray-300 placeholder-gray-400'
              }`}
            />
          </div>
          <SortMenu
            trigger={
              <button
                type="button"
                // 정렬이 걸려 있으면 아이콘으로 알린다 — 메뉴를 열지 않아도 보이게.
                className={`p-1.5 rounded-lg transition-colors ${
                  sortBy !== 'default'
                    ? 'text-primary-400 bg-primary-900/30'
                    : isDark
                      ? 'hover:bg-gray-800 text-gray-400'
                      : 'hover:bg-gray-200 text-gray-500'
                }`}
                title={t('task.sort')}
              >
                <ArrowUpDown size={16} />
              </button>
            }
          />
          <button
            type="button"
            onClick={toggleBatchMode}
            className={`p-1.5 rounded-lg transition-colors ${batchMode ? 'text-primary-400 bg-primary-900/30' : isDark ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-200 text-gray-500'}`}
            title={t('task.batchEdit')}
          >
            <CheckSquare size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {showAddTask ? (
          <div className="pt-3">
            <AddTask onClose={() => setShowAddTask(false)} />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowAddTask(true)}
            className="flex items-center gap-2 px-6 py-3 text-sm text-primary-500 hover:text-primary-400 transition-colors w-full"
          >
            <Plus size={18} /> {t('task.addWithShortcut')}
          </button>
        )}

        {selectedListId === 'summary' ? (
          summaryGroups.map((g) => (
            <div key={g.key} className="mt-1">
              <div
                className={`px-6 py-2 text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-gray-500' : 'text-gray-400'}`}
              >
                {t(g.labelKey)} ({g.tasks.length})
              </div>
              {g.tasks.map((task) => (
                <TaskItem key={task.id} task={task} onDrop={canReorder ? handleDrop : undefined} />
              ))}
            </div>
          ))
        ) : selectedListId === 'completed' ? (
          filteredTasks.map((task) => (
            <TaskItem key={task.id} task={task} onDrop={canReorder ? handleDrop : undefined} />
          ))
        ) : (
          <>
            {incompleteTasks.map((task) => (
              <TaskItem key={task.id} task={task} onDrop={canReorder ? handleDrop : undefined} />
            ))}
            {completedTasks.length > 0 && (
              <div className="mt-4">
                <div
                  className={`px-6 py-2 text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-gray-500' : 'text-gray-400'}`}
                >
                  {t('task.completedCount', { n: completedTasks.length })}
                </div>
                {completedTasks.map((task) => (
                  <TaskItem key={task.id} task={task} onDrop={canReorder ? handleDrop : undefined} />
                ))}
              </div>
            )}
          </>
        )}

        {filteredTasks.length === 0 && !showAddTask && (
          <div
            className={`flex flex-col items-center justify-center py-20 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}
          >
            <p className="text-sm">{t('task.empty')}</p>
            <button
              type="button"
              onClick={() => setShowAddTask(true)}
              className="mt-2 text-sm text-primary-500 hover:text-primary-400"
            >
              {t('task.addFirst')}
            </button>
          </div>
        )}
      </div>

      {batchMode && <BatchBar />}
    </div>
  )
}
