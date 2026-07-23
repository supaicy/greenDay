import { useState, useMemo, useCallback } from 'react'
import { Plus, Search, ArrowUpDown, CheckSquare } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { TaskItem } from './TaskItem'
import { AddTask } from './AddTask'
import { TrashView } from './TrashView'
import { SortMenu } from './SortMenu'
import { BatchBar } from './BatchBar'
import { isDueToday, isDueInNext7Days, isOverdue } from '../../utils/date'
import type { Task, SortBy, SortDir } from '../../types'

const SMART_LABELS: Record<string, string> = {
  today: '오늘',
  next7days: '다음 7일',
  inbox: '수신함',
  all: '전체',
  completed: '완료됨',
  trash: '휴지통'
}

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
  const {
    tasks,
    lists,
    selectedListId,
    searchQuery,
    setSearchQuery,
    showAddTask,
    setShowAddTask,
    theme,
    sortBy,
    sortDir,
    batchMode,
    toggleBatchMode,
    dragTaskId,
    setDragTaskId,
    reorderTasks
  } = useStore()
  const isDark = theme === 'dark'

  const listName = useMemo(() => {
    if (selectedListId in SMART_LABELS) return SMART_LABELS[selectedListId]
    return lists.find((l) => l.id === selectedListId)?.name || ''
  }, [selectedListId, lists])

  const filteredTasks = useMemo(() => {
    let result: Task[]
    switch (selectedListId) {
      case 'today':
        result = tasks.filter((t) => !t.completed && (isDueToday(t.dueDate) || isOverdue(t.dueDate)))
        break
      case 'next7days':
        result = tasks.filter((t) => !t.completed && isDueInNext7Days(t.dueDate))
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
    result = result.filter((t) => !t.parentId)
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q))
      )
    }
    return sortTasks(result, sortBy, sortDir)
  }, [tasks, selectedListId, searchQuery, sortBy, sortDir])

  const incompleteTasks = filteredTasks.filter((t) => !t.completed)
  const completedTasks = filteredTasks.filter((t) => t.completed)

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

  const [showSort, setShowSort] = useState(false)

  if (selectedListId === 'trash') return <TrashView />

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 태스크 목록 컨테이너 — 드래그 드롭 수신 영역
    <div
      className={`flex-1 flex flex-col min-h-0 ${isDark ? 'bg-[#1C1C1E]' : 'bg-white'}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/haru-task-block')) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
        }
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData('application/haru-task-block')
        if (!id) return
        void useStore.getState().updateTask({ id, scheduledStart: null, scheduledEnd: null })
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
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="검색... (Cmd+F)"
              className={`text-sm rounded-lg pl-8 pr-3 py-1.5 outline-none border focus:border-primary-500 w-48 ${
                isDark
                  ? 'bg-gray-800 text-gray-300 border-gray-700 placeholder-gray-600'
                  : 'bg-gray-100 text-gray-700 border-gray-300 placeholder-gray-400'
              }`}
            />
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowSort(!showSort)}
              className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-200 text-gray-500'}`}
              title="정렬"
            >
              <ArrowUpDown size={16} />
            </button>
            {showSort && <SortMenu onClose={() => setShowSort(false)} />}
          </div>
          <button
            type="button"
            onClick={toggleBatchMode}
            className={`p-1.5 rounded-lg transition-colors ${batchMode ? 'text-primary-400 bg-primary-900/30' : isDark ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-200 text-gray-500'}`}
            title="일괄 편집"
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
            <Plus size={18} /> 할 일 추가 (Cmd+N)
          </button>
        )}

        {selectedListId === 'completed' ? (
          filteredTasks.map((task) => <TaskItem key={task.id} task={task} onDrop={handleDrop} />)
        ) : (
          <>
            {incompleteTasks.map((task) => (
              <TaskItem key={task.id} task={task} onDrop={handleDrop} />
            ))}
            {completedTasks.length > 0 && (
              <div className="mt-4">
                <div
                  className={`px-6 py-2 text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-gray-500' : 'text-gray-400'}`}
                >
                  완료됨 ({completedTasks.length})
                </div>
                {completedTasks.map((task) => (
                  <TaskItem key={task.id} task={task} onDrop={handleDrop} />
                ))}
              </div>
            )}
          </>
        )}

        {filteredTasks.length === 0 && !showAddTask && (
          <div
            className={`flex flex-col items-center justify-center py-20 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}
          >
            <p className="text-sm">할 일이 없습니다</p>
            <button
              type="button"
              onClick={() => setShowAddTask(true)}
              className="mt-2 text-sm text-primary-500 hover:text-primary-400"
            >
              새 할 일 추가하기
            </button>
          </div>
        )}
      </div>

      {batchMode && <BatchBar />}
    </div>
  )
}
