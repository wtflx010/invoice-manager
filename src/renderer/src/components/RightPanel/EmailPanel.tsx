import { useState, useEffect, useRef, useCallback } from 'react'
import { Plus, Trash2, Mail, Globe, ArrowLeft, FileText, AlertCircle, Loader2, Wifi, WifiOff, Download, DownloadCloud } from 'lucide-react'
import { useInvoiceStore } from '../../stores/invoiceStore'
import { useAppStore } from '../../stores/appStore'
import { useToastStore } from '../../stores/toastStore'
import { classifyInvoice } from '../../utils/classificationRules'
import type { EmailAccount, Invoice } from '../../types/invoice'

interface EmailItem {
  uid: number
  subject: string
  from: string
  date: string
  hasAttachments: boolean
  attachmentCount: number
  snippet: string
  isInvoice: boolean
}

const providerPresets = [
  { name: '自定义', imapHost: '', imapPort: 993, smtpHost: '', smtpPort: 465 },
  { name: 'QQ邮箱', imapHost: 'imap.qq.com', imapPort: 993, smtpHost: 'smtp.qq.com', smtpPort: 465 },
  { name: '163邮箱', imapHost: 'imap.163.com', imapPort: 993, smtpHost: 'smtp.163.com', smtpPort: 465 },
  { name: 'Gmail', imapHost: 'imap.gmail.com', imapPort: 993, smtpHost: 'smtp.gmail.com', smtpPort: 465 },
  { name: 'Outlook', imapHost: 'outlook.office365.com', imapPort: 993, smtpHost: 'smtp.office365.com', smtpPort: 587 },
  { name: '企业微信', imapHost: 'imap.exmail.qq.com', imapPort: 993, smtpHost: 'smtp.exmail.qq.com', smtpPort: 465 },
  { name: '阿里企业邮箱', imapHost: 'imap.qiye.aliyun.com', imapPort: 993, smtpHost: 'smtp.qiye.aliyun.com', smtpPort: 465 }
]

