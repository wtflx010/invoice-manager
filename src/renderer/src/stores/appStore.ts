import { create } from 'zustand'
import type {
  RightPanelMode,
  LeftPanelTab,
  InvoiceCategory,
  InvoiceStatus,
  AppSettings,
  OcrEngineState
} from '../types/invoice'
import { allCategories } from '../utils/classificationRules'

const defaultSettings: AppSettings = {
  aiProvider: 'openai',
  aiApiKey: '',
  aiApiEndpoint: 'https://api.openai.com/v1',
  aiModel: 'gpt-4',
  aiVisionModel: 'gpt-4o',
  aiTemperature: 0.3,
  aiMaxTokens: 4096,
  fileNamingPattern: '{date}_{seller}_{amount}',
  dateFormat: 'YYYY-MM-DD',
  paperSize: 'A5',
  defaultCopies: 1,
  scalePercent: 100,
  printHeader: '',
  printFooter: '',
  duplexPrint: false,
  colorPrint: true,
  storagePath: '',
  storageStrategy: 'all',
  enabledSkills: ['web_search', 'pdf_recognize', 'image_recognize']
}

const defaultOcrState: OcrEngineState = {
  status: 'not_downloaded',
  progress: 0,
  errorMessage: '',
  version: ''
}

interface AppState {
  leftPanelVisible: boolean
  leftPanelTab: LeftPanelTab
  rightPanelVisible: boolean
  rightPanelMode: RightPanelMode
  selectedInvoiceId: string | null
  searchQuery: string
  showSettings: boolean

  settings: AppSettings
  ocrEngine: OcrEngineState
  initialized: boolean

  categories: InvoiceCategory[]
  filterCategory: InvoiceCategory | 'all'
  filterStatus: InvoiceStatus | 'all'

  initialize: () => Promise<void>
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>
  updateOcrState: (updates: Partial<OcrEngineState>) => void
  downloadOcrModel: () => Promise<void>
  checkOcrStatus: () => Promise<void>

  toggleLeftPanel: () => void
  setLeftPanelTab: (tab: LeftPanelTab) => void
  toggleRightPanel: () => void
  setRightPanelMode: (mode: RightPanelMode) => void
  setSelectedInvoiceId: (id: string | null) => void
  setSearchQuery: (query: string) => void
  setFilterCategory: (cat: InvoiceCategory | 'all') => void
  setFilterStatus: (status: InvoiceStatus | 'all') => void
  setShowSettings: (show: boolean) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  leftPanelVisible: true,
  leftPanelTab: 'tree',
  rightPanelVisible: true,
  rightPanelMode: 'detail',
  selectedInvoiceId: null,
  searchQuery: '',
  showSettings: false,

  settings: { ...defaultSettings },
  ocrEngine: { ...defaultOcrState },
  initialized: false,

  categories: allCategories,
  filterCategory: 'all',
  filterStatus: 'all',

  initialize: async () => {
    if (!window.electronAPI) {
      set({ initialized: true })
      return
    }
    try {
      const allDbSettings = await window.electronAPI.db.getAllSettings()
      if (allDbSettings && Object.keys(allDbSettings).length > 0) {
        const merged = { ...defaultSettings }
        const booleanKeys = ['duplexPrint', 'colorPrint'] as const
        const numberKeys = [
          'aiTemperature', 'aiMaxTokens', 'defaultCopies', 'scalePercent'
        ] as const

        const arrayKeys = ['enabledSkills'] as const
        for (const [key, value] of Object.entries(allDbSettings)) {
          if (key in merged) {
            if (booleanKeys.includes(key as typeof booleanKeys[number])) {
              ;(merged as Record<string, unknown>)[key] = value === 'true'
            } else if (numberKeys.includes(key as typeof numberKeys[number])) {
              ;(merged as Record<string, unknown>)[key] = Number(value)
            } else if (arrayKeys.includes(key as typeof arrayKeys[number])) {
              try { ;(merged as Record<string, unknown>)[key] = JSON.parse(value) } catch { ;(merged as Record<string, unknown>)[key] = value }
            } else {
              ;(merged as Record<string, unknown>)[key] = value
            }
          }
        }
        set({ settings: merged })
      } else {
        const entries = Object.entries(defaultSettings)
        for (const [key, value] of entries) {
          const strVal = Array.isArray(value) ? JSON.stringify(value) : String(value)
          await window.electronAPI.db.setSetting(key, strVal)
        }
      }
    } catch (err) {
      console.error('[appStore] Failed to initialize settings:', err)
    }
    set({ initialized: true })
  },

