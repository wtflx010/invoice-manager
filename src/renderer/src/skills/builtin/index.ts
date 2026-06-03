import type { Skill, SkillResult } from '../types'
import type { Invoice, InvoiceCategory, InvoiceStatus } from '../../types/invoice'
import { useInvoiceStore } from '../../stores/invoiceStore'
import { allCategories } from '../../utils/classificationRules'

function getStore() {
  const state = useInvoiceStore.getState()
  if (!state.initialized) state.initialize()
  return state
}

export function formatAmount(amount: number): string {
  return '¥' + amount.toFixed(2)
}

export function invoiceToDisplay(inv: Invoice): Record<string, unknown> {
  return {
    id: inv.id,
    invoiceCode: inv.invoiceCode || '(无)',
    invoiceNumber: inv.invoiceNumber,
    invoiceType: inv.invoiceType,
    category: inv.category,
    subCategory: inv.subCategory || '',
    status: inv.status === 'pending' ? '待报销' : '已报销',
    issueDate: inv.issueDate,
    sellerName: inv.sellerName,
    buyerName: inv.buyerName,
    amountWithoutTax: inv.amountWithoutTax,
    taxAmount: inv.taxAmount,
    totalAmount: inv.totalAmount,
    tags: inv.tags,
    notes: inv.notes || '',
    fileName: inv.fileName
  }
}

function n(params: Record<string, unknown>, key: string): number {
  return Number(params[key])
}

function s(params: Record<string, unknown>, key: string): string {
  return String(params[key] || '')
}

type ExecFn = (params: Record<string, unknown>) => Promise<SkillResult>

function sk(
  name: string,
  description: string,
  category: Skill['category'],
  enabledByDefault: boolean,
  parameters: Skill['parameters'],
  execute: ExecFn
): Skill {
  return { name, description, category, enabledByDefault, parameters, execute }
}

const searchInvoices: Skill = sk(
  'search_invoices',
  '搜索发票，支持按发票号码、销售方名称、购买方名称、备注、标签等关键词搜索，返回匹配的发票列表',
  'invoice_query',
  true,
  { query: { type: 'string', description: '搜索关键词', required: true } },
  async (params) => {
    const query = s(params, 'query')
    if (!query.trim()) return { success: false, error: '请提供搜索关键词' }
    const results = getStore().searchInvoices(query)
    if (results.length === 0) return { success: true, data: [], message: '未找到匹配的发票' }
    return {
      success: true,
      data: results.map(invoiceToDisplay),
      message: `找到 ${results.length} 张匹配的发票，合计 ${formatAmount(results.reduce((sum, i) => sum + i.totalAmount, 0))}`
    }
  }
)

const getInvoiceDetail: Skill = sk(
  'get_invoice_detail',
  '获取单张发票的完整详细信息',
  'invoice_query',
  true,
  { invoice_id: { type: 'string', description: '发票 ID', required: true } },
  async (params) => {
    const id = s(params, 'invoice_id')
    if (!id) return { success: false, error: '请提供发票 ID' }
    const inv = getStore().getInvoiceById(id)
    if (!inv) return { success: false, error: `未找到 ID 为 ${id} 的发票` }
    return { success: true, data: invoiceToDisplay(inv) }
  }
)

const getStatistics: Skill = sk(
  'get_statistics',
  '获取发票统计数据，包括总数、总金额、分类别统计、按月统计、按状态统计',
  'statistics',
  true,
  {} as Skill['parameters'],
  async () => {
    const stats = getStore().getStatistics()
    return {
      success: true,
      data: {
        totalCount: stats.totalCount,
        totalAmount: formatAmount(stats.totalAmount),
        totalTaxAmount: formatAmount(stats.totalTaxAmount),
        amountWithoutTax: formatAmount(stats.totalAmountWithoutTax),
        byCategory: stats.byCategory.map(c => ({
          category: c.category,
          subCategory: c.subCategory || '',
          count: c.count,
          totalAmount: formatAmount(c.totalAmount)
        })),
        byStatus: stats.byStatus,
        byMonth: stats.byMonth
      }
    }
  }
)

