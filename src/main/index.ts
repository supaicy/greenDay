import { app, shell, BrowserWindow, globalShortcut, ipcMain, Notification } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { initDatabase, closeDatabase, getTasks } from './database'
import { dueReminders } from './reminders'
import { setupIpcHandlers } from './ipc-handlers'

// 리마인더 폴러 인터벌 핸들 (모듈 스코프에서 선언해 will-quit 핸들러에서 접근 가능)
let reminderInterval: ReturnType<typeof setInterval> | null = null

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    backgroundColor: '#1C1C1E',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const parsed = new URL(details.url)
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        shell.openExternal(details.url)
      }
    } catch {
      /* ignore */
    }
    return { action: 'deny' }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.haru.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  initDatabase()
  setupIpcHandlers()
  createWindow()

  // 리마인더 폴러: 60초마다 도래한 리마인더를 확인하고 시스템 알림 발화
  let lastReminderCheck = new Date().toISOString() // 앱 시작 시점 기록 (과거 리마인더 무시)
  reminderInterval = setInterval(() => {
    const now = new Date().toISOString()
    const due = dueReminders(getTasks() as Record<string, unknown>[], lastReminderCheck, now)
    for (const t of due) {
      new Notification({ title: '리마인더', body: String(t.title ?? '') }).show()
    }
    lastReminderCheck = now
  }, 60 * 1000)

  // 자동 업데이트 설정 (MAS 빌드에서는 App Store가 업데이트를 담당하므로 비활성)
  if (!is.dev && !process.mas) {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('update-available', (info) => {
      const wins = BrowserWindow.getAllWindows()
      if (wins.length > 0) {
        wins[0].webContents.send('update-available', {
          version: info.version,
          downloadUrl: `https://github.com/supaicy/haru/releases/tag/v${info.version}`
        })
      }
    })

    autoUpdater.on('update-not-available', () => {
      const wins = BrowserWindow.getAllWindows()
      if (wins.length > 0) {
        wins[0].webContents.send('update-not-available')
      }
    })

    autoUpdater.on('download-progress', (progress) => {
      const wins = BrowserWindow.getAllWindows()
      if (wins.length > 0) {
        wins[0].webContents.send('update-download-progress', Math.round(progress.percent))
      }
    })

    autoUpdater.on('update-downloaded', () => {
      const wins = BrowserWindow.getAllWindows()
      if (wins.length > 0) {
        wins[0].webContents.send('update-downloaded')
      }
    })

    autoUpdater.checkForUpdates()
    const updateInterval = setInterval(() => autoUpdater.checkForUpdates(), 60 * 60 * 1000)
    app.on('will-quit', () => clearInterval(updateInterval))
  }

  // 업데이트 다운로드 / 설치 IPC (MAS에서는 no-op — App Store가 업데이트 담당)
  ipcMain.handle('download-update', () => {
    if (process.mas) return
    return autoUpdater.downloadUpdate()
  })
  ipcMain.handle('install-update', () => {
    if (process.mas) return
    autoUpdater.quitAndInstall(false, true)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  closeDatabase()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  // 리마인더 폴러 정리
  if (reminderInterval) clearInterval(reminderInterval)
  globalShortcut.unregisterAll()
})
