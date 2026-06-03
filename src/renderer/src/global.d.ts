declare module '*.png' {
  const value: string
  export default value
}

declare const __APP_VERSION__: string

declare module '*.jpg' {
  const value: string
  export default value
}

interface Window {
  electronAPI?: {
    db: {
      getAllInvoices: () => Promise<Record<string, unknown>[]>
      getInvoiceById: (id: string) => Promise<Record<string, unknown> | null>
      insertInvoice: (invoice: Record<string, unknown>) => Promise<Record<string, unknown>>
      insertInvoices: (invoices: Record<string, unknown>[]) => Promise<void>
      updateInvoice: (id: string, updates: Record<string, unknown>) => Promise<void>
      deleteInvoice: (id: string) => Promise<void>
      clearAllInvoices: () => Promise<void>
      setSetting: (key: string, value: string) => Promise<void>
      getSetting: (key: string) => Promise<string | null>
      getAllSettings: () => Promise<Record<string, string>>
      getEmailAccounts: () => Promise<Record<string, unknown>[]>
      insertEmailAccount: (account: Record<string, unknown>) => Promise<Record<string, unknown>>
      deleteEmailAccount: (id: string) => Promise<{ success: boolean }>
      checkDuplicate: (invoiceCode: string, invoiceNumber: string, sellerName?: string) => Promise<boolean>
    }
    invoice: {
      list: () => Promise<{ success: boolean; invoices?: Record<string, unknown>[]; error?: string }>
      get: (id: string) => Promise<{ success: boolean; invoice?: Record<string, unknown>; error?: string }>
      delete: (id: string) => Promise<{ success: boolean; error?: string }>
      deleteBatch: (ids: string[]) => Promise<{ success: boolean; deleted?: number; error?: string }>
      update: (id: string, data: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>
      addBatch: (invoices: Array<Record<string, unknown>>) => Promise<{ success: boolean; inserted?: number; error?: string }>
      batchReRecognize: (ids: string[]) => Promise<{ success: boolean; results?: Array<{ id: string; success: boolean; data?: Record<string, unknown>; error?: string }>; error?: string }>
    }
    file: {
      openFileDialog: () => Promise<string[]>
      openFolderDialog: () => Promise<string[]>
      importFiles: (paths: string[]) => Promise<
        Array<{ fileName: string; filePath: string; fileFormat: string }>
      >
      readFile: (filePath: string) => Promise<{ data: string; mimeType: string }>
      pdfToImage: (filePath: string) => Promise<{ success: boolean; data?: string; mimeType?: string; error?: string }>
      saveFile: (fileName: string, data: string, mimeType: string, targetPath?: string) =>
        Promise<{ filePath: string; fileName: string; error?: string }>
      getFileInfo: (filePath: string) => Promise<{ fileName: string; fileFormat: string; size: number }>
      parseInvoice: (filePath: string) => Promise<Record<string, unknown>>
      parseInvoiceWithAI: (rawText: string) => Promise<Record<string, unknown>>
      parseInvoiceWithVision: (filePath: string) => Promise<Record<string, unknown>>
      getOfdPreview: (filePath: string) => Promise<{ success: boolean; data?: string; mimeType?: string; error?: string }>
      renameInvoice: (id: string, oldPath: string, newName: string) =>
        Promise<{ success: boolean; newPath?: string; newFileName?: string; error?: string; skipped?: boolean }>
      openWithDefaultApp: (filePath: string) => Promise<string>
      downloadFromUrl: (url: string) => Promise<{ success: boolean; fileName?: string; data?: string; mimeType?: string; error?: string }>
    }
    imap: {
      connect: (accountId: string) => Promise<{ success: boolean; error?: string | null }>
      disconnect: (accountId: string) => Promise<{ success: boolean }>
      fetchEmails: (accountId: string, options?: { limit?: number }) =>
        Promise<{ emails: unknown[]; total: number; error?: string }>
      getAttachments: (accountId: string, emailUid: number) =>
        Promise<Array<{ emailUid: number; fileName: string; mimeType: string; size: number; partId: string }>>
      getEmailBody: (accountId: string, emailUid: number) => Promise<{ success: boolean; body?: string; error?: string }>
      searchInvoices: (accountId: string) =>
        Promise<{ emails: unknown[]; total: number; searched: number; error?: string }>
      downloadAttachment: (accountId: string, emailUid: number, partId: string) =>
        Promise<{ fileName: string; data: string; mimeType: string; error?: string }>
      isConnected: (accountId: string) => Promise<boolean>
    }
    print: {
      printInvoice: (filePath: string, options?: { paperSize?: string; copies?: number; duplex?: boolean; preview?: boolean }) =>
        Promise<{ success: boolean; error?: string; preview?: boolean; opened?: boolean }>
    }
    app: {
      getDataPath: () => Promise<string>
    }
    ai: {
      testConnection: (endpoint: string, apiKey: string) => Promise<{ success: boolean; models?: string[]; error?: string }>
      chat: (endpoint: string, apiKey: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>
    }
    dialog: {
      saveFileDialog: (defaultName: string) => Promise<string | undefined>
      openFolderDialog: () => Promise<string | null>
    }
    window: {
      close: () => void
      minimize: () => void
      maximize: () => void
      isMaximized: () => Promise<boolean>
      onMaximize: (callback: () => void) => () => void
      onUnmaximize: (callback: () => void) => () => void
    }
    update: {
      checkForUpdates: () => Promise<{ updateAvailable: boolean; version?: string; releaseNotes?: string }>
      downloadUpdate: () => Promise<void>
      installUpdate: () => Promise<void>
      onUpdateAvailable: (callback: (info: { version: string; releaseNotes?: string }) => void) => () => void
      onUpdateNotAvailable: (callback: () => void) => () => void
      onUpdateDownloaded: (callback: () => void) => () => void
      onUpdateProgress: (callback: (progress: { percent: number }) => void) => () => void
    }
    memory: {
      createConversation: (id: string, title: string) => Promise<void>
      getConversations: () => Promise<Record<string, unknown>[]>
      updateConversation: (id: string, updates: Record<string, unknown>) => Promise<void>
      deleteConversation: (id: string) => Promise<void>
      saveMessage: (msg: Record<string, unknown>) => Promise<void>
      getMessages: (conversationId: string) => Promise<Record<string, unknown>[]>
      saveMemory: (memory: Record<string, unknown>) => Promise<void>
      getMemoriesByConversation: (conversationId: string) => Promise<Record<string, unknown>[]>
      getAllMemories: () => Promise<Record<string, unknown>[]>
      searchMemories: (query: string) => Promise<Record<string, unknown>[]>
      deleteMemory: (id: string) => Promise<void>
    }
    skill: {
      getConfigs: () => Promise<Record<string, unknown>[]>
      setConfig: (skillName: string, enabled: boolean, config?: Record<string, unknown>) => Promise<void>
      setConfigs: (configs: Array<{ skillName: string; enabled: boolean; config?: Record<string, unknown> }>) => Promise<void>
    }
    ocr: {
      getStatus: () => Promise<{ ready: boolean; version: string; error?: string }>
      downloadModel: () => Promise<{ success: boolean; version?: string; error?: string; steps?: Array<{ step: string; status: string; error?: string; version?: string }> }>
      recognize: (filePath: string) => Promise<{ success: boolean; fullText?: string; leftText?: string; rightText?: string; lineCount?: number; pageCount?: number; error?: string }>
    }
    webSearch: {
      search: (query: string) => Promise<{ success: boolean; results?: Array<{ title: string; url: string; snippet: string }>; error?: string }>
    }
  }
  __toggleLeft?: () => void
  __toggleRight?: () => void
}