const updateInvoice: Skill = sk(
  'update_invoice',
  '更新发票的字段信息，如类别、状态、备注等',
  'invoice_write',
  true,
  {
    invoice_id: { type: 'string', description: '发票 ID', required: true },
    category: { type: 'string', description: '新类别，可选：餐饮/住宿/机票/车票/打车/办公用品/通讯费/会议费/培训费/加油费/过路费/停车费/其他' },
    status: { type: 'string', description: '新状态：pending 或 reimbursed', enum: ['pending', 'reimbursed'] },
    notes: { type: 'string', description: '新备注内容' }
  },
  async (params) => {
    const id = s(params, 'invoice_id')
    if (!id) return { success: false, error: '请提供发票 ID' }
    const inv = getStore().getInvoiceById(id)
    if (!inv) return { success: false, error: `未找到 ID 为 ${id} 的发票` }
    const updates: Partial<Invoice> = {}
    const changed: string[] = []
    if (params.category && typeof params.category === 'string') {
      const cat = params.category as InvoiceCategory
      if (allCategories.includes(cat)) { updates.category = cat; changed.push(`类别 → ${cat}`) }
      else return { success: false, error: `无效类别: ${params.category}。有效类别: ${allCategories.join(', ')}` }
    }
    if (params.status && typeof params.status === 'string') {
      if (params.status === 'pending' || params.status === 'reimbursed') {
        updates.status = params.status as InvoiceStatus
        changed.push(`状态 → ${params.status === 'pending' ? '待报销' : '已报销'}`)
      }
    }
    if (params.notes !== undefined) { updates.notes = String(params.notes); changed.push('已更新备注') }
    if (changed.length === 0) return { success: false, error: '未提供任何可更新的字段（category/status/notes）' }
    await getStore().updateInvoice(id, updates)
    return { success: true, message: `已更新发票 ${inv.invoiceNumber}: ${changed.join('，')}` }
  }
)

const listInvoicesByCategory: Skill = sk(
  'list_invoices_by_category',
  '按类别列出所有发票',
  'invoice_query',
  true,
  { category: { type: 'string', description: '发票类别：餐饮/住宿/机票/车票/打车/办公用品/通讯费/会议费/培训费/加油费/过路费/停车费/其他', required: true } },
  async (params) => {
    const category = s(params, 'category') as InvoiceCategory
    if (!allCategories.includes(category)) return { success: false, error: `无效类别: ${category}。有效类别: ${allCategories.join(', ')}` }
    const groups = getStore().getInvoicesByCategory()
    const group = groups.find(g => g.category === category)
    if (!group || group.invoices.length === 0) return { success: true, data: [], message: `"${category}" 类别下暂无发票` }
    return {
      success: true,
      data: group.invoices.map(invoiceToDisplay),
      message: `"${category}" 类别共 ${group.count} 张发票，合计 ${formatAmount(group.totalAmount)}`
    }
  }
)

const listInvoicesByStatus: Skill = sk(
  'list_invoices_by_status',
  '按状态列出所有发票',
  'invoice_query',
  true,
  { status: { type: 'string', description: '状态：pending（待报销）或 reimbursed（已报销）', required: true, enum: ['pending', 'reimbursed'] } },
  async (params) => {
    const status = s(params, 'status')
    if (status !== 'pending' && status !== 'reimbursed') return { success: false, error: '状态必须是 pending 或 reimbursed' }
    const invoices = getStore().searchInvoices('')
    const filtered = invoices.filter(i => i.status === status)
    if (filtered.length === 0) return { success: true, data: [], message: `没有${status === 'pending' ? '待报销' : '已报销'}的发票` }
    return {
      success: true,
      data: filtered.map(invoiceToDisplay),
      message: `${status === 'pending' ? '待报销' : '已报销'}发票共 ${filtered.length} 张，合计 ${formatAmount(filtered.reduce((sum, i) => sum + i.totalAmount, 0))}`
    }
  }
)

