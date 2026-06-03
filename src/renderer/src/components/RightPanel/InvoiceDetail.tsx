import { useState, useEffect, useRef } from 'react'
import {
  Tag,
  Printer,
  Trash2,
  FileText,
  CheckCircle,
  XCircle,
  ZoomIn,
  ZoomOut,
  Pencil,
  Loader2,
  X,
  RefreshCw
} from 'lucide-react'
import { useInvoiceStore } from '../../stores/invoiceStore'
import { useAppStore } from '../../stores/appStore'
import { useToastStore } from '../../stores/toastStore'
import { allCategories as categories } from '../../utils/classificationRules'
import type { InvoiceCategory } from '../../types/invoice'

function EditableField({
  field,
  value,
  invoiceId,
  onUpdate,
  format = 'text',
  className,
  style
}: {
  field: string
  value: string | number | undefined
  invoiceId: string
  onUpdate: (id: string, updates: Record<string, unknown>) => Promise<void>
  format?: 'text' | 'number' | 'date'
  className?: string
  style?: React.CSSProperties
}) {
  const [editing, setEditing] = useState(false)
  const [editVal, setEditVal] = useState(String(value ?? ''))

  const startEdit = () => {
    setEditing(true)
    setEditVal(String(value ?? ''))
  }

  const save = () => {
    setEditing(false)
    const newVal = format === 'number' ? Number(editVal) || 0 : editVal
    if (newVal !== value) {
      onUpdate(invoiceId, { [field]: newVal, updatedAt: new Date().toISOString() })
    }
  }

  let display: string
  if (format === 'number' && typeof value === 'number' && value) {
    display = `¥${value.toFixed(2)}`
  } else if (format === 'date' && value) {
    display = String(value).substring(0, 10)
  } else {
    display = value ? String(value) : '-'
  }

  if (editing) {
    return (
      <input
        autoFocus
        type={format === 'number' ? 'number' : 'text'}
        value={editVal}
        onChange={(e) => setEditVal(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') setEditing(false)
        }}
        style={{
          width: '100%',
          padding: '2px 6px',
          fontSize: '12px',
          border: '1px solid var(--accent-blue)',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-base)',
          color: 'var(--fg-text)',
          outline: 'none'
        }}
      />
    )
  }

  return (
    <span
      className={className}
      style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '2px', ...style }}
      onClick={startEdit}
      title="点击编辑"
    >
      {display}
      <Pencil size={10} style={{ opacity: 0.3, flexShrink: 0 }} />
    </span>
  )
}