  updateSettings: async (updates) => {
    set((state) => ({
      settings: { ...state.settings, ...updates }
    }))
    if (!window.electronAPI) return
    try {
      for (const [key, value] of Object.entries(updates)) {
        const strVal = Array.isArray(value) ? JSON.stringify(value) : String(value)
        await window.electronAPI.db.setSetting(key, strVal)
      }
    } catch (err) {
      console.error('Failed to persist settings:', err)
      try {
        const allSettings = await window.electronAPI.db.getAllSettings()
        if (allSettings) {
          const restored = { ...defaultSettings }
          const booleanKeys = ['duplexPrint', 'colorPrint'] as const
          const numberKeys = [
            'defaultCopies', 'scalePercent'
          ] as const

          const arrayKeys = ['enabledSkills'] as const
          for (const [key, value] of Object.entries(allSettings)) {
            if (key in restored) {
              const strVal = (() => { try { return JSON.parse(value) } catch { return value } })()
              if (booleanKeys.includes(key as typeof booleanKeys[number])) {
                ;(restored as Record<string, unknown>)[key] = strVal === 'true'
              } else if (numberKeys.includes(key as typeof numberKeys[number])) {
                ;(restored as Record<string, unknown>)[key] = Number(strVal)
              } else if (arrayKeys.includes(key as typeof arrayKeys[number])) {
                ;(restored as Record<string, unknown>)[key] = Array.isArray(strVal) ? strVal : [strVal]
              } else {
                ;(restored as Record<string, unknown>)[key] = strVal
              }
            }
          }
          set({ settings: restored })
        }
      } catch { /* ignore */ }
    }
  },

  updateOcrState: (updates) => {
    set((state) => ({
      ocrEngine: { ...state.ocrEngine, ...updates }
    }))
  },

  downloadOcrModel: async () => {
    set((state) => ({
      ocrEngine: { ...state.ocrEngine, status: 'downloading', progress: 0, errorMessage: '' }
    }))
    try {
      if (!window.electronAPI?.ocr) {
        set((state) => ({
          ocrEngine: { ...state.ocrEngine, status: 'error', errorMessage: 'OCR API not available' }
        }))
        return
      }
      const result = await window.electronAPI.ocr.downloadModel()
      if (result.success) {
        set((state) => ({
          ocrEngine: { ...state.ocrEngine, status: 'ready', progress: 100, version: result.version || '' }
        }))
      } else {
        set((state) => ({
          ocrEngine: {
            ...state.ocrEngine,
            status: 'error',
            errorMessage: result.error || '下载失败'
          }
        }))
      }
    } catch (err) {
      set((state) => ({
        ocrEngine: {
          ...state.ocrEngine,
          status: 'error',
          errorMessage: err instanceof Error ? err.message : String(err)
        }
      }))
    }
  },

  checkOcrStatus: async () => {
    try {
      if (!window.electronAPI?.ocr) return
      const result = await window.electronAPI.ocr.getStatus()
      if (result) {
        set({
          ocrEngine: {
            status: result.ready ? 'ready' : 'not_downloaded',
            progress: result.ready ? 100 : 0,
            errorMessage: '',
            version: result.version || ''
          }
        })
      }
    } catch {
      // ignore check failures
    }
  },

  toggleLeftPanel: () =>
    set((s) => {
      if (s.leftPanelVisible) {
        return { leftPanelVisible: false }
      }
      if (!s.leftPanelVisible && s.leftPanelTab === 'tree') {
        return { leftPanelVisible: true, leftPanelTab: 'tree' }
      }
      return { leftPanelVisible: true }
    }),

  setLeftPanelTab: (tab) =>
    set((s) => {
      if (s.leftPanelVisible && s.leftPanelTab === tab) {
        return { leftPanelVisible: false }
      }
      return { leftPanelVisible: true, leftPanelTab: tab }
    }),

  toggleRightPanel: () =>
    set((s) => ({ rightPanelVisible: !s.rightPanelVisible })),

  setRightPanelMode: (mode) =>
    set({ rightPanelMode: mode, rightPanelVisible: true }),

  setSelectedInvoiceId: (id) =>
    set({ selectedInvoiceId: id }),

  setSearchQuery: (query) =>
    set({ searchQuery: query }),

  setFilterCategory: (cat) =>
    set({ filterCategory: cat }),

  setFilterStatus: (status) =>
    set({ filterStatus: status }),

  setShowSettings: (show) =>
    set({ showSettings: show })
}))