const listInvoicesByDateRange: Skill = sk(
  'list_invoices_by_date_range',
  '按日期范围列出发票',
  'invoice_query',
  true,
  {
    start_date: { type: 'string', description: '开始日期，格式 YYYY-MM-DD', required: true },
    end_date: { type: 'string', description: '结束日期，格式 YYYY-MM-DD', required: true }
  },
  async (params) => {
    const start = s(params, 'start_date')
    const end = s(params, 'end_date')
    if (!start || !end) return { success: false, error: '请提供开始和结束日期' }
    const invoices = getStore().searchInvoices('')
    const filtered = invoices.filter(i => i.issueDate >= start && i.issueDate <= end)
    if (filtered.length === 0) return { success: true, data: [], message: `${start} 至 ${end} 期间暂无发票` }
    return {
      success: true,
      data: filtered.map(invoiceToDisplay),
      message: `${start} 至 ${end} 共 ${filtered.length} 张发票，合计 ${formatAmount(filtered.reduce((sum, i) => sum + i.totalAmount, 0))}`
    }
  }
)

const addTags: Skill = sk(
  'add_tags',
  '给发票添加标签',
  'invoice_write',
  true,
  {
    invoice_id: { type: 'string', description: '发票 ID', required: true },
    tags: { type: 'string', description: '要添加的标签，多个用英文逗号分隔，如 "紧急,差旅"', required: true }
  },
  async (params) => {
    const id = s(params, 'invoice_id')
    if (!id) return { success: false, error: '请提供发票 ID' }
    const inv = getStore().getInvoiceById(id)
    if (!inv) return { success: false, error: `未找到 ID 为 ${id} 的发票` }
    const newTags = s(params, 'tags').split(',').map(t => t.trim()).filter(Boolean)
    const existing = inv.tags || []
    const added = newTags.filter(t => !existing.includes(t))
    if (added.length === 0) return { success: true, message: '这些标签已存在，无需重复添加' }
    await getStore().updateInvoice(id, { tags: [...existing, ...added] })
    return { success: true, message: `已为发票 ${inv.invoiceNumber} 添加标签: ${added.join(', ')}` }
  }
)

const removeTags: Skill = sk(
  'remove_tags',
  '移除发票的标签',
  'invoice_write',
  true,
  {
    invoice_id: { type: 'string', description: '发票 ID', required: true },
    tags: { type: 'string', description: '要移除的标签，多个用英文逗号分隔', required: true }
  },
  async (params) => {
    const id = s(params, 'invoice_id')
    if (!id) return { success: false, error: '请提供发票 ID' }
    const inv = getStore().getInvoiceById(id)
    if (!inv) return { success: false, error: `未找到 ID 为 ${id} 的发票` }
    const removeList = s(params, 'tags').split(',').map(t => t.trim()).filter(Boolean)
    const remaining = (inv.tags || []).filter(t => !removeList.includes(t))
    if (remaining.length === inv.tags.length) return { success: true, message: '未找到要移除的标签' }
    await getStore().updateInvoice(id, { tags: remaining })
    return { success: true, message: `已从发票 ${inv.invoiceNumber} 移除标签: ${removeList.filter(t => inv.tags.includes(t)).join(', ')}` }
  }
)

const markStatus: Skill = sk(
  'mark_status',
  '标记发票状态为已报销或待报销',
  'invoice_write',
  true,
  {
    invoice_id: { type: 'string', description: '发票 ID', required: true },
    status: { type: 'string', description: '新状态：pending（待报销）或 reimbursed（已报销）', required: true, enum: ['pending', 'reimbursed'] }
  },
  async (params) => {
    const id = s(params, 'invoice_id')
    if (!id) return { success: false, error: '请提供发票 ID' }
    const status = s(params, 'status')
    if (status !== 'pending' && status !== 'reimbursed') return { success: false, error: '状态必须是 pending 或 reimbursed' }
    const inv = getStore().getInvoiceById(id)
    if (!inv) return { success: false, error: `未找到 ID 为 ${id} 的发票` }
    if (inv.status === status) return { success: true, message: `发票 ${inv.invoiceNumber} 已经是${status === 'pending' ? '待报销' : '已报销'}状态` }
    await getStore().updateInvoice(id, { status: status as InvoiceStatus })
    return { success: true, message: `已将发票 ${inv.invoiceNumber} 标记为${status === 'pending' ? '待报销' : '已报销'}` }
  }
)

