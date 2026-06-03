import { useState } from 'react'
import { Printer, Trash2, Eye, CheckSquare, Square } from 'lucide-react'
import { useInvoiceStore } from '../../stores/invoiceStore'
import { useAppStore } from '../../stores/appStore'
import { useToastStore } from '../../stores/toastStore'
import { getCategoryColor, getCategoryIcon } from '../../utils/classificationRules'

export default function PrintQueue() {
  const printQueue = useInvoiceStore((s) => s.printQueue)
  const invoices = useInvoiceStore((s) => s.invoices)
  const removeFromPrintQueue = useInvoiceStore((s) => s.removeFromPrintQueue)
  const clearPrintQueue = useInvoiceStore((s) => s.clearPrintQueue)
  const addToPrintQueue = useInvoiceStore((s) => s.addToPrintQueue)
  const addToast = useToastStore((s) => s.addToast)
  const updateInvoice = useInvoiceStore((s) => s.updateInvoice)
  const selectedInvoiceId = useAppStore((s) => s.selectedInvoiceId)
  const getInvoiceById = useInvoiceStore((s) => s.getInvoiceById)

  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set())
  const [paperSize, setPaperSize] = useState('A4')
  const [duplex, setDuplex] = useState(false)

  const toggleJobSelection = (jobId: string) => {
    setSelectedJobs((prev) => {
      const next = new Set(prev)
      if (next.has(jobId)) {
        next.delete(jobId)
      } else {
        next.add(jobId)
      }
      return next
    })
  }

  const selectAll = () => {
    setSelectedJobs(new Set(printQueue.map((j) => j.id)))
  }

  const deselectAll = () => {
    setSelectedJobs(new Set())
  }

  const handleCopyChange = (jobId: string, copies: number) => {
    if (copies > 0) {
      useInvoiceStore.setState((state) => ({
        printQueue: state.printQueue.map((j) => j.id === jobId ? { ...j, copies } : j)
      }))
    }
  }

  const handleAddSelectedInvoice = () => {
    if (selectedInvoiceId) {
      const invoice = getInvoiceById(selectedInvoiceId)
      if (invoice) {
        addToPrintQueue(invoice)
      }
    }
  }

  const handlePrintPreview = async () => {
    const jobsToPrint = selectedJobs.size > 0
      ? printQueue.filter((j) => selectedJobs.has(j.id))
      : printQueue
    if (jobsToPrint.length === 0) return
    addToast({ type: 'info', message: `正在预览 ${jobsToPrint.length} 张发票...` })
    for (const job of jobsToPrint) {
      if (job.invoice.filePath && window.electronAPI) {
        try {
          const result = await window.electronAPI.print.printInvoice(job.invoice.filePath, {
            paperSize,
            copies: job.copies,
            duplex,
            preview: true
          })
          if (!result?.success) {
            addToast({ type: 'error', message: `预览失败: ${result?.error || '未知错误'}` })
          }
        } catch (err) {
          console.warn('Preview failed for', job.invoice.fileName, err)
          addToast({ type: 'error', message: `预览失败: ${job.invoice.fileName}` })
        }
      } else {
        addToast({ type: 'warning', message: `发票文件路径无效: ${job.invoice.fileName}` })
      }
    }
  }

  const handlePrintAll = async () => {
    const jobsToPrint = selectedJobs.size > 0
      ? printQueue.filter((j) => selectedJobs.has(j.id))
      : printQueue
    if (jobsToPrint.length === 0) return
    addToast({ type: 'info', message: `正在打印 ${jobsToPrint.length} 张发票...` })
    let successCount = 0
    let failCount = 0
    for (const job of jobsToPrint) {
      if (job.invoice.filePath && window.electronAPI) {
        try {
          const result = await window.electronAPI.print.printInvoice(job.invoice.filePath, {
            paperSize,
            copies: job.copies,
            duplex
          })
          if (result?.success) {
            successCount++
          } else {
            failCount++
            console.warn('Print failed for', job.invoice.fileName, result?.error)
          }
        } catch (err) {
          failCount++
          console.warn('Print failed for', job.invoice.fileName, err)
        }
      } else {
        failCount++
      }
    }
    if (successCount > 0) {
      if (selectedJobs.size > 0) {
        for (const jobId of selectedJobs) {
          removeFromPrintQueue(jobId)
        }
        setSelectedJobs(new Set())
      } else {
        clearPrintQueue()
      }
    }
    if (failCount > 0) {
      addToast({ type: 'warning', message: `打印完成 ${successCount} 张，失败 ${failCount} 张` })
    } else {
      addToast({ type: 'success', message: `已完成 ${successCount} 张发票打印` })
    }
  }

  const handleAddMonthCategory = (category?: string) => {
    const now = new Date()
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const filtered = invoices.filter((inv) => {
      const matchMonth = inv.issueDate?.startsWith(thisMonth)
      return category ? matchMonth && inv.category === category : matchMonth
    })
    let added = 0
    for (const inv of filtered) {
      const exists = printQueue.find((j) => j.invoiceId === inv.id)
      if (!exists) {
        addToPrintQueue(inv)
        added++
      }
    }
    if (added > 0) {
      addToast({ type: 'success', message: `已添加 ${added} 张发票到打印队列` })
    } else {
      addToast({ type: 'info', message: '没有新的发票可添加' })
    }
  }

  if (printQueue.length === 0) {
    return (
      <div className="print-panel">
        <div className="print-header">
          <h3 className="print-title">🖨️ 打印队列</h3>
        </div>
        <div className="empty-state" style={{ flex: 1, justifyContent: 'center' }}>
          <Printer size={48} className="empty-state-icon" />
          <p>打印队列为空</p>
          <p className="empty-hint">在发票详情中点击打印按钮添加到队列</p>
        </div>
        <div className="print-quick-add">
          <button
            className="print-quick-add-btn"
            onClick={handleAddSelectedInvoice}
            disabled={!selectedInvoiceId}
            style={{ opacity: selectedInvoiceId ? 1 : 0.5 }}
          >
            + 添加当前选中发票
          </button>
          <button
            className="print-quick-add-btn"
            onClick={() => handleAddMonthCategory('餐饮')}
          >
            + 添加本月餐饮类
          </button>
          <button
            className="print-quick-add-btn"
            onClick={() => handleAddMonthCategory()}
          >
            + 添加本月全部
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="print-panel">
      <div className="print-header">
        <h3 className="print-title">🖨️ 打印队列</h3>
        <button className="print-clear-btn" onClick={clearPrintQueue}>
          清空队列
        </button>
      </div>

      <div className="print-list">
        {printQueue.map((job) => (
          <div key={job.id} className="print-job">
            <div className="print-job-check">
              <input
                type="checkbox"
                checked={selectedJobs.has(job.id)}
                onChange={() => toggleJobSelection(job.id)}
              />
            </div>
            <div className="print-job-info">
              <div className="print-job-name">{job.invoice.fileName}</div>
              <div className="print-job-meta">
                <span>{job.invoice.invoiceType}</span>
                <span style={{ margin: '0 4px', color: 'var(--fg-overlay1)' }}>|</span>
                <span
                  style={{ color: getCategoryColor(job.invoice.category) }}
                >
                  {getCategoryIcon(job.invoice.category)} {job.invoice.category}
                </span>
                <span style={{ margin: '0 4px', color: 'var(--fg-overlay1)' }}>|</span>
                <span className={`status-badge ${job.invoice.status}`}>
                  {job.invoice.status === 'pending' ? '待报销' : '已报销'}
                </span>
              </div>
            </div>
            <div className="print-job-copies">
              <label>份数</label>
              <input
                type="number"
                min={1}
                max={99}
                value={job.copies}
                onChange={(e) =>
                  handleCopyChange(job.id, parseInt(e.target.value) || 1)
                }
              />
            </div>
            <button
              className="print-job-remove"
              onClick={() => removeFromPrintQueue(job.id)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <div style={{
        padding: '8px 16px',
        fontSize: '12px',
        color: 'var(--fg-overlay0)',
        borderTop: '1px solid var(--border-default)',
        flexShrink: 0
      }}>
        队列共 {printQueue.length} 张发票
        {selectedJobs.size > 0 && `，已选 ${selectedJobs.size} 张`}
      </div>

      <div className="print-options">
        <label>
          纸张:
          <select
            value={paperSize}
            onChange={(e) => setPaperSize(e.target.value)}
          >
            <option value="A4">A4</option>
            <option value="A5">A5</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={duplex}
            onChange={(e) => setDuplex(e.target.checked)}
          />
          双面打印
        </label>
      </div>

      <div className="print-actions">
        <button className="print-action-btn secondary" onClick={selectAll}>
          全选
        </button>
        <button className="print-action-btn secondary" onClick={deselectAll}>
          取消全选
        </button>
        <div style={{ flex: 1 }} />
        <button
          className="print-action-btn secondary"
          onClick={handlePrintPreview}
        >
          <Eye size={14} />
          预览
        </button>
        <button
          className="print-action-btn primary"
          onClick={handlePrintAll}
        >
          <Printer size={14} />
          开始打印
        </button>
      </div>

      <div className="print-quick-add">
        <button
          className="print-quick-add-btn"
          onClick={handleAddSelectedInvoice}
          disabled={!selectedInvoiceId}
          style={{ opacity: selectedInvoiceId ? 1 : 0.5 }}
        >
          + 添加当前选中发票
        </button>
        <button
          className="print-quick-add-btn"
          onClick={() => handleAddMonthCategory('餐饮')}
        >
          + 添加本月餐饮类
        </button>
        <button
          className="print-quick-add-btn"
          onClick={() => handleAddMonthCategory()}
        >
          + 添加本月全部
        </button>
      </div>
    </div>
  )
}