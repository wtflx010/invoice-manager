import { useState, useMemo } from 'react'
import { Search, ChevronRight, ChevronDown, FileText, Upload, Printer, Trash2, CheckSquare, Square, X, FolderInput, RefreshCw } from 'lucide-react'
import { useInvoiceStore } from '../../stores/invoiceStore'
import { useAppStore } from '../../stores/appStore'
import { useToastStore } from '../../stores/toastStore'
import { getCategoryIcon, getCategoryColor, classifyInvoice, allCategories } from '../../utils/classificationRules'
import type { Invoice, InvoiceCategory, InvoiceCategoryGroup, YearMonthGroup } from '../../types/invoice'

export default function InvoiceTree() {
  const searchQuery = useAppStore((s) => s.searchQuery)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const selectedInvoiceId = useAppStore((s) => s.selectedInvoiceId)
  const setSelectedInvoiceId = useAppStore((s) => s.setSelectedInvoiceId)
  const setRightPanelMode = useAppStore((s) => s.setRightPanelMode)
  const filterCategory = useAppStore((s) => s.filterCategory)
  const filterStatus = useAppStore((s) => s.filterStatus)
  const getInvoicesByCategory = useInvoiceStore((s) => s.getInvoicesByCategory)
  const getYearMonthGroups = useInvoiceStore((s) => s.getYearMonthGroups)
  const searchInvoices = useInvoiceStore((s) => s.searchInvoices)
  const invoices = useInvoiceStore((s) => s.invoices)
  const addInvoices = useInvoiceStore((s) => s.addInvoices)
  const updateInvoice = useInvoiceStore((s) => s.updateInvoice)
  const deleteInvoice = useInvoiceStore((s) => s.deleteInvoice)
  const addToPrintQueue = useInvoiceStore((s) => s.addToPrintQueue)
  const addToast = useToastStore((s) => s.addToast)

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [expandedYears, setExpandedYears] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBatchCategoryPicker, setShowBatchCategoryPicker] = useState(false)

  const isFiltering = filterCategory !== 'all' || filterStatus !== 'all'

  let filteredInvoices = invoices
  if (filterCategory !== 'all') {
    filteredInvoices = filteredInvoices.filter((inv) => inv.category === filterCategory)
  }
  if (filterStatus !== 'all') {
    filteredInvoices = filteredInvoices.filter((inv) => inv.status === filterStatus)
  }

  function computeCategoryGroups(invs: Invoice[]): InvoiceCategoryGroup[] {
    const categoryMap = new Map<string, InvoiceCategoryGroup>()
    for (const inv of invs) {
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
  }

  function computeYearMonthGroups(invs: Invoice[], category: InvoiceCategory): YearMonthGroup[] {
    const filtered = invs.filter((inv) => inv.category === category)
    const groupMap = new Map<string, YearMonthGroup>()
    for (const inv of filtered) {
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
  }

  const categoryGroups = isFiltering
    ? computeCategoryGroups(filteredInvoices)
    : getInvoicesByCategory()

  const toggleCategory = (key: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const toggleYear = (key: string) => {
    setExpandedYears((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const formatAmount = (amount: number) =>
    amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const searchFilteredInvoices = searchQuery ? searchInvoices(searchQuery) : null

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleSelectAll = () => {
    const allIds = filteredInvoices.map((inv) => inv.id)
    if (selectedIds.size === allIds.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(allIds))
    }
  }

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return
    const idsToDelete = Array.from(selectedIds)
    let successCount = 0
    for (const id of idsToDelete) {
      try {
        await deleteInvoice(id)
        successCount++
      } catch (err) {
        console.error('[InvoiceTree] Delete failed for:', id, err)
      }
    }
    addToast({ type: successCount > 0 ? 'success' : 'error', message: successCount > 0 ? `已删除 ${successCount} 张发票及对应文件` : '删除失败' })
    setSelectedIds(new Set())
    setBatchMode(false)
  }

  const handleBatchMarkReimbursed = async () => {
    if (selectedIds.size === 0) return
    const idsToUpdate = Array.from(selectedIds)
    for (const id of idsToUpdate) {
      await updateInvoice(id, { status: 'reimbursed' })
    }
    addToast({ type: 'success', message: `已标记 ${idsToUpdate.length} 张发票为报销` })
    setSelectedIds(new Set())
    setBatchMode(false)
  }

  const handleBatchChangeCategory = async (category: InvoiceCategory) => {
    if (selectedIds.size === 0) return
    const idsToUpdate = Array.from(selectedIds)
    for (const id of idsToUpdate) {
      await updateInvoice(id, { category })
    }
    addToast({ type: 'success', message: `已将 ${idsToUpdate.length} 张发票改分类为 ${category}` })
    setSelectedIds(new Set())
    setShowBatchCategoryPicker(false)
    setBatchMode(false)
  }

  const handleBatchReRecognize = async () => {
    if (selectedIds.size === 0) return
    const idsToReRecognize = Array.from(selectedIds)
    addToast({ type: 'info', message: `正在重新识别 ${idsToReRecognize.length} 张发票...` })
    try {
      const result = await window.electronAPI?.invoice?.batchReRecognize(idsToReRecognize)
      if (!result?.success) {
        addToast({ type: 'error', message: '重新识别失败' })
        return
      }
      const results = result.results || []
      const successCount = results.filter(r => r.success).length
      const failCount = results.filter(r => !r.success).length
      // Update local store with re-recognized data
      for (const r of results) {
        if (r.success && r.data) {
          await updateInvoice(r.id, {
            invoiceNumber: r.data.invoiceNumber as string | undefined,
            invoiceCode: r.data.invoiceCode as string | undefined,
            invoiceType: r.data.invoiceType as string | undefined,
            issueDate: r.data.issueDate as string | undefined,
            sellerName: r.data.sellerName as string | undefined,
            sellerTaxNumber: r.data.sellerTaxNumber as string | undefined,
            buyerName: r.data.buyerName as string | undefined,
            buyerTaxNumber: r.data.buyerTaxNumber as string | undefined,
            amountWithoutTax: r.data.amountWithoutTax as number | undefined,
            taxAmount: r.data.taxAmount as number | undefined,
            totalAmount: r.data.totalAmount as number | undefined
          })
        }
      }
      addToast({ type: successCount > 0 ? 'success' : 'error', message: `重新识别完成：${successCount} 张成功，${failCount} 张失败` })
      setSelectedIds(new Set())
      setBatchMode(false)
    } catch (err) {
      addToast({ type: 'error', message: `重新识别异常：${err instanceof Error ? err.message : String(err)}` })
    }
  }

  const handleImport = async () => {
    if (!window.electronAPI) {
      alert('导入功能仅在桌面应用中可用')
      return
    }
    setImporting(true)
    try {
      const paths = await window.electronAPI.file.openFileDialog()
      if (!paths || paths.length === 0) {
        setImporting(false)
        return
      }

      const fileInfos = await window.electronAPI.file.importFiles(paths)
      const now = new Date().toISOString()
      const today = now.substring(0, 10)

      const newInvoices: Invoice[] = []
      let duplicateCount = 0

      for (let index = 0; index < fileInfos.length; index++) {
        const fi = fileInfos[index]
        const category = classifyInvoice(fi.fileName)
        const invoiceType = category === '机票'
          ? '航空运输电子客票行程单'
          : '增值税普通发票'

        const invoice: Invoice = {
          id: `import-${Date.now()}-${index}`,
          invoiceCode: '',
          invoiceNumber: '',
          invoiceType,
          category,
          status: 'pending' as const,
          issueDate: today,
          sellerName: '',
          sellerTaxNumber: '',
          buyerName: '',
          buyerTaxNumber: '',
          amountWithoutTax: 0,
          taxAmount: 0,
          totalAmount: 0,
          filePath: fi.filePath,
          fileName: fi.fileName,
          fileFormat: fi.fileFormat as Invoice['fileFormat'],
          source: 'manual' as const,
          tags: [],
          createdAt: now,
          updatedAt: now
        }

        try {
          const parsed = await window.electronAPI?.file?.parseInvoice?.(invoice.filePath)
          if (parsed?.success) {
            invoice.invoiceNumber = (parsed.invoiceNumber as string) || ''
            invoice.invoiceType = (parsed.invoiceType as string) || invoice.invoiceType
            invoice.issueDate = (parsed.issueDate as string) || today
            invoice.sellerName = (parsed.sellerName as string) || ''
            invoice.sellerTaxNumber = (parsed.sellerTaxNumber as string) || ''
            invoice.buyerName = (parsed.buyerName as string) || ''
            invoice.buyerTaxNumber = (parsed.buyerTaxNumber as string) || ''
            invoice.amountWithoutTax = (parsed.amountWithoutTax as number) || 0
            invoice.taxAmount = (parsed.taxAmount as number) || 0
            invoice.totalAmount = (parsed.totalAmount as number) || 0
            invoice.category = classifyInvoice(fi.fileName, invoice.invoiceType, invoice.sellerName)
          }
        } catch (err) {
          console.warn(`[InvoiceTree] Parse failed for ${fi.fileName}:`, err)
        }

        if (invoice.invoiceNumber) {
          const isDuplicate = await window.electronAPI?.db?.checkDuplicate?.(invoice.invoiceCode, invoice.invoiceNumber, invoice.sellerName)
          if (isDuplicate) {
            duplicateCount++
            addToast({ type: 'warning', message: `发票 ${invoice.invoiceNumber} 已存在，已跳过` })
            continue
          }
        }

        newInvoices.push(invoice)
      }

      if (newInvoices.length > 0) {
        await addInvoices(newInvoices)
      }

      if (duplicateCount > 0) {
        addToast({ type: 'warning', message: `导入完成，跳过 ${duplicateCount} 张重复发票` })
      }
    } catch (err) {
      console.error('导入发票失败:', err)
    } finally {
      setImporting(false)
    }
  }

  const months = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

  const renderInvoiceItem = (inv: Invoice) => (
    <div
      key={inv.id}
      className={`tree-invoice-item ${selectedInvoiceId === inv.id ? 'selected' : ''}`}
      onClick={() => {
        if (batchMode) {
          toggleSelect(inv.id)
        } else {
          setSelectedInvoiceId(inv.id)
          setRightPanelMode('detail')
        }
      }}
    >
      {batchMode && (
        <span
          className="batch-checkbox"
          onClick={(e) => { e.stopPropagation(); toggleSelect(inv.id) }}
          style={{ cursor: 'pointer', marginRight: 6, display: 'inline-flex', alignItems: 'center' }}
        >
          {selectedIds.has(inv.id) ? <CheckSquare size={14} /> : <Square size={14} />}
        </span>
      )}
      <span className="invoice-file-icon" style={{ color: getCategoryColor(inv.category) }}>
        ●
      </span>
      <div className="invoice-item-info">
        <span className="invoice-item-name">
          {inv.fileName ? inv.fileName.replace(/\.[^.]+$/, '') : inv.sellerName || '未知发票'}
        </span>
      </div>
      {!batchMode && (
        <div className="tree-invoice-actions">
          <button
            className="tree-action-btn"
            onClick={(e) => { e.stopPropagation(); addToPrintQueue(inv); addToast({ type: 'success', message: '已加入打印队列' }) }}
            title="加入打印队列"
          >
            <Printer size={12} />
          </button>
          <button
            className="tree-action-btn tree-action-delete"
            onClick={(e) => { e.stopPropagation(); if (confirm(`确定要删除发票 "${inv.fileName || inv.sellerName || inv.id}" 吗？`)) { deleteInvoice(inv.id); addToast({ type: 'success', message: '已删除' }) } }}
            title="删除"
          >
            <Trash2 size={12} />
          </button>
        </div>
      )}
      <span className="invoice-item-amount">¥{formatAmount(inv.totalAmount)}</span>
    </div>
  )

  return (
    <div className="invoice-tree">
      <div className="invoice-tree-header">
        <span className="invoice-tree-title">发票分类</span>
        <span className="invoice-tree-count">{filteredInvoices.length}</span>
        <button
          className={`batch-toggle-btn ${batchMode ? 'active' : ''}`}
          onClick={() => {
            setBatchMode(!batchMode)
            setSelectedIds(new Set())
            setShowBatchCategoryPicker(false)
          }}
          style={{
            marginLeft: 'auto',
            fontSize: 12,
            padding: '2px 8px',
            borderRadius: 4,
            border: '1px solid var(--border-default)',
            background: batchMode ? 'var(--accent-primary)' : 'transparent',
            color: batchMode ? '#fff' : 'var(--fg-text)',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            whiteSpace: 'nowrap'
          }}
        >
          {batchMode ? '退出批量' : '批量管理'}
        </button>
      </div>

      <div className="invoice-tree-actions">
        <button
          className="import-btn"
          onClick={handleImport}
          disabled={importing}
        >
          <Upload size={14} />
          <span>{importing ? '导入中...' : '导入发票'}</span>
        </button>
      </div>

      <div className="invoice-tree-search">
        <Search size={14} className="search-icon" />
        <input
          type="text"
          placeholder="搜索发票号码、商家..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="invoice-tree-content">
        {searchQuery && searchFilteredInvoices ? (
          searchFilteredInvoices.length === 0 ? (
            <div className="empty-state">
              <FileText size={28} className="empty-state-icon" />
              <p>未找到匹配的发票</p>
            </div>
          ) : (
            searchFilteredInvoices.map((inv) => renderInvoiceItem(inv))
          )
        ) : categoryGroups.length === 0 ? (
          <div className="empty-state">
            <FileText size={32} className="empty-state-icon" />
            <p>暂无发票</p>
            <p className="empty-hint">点击"导入发票"添加文件</p>
          </div>
        ) : (
          categoryGroups.map((group) => {
            const categoryKey = group.subCategory
              ? `${group.category}-${group.subCategory}`
              : group.category
            const yearMonthGroups = isFiltering
              ? computeYearMonthGroups(filteredInvoices, group.category)
              : getYearMonthGroups(group.category)

            return (
              <div key={categoryKey} className="tree-category">
                <div
                  className="tree-category-header"
                  onClick={() => toggleCategory(categoryKey)}
                >
                  <span className="tree-category-chevron">
                    {expandedCategories.has(categoryKey) ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                  </span>
                  <span className="tree-category-icon">
                    {getCategoryIcon(group.category)}
                  </span>
                  <span className="tree-category-name">{group.category}</span>
                  <span className="tree-category-meta">
                    <span>{group.count}张</span>
                    <span>¥{formatAmount(group.totalAmount)}</span>
                  </span>
                </div>

                {expandedCategories.has(categoryKey) &&
                  yearMonthGroups.map((ymGroup) => {
                    const ymKey = `${categoryKey}-${ymGroup.year}-${ymGroup.month}`
                    return (
                      <div key={ymKey} className="tree-category-invoices">
                        <div
                          className="tree-month-header"
                          onClick={() => toggleYear(ymKey)}
                        >
                          <span className="tree-category-chevron">
                            {expandedYears.has(ymKey) ? (
                              <ChevronDown size={12} />
                            ) : (
                              <ChevronRight size={12} />
                            )}
                          </span>
                          <span className="tree-month-name">
                            {ymGroup.year}年 {months[ymGroup.month - 1]}
                          </span>
                          <span className="tree-month-count">{ymGroup.count}张</span>
                        </div>

                        {expandedYears.has(ymKey) &&
                          ymGroup.invoices.map((inv) => renderInvoiceItem(inv))}
                      </div>
                    )
                  })}
              </div>
            )
          })
        )}
      </div>

      {batchMode && (
        <div
          className="batch-action-bar"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            borderTop: '1px solid var(--border-default)',
            background: 'var(--bg-surface)',
            position: 'relative'
          }}
        >
          <button
            className="batch-action-btn"
            onClick={handleSelectAll}
            style={{ fontSize: 12, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border-default)', background: 'transparent', color: 'var(--fg-text)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
          >
            全选
          </button>
          <button
            className="batch-action-btn"
            onClick={handleBatchDelete}
            disabled={selectedIds.size === 0}
            style={{ fontSize: 12, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border-default)', background: 'transparent', color: selectedIds.size === 0 ? 'var(--fg-overlay0)' : 'var(--fg-text)', cursor: selectedIds.size === 0 ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
          >
            删除选中
          </button>
          <button
            className="batch-action-btn"
            onClick={handleBatchMarkReimbursed}
            disabled={selectedIds.size === 0}
            style={{ fontSize: 12, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border-default)', background: 'transparent', color: selectedIds.size === 0 ? 'var(--fg-overlay0)' : 'var(--fg-text)', cursor: selectedIds.size === 0 ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
          >
            标记报销
          </button>
          <button
            className="batch-action-btn"
            onClick={handleBatchReRecognize}
            disabled={selectedIds.size === 0}
            style={{ fontSize: 12, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border-default)', background: 'transparent', color: selectedIds.size === 0 ? 'var(--fg-overlay0)' : 'var(--fg-text)', cursor: selectedIds.size === 0 ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
          >
            <RefreshCw size={12} />
            重新识别
          </button>
          <div style={{ position: 'relative' }}>
            <button
              className="batch-action-btn"
              onClick={() => setShowBatchCategoryPicker(!showBatchCategoryPicker)}
              disabled={selectedIds.size === 0}
              style={{ fontSize: 12, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border-default)', background: 'transparent', color: selectedIds.size === 0 ? 'var(--fg-overlay0)' : 'var(--fg-text)', cursor: selectedIds.size === 0 ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <FolderInput size={12} />
              改分类
            </button>
            {showBatchCategoryPicker && (
              <div
                className="batch-category-picker"
                style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: 0,
                  marginBottom: 4,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 6,
                  padding: 4,
                  zIndex: 100,
                  minWidth: 120,
                  maxHeight: 240,
                  overflowY: 'auto',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                }}
              >
                {allCategories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => handleBatchChangeCategory(cat)}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '4px 8px',
                      fontSize: 12,
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--fg-text)',
                      cursor: 'pointer',
                      borderRadius: 3
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                  >
                    {getCategoryIcon(cat)} {cat}
                  </button>
                ))}
              </div>
            )}
          </div>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--fg-overlay0)' }}>
            已选 {selectedIds.size} 项
          </span>
        </div>
      )}
    </div>
  )
}
