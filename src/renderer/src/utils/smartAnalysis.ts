import type { Invoice } from '../types/invoice'

export interface AnalysisAlert {
  type: 'duplicate' | 'expired' | 'anomaly' | 'missing_info' | 'info'
  level: 'error' | 'warning' | 'info'
  title: string
  message: string
  invoiceIds?: string[]
}

const EXPIRE_DAYS = 90
const ANOMALY_THRESHOLD = 100000

export function analyzeInvoices(invoices: Invoice[]): AnalysisAlert[] {
  const alerts: AnalysisAlert[] = []

  const duplicateAlerts = findDuplicates(invoices)
  alerts.push(...duplicateAlerts)

  const expiredAlerts = findExpired(invoices)
  alerts.push(...expiredAlerts)

  const anomalyAlerts = findAnomalies(invoices)
  alerts.push(...anomalyAlerts)

  const missingAlerts = findMissingInfo(invoices)
  alerts.push(...missingAlerts)

  return alerts
}

function findDuplicates(invoices: Invoice[]): AnalysisAlert[] {
  const alerts: AnalysisAlert[] = []
  const seen = new Map<string, Invoice[]>()

  for (const inv of invoices) {
    const key = `${inv.invoiceCode}|${inv.invoiceNumber}`.trim()
    if (!key || key === '|') continue
    if (!seen.has(key)) seen.set(key, [])
    seen.get(key)!.push(inv)
  }

  const duplicates = Array.from(seen.values()).filter(g => g.length > 1)
  if (duplicates.length > 0) {
    const ids = duplicates.flatMap(g => g.map(i => i.id))
    const totalAmount = duplicates.reduce((sum, g) => sum + g[0].totalAmount, 0)
    alerts.push({
      type: 'duplicate',
      level: 'error',
      title: '发现重复发票',
      message: `发现 ${duplicates.length} 组重复发票（共 ${ids.length} 张），涉及金额 ¥${totalAmount.toFixed(2)}，请检查避免重复报销`,
      invoiceIds: ids
    })
  }

  return alerts
}

function findExpired(invoices: Invoice[]): AnalysisAlert[] {
  const alerts: AnalysisAlert[] = []
  const now = new Date()
  const expireDate = new Date(now.getTime() - EXPIRE_DAYS * 24 * 60 * 60 * 1000)
  const warningDate = new Date(now.getTime() - (EXPIRE_DAYS - 15) * 24 * 60 * 60 * 1000)

  const expired = invoices.filter(inv => {
    if (!inv.issueDate || inv.status === 'reimbursed') return false
    const d = new Date(inv.issueDate)
    return d < expireDate
  })

  const expiringSoon = invoices.filter(inv => {
    if (!inv.issueDate || inv.status === 'reimbursed') return false
    const d = new Date(inv.issueDate)
    return d >= expireDate && d < warningDate
  })

  if (expired.length > 0) {
    const totalAmount = expired.reduce((sum, i) => sum + i.totalAmount, 0)
    alerts.push({
      type: 'expired',
      level: 'error',
      title: '发票已过期',
      message: `${expired.length} 张发票已超过 ${EXPIRE_DAYS} 天报销期限，合计 ¥${totalAmount.toFixed(2)}`,
      invoiceIds: expired.map(i => i.id)
    })
  }

  if (expiringSoon.length > 0) {
    const totalAmount = expiringSoon.reduce((sum, i) => sum + i.totalAmount, 0)
    alerts.push({
      type: 'expired',
      level: 'warning',
      title: '发票即将过期',
      message: `${expiringSoon.length} 张发票将在 15 天内过期，合计 ¥${totalAmount.toFixed(2)}，请尽快报销`,
      invoiceIds: expiringSoon.map(i => i.id)
    })
  }

  return alerts
}

