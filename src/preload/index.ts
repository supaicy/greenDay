import { contextBridge, ipcRenderer } from 'electron'
import type { Capabilities } from '../shared/capabilities'
import type { MigrationStatus } from '../shared/migration'
import type { ActivateFailure, DeactivateFailure, PublicLicenseState } from '../shared/license'

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
  addScoreEvents: (events: unknown[]) => ipcRenderer.invoke('add-score-events', events),

  // Attachments
  pickAttachment: () => ipcRenderer.invoke('pick-attachment'),
  openAttachment: (path: string) => ipcRenderer.invoke('open-attachment', path),

  // Export
  exportData: () => ipcRenderer.invoke('export-data'),

  // Notifications — 권한이 없으면 리마인더가 조용히 사라지므로 설정에서 상태를 안내한다.
  notificationPermission: () =>
    ipcRenderer.invoke('app:notification-permission') as Promise<'supported' | 'unsupported'>,
  requestNotificationPermission: () => ipcRenderer.invoke('app:request-notification-permission') as Promise<boolean>,
  openNotificationSettings: () => ipcRenderer.invoke('app:open-notification-settings'),

  // App meta — 이 빌드가 무엇을 할 수 있는가 (shared/capabilities.ts)
  capabilities: () => ipcRenderer.invoke('app:capabilities') as Promise<Capabilities>,

  // 번들 ID 마이그레이션 (shared/migration.ts · main/migration/). 부팅 때 계산된 결과를 받는다.
  migrationStatus: () => ipcRenderer.invoke('migration:status') as Promise<MigrationStatus>,
  // 브리지: "나중에" / 설정에서 다시 열기
  migrationSnooze: () => ipcRenderer.invoke('migration:snooze') as Promise<MigrationStatus>,
  migrationReopen: () => ipcRenderer.invoke('migration:reopen') as Promise<MigrationStatus>,
  // 새 앱: 옛 앱 안내 닫기 / 보호 모드 해제(사용자가 다시 연결한 뒤 명시적으로)
  migrationDismissOldApp: () => ipcRenderer.invoke('migration:dismiss-old-app') as Promise<MigrationStatus>,
  migrationReleaseLock: () => ipcRenderer.invoke('migration:release-lock') as Promise<MigrationStatus>,

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

  // 캘린더 연동. 비밀번호는 저장하러 보낼 때만 오가고, 읽어올 때는 절대 넘어오지 않는다.
  calendarGetConfig: () => ipcRenderer.invoke('calendar:get-config'),
  calendarSaveCredentials: (input: { serverUrl?: string; username?: string; password?: string }) =>
    ipcRenderer.invoke('calendar:save-credentials', input),
  calendarTestConnection: () => ipcRenderer.invoke('calendar:test-connection'),
  calendarSelect: (url: string, name: string) => ipcRenderer.invoke('calendar:select', url, name),
  calendarSyncNow: () => ipcRenderer.invoke('calendar:sync-now'),
  calendarDisconnect: () => ipcRenderer.invoke('calendar:disconnect'),

  // 구글 캘린더. 토큰은 메인에만 있고 렌더러로 넘어오지 않는다.
  googleGetConfig: () => ipcRenderer.invoke('google:get-config'),
  googleConnect: () => ipcRenderer.invoke('google:connect'),
  googleSyncNow: () => ipcRenderer.invoke('google:sync-now'),
  googleDisconnect: () => ipcRenderer.invoke('google:disconnect'),

  // 라이선스. 키도 토큰도 여기로 넘어오지 않는다 — 상태와 가린 키만 온다.
  // 타입을 preload가 한 번 진다 — 64행의 `capabilities`와 같은 방식이다.
  // 렌더러 세 곳이 각자 캐스트하면, 실패 코드가 하나 늘어도 셋 다 조용히 통과한다.
  licenseGetState: () => ipcRenderer.invoke('license:state') as Promise<PublicLicenseState>,
  licenseActivate: (key: string) =>
    ipcRenderer.invoke('license:activate', key) as Promise<ActivateFailure | null>,
  licenseDeactivate: () => ipcRenderer.invoke('license:deactivate') as Promise<DeactivateFailure | null>,
  licenseOpenPurchase: (source: string) => ipcRenderer.invoke('license:purchase', source),
  licenseOpenRecover: () => ipcRenderer.invoke('license:recover'),

  // IPC events
  onLicenseChanged: (callback: (state: PublicLicenseState) => void) => {
    // 상태는 마감 타이머로도 스스로 움직인다. 이걸 안 들으면 설정 화면이 만료된
    // 라이선스를 계속 "활성"이라고 말한다 — 데스크톱 앱은 몇 주씩 안 꺼진다.
    const handler = (_: Electron.IpcRendererEvent, state: PublicLicenseState): void => callback(state)
    ipcRenderer.on('license:changed', handler)
    return () => ipcRenderer.removeListener('license:changed', handler)
  },

  onGlobalQuickAdd: (callback: () => void) => {
    const handler = (_: Electron.IpcRendererEvent): void => callback()
    ipcRenderer.on('global-quick-add', handler)
    return () => ipcRenderer.removeListener('global-quick-add', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
export type Api = typeof api
