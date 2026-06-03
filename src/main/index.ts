import { app, BrowserWindow, ipcMain, shell, nativeImage } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { getDatabase } from './database'
import { registerIpcHandlers } from './ipc-handlers'
import { imapService } from './imap'

if (process.platform === 'linux' || process.platform === 'darwin') {
  app.commandLine.appendSwitch('no-sandbox')
}

let mainWindow: BrowserWindow | null = null

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

function createWindow(): void {
  const iconPath = join(__dirname, '../../resources/icon.png')
  const appIcon = nativeImage.createFromPath(iconPath)

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#ececec',
      symbolColor: '#1a1a2e',
      height: 32
    },
    backgroundColor: '#f5f5f5',
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function setupAutoUpdater(): void {
  autoUpdater.autoDownload = false

  autoUpdater.on('update-available', (info) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      win.webContents.send('update-available', {
        version: info.version,
        releaseNotes: info.releaseNotes as string | undefined
      })
    }
  })

  autoUpdater.on('update-not-available', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      win.webContents.send('update-not-available')
    }
  })

  autoUpdater.on('download-progress', (progressInfo) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      win.webContents.send('update-progress', { percent: progressInfo.percent })
    }
  })

  autoUpdater.on('update-downloaded', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      win.webContents.send('update-downloaded')
    }
  })

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err)
  })

  ipcMain.handle('update:checkForUpdates', async () => {
    try {
      const result = await autoUpdater.checkForUpdates()
      if (result) {
        return {
          updateAvailable: true,
          version: result.updateInfo.version,
          releaseNotes: result.updateInfo.releaseNotes as string | undefined
        }
      }
      return { updateAvailable: false }
    } catch {
      return { updateAvailable: false }
    }
  })

  ipcMain.handle('update:downloadUpdate', async () => {
    try {
      await autoUpdater.downloadUpdate()
    } catch (err) {
      console.error('Download update error:', err)
    }
  })

  ipcMain.handle('update:installUpdate', () => {
    autoUpdater.quitAndInstall(false, true)
  })

  if (!is.dev) {
    autoUpdater.checkForUpdates()
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.invoice-manager.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.on('window-minimize', () => mainWindow?.minimize())
  ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.on('window-close', () => mainWindow?.close())
  ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() ?? false)

  mainWindow?.on('maximize', () => {
    mainWindow?.webContents.send('window-maximized')
  })
  mainWindow?.on('unmaximize', () => {
    mainWindow?.webContents.send('window-unmaximized')
  })


  getDatabase()
  registerIpcHandlers()
  setupAutoUpdater()

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  imapService.disconnectAll()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  imapService.disconnectAll()
  try { getDatabase().close() } catch { /* ignore */ }
})