import { create } from 'zustand'
import type {
  Invoice,
  InvoiceCategory,
  InvoiceCategoryGroup,
  YearMonthGroup,
  InvoiceStatistics,
  MonthStatistics,
  PrintJob
} from '../types/invoice'
import { allCategories } from '../utils/classificationRules'

interface InvoiceState {
  invoices: Invoice[]
  printQueue: PrintJob[]
  initialized: boolean

  initialize: () => Promise<void>

  addInvoice: (invoice: Invoice) => Promise<void>
  addInvoices: (invoices: Invoice[]) => Promise<void>
  updateInvoice: (id: string, updates: Partial<Invoice>) => Promise<void>
  deleteInvoice: (id: string) => Promise<void>
  clearAllInvoices: () => Promise<void>

  addToPrintQueue: (invoice: Invoice, copies?: number) => void
  removeFromPrintQueue: (id: string) => void
  clearPrintQueue: () => void

  getInvoicesByCategory: () => InvoiceCategoryGroup[]
  getYearMonthGroups: (category: InvoiceCategory) => YearMonthGroup[]
  getStatistics: () => InvoiceStatistics
  searchInvoices: (query: string) => Invoice[]
  getInvoiceById: (id: string) => Invoice | undefined
}

export const useInvoiceStore = create<InvoiceState>((set, get) => ({
  invoices: [],
  printQueue: [],
  initialized: false,

  initialize: async () => {
    if (!window.electronAPI) {
      set({ invoices: [], initialized: true })
      return
    }
    try {
      const invs = await window.electronAPI.db.getAllInvoices() as unknown as Invoice[]
      set({ invoices: invs || [], initialized: true })
    } catch (err) {
      console.error('Failed to initialize invoice store:', err)
      set({ initialized: true })
    }
  },

  addInvoice: async (invoice) => {
    if (!window.electronAPI) {
      set((state) => ({ invoices: [...state.invoices, invoice] }))
      return
    }
    try {
      await window.electronAPI.db.insertInvoice(invoice as unknown as Record<string, unknown>)
      const all = await window.electronAPI.db.getAllInvoices() as unknown as Invoice[]
      set({ invoices: all })
    } catch (err) {
      console.error('Failed to add invoice:', err)
    }
  },

  addInvoices: async (invoices) => {
    if (!window.electronAPI) {
      set((state) => ({ invoices: [...state.invoices, ...invoices] }))
      return
    }
    try {
      await window.electronAPI.db.insertInvoices(invoices as unknown as Record<string, unknown>[])
      const all = await window.electronAPI.db.getAllInvoices() as unknown as Invoice[]
      set({ invoices: all })
    } catch (err) {
      console.error('Failed to add invoices:', err)
    }
  },

  updateInvoice: async (id, updates) => {
    set((state) => ({
      invoices: state.invoices.map((inv) =>
        inv.id === id ? { ...inv, ...updates, updatedAt: new Date().toISOString() } : inv
      )
    }))
    if (!window.electronAPI) return
    try {
      await window.electronAPI.db.updateInvoice(id, updates)
    } catch (err) {
      console.error('Failed to update invoice:', err)
      try {
        const all = await window.electronAPI.db.getAllInvoices() as unknown as Invoice[]
        set({ invoices: all })
      } catch { /* ignore */ }
    }
  },

  deleteInvoice: async (id) => {
    if (!window.electronAPI) {
      set((state) => ({
        invoices: state.invoices.filter((inv) => inv.id !== id)
      }))
      return
    }
    try {
      await window.electronAPI.db.deleteInvoice(id)
      set((state) => ({
        invoices: state.invoices.filter((inv) => inv.id !== id)
      }))
    } catch (err) {
      console.error('Failed to delete invoice:', err)
    }
  },

  clearAllInvoices: async () => {
    if (!window.electronAPI) {
      set({ invoices: [], printQueue: [] })
      return
    }
    try {
      await window.electronAPI.db.clearAllInvoices()
      set({ invoices: [], printQueue: [] })
    } catch (err) {
      console.error('Failed to clear invoices:', err)
    }
  },

  addToPrintQueue: (invoice, copies = 1) =>
    set((state) => {
      const exists = state.printQueue.find((j) => j.invoiceId === invoice.id)
      if (exists) return state
      return {
        printQueue: [
          ...state.printQueue,
          {
            id: `print-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            invoiceId: invoice.id,
            invoice,
            copies,
            createdAt: new Date().toISOString()
          }
        ]
      }
    }),

  removeFromPrintQueue: (id) =>
    set((state) => ({
      printQueue: state.printQueue.filter((job) => job.id !== id)
    })),

  clearPrintQueue: () => set({ printQueue: [] }),

  getInvoicesByCategory: () => {
    const invoices = get().invoices
    const categoryMap = new Map<string, InvoiceCategoryGroup>()

    for (const inv of invoices) {
      const key = inv.subCategory
        ? `${inv.category}-${inv.subCategory}`
        : inv.category

      if (!categoryMap.has(key)) {
        categoryMap.set(key, {
          category: inv.category,
          subCategory: inv.subCategory,
          count: 0,
          totalAmount: 0,
          invoices: []
        })
      }
      const group = categoryMap.get(key)!
      group.count++
      group.totalAmount += inv.totalAmount
      group.invoices.push(inv)
    }

    return Array.from(categoryMap.values()).sort(
      (a, b) => allCategories.indexOf(a.category) - allCategories.indexOf(b.category)
    )
  },

  getYearMonthGroups: (category) => {
    const invoices = get().invoices.filter((inv) => inv.category === category)
    const groupMap = new Map<string, YearMonthGroup>()

    for (const inv of invoices) {
      const date = new Date(inv.issueDate)
      const key = `${date.getFullYear()}-${date.getMonth() + 1}`
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          year: date.getFullYear(),
          month: date.getMonth() + 1,
          count: 0,
          totalAmount: 0,
          invoices: []
        })
      }
      const group = groupMap.get(key)!
      group.count++
      group.totalAmount += inv.totalAmount
      group.invoices.push(inv)
    }

    return Array.from(groupMap.values()).sort(
      (a, b) => b.year - a.year || b.month - a.month
    )
  },

  getStatistics: () => {
    const invoices = get().invoices
    const byCategory = get().getInvoicesByCategory()

    const pendingCount = invoices.filter((i) => i.status === 'pending').length
    const reimbursedCount = invoices.filter((i) => i.status === 'reimbursed').length

    const byMonth: MonthStatistics[] = []
    const monthMap = new Map<string, MonthStatistics>()
    for (const inv of invoices) {
      const month = inv.issueDate.substring(0, 7)
      if (!monthMap.has(month)) {
        monthMap.set(month, { month, count: 0, totalAmount: 0 })
      }
      const stat = monthMap.get(month)!
      stat.count++
      stat.totalAmount += inv.totalAmount
    }
    byMonth.push(
      ...Array.from(monthMap.values()).sort((a, b) => a.month.localeCompare(b.month))
    )

    return {
      totalCount: invoices.length,
      totalAmount: invoices.reduce((sum, inv) => sum + inv.totalAmount, 0),
      totalTaxAmount: invoices.reduce((sum, inv) => sum + inv.taxAmount, 0),
      totalAmountWithoutTax: invoices.reduce((sum, inv) => sum + inv.amountWithoutTax, 0),
      byCategory,
      byMonth,
      byStatus: { pending: pendingCount, reimbursed: reimbursedCount }
    }
  },

  searchInvoices: (query) => {
    const invoices = get().invoices
    const lowerQuery = query.toLowerCase()
    return invoices.filter(
      (inv) =>
        inv.invoiceNumber.toLowerCase().includes(lowerQuery) ||
        inv.invoiceCode.toLowerCase().includes(lowerQuery) ||
        inv.sellerName.toLowerCase().includes(lowerQuery) ||
        inv.buyerName.toLowerCase().includes(lowerQuery) ||
        inv.notes?.toLowerCase().includes(lowerQuery) ||
        inv.tags?.some((tag) => tag.toLowerCase().includes(lowerQuery))
    )
  },

  getInvoiceById: (id) => get().invoices.find((inv) => inv.id === id)
}))