function findAnomalies(invoices: Invoice[]): AnalysisAlert[] {
  const alerts: AnalysisAlert[] = []

  const highAmount = invoices.filter(inv => inv.totalAmount >= ANOMALY_THRESHOLD)
  if (highAmount.length > 0) {
    alerts.push({
      type: 'anomaly',
      level: 'warning',
      title: '大额发票提醒',
      message: `${highAmount.length} 张发票金额超过 ¥${ANOMALY_THRESHOLD.toLocaleString()}，请确认是否正确`,
      invoiceIds: highAmount.map(i => i.id)
    })
  }

  const sameSellerAmounts = new Map<string, number[]>()
  for (const inv of invoices) {
    if (!inv.sellerName) continue
    if (!sameSellerAmounts.has(inv.sellerName)) sameSellerAmounts.set(inv.sellerName, [])
    sameSellerAmounts.get(inv.sellerName)!.push(inv.totalAmount)
  }

  for (const [seller, amounts] of sameSellerAmounts) {
    if (amounts.length < 2) continue
    const uniqueAmounts = [...new Set(amounts.map(a => a.toFixed(2)))]
    if (uniqueAmounts.length === 1 && amounts.length >= 3) {
      const ids = invoices
        .filter(i => i.sellerName === seller && i.totalAmount === amounts[0])
        .map(i => i.id)
      alerts.push({
        type: 'anomaly',
        level: 'warning',
        title: '同金额发票',
        message: `"${seller}" 有 ${amounts.length} 张金额相同的发票（¥${amounts[0].toFixed(2)}），请确认`,
        invoiceIds: ids
      })
    }
  }

  return alerts
}

function findMissingInfo(invoices: Invoice[]): AnalysisAlert[] {
  const alerts: AnalysisAlert[] = []

  const missing = invoices.filter(inv =>
    !inv.invoiceNumber || !inv.sellerName || !inv.totalAmount
  )

  if (missing.length > 0) {
    alerts.push({
      type: 'missing_info',
      level: 'info',
      title: '信息不完整',
      message: `${missing.length} 张发票缺少关键信息（发票号码/销售方/金额），建议重新识别`,
      invoiceIds: missing.map(i => i.id)
    })
  }

  return alerts
}

export function generateImportReport(
  invoices: Invoice[],
  parseResults: { fileName: string; success: boolean; sellerName?: string; totalAmount?: number; error?: string }[]
): string {
  const lines: string[] = []
  const successCount = parseResults.filter(r => r.success).length
  const failCount = parseResults.filter(r => !r.success).length

  lines.push(`已导入 ${invoices.length} 张发票，识别结果如下：`)
  lines.push('')

  for (const r of parseResults) {
    if (r.success) {
      lines.push(`  ${r.fileName}`)
      lines.push(`    销售方: ${r.sellerName || '未知'}`)
      lines.push(`    金额: ¥${r.totalAmount?.toFixed(2) ?? '0.00'}`)
      lines.push('')
    } else {
      lines.push(`  ${r.fileName} — 解析失败`)
      lines.push('')
    }
  }

  if (failCount > 0) {
    lines.push(`共 ${successCount} 张成功，${failCount} 张失败`)
  } else {
    lines.push(`全部 ${successCount} 张发票识别成功`)
  }

  const alerts = analyzeInvoices(invoices)
  if (alerts.length > 0) {
    lines.push('')
    lines.push('─── 智能分析 ───')
    for (const alert of alerts) {
      const icon = alert.level === 'error' ? '❗' : alert.level === 'warning' ? '⚠️' : 'ℹ️'
      lines.push(`${icon} ${alert.title}: ${alert.message}`)
    }
  }

  const totalAmount = invoices.reduce((sum, i) => sum + i.totalAmount, 0)
  const pendingCount = invoices.filter(i => i.status === 'pending').length
  if (invoices.length > 0) {
    lines.push('')
    lines.push(`📊 合计金额: ¥${totalAmount.toFixed(2)} | 待报销: ${pendingCount} 张`)
  }

  return lines.join('\n')
}
