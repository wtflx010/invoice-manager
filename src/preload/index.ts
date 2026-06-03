import { contextBridge, ipcRenderer } from 'electron'

const api = {
  db: {
    getAllInvoices: () => ipcRenderer.invoke('db:getAllInvoices'),
    getInvoiceById: (id: string) => ipcRenderer.invoke('db:getInvoiceById', { id }),
    insertInvoice: (invoice: Record<string, unknown>) => ipcRenderer.invoke('db:insertInvoice', invoice),
    insertInvoices: (invoices: Record<string, unknown>[]) => ipcRenderer.invoke('db:insertInvoices', { invoices }),
    updateInvoice: (id: string, updates: Record<string, unknown>) => ipcRenderer.invoke('db:updateInvoice', { id, updates }),
    deleteInvoice: (id: string) => ipcRenderer.invoke('db:deleteInvoice', { id }),
    clearAllInvoices: () => ipcRenderer.invoke('db:clearAllInvoices'),
    getSetting: (key: string) => ipcRenderer.invoke('db:getSetting', { key }),
    setSetting: (key: string, value: string) => ipcRenderer.invoke('db:setSetting', { key, value }),
    getAllSettings: () => ipcRenderer.invoke('db:getAllSettings'),
    getEmailAccounts: () => ipcRenderer.invoke('db:getEmailAccounts'),
    insertEmailAccount: (account: Record<string, unknown>) => ipcRenderer.invoke('db:insertEmailAccount', account),
    deleteEmailAccount: (id: string) => ipcRenderer.invoke('db:deleteEmailAccount', { id }),
    checkDuplicate: (invoiceCode: string, invoiceNumber: string, sellerName?: string) => ipcRenderer.invoke('db:checkDuplicate', { invoiceCode, invoiceNumber, sellerName })
  },
  invoice: {
    list: () => ipcRenderer.invoke('invoice:list'),
    get: (id: string) => ipcRenderer.invoke('invoice:get', { id }),
    delete: (id: string) => ipcRenderer.invoke('invoice:delete', { id }),
    deleteBatch: (ids: string[]) => ipcRenderer.invoke('invoice:deleteBatch', { ids }),
    update: (id: string, data: Record<string, unknown>) => ipcRenderer.invoke('invoice:update', { id, data }),
    addBatch: (invoices: Array<Record<string, unknown>>) => ipcRenderer.invoke('invoice:addBatch', { invoices }),
    batchReRecognize: (ids: string[]) => ipcRenderer.invoke('invoice:batchReRecognize', { invoiceIds: ids })
  },
  file: {
    openFileDialog: () => ipcRenderer.invoke('file:openFileDialog'),
    openFolderDialog: () => ipcRenderer.invoke('file:openFolderDialog'),
    openWithDefaultApp: (filePath: string) => ipcRenderer.invoke('file:openFileWithDefault', { filePath }),
    importFiles: (filePaths: string[]) => ipcRenderer.invoke('file:importFiles', { filePaths }),
    getFileInfo: (filePath: string) => ipcRenderer.invoke('file:getFileInfo', { filePath }),
    readFile: (filePath: string) => ipcRenderer.invoke('file:readFile', { filePath }),
    pdfToImage: (filePath: string) => ipcRenderer.invoke('file:pdfToImage', { filePath }),
    saveFile: (fileName: string, data: string, mimeType: string, targetPath?: string) =>
      ipcRenderer.invoke('file:saveFile', { fileName, data, mimeType, targetPath }),
    parseInvoice: (filePath: string) => ipcRenderer.invoke('file:parseInvoice', { filePath }),
    parseInvoiceWithAI: (rawText: string) => ipcRenderer.invoke('file:parseInvoiceWithAI', { rawText }),
    parseInvoiceWithVision: (filePath: string) => ipcRenderer.invoke('file:parseInvoiceWithVision', { filePath }),
    getOfdPreview: (filePath: string) => ipcRenderer.invoke('file:getOfdPreview', { filePath }),
    renameInvoice: (id: string, oldPath: string, newName: string) =>
      ipcRenderer.invoke('file:renameInvoice', { id, oldPath, newName }),
    downloadFromUrl: (url: string) => ipcRenderer.invoke('file:downloadFromUrl', { url })
  },
  print: {
    printInvoice: (filePath: string, options?: { paperSize?: string; copies?: number; duplex?: boolean; preview?: boolean }) =>
      ipcRenderer.invoke('print:invoice', { filePath, options })
  },
  app: {
    getDataPath: () => ipcRenderer.invoke('app:getDataPath')
  },
  ai: {
    testConnection: (endpoint: string, apiKey: string) => ipcRenderer.invoke('ai:testConnection', { endpoint, apiKey }),
    chat: (endpoint: string, apiKey: string, body: Record<string, unknown>) => ipcRenderer.invoke('ai:chat', { endpoint, apiKey, body })
  },
  dialog: {
    saveFileDialog: (defaultName: string) => ipcRenderer.invoke('dialog:saveFileDialog', { defaultName }),
    openFolderDialog: () => ipcRenderer.invoke('dialog:openFolderDialog')
  },
  imap: {
    connect: (accountId: string) => ipcRenderer.invoke('imap:connect', { accountId }),
    disconnect: (accountId: string) => ipcRenderer.invoke('imap:disconnect', { accountId }),
    fetchEmails: (accountId: string, options?: { limit?: number }) =>
      ipcRenderer.invoke('imap:fetchEmails', { accountId, ...options }),
    searchInvoices: (accountId: string) =>
      ipcRenderer.invoke('imap:searchInvoices', { accountId }),
    getAttachments: (accountId: string, emailUid: number) => ipcRenderer.invoke('imap:getAttachments', { accountId, emailUid }),
    getEmailBody: (accountId: string, emailUid: number) => ipcRenderer.invoke('imap:getEmailBody', { accountId, emailUid }),
    downloadAttachment: (accountId: string, emailUid: number, partId: string) =>
      ipcRenderer.invoke('imap:downloadAttachment', { accountId, emailUid, partId }),
    isConnected: (accountId: string) => ipcRenderer.invoke('imap:isConnected', { accountId })
  },
  window: {
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),
    isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
    onMaximize: (callback: () => void) => {
      ipcRenderer.on('window-maximized', callback)
      return () => ipcRenderer.removeListener('window-maximized', callback)
    },
    onUnmaximize: (callback: () => void) => {
      ipcRenderer.on('window-unmaximized', callback)
      return () => ipcRenderer.removeListener('window-unmaximized', callback)
    }
  },
  update: {
    checkForUpdates: () => ipcRenderer.invoke('update:checkForUpdates'),
    downloadUpdate: () => ipcRenderer.invoke('update:downloadUpdate'),
    installUpdate: () => ipcRenderer.invoke('update:installUpdate'),
    onUpdateAvailable: (callback: (info: { version: string; releaseNotes?: string }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, info: { version: string; releaseNotes?: string }) => callback(info)
      ipcRenderer.on('update-available', handler)
      return () => ipcRenderer.removeListener('update-available', handler)
    },
    onUpdateNotAvailable: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('update-not-available', handler)
      return () => ipcRenderer.removeListener('update-not-available', handler)
    },
    onUpdateDownloaded: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('update-downloaded', handler)
      return () => ipcRenderer.removeListener('update-downloaded', handler)
    },
    onUpdateProgress: (callback: (progress: { percent: number }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, progress: { percent: number }) => callback(progress)
      ipcRenderer.on('update-progress', handler)
      return () => ipcRenderer.removeListener('update-progress', handler)
    }
  },
  memory: {
    createConversation: (id: string, title: string) => ipcRenderer.invoke('memory:createConversation', { id, title }),
    getConversations: () => ipcRenderer.invoke('memory:getConversations'),
    updateConversation: (id: string, updates: Record<string, unknown>) =>
      ipcRenderer.invoke('memory:updateConversation', { id, updates }),
    deleteConversation: (id: string) => ipcRenderer.invoke('memory:deleteConversation', { id }),
    saveMessage: (msg: Record<string, unknown>) => ipcRenderer.invoke('memory:saveMessage', msg),
    getMessages: (conversationId: string) => ipcRenderer.invoke('memory:getMessages', { conversationId }),
    saveMemory: (memory: Record<string, unknown>) => ipcRenderer.invoke('memory:saveMemory', memory),
    getMemoriesByConversation: (conversationId: string) =>
      ipcRenderer.invoke('memory:getMemoriesByConversation', { conversationId }),
    getAllMemories: () => ipcRenderer.invoke('memory:getAllMemories'),
    searchMemories: (query: string) => ipcRenderer.invoke('memory:searchMemories', { query }),
    deleteMemory: (id: string) => ipcRenderer.invoke('memory:deleteMemory', { id })
  },
  skill: {
    getConfigs: () => ipcRenderer.invoke('skill:getConfigs'),
    setConfig: (skillName: string, enabled: boolean, config?: Record<string, unknown>) =>
      ipcRenderer.invoke('skill:setConfig', { skillName, enabled, config }),
    setConfigs: (configs: Array<{ skillName: string; enabled: boolean; config?: Record<string, unknown> }>) =>
      ipcRenderer.invoke('skill:setConfigs', { configs })
  },
  ocr: {
    getStatus: () => ipcRenderer.invoke('ocr:getStatus'),
    downloadModel: () => ipcRenderer.invoke('ocr:downloadModel'),
    recognize: (filePath: string) => ipcRenderer.invoke('ocr:recognize', { filePath })
  },
  webSearch: {
    search: (query: string) => ipcRenderer.invoke('webSearch:search', { query })
  }
}

export type ElectronAPI = typeof api

contextBridge.exposeInMainWorld('electronAPI', api)