const listAllTags: Skill = sk(
  'list_all_tags',
  '获取所有已使用的标签列表',
  'utility',
  true,
  {} as Skill['parameters'],
  async () => {
    const invoices = getStore().searchInvoices('')
    const tagCounts: Record<string, number> = {}
    for (const inv of invoices) {
      for (const tag of (inv.tags || [])) tagCounts[tag] = (tagCounts[tag] || 0) + 1
    }
    const tags = Object.entries(tagCounts).sort(([, a], [, b]) => b - a)
    if (tags.length === 0) return { success: true, data: [], message: '当前没有发票使用了标签' }
    return {
      success: true,
      data: tags.map(([tag, count]) => ({ tag, count })),
      message: `共有 ${tags.length} 个标签`
    }
  }
)

const getByTag: Skill = sk(
  'get_invoices_by_tag',
  '按标签查找发票',
  'invoice_query',
  true,
  { tag: { type: 'string', description: '标签名称', required: true } },
  async (params) => {
    const tag = s(params, 'tag')
    if (!tag) return { success: false, error: '请提供标签名称' }
    const filtered = getStore().searchInvoices('').filter(i => (i.tags || []).includes(tag))
    if (filtered.length === 0) return { success: true, data: [], message: `没有标签为 "${tag}" 的发票` }
    return {
      success: true,
      data: filtered.map(invoiceToDisplay),
      message: `标签 "${tag}" 共 ${filtered.length} 张发票，合计 ${formatAmount(filtered.reduce((sum, i) => sum + i.totalAmount, 0))}`
    }
  }
)

const findDuplicates: Skill = sk(
  'find_duplicates',
  '查找疑似重复的发票（发票代码+号码相同，或卖家+金额相同）',
  'utility',
  true,
  {} as Skill['parameters'],
  async () => {
    const invoices = getStore().searchInvoices('')
    const seen = new Map<string, Invoice[]>()
    for (const inv of invoices) {
      const key = `${inv.invoiceCode}|${inv.invoiceNumber}`.trim()
      if (!key || key === '|') continue
      if (!seen.has(key)) seen.set(key, [])
      seen.get(key)!.push(inv)
    }
    const duplicates = Array.from(seen.values()).filter(g => g.length > 1)
    if (duplicates.length === 0) return { success: true, data: [], message: '未发现重复发票' }
    return {
      success: true,
      data: duplicates.map(g => g.map(invoiceToDisplay)),
      message: `发现 ${duplicates.length} 组疑似重复发票，共涉及 ${duplicates.reduce((sum, g) => sum + g.length, 0)} 张发票`
    }
  }
)

const getByAmountRange: Skill = sk(
  'get_invoices_by_amount_range',
  '按金额范围筛选发票',
  'invoice_query',
  true,
  {
    min_amount: { type: 'number', description: '最低金额', required: true },
    max_amount: { type: 'number', description: '最高金额', required: true }
  },
  async (params) => {
    const min = n(params, 'min_amount')
    const max = n(params, 'max_amount')
    if (isNaN(min) || isNaN(max)) return { success: false, error: '请提供有效的金额范围' }
    if (min > max) return { success: false, error: '最低金额不能大于最高金额' }
    const filtered = getStore().searchInvoices('').filter(i => i.totalAmount >= min && i.totalAmount <= max)
    if (filtered.length === 0) return { success: true, data: [], message: `${formatAmount(min)} 至 ${formatAmount(max)} 范围内暂无发票` }
    return {
      success: true,
      data: filtered.map(invoiceToDisplay),
      message: `${formatAmount(min)} 至 ${formatAmount(max)} 共 ${filtered.length} 张发票，合计 ${formatAmount(filtered.reduce((sum, i) => sum + i.totalAmount, 0))}`
    }
  }
)

