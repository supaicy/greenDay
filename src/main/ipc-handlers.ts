import { ipcMain, dialog, Notification, globalShortcut, BrowserWindow, shell } from 'electron'
import { writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { v4 as uuid } from 'uuid'
import * as db from './database'
import * as ai from './ai-service'
import { validateTaskInput, validateTaskUpdate } from './validate'

function csvCell(value: unknown): string {
  const s = String(value ?? '')
  const escaped = s.replace(/"/g, '""')
  const safe = /^[=+\-@\t\r\n]/.test(escaped) ? `'${escaped}` : escaped
  return `"${safe}"`
}

async function safeOpenExternal(url: string): Promise<void> {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return
    await shell.openExternal(parsed.href)
  } catch {
    // 잘못된 URL 무시
  }
}

export function setupIpcHandlers(): void {
  // Folders
  ipcMain.handle('get-folders', () => db.getFolders())
  ipcMain.handle('create-folder', (_, id, name) => db.createFolder(id, name))
  ipcMain.handle('update-folder', (_, id, name, collapsed) => db.updateFolder(id, name, collapsed))
  ipcMain.handle('delete-folder', (_, id) => db.deleteFolder(id))

  // Lists
  ipcMain.handle('get-lists', () => db.getLists())
  ipcMain.handle('create-list', (_, id, name, color, icon, folderId) => db.createList(id, name, color, icon, folderId))
  ipcMain.handle('update-list', (_, id, updates) => db.updateList(id, updates))
  ipcMain.handle('delete-list', (_, id) => db.deleteList(id))
  ipcMain.handle('reorder-lists', (_, ids) => db.reorderLists(ids))

  // Tasks
  ipcMain.handle('get-tasks', () => db.getTasks())
  ipcMain.handle('get-trash-tasks', () => db.getTrashTasks())
  ipcMain.handle('create-task', (_, task) => db.createTask(validateTaskInput(task)))
  ipcMain.handle('update-task', (_, task) => db.updateTask(validateTaskUpdate(task)))
  ipcMain.handle('delete-task', (_, id) => db.deleteTask(id))
  ipcMain.handle('restore-task', (_, id) => db.restoreTask(id))
  ipcMain.handle('permanent-delete-task', (_, id) => db.permanentDeleteTask(id))
  ipcMain.handle('empty-trash', () => db.emptyTrash())
  ipcMain.handle('reorder-tasks', (_, ids) => db.reorderTasks(ids))
  ipcMain.handle('batch-update-tasks', (_, ids, updates) => db.batchUpdateTasks(ids, updates))

  // Habits
  ipcMain.handle('get-habits', () => db.getHabits())
  ipcMain.handle('create-habit', (_, id, name, color, frequency, targetDays) =>
    db.createHabit(id, name, color, frequency, targetDays)
  )
  ipcMain.handle('delete-habit', (_, id) => db.deleteHabit(id))
  ipcMain.handle('get-habit-logs', () => db.getHabitLogs())
  ipcMain.handle('toggle-habit-log', (_, id, habitId, date) => db.toggleHabitLog(id, habitId, date))

  // Pomodoro
  ipcMain.handle('get-pomodoro-sessions', () => db.getPomodoroSessions())
  ipcMain.handle('save-pomodoro-session', (_, session) => db.savePomodoroSession(session))

  // Score
  ipcMain.handle('get-score', () => db.getScore())
  ipcMain.handle('add-score-event', (_, event) => db.addScoreEvent(event))

  // Attachments
  ipcMain.handle('pick-attachment', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '모든 파일', extensions: ['*'] },
        { name: '이미지', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
        { name: '문서', extensions: ['pdf', 'doc', 'docx', 'txt', 'md'] }
      ]
    })
    if (result.canceled) return []
    const attachments: { name: string; path: string }[] = []
    for (const filePath of result.filePaths) {
      const name = `${uuid()}-${basename(filePath)}`
      const destPath = db.copyAttachment(filePath, name)
      attachments.push({ name: basename(filePath), path: destPath })
    }
    return attachments
  })
  ipcMain.handle('get-attachments-dir', () => db.getAttachmentsDir())
  // 첨부파일 열기: 시스템 기본 앱으로 파일 경로를 엶
  ipcMain.handle('open-attachment', (_, filePath: string) => shell.openPath(String(filePath)))

  // Export
  ipcMain.handle('export-data', async () => {
    // Local date (not toISOString/UTC) so the filename matches the user's day —
    // toISOString lags a day for positive-UTC users in early-morning hours.
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const result = await dialog.showSaveDialog({
      defaultPath: `ticktick-backup-${today}.json`,
      filters: [
        { name: 'JSON', extensions: ['json'] },
        { name: 'CSV', extensions: ['csv'] }
      ]
    })
    if (result.canceled || !result.filePath) return false
    const ext = result.filePath.endsWith('.csv') ? 'csv' : 'json'
    const exportedData = db.exportData()
    if (ext === 'csv') {
      const parsed = JSON.parse(exportedData)
      const tasks = parsed.tasks || []
      const header = 'Title,Description,Priority,DueDate,List,Completed,CreatedAt\n'
      const rows = tasks
        .map((t: Record<string, unknown>) =>
          [t.title, t.description, t.priority, t.due_date || '', t.list_id, t.completed ? 'Yes' : 'No', t.created_at]
            .map(csvCell)
            .join(',')
        )
        .join('\n')
      writeFileSync(result.filePath, header + rows, 'utf-8')
    } else {
      writeFileSync(result.filePath, exportedData, 'utf-8')
    }
    return true
  })

  // Notifications
  ipcMain.handle('show-notification', (_, title, body) => {
    new Notification({ title, body }).show()
  })

  // 외부 링크 열기
  ipcMain.handle('open-external', (_, url: string) => {
    safeOpenExternal(url)
  })

  // AI
  ipcMain.handle('ai:check-connection', () => ai.checkConnection())
  ipcMain.handle('ai:warmup', () => ai.warmupModel())
  ipcMain.handle('ai:get-config', () => ai.getAiConfig())
  ipcMain.handle('ai:set-config', (_, updates) => ai.setAiConfig(updates))
  ipcMain.handle('ai:create-task', (_, input, tasks) => ai.createTaskFromNL(input, tasks))
  ipcMain.handle('ai:chat', (_, message, tasks) => ai.chat(message, tasks))
  ipcMain.handle('ai:stream-chat', (event, message, tasks, history) => {
    const sender = event.sender
    ai.streamChat(
      message,
      tasks,
      history ?? [],
      (token) => {
        if (!sender.isDestroyed()) sender.send('ai:stream-token', token)
      },
      () => {
        if (!sender.isDestroyed()) sender.send('ai:stream-done')
      },
      (error) => {
        if (!sender.isDestroyed()) sender.send('ai:stream-error', error)
      }
    )
  })
  ipcMain.handle('ai:get-history', () => db.getChatHistory())
  ipcMain.handle('ai:save-history', (_, messages) => db.saveChatHistory(messages))

  // Quick add (global shortcut)
  ipcMain.handle('register-global-shortcut', () => {
    // MAS 샌드박스에서는 시스템 전역 단축키를 등록할 수 없어 조용히 실패 → no-op
    if (process.mas) return false
    try {
      globalShortcut.register('CommandOrControl+Shift+A', () => {
        const wins = BrowserWindow.getAllWindows()
        if (wins.length > 0) {
          const win = wins[0]
          if (win.isMinimized()) win.restore()
          win.focus()
          win.webContents.send('global-quick-add')
        }
      })
      return true
    } catch {
      return false
    }
  })
}