export default function InvoiceDetail() {
  const selectedInvoiceId = useAppStore((s) => s.selectedInvoiceId)
  const setSelectedInvoiceId = useAppStore((s) => s.setSelectedInvoiceId)
  const setRightPanelMode = useAppStore((s) => s.setRightPanelMode)
  const getInvoiceById = useInvoiceStore((s) => s.getInvoiceById)
  const updateInvoice = useInvoiceStore((s) => s.updateInvoice)
  const deleteInvoice = useInvoiceStore((s) => s.deleteInvoice)
  const addToPrintQueue = useInvoiceStore((s) => s.addToPrintQueue)
  const addToast = useToastStore((s) => s.addToast)

  const invoice = getInvoiceById(selectedInvoiceId || '')
  const [showCategoryPicker, setShowCategoryPicker] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const parsedInvoiceIdRef = useRef<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [previewType, setPreviewType] = useState<'image' | 'pdf' | 'none'>('none')
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [notesValue, setNotesValue] = useState('')
  const [parsing, setParsing] = useState(false)

  const hasBasicInfo = invoice && (
    (invoice.invoiceNumber && invoice.invoiceNumber !== '') ||
    (invoice.totalAmount && invoice.totalAmount > 0) ||
    (invoice.sellerName && invoice.sellerName !== '') ||
    (invoice.buyerName && invoice.buyerName !== '')
  )

  const handleReparse = async () => {
    if (!invoice?.filePath) return
    setParsing(true)
    parsedInvoiceIdRef.current = null
    try {
      const settings = useAppStore.getState().settings
      const hasAI = settings.aiApiKey && settings.aiApiEndpoint
      let p: Record<string, unknown> | null = null

      if (hasAI) {
        try {
          const visionResult = await window.electronAPI?.file?.parseInvoiceWithVision?.(invoice.filePath)
          if (visionResult?.success) {
            p = visionResult as Record<string, unknown>
          }
        } catch {
          // vision failed, fallback
        }
      }

      if (!p) {
        const parseResult = await window.electronAPI?.file?.parseInvoice?.(invoice.filePath)
        if (parseResult?.success) {
          p = parseResult as Record<string, unknown>
        }
      }

      if (p) {
        await updateInvoice(invoice.id, {
          invoiceNumber: (p.invoiceNumber as string) || invoice.invoiceNumber,
          invoiceType: (p.invoiceType as string) || invoice.invoiceType,
          issueDate: (p.issueDate as string) || invoice.issueDate,
          sellerName: (p.sellerName as string) || invoice.sellerName,
          sellerTaxNumber: (p.sellerTaxNumber as string) || invoice.sellerTaxNumber,
          buyerName: (p.buyerName as string) || invoice.buyerName,
          buyerTaxNumber: (p.buyerTaxNumber as string) || invoice.buyerTaxNumber,
          amountWithoutTax: (p.amountWithoutTax as number) || invoice.amountWithoutTax,
          taxAmount: (p.taxAmount as number) || invoice.taxAmount,
          totalAmount: (p.totalAmount as number) || invoice.totalAmount
        } as Parameters<typeof updateInvoice>[1])
        addToast({ type: 'success', message: hasAI ? 'AI 视觉识别完成，发票信息已更新' : '发票信息已重新解析' })
      } else {
        addToast({ type: 'warning', message: '未能解析出发票信息' })
      }
    } catch {
      addToast({ type: 'error', message: '解析失败' })
    } finally {
      setParsing(false)
    }
  }

  useEffect(() => {
    if (invoice) {
      setNotesValue(invoice.notes || '')
    }
  }, [invoice?.id, invoice?.notes])

  useEffect(() => {
    if (invoice?.filePath) {
      const ext = invoice.fileName?.substring(invoice.fileName.lastIndexOf('.'))?.toLowerCase() || ''

      if (ext === '.pdf') {
        setPreviewType('pdf')
        const filePath = invoice.filePath.replace(/\\/g, '/')
        setPreviewSrc(`file://${filePath.startsWith('/') ? '' : '/'}${filePath}`)
      } else if (ext === '.ofd') {
        setPreviewType('image')
        setPreviewLoading(true)
        setPreviewSrc(null)
        window.electronAPI?.file?.getOfdPreview?.(invoice.filePath).then((result) => {
          if (result?.success && result.data) {
            setPreviewSrc(`data:${result.mimeType};base64,${result.data}`)
          } else {
            setPreviewType('none')
          }
        }).catch(() => {
          setPreviewType('none')
        }).finally(() => {
          setPreviewLoading(false)
        })
      } else {
        setPreviewType('image')
        setPreviewLoading(true)
        setPreviewSrc(null)
        window.electronAPI?.file?.readFile(invoice.filePath).then((result) => {
          setPreviewSrc(`data:${result.mimeType};base64,${result.data}`)
        }).catch(() => {
          setPreviewSrc(null)
        }).finally(() => {
          setPreviewLoading(false)
        })
      }

      if (parsedInvoiceIdRef.current !== invoice.id) {
        const current = useInvoiceStore.getState().getInvoiceById(invoice.id)
        const hasInfo = current && (
          (current.invoiceNumber && current.invoiceNumber !== '') ||
          (current.totalAmount && current.totalAmount > 0) ||
          (current.sellerName && current.sellerName !== '') ||
          (current.buyerName && current.buyerName !== '')
        )
        if (!hasInfo) {
          parsedInvoiceIdRef.current = invoice.id
          const settings = useAppStore.getState().settings
          const hasAI = settings.aiApiKey && settings.aiApiEndpoint

          const doParse = async () => {
            let p: Record<string, unknown> | null = null

            if (hasAI) {
              try {
                const visionResult = await window.electronAPI?.file?.parseInvoiceWithVision?.(invoice.filePath)
                if (visionResult?.success) {
                  p = visionResult as Record<string, unknown>
                }
              } catch {
                // vision failed, fallback
              }
            }

            if (!p) {
              const parseResult = await window.electronAPI?.file?.parseInvoice?.(invoice.filePath)
              if (parseResult?.success) {
                p = parseResult as Record<string, unknown>
              }
            }

            if (p) {
              useInvoiceStore.getState().updateInvoice(invoice.id, {
                invoiceNumber: (p.invoiceNumber as string) || invoice.invoiceNumber || '',
                invoiceType: (p.invoiceType as string) || invoice.invoiceType || '',
                issueDate: (p.issueDate as string) || invoice.issueDate || '',
                sellerName: (p.sellerName as string) || invoice.sellerName || '',
                sellerTaxNumber: (p.sellerTaxNumber as string) || invoice.sellerTaxNumber || '',
                buyerName: (p.buyerName as string) || invoice.buyerName || '',
                buyerTaxNumber: (p.buyerTaxNumber as string) || invoice.buyerTaxNumber || '',
                amountWithoutTax: (p.amountWithoutTax as number) || invoice.amountWithoutTax || 0,
                taxAmount: (p.taxAmount as number) || invoice.taxAmount || 0,
                totalAmount: (p.totalAmount as number) || invoice.totalAmount || 0
              })
            }
          }

          doParse().catch(() => {})
        }
      }
    }
  }, [invoice?.id, invoice?.filePath])

  const handleReclassify = async (category: InvoiceCategory) => {
    if (!invoice) return
    await updateInvoice(invoice.id, { category, updatedAt: new Date().toISOString() })
    setShowCategoryPicker(false)
    addToast({ type: 'success', message: `已归类为 ${category}` })
  }

  const handlePrint = () => {
    if (invoice) {
      addToPrintQueue(invoice)
    }
    setRightPanelMode('print')
    addToast({ type: 'success', message: '已加入打印队列' })
  }

  const toggleReimbursed = async () => {
    if (!invoice) return
    const newStatus = invoice.status === 'reimbursed' ? 'pending' : 'reimbursed'
    await updateInvoice(invoice.id, { status: newStatus, updatedAt: new Date().toISOString() })
    addToast({ type: 'success', message: newStatus === 'reimbursed' ? '已标记为报销' : '已取消报销' })
  }

  const handleAddTag = () => {
    if (!invoice || !tagInput.trim()) return
    const newTags = [...(invoice.tags || []), tagInput.trim()]
    updateInvoice(invoice.id, { tags: newTags, updatedAt: new Date().toISOString() })
    setTagInput('')
  }

  const handleRemoveTag = (tag: string) => {
    if (!invoice) return
    const newTags = (invoice.tags || []).filter(t => t !== tag)
    updateInvoice(invoice.id, { tags: newTags, updatedAt: new Date().toISOString() })
  }

  const handleNotesBlur = () => {
    if (!invoice) return
    if (notesValue !== (invoice.notes || '')) {
      updateInvoice(invoice.id, { notes: notesValue, updatedAt: new Date().toISOString() })
    }
  }

  if (!invoice) {
    return <div className="right-panel-empty"><FileText size={40} style={{ opacity: 0.15 }} /><div style={{ fontSize: 12, marginTop: 8 }}>请选择一张发票</div></div>
  }

  const sectionTitleStyle = { fontSize: '12px', fontWeight: 600, color: 'var(--fg-subtext0)', marginBottom: '6px', paddingBottom: '4px', borderBottom: '1px solid var(--border-default)' }
  const editUpdate = updateInvoice as (id: string, updates: Record<string, unknown>) => Promise<void>

  return (
    <div className="detail-panel">
      <div className="detail-preview-area">
        <div style={{
          width: '100%',
          height: '100%',
          transform: `scale(${zoom})`,
          transformOrigin: 'center center',
          transition: 'transform 0.15s',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          {previewType === 'pdf' && previewSrc ? (
            <webview
              src={previewSrc}
              style={{ width: '100%', height: '100%', border: 'none' }}
              plugins
            />
          ) : previewType === 'image' && previewLoading ? (
            <Loader2 size={24} className="spinning" style={{ color: 'var(--fg-overlay0)' }} />
          ) : previewType === 'image' && previewSrc ? (
            <img
              src={previewSrc}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                display: 'block'
              }}
            />
          ) : (
            <div style={{ color: 'var(--fg-overlay0)', fontSize: 13 }}>
              {invoice.fileName?.toLowerCase().endsWith('.ofd') ? 'OFD 文件预览加载失败' : '暂无可预览内容'}
            </div>
          )}
        </div>
        {previewType !== 'none' && (previewSrc || previewLoading) && (
          <div className="detail-preview-zoom">
            <button onClick={() => setZoom(z => Math.max(0.3, z - 0.2))} title="缩小"><ZoomOut size={14} /></button>
            <button onClick={() => setZoom(1)} title="重置" style={{ fontSize: '11px' }}>{Math.round(zoom * 100)}%</button>
            <button onClick={() => setZoom(z => Math.min(3, z + 0.2))} title="放大"><ZoomIn size={14} /></button>
          </div>
        )}
      </div>

      <div className="detail-info">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <span className={`status-badge ${invoice.status === 'reimbursed' ? 'reimbursed' : 'pending'}`}>
            {invoice.status === 'reimbursed' ? '已报销' : '待报销'}
          </span>
          <span className={`status-badge ${invoice.category ? 'reimbursed' : 'pending'}`}>
            {invoice.category || '未分类'}
          </span>
        </div>

        <div className="detail-info-section">
          <div style={sectionTitleStyle}>金额信息</div>
          <div className="detail-info-row">
            <span className="detail-info-label">不含税金额</span>
            <EditableField field="amountWithoutTax" value={invoice.amountWithoutTax} invoiceId={invoice.id} onUpdate={editUpdate} format="number" className="detail-info-value amount" />
          </div>
          <div className="detail-info-row">
            <span className="detail-info-label">税额</span>
            <EditableField field="taxAmount" value={invoice.taxAmount} invoiceId={invoice.id} onUpdate={editUpdate} format="number" className="detail-info-value amount" />
          </div>
          <div className="detail-info-row">
            <span className="detail-info-label">价税合计</span>
            <EditableField field="totalAmount" value={invoice.totalAmount} invoiceId={invoice.id} onUpdate={editUpdate} format="number" className="detail-info-value amount" style={{ fontSize: '18px' }} />
          </div>
        </div>

        <div className="detail-info-section">
          <div style={{ ...sectionTitleStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>基本信息</span>
            <button
              onClick={handleReparse}
              disabled={parsing}
              title="重新解析发票信息"
              style={{
                background: 'none',
                border: 'none',
                cursor: parsing ? 'wait' : 'pointer',
                color: 'var(--fg-subtext0)',
                padding: '0 4px',
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
                fontSize: '10px'
              }}
            >
              <RefreshCw size={11} className={parsing ? 'spinning' : ''} />
              {parsing ? '解析中' : '重新解析'}
            </button>
          </div>
          <div className="detail-info-row">
            <span className="detail-info-label">发票号码</span>
            <EditableField field="invoiceNumber" value={invoice.invoiceNumber} invoiceId={invoice.id} onUpdate={editUpdate} />
          </div>
          <div className="detail-info-row">
            <span className="detail-info-label">开票日期</span>
            <EditableField field="issueDate" value={invoice.issueDate} invoiceId={invoice.id} onUpdate={editUpdate} format="date" />
          </div>
          <div className="detail-info-row"><span className="detail-info-label">发票类型</span><span className="detail-info-value">{invoice.invoiceType || '-'}</span></div>
        </div>

        <div className="detail-info-section">
          <div style={sectionTitleStyle}>销售方</div>
          <div className="detail-info-row">
            <span className="detail-info-label">名称</span>
            <EditableField field="sellerName" value={invoice.sellerName} invoiceId={invoice.id} onUpdate={editUpdate} />
          </div>
          {invoice.sellerTaxNumber && <div className="detail-info-row"><span className="detail-info-label">税号</span><span className="detail-info-value">{invoice.sellerTaxNumber}</span></div>}
        </div>

        <div className="detail-info-section">
          <div style={sectionTitleStyle}>购买方</div>
          <div className="detail-info-row">
            <span className="detail-info-label">名称</span>
            <EditableField field="buyerName" value={invoice.buyerName} invoiceId={invoice.id} onUpdate={editUpdate} />
          </div>
          {invoice.buyerTaxNumber && <div className="detail-info-row"><span className="detail-info-label">税号</span><span className="detail-info-value">{invoice.buyerTaxNumber}</span></div>}
        </div>

        <div className="detail-info-section">
          <div style={sectionTitleStyle}>备注</div>
          <textarea
            value={notesValue}
            onChange={(e) => setNotesValue(e.target.value)}
            onBlur={handleNotesBlur}
            placeholder="添加备注..."
            style={{
              width: '100%',
              minHeight: '60px',
              padding: '6px 8px',
              fontSize: '12px',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-base)',
              color: 'var(--fg-text)',
              resize: 'vertical',
              outline: 'none',
              fontFamily: 'inherit'
            }}
          />
        </div>

        <div className="detail-info-section">
          <div style={sectionTitleStyle}>标签</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
            {(invoice.tags || []).map((tag) => (
              <span
                key={tag}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '2px',
                  padding: '2px 8px',
                  fontSize: '11px',
                  background: 'rgba(30, 102, 245, 0.1)',
                  color: 'var(--accent-blue)',
                  borderRadius: 'var(--radius-sm)'
                }}
              >
                {tag}
                <X
                  size={10}
                  style={{ cursor: 'pointer', opacity: 0.6 }}
                  onClick={() => handleRemoveTag(tag)}
                />
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '4px' }}>
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddTag() }}
              placeholder="添加标签"
              style={{
                flex: 1,
                padding: '2px 6px',
                fontSize: '11px',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-base)',
                color: 'var(--fg-text)',
                outline: 'none'
              }}
            />
            <button
              onClick={handleAddTag}
              style={{
                padding: '2px 8px',
                fontSize: '11px',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-surface0)',
                color: 'var(--fg-text)',
                cursor: 'pointer'
              }}
            >
              添加
            </button>
          </div>
        </div>
      </div>

      <div className="detail-actions">
        {showCategoryPicker ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', width: '100%', justifyContent: 'center' }}>
            {categories.map((c) => (
              <button key={c} className="detail-action-btn" onClick={() => handleReclassify(c)} style={{ fontSize: '11px', padding: '4px 8px' }}>{c}</button>
            ))}
            <button className="detail-action-btn" onClick={() => setShowCategoryPicker(false)} style={{ fontSize: '11px', padding: '4px 8px' }}>取消</button>
          </div>
        ) : showDeleteConfirm ? (
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', width: '100%', justifyContent: 'center' }}>
            <span style={{ fontSize: '12px', color: 'var(--accent-red)' }}>确认删除？</span>
            <button className="detail-action-btn" onClick={() => { deleteInvoice(invoice.id); setSelectedInvoiceId(null); setShowDeleteConfirm(false); addToast({ type: 'success', message: '发票已删除' }) }} style={{ color: 'var(--accent-red)' }}>删除</button>
            <button className="detail-action-btn" onClick={() => setShowDeleteConfirm(false)}>取消</button>
          </div>
        ) : (
          <>
            <button className="detail-action-btn" onClick={() => setShowCategoryPicker(true)}><Tag size={14} /><span>分类</span></button>
            <button className="detail-action-btn" onClick={toggleReimbursed}>
              {invoice.status === 'reimbursed' ? <><XCircle size={14} /><span>取消报销</span></> : <><CheckCircle size={14} /><span>标记报销</span></>}
            </button>
            <button className="detail-action-btn" onClick={handlePrint}><Printer size={14} /><span>打印</span></button>
            <button className="detail-action-btn" onClick={() => setShowDeleteConfirm(true)}><Trash2 size={14} /><span>删除</span></button>
          </>
        )}
      </div>
    </div>
  )
}