function generateId() {
  return `email-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function formatEmailDate(isoStr: string): string {
  const d = new Date(isoStr)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

export default function EmailPanel() {
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    providerPreset: 0,
    imapHost: '',
    imapPort: 993,
    smtpHost: '',
    smtpPort: 465,
    useTls: true
  })
  const [saving, setSaving] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<string | null>(null)

  const [emails, setEmails] = useState<EmailItem[]>([])
  const [mailboxTotal, setMailboxTotal] = useState(0)
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [scanResult, setScanResult] = useState<string | null>(null)
  const [downloadingUids, setDownloadingUids] = useState<Set<number>>(new Set())

  const addInvoices = useInvoiceStore((s) => s.addInvoices)
  const addToast = useToastStore((s) => s.addToast)

  const [downloadProgress, setDownloadProgress] = useState<Record<number, { completed: number; total: number }>>({})
  const [emailLinks, setEmailLinks] = useState<Record<number, Array<{ url: string; label: string }>>>({})
  const [downloadingLinkUrls, setDownloadingLinkUrls] = useState<Set<string>>(new Set())

  const extractInvoiceLinks = (htmlBody: string): Array<{ url: string; label: string }> => {
    // QP-encoded URLs may contain =XX hex sequences that need decoding
    const decodeQPUrl = (url: string): string => {
      const bytes: number[] = []
      let i = 0
      while (i < url.length) {
        if (url[i] === '=' && i + 2 < url.length && /^[0-9A-Fa-f]{2}$/.test(url.substring(i + 1, i + 3))) {
          bytes.push(parseInt(url.substring(i + 1, i + 3), 16))
          i += 3
        } else {
          bytes.push(url.charCodeAt(i))
          i++
        }
      }
      try {
        const decoder = new TextDecoder('utf-8')
        return decoder.decode(new Uint8Array(bytes))
      } catch {
        return url
      }
    }
    const links: Array<{ url: string; label: string }> = []
    const linkRegex = /<a[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi
    let match
    let totalMatches = 0
    while ((match = linkRegex.exec(htmlBody)) !== null) {
      totalMatches++
      let url = match[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      const text = match[2].replace(/<[^>]*>/g, '').trim()
      if (!url || url.startsWith('#') || url.startsWith('mailto:') || url.startsWith('javascript:')) continue
      if (url.includes('unsubscribe') || url.includes('opt-out') || text.includes('退订') || text.includes('取消订阅')) continue
      if (url.includes('tracking') || url.includes('beacon.') || url.includes('pixel')) continue
      const isInvoiceUrl = url.includes('pdf') || url.includes('PDF') ||
        url.includes('ofd') || url.includes('OFD') ||
        url.includes('xml') || url.includes('XML') ||
        url.includes('fapiao') || url.includes('invoice') ||
        url.includes('fp.') || url.includes('tax') ||
        url.includes('download') || url.includes('export') ||
        url.includes('preview') || url.includes('viewInvoice')
      const isInvoiceText = text.includes('下载') || text.includes('PDF') ||
        text.includes('OFD') || text.includes('发票') || text.includes('数电') ||
        text.includes('获取') || text.includes('查看') || text.includes('导出') ||
        text.includes('invoice') || text.includes('download')
      const looksLikeFile = /\.(pdf|ofd|xml|zip)(\?|$)/i.test(url)
      if (isInvoiceUrl || isInvoiceText || looksLikeFile) {
        links.push({ url, label: text || '下载发票' })
      }
    }
    if (links.length === 0) {
      const urlRegex = /https?:\/\/[^\s<>"']+\.(pdf|xml|ofd)[^\s<>"']*/gi
      while ((match = urlRegex.exec(htmlBody)) !== null) {
        links.push({ url: match[0], label: '下载发票' })
      }
    }
    return links
  }

  const handleDownloadFromLink = async (email: EmailItem, linkUrl: string): Promise<boolean> => {
    if (!window.electronAPI?.file) {
      console.error(`[handleDownloadFromLink] electronAPI.file not available`)
      return false
    }
    setDownloadingLinkUrls((prev) => new Set(prev).add(linkUrl))
    try {
      const dlResult = await window.electronAPI.file.downloadFromUrl(linkUrl)
      if (!dlResult?.success || !dlResult.data || !dlResult.fileName) {
        addToast({ type: 'error', message: `链接下载失败: ${dlResult?.error || '未知错误'}` })
        return false
      }
      const ext = dlResult.fileName.split('.').pop()?.toLowerCase() || 'pdf'
      const tempSaved = await window.electronAPI?.file?.saveFile(
        dlResult.fileName,
        dlResult.data,
        dlResult.mimeType
      )
      if (tempSaved?.error || !tempSaved?.filePath) {
        addToast({ type: 'error', message: `文件保存失败` })
        return false
      }

      const now = new Date()
      const fileFormatMap: Record<string, Invoice['fileFormat']> = { pdf: 'pdf', ofd: 'ofd', xml: 'xml', jpg: 'image', jpeg: 'image', png: 'image' }
      const invoice: Invoice = {
        id: `email-link-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        invoiceCode: '', invoiceNumber: '', invoiceType: '增值税普通发票',
        category: '其他', status: 'pending', issueDate: now.toISOString().substring(0, 10),
        sellerName: '', sellerTaxNumber: '', buyerName: '', buyerTaxNumber: '',
        amountWithoutTax: 0, taxAmount: 0, totalAmount: 0,
        filePath: tempSaved.filePath, fileName: tempSaved.fileName || dlResult.fileName,
        fileFormat: fileFormatMap[ext] || 'pdf', source: 'email', tags: [],
        createdAt: now, updatedAt: now
      }

      try {
        const parsed = await window.electronAPI?.file?.parseInvoice(tempSaved.filePath)
        if (parsed?.success) {
          const code = parsed.invoiceCode as string; const number = parsed.invoiceNumber as string
          if (code && number) {
            const isDuplicate = await window.electronAPI?.db?.checkDuplicate?.(code, number)
            if (isDuplicate) { addToast({ type: 'warning', message: `发票 ${code}-${number} 已存在，跳过` }); return false }
          }
          invoice.invoiceCode = (parsed.invoiceCode as string) || invoice.invoiceCode
          invoice.invoiceNumber = (parsed.invoiceNumber as string) || invoice.invoiceNumber
          invoice.invoiceType = (parsed.invoiceType as string) || invoice.invoiceType
          invoice.issueDate = (parsed.issueDate as string) || invoice.issueDate
          invoice.sellerName = (parsed.sellerName as string) || invoice.sellerName
          invoice.sellerTaxNumber = (parsed.sellerTaxNumber as string) || invoice.sellerTaxNumber
          invoice.buyerName = (parsed.buyerName as string) || invoice.buyerName
          invoice.buyerTaxNumber = (parsed.buyerTaxNumber as string) || invoice.buyerTaxNumber
          invoice.amountWithoutTax = (parsed.amountWithoutTax as number) || invoice.amountWithoutTax
          invoice.taxAmount = (parsed.taxAmount as number) || invoice.taxAmount
          invoice.totalAmount = (parsed.totalAmount as number) || invoice.totalAmount
          invoice.category = classifyInvoice(invoice.sellerName, invoice.invoiceType, invoice.sellerName)
        }
      } catch { /* skip */ }

      const settings = useAppStore.getState().settings
      const pattern = settings.fileNamingPattern || '{date}_{seller}_{amount}'
      const dateFormat = settings.dateFormat || 'YYYYMMDD'
      const rawDate = (invoice.issueDate || '').substring(0, 10)
      let date = rawDate.replace(/-/g, '')
      if (dateFormat === 'YYYY-MM-DD') date = rawDate
      else if (dateFormat === 'YYYY年MM月DD日') { const parts = (rawDate).split('-'); date = parts.length === 3 ? `${parts[0]}年${parts[1]}月${parts[2]}日` : rawDate }
      const seller = (invoice.sellerName || '未知').substring(0, 30)
      const amount = (Number(invoice.totalAmount) || 0).toFixed(2)
      const newNameBase = pattern.replace(/{date}/g, date).replace(/{seller}/g, seller).replace(/{amount}/g, amount)
        .replace(/{category}/g, invoice.category || '其他').replace(/{code}/g, invoice.invoiceNumber || '')
        .replace(/{invoice_code}/g, invoice.invoiceCode || '').replace(/{buyer}/g, (invoice.buyerName || '').substring(0, 30))
        .replace(/{format}/g, ext)
      const newName = newNameBase.includes('.') ? newNameBase : `${newNameBase}.${ext}`

      if (invoice.id && tempSaved.filePath) {
        const renameResult = await window.electronAPI?.file?.renameInvoice?.(invoice.id, tempSaved.filePath, newName)
        if (renameResult?.success && renameResult.newPath) { invoice.filePath = renameResult.newPath; invoice.fileName = renameResult.newFileName || newName }
      }
      await addInvoices([invoice])
      addToast({ type: 'success', message: `发票已下载并保存: ${invoice.fileName}` })
      return true
    } catch (err) {
      addToast({ type: 'error', message: `链接下载异常: ${err instanceof Error ? err.message : String(err)}` })
      return false
    } finally {
      setDownloadingLinkUrls((prev) => { const n = new Set(prev); n.delete(linkUrl); return n })
    }
  }

  const loadAccounts = async () => {
    if (!window.electronAPI) {
      setLoaded(true)
      return
    }
    try {
      const accs = await window.electronAPI?.db?.getEmailAccounts()
      setAccounts(accs as unknown as EmailAccount[] || [])
      setLoaded(true)
    } catch {
      setLoaded(true)
    }
  }

  useEffect(() => {
    loadAccounts()
  }, [])

  useEffect(() => {
    if (activeAccountId && loaded) {
      checkConnection(activeAccountId)
    }
  }, [activeAccountId, loaded])

  const checkConnection = async (accountId: string) => {
    if (!window.electronAPI) {
      setConnectError('浏览器预览模式不支持 IMAP 连接，请在桌面应用中打开')
      return
    }
    try {
      const isAlreadyConnected = await window.electronAPI?.imap?.isConnected(accountId)
      if (isAlreadyConnected) {
        setConnected(true)
        await fetchEmailsFromImap(accountId)
      } else {
        connectToImap(accountId)
      }
    } catch {
      connectToImap(accountId)
    }
  }

  const connectToImap = async (accountId: string) => {
    if (!window.electronAPI?.imap) return
    setConnecting(true)
    setConnectError(null)
    setEmails([])
    setMailboxTotal(0)
    setConnected(false)
    try {
      const result = await window.electronAPI.imap.connect(accountId)
      if (result?.success) {
        setConnected(true)
        await fetchEmailsFromImap(accountId)
      } else {
        setConnectError(result?.error || 'IMAP 连接失败')
      }
    } catch (err) {
      setConnectError('IMAP 连接异常: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setConnecting(false)
    }
  }

  const fetchEmailsFromImap = async (accountId: string) => {
    if (!window.electronAPI?.imap) return
    try {
      const result = await window.electronAPI.imap.fetchEmails(accountId)
      if (result?.emails) {
        setEmails(result.emails as EmailItem[])
        setMailboxTotal(result.total)
      }
      if (result?.error) {
        setConnectError(result.error)
      }
      setLastRefresh(new Date().toLocaleTimeString())
    } catch (err) {
      console.error('Failed to fetch emails:', err)
      setConnectError('获取邮件失败: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  const handleProviderChange = (index: number) => {
    const preset = providerPresets[index]
    setForm((prev) => ({
      ...prev,
      providerPreset: index,
      imapHost: preset.imapHost,
      imapPort: preset.imapPort,
      smtpHost: preset.smtpHost,
      smtpPort: preset.smtpPort
    }))
  }

  const detectProviderIndex = (email: string): number => {
    const domain = email.split('@')[1]?.toLowerCase()
    if (!domain) return 0
    const domainMap: Record<string, number> = {
      'qq.com': 1, 'vip.qq.com': 1, 'foxmail.com': 1,
      '163.com': 2, '126.com': 2, 'yeah.net': 2,
      'gmail.com': 3, 'googlemail.com': 3,
      'outlook.com': 4, 'hotmail.com': 4, 'live.com': 4,
      'exmail.qq.com': 5,
      'aliyun.com': 6
    }
    return domainMap[domain] ?? 0
  }

  const handleEmailChange = (email: string) => {
    const detectedIndex = detectProviderIndex(email)
    const preset = providerPresets[detectedIndex]
    setForm((prev) => ({
      ...prev,
      email,
      providerPreset: detectedIndex,
      imapHost: preset.imapHost || prev.imapHost,
      imapPort: preset.imapPort || prev.imapPort,
      smtpHost: preset.smtpHost || prev.smtpHost,
      smtpPort: preset.smtpPort || prev.smtpPort
    }))
  }

  const handleAddAccount = async () => {
    setAddError(null)
    if (!form.email) { setAddError('请输入邮箱地址'); return }
    if (!form.password) { setAddError('请输入授权码或密码'); return }
    if (!form.imapHost) { setAddError('请选择邮箱服务商或手动填写 IMAP 服务器地址'); return }
    setSaving(true)

    const newAccount: EmailAccount = {
      id: generateId(),
      name: form.name || form.email,
      email: form.email,
      provider: providerPresets[form.providerPreset].name,
      imapHost: form.imapHost,
      imapPort: form.imapPort,
      smtpHost: form.smtpHost,
      smtpPort: form.smtpPort,
      useTls: form.useTls,
      createdAt: new Date().toISOString()
    }

    if (window.electronAPI?.db) {
      try {
        await window.electronAPI.db.insertEmailAccount({
          ...newAccount,
          encryptedPassword: form.password
        } as unknown as Record<string, unknown>)
      } catch (err) {
        console.error('Failed to save email account to DB:', err)
        setAddError('保存邮箱账户失败: ' + (err instanceof Error ? err.message : String(err)))
        setSaving(false)
        return
      }
    } else {
      setAddError('无法连接到数据库，请在桌面应用中操作')
      setSaving(false)
      return
    }

    setAccounts((prev) => [newAccount, ...prev])
    setActiveAccountId(newAccount.id)
    resetForm()
    setShowAddDialog(false)
    setSaving(false)
  }

  const handleDeleteAccount = async (id: string) => {
    const account = accounts.find((a) => a.id === id)
    if (!confirm(`确定要删除邮箱账户 "${account?.name || account?.email || ''}" 吗？已下载的发票文件不会被删除。`)) return
    if (window.electronAPI) {
      try {
        await window.electronAPI?.imap?.disconnect(id)
      } catch {
        // ignore
      }
      try {
        await window.electronAPI?.db?.deleteEmailAccount(id)
      } catch (err) {
        console.error('Failed to delete email account:', err)
      }
    }
    setAccounts((prev) => prev.filter((a) => a.id !== id))
    if (activeAccountId === id) {
      setActiveAccountId(accounts.length > 1 ? accounts.find((a) => a.id !== id)?.id ?? null : null)
      setConnected(false)
    }
  }

  const resetForm = () => {
    setAddError(null)
    setForm({
      name: '',
      email: '',
      password: '',
      providerPreset: 0,
      imapHost: '',
      imapPort: 993,
      smtpHost: '',
      smtpPort: 465,
      useTls: true
    })
  }

  const handleSwitchAccount = async (accountId: string) => {
    if (activeAccountId && activeAccountId !== accountId && window.electronAPI) {
      await window.electronAPI?.imap?.disconnect(activeAccountId)
    }
    setConnected(false)
    setEmails([])
    setActiveAccountId(accountId)
  }

  const activeAccount = accounts.find((a) => a.id === activeAccountId)

  const openAddDialog = () => {
    resetForm()
    setShowAddDialog(true)
  }

  const handleRefresh = async () => {
    if (!activeAccountId || !window.electronAPI) return
    setRefreshing(true)
    try {
      if (connected) {
        await fetchEmailsFromImap(activeAccountId)
      } else {
        await connectToImap(activeAccountId)
      }
    } finally {
      setRefreshing(false)
    }
  }

  const handleScanInvoices = async () => {
    if (!activeAccountId || !window.electronAPI) return
    setScanning(true)
    setScanResult(null)
    try {
      if (!connected) {
        await connectToImap(activeAccountId)
      }
      const result = await window.electronAPI?.imap?.searchInvoices(activeAccountId)
      if (!result || result.error) {
        setScanResult('扫描失败: ' + result.error)
        return
      }
      setEmails(result.emails as EmailItem[])
      setMailboxTotal(result.total)
      setLastRefresh(new Date().toLocaleTimeString())
      const count = result.emails.length
      setScanResult(
        count > 0
          ? `已搜索全部 ${result.searched} 封邮件，发现 ${count} 封发票邮件`
          : `已搜索全部 ${result.searched} 封邮件，未发现发票邮件`
      )
    } catch (err) {
      setScanResult('扫描失败: ' + String(err))
    } finally {
      setScanning(false)
    }
  }

  const handleDownloadAttachment = async (emailUid: number): Promise<boolean> => {
    if (!activeAccountId || !window.electronAPI?.imap) return false
    setDownloadingUids((prev) => new Set(prev).add(emailUid))
    try {
      let attachments = await window.electronAPI.imap.getAttachments(activeAccountId, emailUid)
      if (!attachments || attachments.length === 0) {
        addToast({ type: 'warning', message: '未找到可下载的附件' })
        return false
      }

      const settings = useAppStore.getState().settings
      const strategy = settings.storageStrategy || 'all'
      const filteredAttachments = attachments.filter((att) => {
        const ext = att.fileName.split('.').pop()?.toLowerCase() || ''
        if (strategy === 'pdf_only') return ext === 'pdf'
        if (strategy === 'xml_only') return ext === 'xml'
        return true
      })

      if (filteredAttachments.length === 0) {
        addToast({ type: 'warning', message: '附件格式不符合筛选条件' })
        return false
      }

      const total = filteredAttachments.length
      let completed = 0
      let savedAny = false
      let failCount = 0
      setDownloadProgress((prev) => ({ ...prev, [emailUid]: { completed: 0, total } }))

      const processAttachment = async (att: typeof filteredAttachments[0]): Promise<boolean> => {
        try {
          const result = await window.electronAPI?.imap?.downloadAttachment(activeAccountId, emailUid, att.partId)
          if (result?.error) {
            console.warn(`[Email] Download attachment failed for uid=${emailUid} partId=${att.partId}:`, result.error)
            return false
          }
          if (result?.data && result?.fileName) {
            const ext = result.fileName.split('.').pop()?.toLowerCase() || 'pdf'
            const tempSaved = await window.electronAPI?.file?.saveFile(
              result.fileName,
              result.data,
              result.mimeType
            )
            if (tempSaved?.error || !tempSaved?.filePath) {
              return false
            }
            const fileFormatMap: Record<string, Invoice['fileFormat']> = {
              pdf: 'pdf', ofd: 'ofd', xml: 'xml',
              jpg: 'image', jpeg: 'image', png: 'image'
            }
            const now = new Date()
            const issueDate = now.toISOString()
            const invoice: Invoice = {
              id: `email-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              invoiceCode: '', invoiceNumber: '', invoiceType: '增值税普通发票',
              category: '其他', status: 'pending', issueDate: issueDate.substring(0, 10),
              sellerName: '', sellerTaxNumber: '', buyerName: '', buyerTaxNumber: '',
              amountWithoutTax: 0, taxAmount: 0, totalAmount: 0,
              filePath: tempSaved.filePath, fileName: tempSaved.fileName || result.fileName,
              fileFormat: fileFormatMap[ext] || 'pdf', source: 'email', tags: [],
              createdAt: now, updatedAt: now
            }

            try {
              const parsed = await window.electronAPI?.file?.parseInvoice(tempSaved.filePath)
              if (parsed?.success) {
                const code = parsed.invoiceCode as string
                const number = parsed.invoiceNumber as string
                if (code && number) {
                  const isDuplicate = await window.electronAPI?.db?.checkDuplicate?.(code, number)
                  if (isDuplicate) {
                    addToast({ type: 'warning', message: `发票 ${code}-${number} 已存在，跳过` })
                    return false
                  }
                }
                invoice.invoiceCode = (parsed.invoiceCode as string) || invoice.invoiceCode
                invoice.invoiceNumber = (parsed.invoiceNumber as string) || invoice.invoiceNumber
                invoice.invoiceType = (parsed.invoiceType as string) || invoice.invoiceType
                invoice.issueDate = (parsed.issueDate as string) || invoice.issueDate
                invoice.sellerName = (parsed.sellerName as string) || invoice.sellerName
                invoice.sellerTaxNumber = (parsed.sellerTaxNumber as string) || invoice.sellerTaxNumber
                invoice.buyerName = (parsed.buyerName as string) || invoice.buyerName
                invoice.buyerTaxNumber = (parsed.buyerTaxNumber as string) || invoice.buyerTaxNumber
                invoice.amountWithoutTax = (parsed.amountWithoutTax as number) || invoice.amountWithoutTax
                invoice.taxAmount = (parsed.taxAmount as number) || invoice.taxAmount
                invoice.totalAmount = (parsed.totalAmount as number) || invoice.totalAmount
                invoice.category = classifyInvoice(invoice.sellerName, invoice.invoiceType, invoice.sellerName)
              }
            } catch { /* skip */ }

            const settings = useAppStore.getState().settings
            const pattern = settings.fileNamingPattern || '{date}_{seller}_{amount}'
            const dateFormat = settings.dateFormat || 'YYYYMMDD'
            const rawDate = (invoice.issueDate || '').substring(0, 10)
            let date = rawDate.replace(/-/g, '') || now.toISOString().substring(0, 10).replace(/-/g, '')
            if (dateFormat === 'YYYY-MM-DD') {
              date = rawDate || now.toISOString().substring(0, 10)
            } else if (dateFormat === 'YYYY年MM月DD日') {
              const parts = (rawDate || now.toISOString().substring(0, 10)).split('-')
              date = parts.length === 3 ? `${parts[0]}年${parts[1]}月${parts[2]}日` : rawDate
            }
            const seller = (invoice.sellerName || '未知').substring(0, 30)
            const amount = (Number(invoice.totalAmount) || 0).toFixed(2)
            const code = invoice.invoiceNumber || ''
            const buyer = (invoice.buyerName || '').substring(0, 30)
            let newName = pattern
              .replace(/{date}/g, date)
              .replace(/{category}/g, invoice.category || '其他')
              .replace(/{seller}/g, seller)
              .replace(/{amount}/g, amount)
              .replace(/{code}/g, code)
              .replace(/{invoice_code}/g, code)
              .replace(/{buyer}/g, buyer)
              .replace(/{format}/g, ext)
              .replace(/[<>:"/\\|?*]/g, '_')
              .substring(0, 200)
            if (!newName.endsWith(`.${ext}`)) {
              newName = `${newName}.${ext}`
            }

            if (invoice.id && tempSaved.filePath) {
              const renameResult = await window.electronAPI?.file?.renameInvoice?.(invoice.id, tempSaved.filePath, newName)
              if (renameResult?.success && renameResult.newPath) {
                invoice.filePath = renameResult.newPath
                invoice.fileName = renameResult.newFileName || newName
              }
            }

            await addInvoices([invoice])
            return true
          }
          return false
        } catch {
          return false
        }
      }

      const results = await Promise.all(filteredAttachments.map((att) => processAttachment(att)))
      for (const ok of results) {
        if (ok) savedAny = true
        else failCount++
        completed++
        setDownloadProgress((prev) => ({ ...prev, [emailUid]: { completed, total } }))
      }

      if (failCount > 0 && !savedAny) {
        addToast({ type: 'error', message: `下载失败：${failCount} 个附件未能保存` })
      } else if (failCount > 0 && savedAny) {
        addToast({ type: 'warning', message: `部分下载成功，${failCount} 个附件失败` })
      }

      return savedAny
    } catch (err) {
      console.error('Download failed:', err)
      addToast({ type: 'error', message: '下载失败: ' + (err instanceof Error ? err.message : String(err)) })
      return false
    } finally {
      setDownloadingUids((prev) => {
        const next = new Set(prev)
        next.delete(emailUid)
        return next
      })
    }
  }

  const invoiceCount = emails.filter((e) => e.isInvoice).length
  const allAreInvoices = emails.length > 0 && emails.every((e) => e.isInvoice)

  const [batchDownloading, setBatchDownloading] = useState(false)
  const [batchProgress, setBatchProgress] = useState({ completed: 0, total: 0 })

  const handleBatchDownload = async () => {
    if (!activeAccountId || !window.electronAPI?.imap) return
    const invoiceEmails = emails.filter((e) => e.isInvoice)
    if (invoiceEmails.length === 0) {
      addToast({ type: 'warning', message: '没有可下载的发票邮件' })
      return
    }

    setBatchDownloading(true)
    setBatchProgress({ completed: 0, total: invoiceEmails.length })
    addToast({ type: 'info', message: `开始批量下载 ${invoiceEmails.length} 封发票邮件...` })

    let attachmentSuccessCount = 0
    let linkSuccessCount = 0
    let noContentCount = 0
    let linkFailCount = 0
    let bodyErrorCount = 0

    const CONCURRENCY = 2
    const processEmail = async (email: EmailItem): Promise<string[]> => {
      const results: string[] = []
      try {
        if (email.hasAttachments) {
          const didSave = await handleDownloadAttachment(email.uid)
          if (didSave) results.push('attachment')
          // Skip link download for emails with attachments to avoid duplicates
          if (results.includes('attachment')) {
            return results
          }
        }

        // Only try link download for emails without attachments (or attachment download failed)
        if (activeAccountId) {
          const bodyResult = await window.electronAPI?.imap?.getEmailBody?.(activeAccountId, email.uid)
          if (bodyResult?.success && bodyResult.body) {
            if (bodyResult.body.includes('无法提取邮件正文')) {
              results.push('no-body')
            } else {
              const links = extractInvoiceLinks(bodyResult.body)
              if (links.length > 0) {
                // Prioritize PDF links, skip OFD reader / website links
                const pdfLinks = links.filter(l => /\.pdf(\?|$)/i.test(l.url) || l.label.includes('PDF'))
                const otherLinks = links.filter(l => !pdfLinks.includes(l))
                const sortedLinks = [...pdfLinks, ...otherLinks]
                let anySuccess = false
                for (const link of sortedLinks) {
                  // Skip OFD reader download links
                  if (link.url.includes('ofd_read') || link.url.includes('ofd-reader') || link.url.includes('OFD阅读')) continue
                  // Skip website homepages
                  if (/^https?:\/\/[^/]+\/?$/.test(link.url)) continue
                  const decodedUrl = link.url
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                  const success = await handleDownloadFromLink(email, decodedUrl)
                  if (success) { anySuccess = true; break }
                }
                results.push(anySuccess ? 'link' : 'link-fail')
              } else {
                results.push('no-links')
              }
            }
          } else {
            results.push('body-error')
          }
        } else {
        }

        if (results.length === 0) results.push('no-content')
      } catch (err) {
        console.error(`[EmailPanel] processEmail uid=${email.uid} ERROR:`, err)
        results.push('skip')
      }
      return results
    }

    const processQueue = async (emails: EmailItem[]): Promise<void> => {
      let index = 0
      const runWorker = async (): Promise<void> => {
        while (index < emails.length) {
          const currentIdx = index++
          const email = emails[currentIdx]
          const results = await processEmail(email)
          for (const result of results) {
            if (result === 'attachment') attachmentSuccessCount++
            else if (result === 'link') linkSuccessCount++
            else if (result === 'link-fail') linkFailCount++
            else if (result === 'body-error' || result === 'no-body') bodyErrorCount++
            else noContentCount++
          }
          setBatchProgress({ completed: currentIdx + 1, total: emails.length })
        }
      }
      const workers = Array.from({ length: Math.min(CONCURRENCY, emails.length) }, () => runWorker())
      await Promise.all(workers)
    }

    await processQueue(invoiceEmails)

    setBatchDownloading(false)
    const parts = []
    if (attachmentSuccessCount > 0) parts.push(`附件下载成功 ${attachmentSuccessCount} 封`)
    if (linkSuccessCount > 0) parts.push(`链接下载成功 ${linkSuccessCount} 封`)
    if (linkFailCount > 0) parts.push(`链接下载失败 ${linkFailCount} 封`)
    if (bodyErrorCount > 0) parts.push(`正文获取失败 ${bodyErrorCount} 封`)
    if (noContentCount > 0) parts.push(`无发票内容 ${noContentCount} 封`)
    addToast({
      type: (attachmentSuccessCount + linkSuccessCount) > 0 ? 'success' : 'warning',
      message: `批量下载完成：${parts.join('，')}`
    })

    if ((attachmentSuccessCount + linkSuccessCount) > 0) {
      const settings = useAppStore.getState().settings
      const downloadDir = settings.storagePath || '应用数据目录/invoices'
      addToast({ type: 'info', message: `文件已保存到：${downloadDir}` })
    }
  }

  if (showAddDialog) {
    return (
      <div className="email-panel">
        <div className="email-account-tabs" style={{ padding: '10px 12px', gap: '8px' }}>
          <button
            className="email-toolbar-btn"
            onClick={() => setShowAddDialog(false)}
            style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <ArrowLeft size={14} />
            返回
          </button>
          <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg-text)' }}>
            添加邮箱账户
          </span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
          <div className="settings-section">
            <div className="settings-section-title">邮箱服务商</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {providerPresets.map((preset, idx) => (
                <button
                  key={preset.name}
                  onClick={() => handleProviderChange(idx)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '12px',
                    border: `1px solid ${form.providerPreset === idx ? 'var(--accent-blue)' : 'var(--border-default)'}`,
                    background: form.providerPreset === idx ? 'rgba(30, 102, 245, 0.08)' : 'var(--bg-surface0)',
                    color: form.providerPreset === idx ? 'var(--accent-blue)' : 'var(--fg-subtext0)',
                    cursor: 'pointer'
                  }}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">账户信息</div>
            <div className="settings-field">
              <label className="settings-label">邮箱地址</label>
              <input
                className="settings-input"
                type="email"
                placeholder="yourname@example.com"
                value={form.email}
                onChange={(e) => handleEmailChange(e.target.value)}
              />
            </div>
            <div className="settings-field">
              <label className="settings-label">授权码 / 密码</label>
              <input
                className="settings-input"
                type="password"
                placeholder="IMAP 授权码（非邮箱登录密码）"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
              <div style={{ fontSize: '11px', color: 'var(--fg-overlay0)', marginTop: '4px' }}>
                QQ邮箱/163邮箱等需在邮箱设置中生成授权码
              </div>
            </div>
            <div className="settings-field">
              <label className="settings-label">显示名称（可选）</label>
              <input
                className="settings-input"
                placeholder="如：公司邮箱"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">服务器设置</div>
            <div className="settings-field">
              <label className="settings-label">IMAP 服务器</label>
              <div className="settings-input-row">
                <input
                  style={{ flex: 3 }}
                  value={form.imapHost}
                  onChange={(e) => setForm({ ...form, imapHost: e.target.value, providerPreset: 0 })}
                  placeholder="imap.example.com"
                />
                <input
                  style={{ flex: 1 }}
                  type="number"
                  value={form.imapPort}
                  onChange={(e) => setForm({ ...form, imapPort: parseInt(e.target.value) || 993 })}
                />
              </div>
            </div>
            <div className="settings-field">
              <label className="settings-label">SMTP 服务器</label>
              <div className="settings-input-row">
                <input
                  style={{ flex: 3 }}
                  value={form.smtpHost}
                  onChange={(e) => setForm({ ...form, smtpHost: e.target.value, providerPreset: 0 })}
                  placeholder="smtp.example.com"
                />
                <input
                  style={{ flex: 1 }}
                  type="number"
                  value={form.smtpPort}
                  onChange={(e) => setForm({ ...form, smtpPort: parseInt(e.target.value) || 465 })}
                />
              </div>
            </div>
            <div className="settings-toggle">
              <span className="settings-label" style={{ marginBottom: 0 }}>使用 TLS 加密</span>
              <input
                type="checkbox"
                checked={form.useTls}
                onChange={(e) => setForm({ ...form, useTls: e.target.checked })}
              />
            </div>
          </div>

          {addError && (
            <div style={{
              padding: '8px 12px',
              marginTop: '8px',
              fontSize: '12px',
              color: 'var(--accent-red)',
              background: 'rgba(210, 15, 57, 0.06)',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <AlertCircle size={14} />
              {addError}
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button
              className="settings-btn secondary"
              onClick={() => setShowAddDialog(false)}
            >
              取消
            </button>
            <button
              className="settings-btn primary"
              onClick={handleAddAccount}
              disabled={saving}
              style={{ flex: 1, opacity: saving ? 0.5 : 1 }}
            >
              {saving ? '添加中...' : '添加邮箱'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!loaded) {
    return (
      <div className="email-panel">
        <div className="right-panel-empty">加载中...</div>
      </div>
    )
  }

  return (
    <div className="email-panel">
      <div className="email-account-tabs">
        {accounts.map((account) => (
          <button
            key={account.id}
            className={`email-account-tab ${activeAccount?.id === account.id ? 'active' : ''}`}
            onClick={() => handleSwitchAccount(account.id)}
            style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <Mail size={12} />
            {account.name || account.email}
          </button>
        ))}
        <button className="email-account-add" onClick={openAddDialog} style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
          <Plus size={14} />
          添加
        </button>
      </div>

      {accounts.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-overlay0)', gap: '12px', padding: '40px' }}>
          <Globe size={48} style={{ opacity: 0.3 }} />
          <p style={{ fontSize: '14px' }}>尚未添加邮箱账户</p>
          <p style={{ fontSize: '12px', color: 'var(--fg-overlay1)', textAlign: 'center', maxWidth: '240px' }}>
            添加邮箱后即可接收发票邮件并自动下载发票附件
          </p>
          <button
            onClick={openAddDialog}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 20px',
              background: 'var(--accent-blue)',
              color: '#ffffff',
              borderRadius: 'var(--radius-sm)',
              fontSize: '13px',
              fontWeight: 500
            }}
          >
            <Plus size={16} />
            添加邮箱账户
          </button>
        </div>
      ) : !activeAccount ? (
        <div className="right-panel-empty">
          <p>请选择一个邮箱账户</p>
        </div>
      ) : (
        <>
          <div className="email-toolbar">
            <span className="email-current">{activeAccount.email}</span>
            <div className="email-toolbar-actions">
              {connecting ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--accent-blue)' }}>
                  <Loader2 size={12} className="spinning" /> 连接中
                </span>
              ) : connected ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--accent-green)' }}>
                  <Wifi size={12} /> 已连接
                </span>
              ) : (
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--accent-red)' }}>
                  <WifiOff size={12} /> {connectError ? '连接失败' : '未连接'}
                </span>
              )}
              <button
                className="email-toolbar-btn"
                onClick={handleRefresh}
                disabled={refreshing || connecting}
              >
                {refreshing ? <><Loader2 size={12} className="spinning" /> 刷新中...</> : '刷新'}
              </button>
              <button
                className="email-toolbar-btn"
                onClick={handleScanInvoices}
                disabled={scanning || connecting}
              >
                {scanning ? <><Loader2 size={12} className="spinning" /> 扫描中...</> : '扫描发票'}
              </button>
              {invoiceCount > 0 && (
                <button
                  className="email-toolbar-btn"
                  onClick={handleBatchDownload}
                  disabled={batchDownloading || connecting}
                  style={{
                    background: batchDownloading ? 'var(--bg-surface1)' : 'rgba(var(--accent-blue-rgb, 30, 102, 200), 0.1)',
                    color: batchDownloading ? 'var(--fg-subtext0)' : 'var(--accent-blue)',
                    fontWeight: 500
                  }}
                >
                  <DownloadCloud size={13} />
                  {batchDownloading
                    ? `下载中 ${batchProgress.completed}/${batchProgress.total}`
                    : `一键下载全部 (${invoiceCount})`}
                </button>
              )}
              <button
                className="email-toolbar-btn"
                onClick={() => handleDeleteAccount(activeAccount.id)}
                style={{ color: 'var(--accent-red)' }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>

          {connectError && (
            <div style={{
              padding: '8px 12px',
              fontSize: '12px',
              color: 'var(--accent-red)',
              background: 'rgba(210, 15, 57, 0.06)',
              borderBottom: '1px solid var(--border-default)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <AlertCircle size={14} />
              {connectError}
            </div>
          )}

          {lastRefresh && (
            <div style={{
              padding: '4px 12px',
              fontSize: '11px',
              color: 'var(--fg-overlay0)',
              borderBottom: '1px solid var(--border-default)',
              display: 'flex',
              justifyContent: 'space-between'
            }}>
              <span>上次刷新: {lastRefresh}</span>
              <span>{mailboxTotal > 0 ? `收件箱共 ${mailboxTotal} 封` : '正在获取...'}</span>
            </div>
          )}

          <div className="email-list">
            {emails.length === 0 && !connecting ? (
              <div className="right-panel-empty" style={{ flexDirection: 'column', gap: '8px' }}>
                {connectError ? (
                  <>
                    <AlertCircle size={32} style={{ opacity: 0.3, color: 'var(--accent-red)' }} />
                    <p style={{ fontSize: '13px', color: 'var(--fg-overlay1)' }}>无法连接到邮箱</p>
                    <button
                      onClick={() => activeAccountId && connectToImap(activeAccountId)}
                      style={{
                        padding: '6px 16px',
                        background: 'var(--accent-blue)',
                        color: '#ffffff',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '12px'
                      }}
                    >
                      重试连接
                    </button>
                  </>
                ) : (
                  <>
                    <Mail size={32} style={{ opacity: 0.3 }} />
                    <p style={{ fontSize: '13px', color: 'var(--fg-overlay0)' }}>点击"刷新"获取邮件</p>
                  </>
                )}
                {scanResult && (
                  <p style={{
                    fontSize: '12px',
                    color: 'var(--accent-yellow)',
                    background: 'rgba(223, 142, 29, 0.1)',
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-sm)'
                  }}>
                    {scanResult}
                  </p>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {scanResult && (
                  <div style={{
                    padding: '6px 12px',
                    fontSize: '12px',
                    color: 'var(--accent-yellow)',
                    background: 'rgba(223, 142, 29, 0.1)',
                    borderBottom: '1px solid var(--border-default)'
                  }}>
                    {scanResult}
                  </div>
                )}
                {emails.map((email) => (
                  <div
                    key={email.uid}
                    className="email-list-item"
                    style={{
                      padding: '8px 12px',
                      borderBottom: '1px solid var(--border-default)',
                      cursor: 'pointer',
                      transition: 'background 0.1s',
                      opacity: email.isInvoice ? 1 : 0.7
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background = 'var(--bg-mantle)'
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = 'transparent'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1, minWidth: 0 }}>
                        {email.isInvoice && (
                          <FileText size={12} style={{ color: 'var(--accent-peach)', flexShrink: 0 }} />
                        )}
                        <span style={{
                          fontSize: '12px',
                          fontWeight: email.isInvoice ? 600 : 400,
                          color: 'var(--fg-text)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}>
                          {email.subject}
                        </span>
                      </div>
                      <span style={{ fontSize: '10px', color: 'var(--fg-overlay0)', flexShrink: 0, marginLeft: '8px' }}>
                        {formatEmailDate(email.date)}
                      </span>
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--fg-overlay0)', marginBottom: '2px' }}>
                      {email.from}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--fg-overlay1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{email.snippet}</span>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation()
                          if (!activeAccount) return
                          const result = await window.electronAPI?.imap?.getEmailBody?.(activeAccount.id, email.uid)
                          if (result?.success && result.body) {
                            const links = extractInvoiceLinks(result.body)
                            if (links.length > 0) {
                              setEmailLinks((prev) => ({ ...prev, [email.uid]: links }))
                              addToast({ type: 'info', message: `发现 ${links.length} 个发票下载链接` })
                            } else {
                              const win = window.open('', '_blank', 'width=600,height=400')
                              if (win) {
                                win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${email.subject}</title><style>body{font-family:sans-serif;padding:16px;line-height:1.6;max-width:600px;margin:0 auto;}</style></head><body>${result.body}</body></html>`)
                                win.document.close()
                              }
                            }
                          } else {
                            addToast({ type: 'warning', message: '无法获取邮件正文' })
                          }
                        }}
                        style={{
                          flexShrink: 0,
                          padding: '1px 6px',
                          fontSize: '9px',
                          background: 'var(--bg-surface0)',
                          color: 'var(--fg-subtext0)',
                          borderRadius: 'var(--radius-sm)',
                          border: 'none',
                          cursor: 'pointer'
                        }}
                      >
                        查看正文
                      </button>
                    </div>
                    {emailLinks[email.uid] && emailLinks[email.uid].length > 0 && (
                      <div style={{ marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {emailLinks[email.uid].map((link, idx) => (
                          <button
                            key={idx}
                            onClick={async (e) => {
                              e.stopPropagation()
                              const success = await handleDownloadFromLink(email, link.url)
                              if (success) {
                                setEmailLinks((prev) => {
                                  const links = prev[email.uid] || []
                                  const newLinks = links.filter((_, i) => i !== idx)
                                  return { ...prev, [email.uid]: newLinks }
                                })
                              }
                            }}
                            disabled={downloadingLinkUrls.has(link.url)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '3px',
                              padding: '2px 8px',
                              fontSize: '10px',
                              background: 'rgba(30, 102, 245, 0.1)',
                              color: 'var(--accent-blue)',
                              borderRadius: 'var(--radius-sm)',
                              border: 'none',
                              cursor: downloadingLinkUrls.has(link.url) ? 'wait' : 'pointer'
                            }}
                          >
                            <DownloadCloud size={10} />
                            {downloadingLinkUrls.has(link.url) ? '下载中...' : link.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {email.hasAttachments && (
                      <div style={{ marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDownloadAttachment(email.uid)
                          }}
                          disabled={downloadingUids.has(email.uid)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '3px',
                            padding: '2px 8px',
                            fontSize: '10px',
                            background: 'var(--bg-surface0)',
                            color: 'var(--accent-blue)',
                            borderRadius: 'var(--radius-sm)',
                            border: 'none',
                            cursor: downloadingUids.has(email.uid) ? 'wait' : 'pointer'
                          }}
                        >
                          <Download size={10} />
                          {downloadingUids.has(email.uid)
                            ? (downloadProgress[email.uid]
                              ? `${downloadProgress[email.uid].completed}/${downloadProgress[email.uid].total}`
                              : '下载中')
                            : `${email.attachmentCount} 个附件`}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="email-footer">
            <span style={{ fontSize: '12px', color: 'var(--fg-overlay0)' }}>
              {allAreInvoices
                ? `共 ${emails.length} 封发票`
                : invoiceCount > 0
                  ? `发现 ${invoiceCount} 封发票，共 ${emails.length} 封`
                  : `已加载 ${emails.length} 封`
              }
            </span>
          </div>
        </>
      )}
    </div>
  )
}
