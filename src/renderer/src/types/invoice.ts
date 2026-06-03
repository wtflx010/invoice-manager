export type InvoiceCategory =
  | '餐饮'
  | '住宿'
  | '机票'
  | '车票'
  | '打车'
  | '办公用品'
  | '通讯费'
  | '会议费'
  | '培训费'
  | '加油费'
  | '过路费'
  | '停车费'
  | '其他'

export type InvoiceStatus = 'pending' | 'reimbursed'

export interface Invoice {
  id: string
  invoiceCode: string
  invoiceNumber: string
  invoiceType: string
  category: InvoiceCategory
  subCategory?: string
  status: InvoiceStatus
  issueDate: string
  sellerName: string
  sellerTaxNumber: string
  buyerName: string
  buyerTaxNumber: string
  amountWithoutTax: number
  taxAmount: number
  totalAmount: number
  filePath: string
  fileName: string
  fileFormat: 'pdf' | 'ofd' | 'xml' | 'image'
  source: 'email' | 'manual' | 'scan'
  tags: string[]
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface InvoiceCategoryGroup {
  category: InvoiceCategory
  subCategory?: string
  count: number
  totalAmount: number
  invoices: Invoice[]
}

export interface YearMonthGroup {
  year: number
  month: number
  count: number
  totalAmount: number
  invoices: Invoice[]
}

export interface InvoiceStatistics {
  totalCount: number
  totalAmount: number
  totalTaxAmount: number
  totalAmountWithoutTax: number
  byCategory: InvoiceCategoryGroup[]
  byMonth: MonthStatistics[]
  byStatus: { pending: number; reimbursed: number }
}

export interface MonthStatistics {
  month: string
  count: number
  totalAmount: number
}

export interface PrintJob {
  id: string
  invoiceId: string
  invoice: Invoice
  copies: number
  createdAt: string
}

export type RightPanelMode = 'email' | 'detail' | 'print'

export type LeftPanelTab = 'tree' | 'statistics'

export interface EmailAccount {
  id: string
  name: string
  email: string
  provider: string
  imapHost: string
  imapPort: number
  smtpHost: string
  smtpPort: number
  useTls: boolean
  createdAt: string
}

export type OcrEngineStatus = 'not_downloaded' | 'downloading' | 'installing' | 'ready' | 'error'

export interface OcrEngineState {
  status: OcrEngineStatus
  progress: number
  errorMessage: string
  version: string
}

export interface AppSettings {
  aiProvider: string
  aiApiKey: string
  aiApiEndpoint: string
  aiModel: string
  aiVisionModel: string
  aiTemperature: number
  aiMaxTokens: number
  fileNamingPattern: string
  dateFormat: string
  paperSize: string
  defaultCopies: number
  scalePercent: number
  printHeader: string
  printFooter: string
  duplexPrint: boolean
  colorPrint: boolean
  storagePath: string
  storageStrategy: 'all' | 'pdf_only' | 'xml_only'
  enabledSkills: string[]
}