const batchUpdateCategory: Skill = sk(
  'batch_update_category',
  '批量修改发票类别',
  'invoice_write',
  true,
  {
    invoice_ids: { type: 'string', description: '发票 ID 列表，用英文逗号分隔', required: true },
    category: { type: 'string', description: '新类别：餐饮/住宿/机票/车票/打车/办公用品/通讯费/会议费/培训费/加油费/过路费/停车费/其他', required: true }
  },
  async (params) => {
    const ids = s(params, 'invoice_ids').split(',').map(x => x.trim()).filter(Boolean)
    const category = s(params, 'category') as InvoiceCategory
    if (!allCategories.includes(category)) return { success: false, error: `无效类别: ${category}。有效类别: ${allCategories.join(', ')}` }
    const invoices = getStore().searchInvoices('')
    const targetInvs = invoices.filter(i => ids.includes(i.id))
    if (targetInvs.length === 0) return { success: false, error: '未找到任何匹配的发票' }
    for (const inv of targetInvs) await getStore().updateInvoice(inv.id, { category })
    return { success: true, message: `已将 ${targetInvs.length} 张发票的类别修改为 "${category}"` }
  }
)

const getMonthlySummary: Skill = sk(
  'get_monthly_summary',
  '获取指定月份的发票汇总',
  'statistics',
  true,
  {
    year: { type: 'number', description: '年份，如 2026', required: true },
    month: { type: 'number', description: '月份，1-12', required: true }
  },
  async (params) => {
    const year = n(params, 'year')
    const month = n(params, 'month')
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) return { success: false, error: '请提供有效的年份和月份（1-12）' }
    const monthStr = `${year}-${String(month).padStart(2, '0')}`
    const filtered = getStore().searchInvoices('').filter(i => i.issueDate.startsWith(monthStr))
    if (filtered.length === 0) return { success: true, data: [], message: `${year}年${month}月暂无发票` }
    const cats: Record<string, { count: number; total: number }> = {}
    for (const inv of filtered) {
      if (!cats[inv.category]) cats[inv.category] = { count: 0, total: 0 }
      cats[inv.category].count++
      cats[inv.category].total += inv.totalAmount
    }
    return {
      success: true,
      data: {
        year, month,
        totalCount: filtered.length,
        totalAmount: formatAmount(filtered.reduce((sum, i) => sum + i.totalAmount, 0)),
        byCategory: Object.entries(cats).map(([cat, d]) => ({
          category: cat, count: d.count, amount: formatAmount(d.total)
        }))
      },
      message: `${year}年${month}月共 ${filtered.length} 张发票，合计 ${formatAmount(filtered.reduce((sum, i) => sum + i.totalAmount, 0))}`
    }
  }
)

export const webSearch: Skill = sk(
  'web_search',
  '在网络上搜索与用户问题相关的最新信息。适用于搜索政策法规变化、税率更新、报销标准调整等需要最新知识的问题。',
  'utility',
  false,
  { query: { type: 'string', description: '搜索查询关键词，用中文描述要搜索的内容', required: true } },
  async (params: Record<string, unknown>): Promise<SkillResult> => {
    const query = String(params.query || '')
    if (!query) return { success: false, error: '搜索关键词不能为空' }
    try {
      const result = await (window.electronAPI as Record<string, unknown>)?.webSearch?.search?.(query)
      if (!result || !(result as Record<string, unknown>).success) {
        return { success: false, error: String((result as Record<string, unknown>)?.error || '搜索失败') }
      }
      const results = (result as Record<string, unknown>)?.results as Array<Record<string, string>> | undefined
      const count = results?.length || 0
      return {
        success: true,
        data: results,
        message: `搜索"${query}"的结果：找到 ${count} 条相关信息`
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : '搜索失败' }
    }
  }
)

export const builtinSkills: Skill[] = [
  searchInvoices,
  getInvoiceDetail,
  getStatistics,
  updateInvoice,
  listInvoicesByCategory,
  listInvoicesByStatus,
  listInvoicesByDateRange,
  addTags,
  removeTags,
  markStatus,
  listAllTags,
  getByTag,
  findDuplicates,
  getByAmountRange,
  batchUpdateCategory,
  getMonthlySummary,
  webSearch
]