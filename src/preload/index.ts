import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // Folders
  getFolders: () => ipcRenderer.invoke('get-folders'),
  createFolder: (id: string, name: string) => ipcRenderer.invoke('create-folder', id, name),
  updateFolder: (id: string, name: string, collapsed: boolean) =>
    ipcRenderer.invoke('update-folder', id, name, collapsed),
  deleteFolder: (id: string) => ipcRenderer.invoke('delete-folder', id),

  // Lists
  getLists: () => ipcRenderer.invoke('get-lists'),
  createList: (id: string, name: string, color: string, icon: string, folderId?: string | null) =>
    ipcRenderer.invoke('create-list', id, name, color, icon, folderId || null),
  updateList: (id: string, updates: Record<string, unknown>) => ipcRenderer.invoke('update-list', id, updates),
  deleteList: (id: string) => ipcRenderer.invoke('delete-list', id),
  reorderLists: (ids: string[]) => ipcRenderer.invoke('reorder-lists', ids),

  // Tasks
  getTasks: () => ipcRenderer.invoke('get-tasks'),
  getTrashTasks: () => ipcRenderer.invoke('get-trash-tasks'),
  createTask: (task: unknown) => ipcRenderer.invoke('create-task', task),
  updateTask: (task: unknown) => ipcRenderer.invoke('update-task', task),
  deleteTask: (id: string) => ipcRenderer.invoke('delete-task', id),
  restoreTask: (id: string) => ipcRenderer.invoke('restore-task', id),
  permanentDeleteTask: (id: string) => ipcRenderer.invoke('permanent-delete-task', id),
  emptyTrash: () => ipcRenderer.invoke('empty-trash'),
  reorderTasks: (ids: string[]) => ipcRenderer.invoke('reorder-tasks', ids),
  batchUpdateTasks: (ids: string[], updates: Record<string, unknown>) =>
    ipcRenderer.invoke('batch-update-tasks', ids, updates),

  // Habits
  getHabits: () => ipcRenderer.invoke('get-habits'),
  createHabit: (id: string, name: string, color: string, frequency: string, targetDays: number[]) =>
    ipcRenderer.invoke('create-habit', id, name, color, frequency, targetDays),
  deleteHabit: (id: string) => ipcRenderer.invoke('delete-habit', id),
  getHabitLogs: () => ipcRenderer.invoke('get-habit-logs'),
  toggleHabitLog: (id: string, habitId: string, date: string) =>
    ipcRenderer.invoke('toggle-habit-log', id, habitId, date),

  // Pomodoro
  getPomodoroSessions: () => ipcRenderer.invoke('get-pomodoro-sessions'),
  savePomodoroSession: (session: unknown) => ipcRenderer.invoke('save-pomodoro-session', session),

  // Score
  getScore: () => ipcRenderer.invoke('get-score'),
  addScoreEvent: (event: unknown) => ipcRenderer.invoke('add-score-event', event),

  // Attachments
  pickAttachment: () => ipcRenderer.invoke('pick-attachment'),
  getAttachmentsDir: () => ipcRenderer.invoke('get-attachments-dir'),
  openAttachment: (path: string) => ipcRenderer.invoke('open-attachment', path),

  // Export
  exportData: () => ipcRenderer.invoke('export-data'),

  // Notifications
  showNotification: (title: string, body: string) => ipcRenderer.invoke('show-notification', title, body),

  // App meta
  isMas: () => ipcRenderer.invoke('app:is-mas') as Promise<boolean>,

  // 외부 링크 열기
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateAvailable: (callback: (info: { version: string; downloadUrl: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, info: { version: string; downloadUrl: string }): void =>
      callback(info)
    ipcRenderer.on('update-available', handler)
    return () => ipcRenderer.removeListener('update-available', handler)
  },
  onUpdateNotAvailable: (callback: () => void) => {
    const handler = (_: Electron.IpcRendererEvent): void => callback()
    ipcRenderer.on('update-not-available', handler)
    return () => ipcRenderer.removeListener('update-not-available', handler)
  },
  onUpdateProgress: (callback: (percent: number) => void) => {
    const handler = (_: Electron.IpcRendererEvent, percent: number): void => callback(percent)
    ipcRenderer.on('update-download-progress', handler)
    return () => ipcRenderer.removeListener('update-download-progress', handler)
  },
  onUpdateDownloaded: (callback: () => void) => {
    const handler = (_: Electron.IpcRendererEvent): void => callback()
    ipcRenderer.on('update-downloaded', handler)
    return () => ipcRenderer.removeListener('update-downloaded', handler)
  },

  // AI
  aiCheckConnection: () => ipcRenderer.invoke('ai:check-connection'),
  aiGetConfig: () => ipcRenderer.invoke('ai:get-config'),
  aiSetConfig: (updates: Record<string, unknown>) => ipcRenderer.invoke('ai:set-config', updates),
  aiWarmup: () => ipcRenderer.invoke('ai:warmup'),
  aiCreateTask: (input: string, tasks: unknown[]) => ipcRenderer.invoke('ai:create-task', input, tasks),
  aiInterpretAction: (message: string, tasks: unknown[]) => ipcRenderer.invoke('ai:interpret-action', message, tasks),
  aiChat: (message: string, tasks: unknown[]) => ipcRenderer.invoke('ai:chat', message, tasks),
  aiStreamChat: (message: string, tasks: unknown[], history: unknown[]) =>
    ipcRenderer.invoke('ai:stream-chat', message, tasks, history),
  aiGetHistory: () => ipcRenderer.invoke('ai:get-history'),
  aiSaveHistory: (messages: unknown[]) => ipcRenderer.invoke('ai:save-history', messages),
  aiPullModel: (model: string) => ipcRenderer.invoke('ai:pull-model', model),
  onAiPullProgress: (
    callback: (p: { status: string; completed?: number; total?: number; percent: number | null }) => void
  ) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      p: { status: string; completed?: number; total?: number; percent: number | null }
    ): void => callback(p)
    ipcRenderer.on('ai:pull-progress', handler)
    return () => ipcRenderer.removeListener('ai:pull-progress', handler)
  },
  onAiPullDone: (callback: () => void) => {
    const handler = (_: Electron.IpcRendererEvent): void => callback()
    ipcRenderer.on('ai:pull-done', handler)
    return () => ipcRenderer.removeListener('ai:pull-done', handler)
  },
  onAiPullError: (callback: (error: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, error: string): void => callback(error)
    ipcRenderer.on('ai:pull-error', handler)
    return () => ipcRenderer.removeListener('ai:pull-error', handler)
  },
  onAiStreamToken: (callback: (token: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, token: string): void => callback(token)
    ipcRenderer.on('ai:stream-token', handler)
    return () => ipcRenderer.removeListener('ai:stream-token', handler)
  },
  onAiStreamDone: (callback: () => void) => {
    const handler = (_: Electron.IpcRendererEvent): void => callback()
    ipcRenderer.on('ai:stream-done', handler)
    return () => ipcRenderer.removeListener('ai:stream-done', handler)
  },
  onAiStreamError: (callback: (error: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, error: string): void => callback(error)
    ipcRenderer.on('ai:stream-error', handler)
    return () => ipcRenderer.removeListener('ai:stream-error', handler)
  },

  // Global shortcut
  registerGlobalShortcut: () => ipcRenderer.invoke('register-global-shortcut'),

  // 메인이 직접 띄우는 알림 문구를 위해 UI 언어를 알려 준다.
  setLanguage: (language: string) => ipcRenderer.invoke('set-language', language),

  // IPC events
  onGlobalQuickAdd: (callback: () => void) => {
    const handler = (_: Electron.IpcRendererEvent): void => callback()
    ipcRenderer.on('global-quick-add', handler)
    return () => ipcRenderer.removeListener('global-quick-add', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
export type Api = typeof api
