import React, { useState, useEffect } from 'react'
import {
  X, Printer, FileOutput, Shield, Eye, EyeOff,
  Save, Trash2, Download, Upload, CheckCircle2, AlertCircle,
  RotateCcw, FolderOpen, Info, RefreshCw, Zap,
  Cpu, Loader2, Bot
} from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { useInvoiceStore } from '../../stores/invoiceStore'
import { useToastStore } from '../../stores/toastStore'
import type { AppSettings } from '../../types/invoice'

type SettingsTab = 'ocr' | 'ai' | 'print' | 'naming' | 'storage' | 'privacy' | 'about'

const aiProviders = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'tongyi', label: '通义千问' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'zhipu', label: '智谱 GLM' },
  { value: 'ollama', label: 'Ollama (本地)' },
  { value: 'lmstudio', label: 'LM Studio (本地)' },
  { value: 'custom', label: '自定义' }
]

const aiEndpoints: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  tongyi: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  deepseek: 'https://api.deepseek.com/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  ollama: 'http://localhost:11434/v1',
  lmstudio: 'http://localhost:1234/v1',
  custom: ''
}

const tabs: { key: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { key: 'ocr', label: '视觉模型', icon: <Cpu size={16} /> },
  { key: 'ai', label: '大模型', icon: <Bot size={16} /> },
  { key: 'print', label: '打印偏好', icon: <Printer size={16} /> },
  { key: 'naming', label: '文件命名', icon: <FileOutput size={16} /> },
  { key: 'storage', label: '存储路径', icon: <FolderOpen size={16} /> },
  { key: 'privacy', label: '隐私数据', icon: <Shield size={16} /> },
  { key: 'about', label: '关于', icon: <Info size={16} /> }
]

export default function SettingsModal() {
  const showSettings = useAppStore((s) => s.showSettings)
  const setShowSettings = useAppStore((s) => s.setShowSettings)
  const storeSettings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const ocrEngine = useAppStore((s) => s.ocrEngine)
  const downloadOcrModel = useAppStore((s) => s.downloadOcrModel)
  const checkOcrStatus = useAppStore((s) => s.checkOcrStatus)
  const clearAllInvoices = useInvoiceStore((s) => s.clearAllInvoices)
  const addToast = useToastStore((s) => s.addToast)

  const [activeTab, setActiveTab] = useState<SettingsTab>('ocr')
  const [localSettings, setLocalSettings] = useState<AppSettings>(storeSettings)
  // Sync localSettings when store settings change (e.g. after initialization)
  useEffect(() => {
    setLocalSettings(storeSettings)
  }, [storeSettings])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [fetchedModels, setFetchedModels] = useState<string[]>([])

  useEffect(() => {
    checkOcrStatus()
  }, [])
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available'>('idle')
  const [updateInfo, setUpdateInfo] = useState<{ version: string; releaseNotes?: string } | null>(null)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [appVersion] = useState(() => {
    return (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : null) ||
      document.querySelector('meta[name="app-version"]')?.getAttribute('content') ||
      '1.0.0'
  })

  useEffect(() => {
    if (!window.electronAPI?.update) return
    const unsubs = [
      window.electronAPI.update.onUpdateAvailable((info) => {
        setUpdateInfo(info)
        setUpdateState('available')
      }),
      window.electronAPI.update.onUpdateNotAvailable(() => {
        setUpdateState('not-available')
      }),
      window.electronAPI.update.onUpdateDownloaded(() => {
        setUpdateState('downloaded')
      }),
      window.electronAPI.update.onUpdateProgress((progress) => {
        setDownloadProgress(Math.round(progress.percent))
      })
    ]
    return () => { unsubs.forEach((u) => u()) }
  }, [])

  if (!showSettings) return null

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setLocalSettings((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  const handleTestConnection = async () => {
    if (!localSettings.aiApiEndpoint) return
    const apiKey = localSettings.aiApiKey || 'no-key'
    setTesting(true)
    setTestResult(null)
    setFetchedModels([])
    try {
      const result = await window.electronAPI?.ai?.testConnection?.(
        localSettings.aiApiEndpoint, apiKey
      )
      if (!result) {
        setTestResult({ success: false, message: '连接测试不可用' })
        return
      }
      if (result.success) {
        const models = (result.models as string[]) || []
        if (models.length > 0) {
          setFetchedModels(models)
          if (!models.includes(localSettings.aiModel)) {
            updateSetting('aiModel', models[0])
          }
          setTestResult({ success: true, message: `连接成功，发现 ${models.length} 个模型` })
        } else {
          setTestResult({ success: true, message: '连接成功' })
        }
      } else {
        setTestResult({ success: false, message: `连接失败：${String(result.error || '未知错误')}` })
      }
    } catch (err) {
      setTestResult({ success: false, message: `连接失败：${err instanceof Error ? err.message : String(err)}` })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateSettings(localSettings)
      setDirty(false)
      addToast({ type: 'success', message: '设置已保存' })
    } catch {
      addToast({ type: 'error', message: '保存失败，请重试' })
    } finally {
      setSaving(false)
    }
  }

  const handleBackupData = async () => {
    try {
      const invoices = await window.electronAPI?.db?.getAllInvoices?.()
      if (!invoices) return
      const jsonStr = JSON.stringify(invoices, null, 2)
      const blob = new Blob([jsonStr], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `invoice-backup-${new Date().toISOString().substring(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      addToast({ type: 'success', message: '数据备份成功' })
    } catch {
      addToast({ type: 'error', message: '备份失败' })
    }
  }

  const handleRestoreData = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const data = JSON.parse(text)
        if (!Array.isArray(data)) {
          addToast({ type: 'error', message: '无效的备份文件格式' })
          return
        }
        await clearAllInvoices?.()
        for (const invoice of data) {
          await window.electronAPI?.db?.insertInvoice?.(invoice as Record<string, unknown>)
        }
        await useInvoiceStore.getState().initialize()
        addToast({ type: 'success', message: `已恢复 ${data.length} 张发票` })
      } catch {
        addToast({ type: 'error', message: '恢复数据失败' })
      }
    }
    input.click()
  }

  const handleExportExcel = async () => {
    if (!window.electronAPI) {
      addToast({ type: 'error', message: '导出功能仅在桌面应用中可用' })
      return
    }
    try {
      const XLSX = await import('xlsx')
      const invoices = await window.electronAPI?.db?.getAllInvoices?.()
      if (!invoices || invoices.length === 0) {
        addToast({ type: 'info', message: '没有发票数据可导出' })
        return
      }
      const rows = invoices.map((inv: Record<string, unknown>) => ({
        '发票号码': inv.invoiceNumber || '',
        '发票类型': inv.invoiceType || '',
        '分类': inv.category || '',
        '状态': inv.status === 'reimbursed' ? '已报销' : '待报销',
        '开票日期': inv.issueDate || '',
        '销售方': inv.sellerName || '',
        '购买方': inv.buyerName || '',
        '不含税金额': Number(inv.amountWithoutTax) || 0,
        '税额': Number(inv.taxAmount) || 0,
        '价税合计': Number(inv.totalAmount) || 0,
        '文件名': inv.fileName || '',
        '来源': inv.source || ''
      }))
      const ws = XLSX.utils.json_to_sheet(rows)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '发票汇总')
      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const reader = new FileReader()
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1]
        const date = new Date().toISOString().substring(0, 10)
        const defaultName = `发票汇总_${date}.xlsx`
        try {
          const targetPath = await window.electronAPI?.dialog?.saveFileDialog?.(defaultName)
          if (targetPath) {
            await window.electronAPI?.file?.saveFile?.(defaultName, base64, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', targetPath)
            addToast({ type: 'success', message: `已导出 ${rows.length} 条发票记录` })
          }
        } catch {
          await window.electronAPI?.file?.saveFile?.(defaultName, base64, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          addToast({ type: 'success', message: `已导出 ${rows.length} 条发票记录` })
        }
      }
      reader.readAsDataURL(blob)
    } catch (err) {
      console.error('Export failed:', err)
      addToast({ type: 'error', message: '导出失败' })
    }
  }

  const handleClearCache = async () => {
    if (!confirm('确定要清除所有发票数据吗？此操作不可恢复！')) return
    await clearAllInvoices?.()
    addToast({ type: 'success', message: '所有发票数据已清除' })
  }

  const handleApplyNaming = async () => {
    if (!window.electronAPI) {
      addToast({ type: 'error', message: '文件重命名仅在桌面应用中可用' })
      return
    }
    try {
      const invoices = await window.electronAPI?.db?.getAllInvoices?.()
      if (!invoices || invoices.length === 0) {
        addToast({ type: 'info', message: '没有发票文件可重命名' })
        return
      }
      let renamed = 0
      let failed = 0
      let skipped = 0
      let sameName = 0
      const pattern = localSettings.fileNamingPattern || '{date}_{category}_{seller}_{amount}'
      for (const inv of invoices as Record<string, unknown>[]) {
        try {
          if (!inv.filePath) { skipped++; continue }
          const rawDate = (inv.issueDate as string || '').substring(0, 10)
          const dateFormat = localSettings.dateFormat || 'YYYYMMDD'
          let date = rawDate.replace(/-/g, '')
          if (dateFormat === 'YYYY-MM-DD') {
            date = rawDate
          } else if (dateFormat === 'YYYY年MM月DD日') {
            const parts = rawDate.split('-')
            date = parts.length === 3 ? `${parts[0]}年${parts[1]}月${parts[2]}日` : rawDate
          }
          const category = (inv.category as string) || '其他'
          const seller = ((inv.sellerName as string) || '未知').substring(0, 30)
          const amount = (Number(inv.totalAmount) || 0).toFixed(2)
          const code = (inv.invoiceNumber as string) || ''
          const buyer = ((inv.buyerName as string) || '').substring(0, 30)
          const oldPath = inv.filePath as string
          const ext = (oldPath.split('.').pop() || 'pdf').toLowerCase()
          let newName = pattern
            .replace(/{date}/g, date)
            .replace(/{category}/g, category)
            .replace(/{seller}/g, seller)
            .replace(/{amount}/g, amount)
            .replace(/{code}/g, code)
            .replace(/{invoice_code}/g, code)
            .replace(/{buyer}/g, buyer)
            .replace(/{format}/g, ext)
            .replace(/[<>:"/\\|?*]/g, '_')
            .substring(0, 200)
          const result = await window.electronAPI?.file?.renameInvoice?.(inv.id as string, oldPath, newName)
          if (result?.success) {
            if (result.skipped) {
              sameName++
            } else {
              useInvoiceStore.getState().updateInvoice(inv.id as string, {
                filePath: result.newPath,
                fileName: result.newFileName
              })
            }
            renamed++
          } else {
            console.error(`[ApplyNaming] Failed to rename invoice ${inv.id}:`, result?.error, 'oldPath:', oldPath, 'newName:', newName)
            failed++
          }
        } catch (e) {
          console.error(`[ApplyNaming] Exception renaming invoice ${inv.id}:`, e)
          failed++
        }
      }
      // 重命名完成后，从数据库重新加载所有发票，确保前端状态与数据库完全一致
      if (renamed > 0) {
        try {
          await useInvoiceStore.getState().initialize()
        } catch (e) {
          console.error('[ApplyNaming] Failed to reload invoices:', e)
        }
      }
      const parts: string[] = []
      if (renamed > 0) parts.push(`已处理 ${renamed} 个文件`)
      if (sameName > 0) parts.push(`${sameName} 个名称未变`)
      if (failed > 0) parts.push(`${failed} 个失败`)
      if (skipped > 0) parts.push(`${skipped} 个跳过`)
      if (renamed > 0) {
        addToast({ type: failed > 0 ? 'warning' : 'success', message: parts.join('，') })
      } else if (skipped > 0) {
        addToast({ type: 'warning', message: `${skipped} 个发票文件因缺少文件路径被跳过` })
      } else {
        addToast({ type: 'error', message: `重命名失败，共 ${failed} 个错误` })
      }
    } catch (err) {
      console.error('Batch rename failed:', err)
      addToast({ type: 'error', message: '重命名失败' })
    }
  }

  return (
    <div
      className="settings-modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 5000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <div className="settings-modal-content" style={{
        width: '720px',
        height: '520px',
        background: 'var(--bg-base)',
        borderRadius: '12px',
        boxShadow: '0 16px 48px rgba(0,0,0,0.35)',
        border: '1px solid var(--border-default)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 20px',
          borderBottom: '1px solid var(--border-default)',
          flexShrink: 0
        }}>
          <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--fg-text)' }}>系统设置</h2>
          <button
            onClick={() => setShowSettings(false)}
            style={{
              padding: '4px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              color: 'var(--fg-overlay0)',
              display: 'flex'
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <div style={{
            width: '160px',
            borderRight: '1px solid var(--border-default)',
            background: 'var(--bg-mantle)',
            padding: '8px',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0
          }}>
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`settings-tab-btn ${activeTab === tab.key ? 'active' : ''}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 12px',
                  fontSize: '13px',
                  border: 'none',
                  background: 'transparent',
                  color: activeTab === tab.key ? 'var(--fg-text)' : 'var(--fg-overlay0)',
                  cursor: 'pointer',
                  marginBottom: '2px',
                  fontWeight: activeTab === tab.key ? 500 : 400,
                  width: '100%'
                }}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          <div style={{
            flex: 1,
            padding: '20px',
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div className="settings-tab-content" style={{ flex: 1 }}>
              {activeTab === 'ocr' && (
                <div>
                  <div style={{
                    padding: '20px 16px',
                    background: 'var(--bg-crust)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-default)',
                    marginBottom: '16px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                      <div style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '10px',
                        background: ocrEngine.status === 'ready'
                          ? 'var(--accent-green)'
                          : ocrEngine.status === 'error'
                            ? 'var(--accent-red)'
                            : 'var(--accent-blue)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}>
                        <Cpu size={20} color="white" />
                      </div>
                      <div>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg-text)' }}>
                          PaddleOCR 本地视觉模型
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--fg-overlay0)', marginTop: '2px' }}>
                          {ocrEngine.status === 'ready'
                            ? '模型已就绪，可离线识别扫描件发票'
                            : ocrEngine.status === 'downloading'
                              ? '正在下载安装模型依赖...'
                              : ocrEngine.status === 'error'
                                ? '安装失败：' + (ocrEngine.errorMessage || '未知错误')
                                : '点击下方按钮下载安装视觉模型（首次约需 500MB-1GB 空间）'}
                        </div>
                      </div>
                    </div>

                    {ocrEngine.status === 'ready' && (
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '8px 12px',
                        background: 'rgba(166, 227, 161, 0.1)',
                        borderRadius: '6px',
                        fontSize: '12px',
                        color: 'var(--accent-green)'
                      }}>
                        <CheckCircle2 size={14} />
                        模型已部署完成，所有 PDF 发票将自动使用本地 OCR 识别
                      </div>
                    )}

                    {ocrEngine.status === 'error' && (
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '8px 12px',
                        background: 'rgba(210, 15, 57, 0.06)',
                        borderRadius: '6px',
                        fontSize: '12px',
                        color: 'var(--accent-red)',
                        marginBottom: '12px'
                      }}>
                        <AlertCircle size={14} />
                        {ocrEngine.errorMessage || '安装失败，请重试'}
                      </div>
                    )}

                    {ocrEngine.status === 'downloading' && (
                      <div style={{ marginBottom: '12px' }}>
                        <div style={{
                          fontSize: '12px',
                          color: 'var(--fg-overlay0)',
                          marginBottom: '6px'
                        }}>
                          正在安装依赖包，请稍候... 这可能需要几分钟
                        </div>
                        <div style={{
                          width: '100%',
                          height: '4px',
                          background: 'var(--bg-surface0)',
                          borderRadius: '2px',
                          overflow: 'hidden'
                        }}>
                          <div style={{
                            width: '100%',
                            height: '100%',
                            background: 'var(--accent-blue)',
                            borderRadius: '2px',
                            animation: 'pulse 1.5s ease-in-out infinite'
                          }} />
                        </div>
                      </div>
                    )}

                    <button
                      className="settings-btn primary"
                      onClick={() => downloadOcrModel()}
                      disabled={ocrEngine.status === 'downloading'}
                      style={{ width: '100%' }}
                    >
                      {ocrEngine.status === 'downloading' ? (
                        <>
                          <Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} />
                          正在安装...
                        </>
                      ) : ocrEngine.status === 'ready' ? (
                        <>
                          <RefreshCw size={14} />
                          重新安装
                        </>
                      ) : (
                        <>
                          <Download size={14} />
                          下载视觉模型
                        </>
                      )}
                    </button>
                  </div>

                  <div style={{
                    padding: '12px 16px',
                    borderRadius: '8px',
                    background: 'var(--bg-surface1)',
                    fontSize: '12px',
                    color: 'var(--fg-overlay0)',
                    lineHeight: 1.6
                  }}>
                    <div style={{ fontWeight: 600, color: 'var(--fg-text)', marginBottom: '6px' }}>
                      关于本地视觉模型
                    </div>
                    <ul style={{ margin: 0, paddingLeft: '16px' }}>
                      <li>使用 PaddleOCR 引擎，专为中文发票优化</li>
                      <li>完全本地运行，无需联网，保护数据隐私</li>
                      <li>首次安装需要下载约 500MB 模型文件</li>
                      <li>安装后所有 PDF 扫描件将自动使用本地识别</li>
                      <li>支持 Windows 和 macOS 双平台</li>
                    </ul>
                  </div>
                </div>
              )}

              {activeTab === 'ai' && (
                <div>
                  <div style={{
                    padding: '12px 16px',
                    borderRadius: '8px',
                    background: 'var(--bg-surface1)',
                    fontSize: '12px',
                    color: 'var(--fg-overlay0)',
                    lineHeight: 1.6,
                    marginBottom: '16px'
                  }}>
                    <div style={{ fontWeight: 600, color: 'var(--fg-text)', marginBottom: '4px' }}>
                      大模型用于智能对话与发票分析
                    </div>
                    配置后可使用 AI 对话、智能分析、自动归类等功能。视觉模型（PaddleOCR）负责发票文字识别，大模型负责语义理解和交互，两者互补。
                  </div>

                  <div className="settings-field" style={{ marginBottom: '14px' }}>
                    <label className="settings-label">服务提供商</label>
                    <select
                      className="settings-select"
                      value={localSettings.aiProvider}
                      onChange={(e) => {
                        const provider = e.target.value
                        updateSetting('aiProvider', provider)
                        const endpoint = aiEndpoints[provider]
                        if (endpoint !== undefined) {
                          updateSetting('aiApiEndpoint', endpoint)
                        }
                      }}
                    >
                      {aiProviders.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="settings-field" style={{ marginBottom: '14px' }}>
                    <label className="settings-label">API 地址</label>
                    <input
                      className="settings-input"
                      type="text"
                      placeholder="https://api.openai.com/v1"
                      value={localSettings.aiApiEndpoint}
                      onChange={(e) => updateSetting('aiApiEndpoint', e.target.value)}
                    />
                  </div>

                  <div className="settings-field" style={{ marginBottom: '14px' }}>
                    <label className="settings-label">API Key</label>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <input
                        className="settings-input"
                        type={showApiKey ? 'text' : 'password'}
                        placeholder="sk-..."
                        value={localSettings.aiApiKey}
                        onChange={(e) => updateSetting('aiApiKey', e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <button
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="settings-btn secondary"
                      >
                        {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                      <button
                        onClick={handleTestConnection}
                        disabled={testing}
                        className="settings-btn primary"
                      >
                        {testing ? (
                          <>
                            <div style={{ width: '12px', height: '12px', border: '2px solid transparent', borderTopColor: 'currentColor', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                            测试中...
                          </>
                        ) : (
                          <>
                            <Zap size={12} />
                            测试
                          </>
                        )}
                      </button>
                    </div>
                    {testResult && (
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: '6px',
                        marginTop: '8px', padding: '6px 10px', fontSize: '11px',
                        borderRadius: 'var(--radius-sm)',
                        background: testResult.success ? 'rgba(166, 227, 161, 0.1)' : 'rgba(210, 15, 57, 0.06)',
                        color: testResult.success ? 'var(--accent-green)' : 'var(--accent-red)'
                      }}>
                        {testResult.success ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                        {testResult.message}
                      </div>
                    )}
                  </div>

                  <div className="settings-field" style={{ marginBottom: '14px' }}>
                    <label className="settings-label">对话模型</label>
                    <select
                      className="settings-select"
                      value={localSettings.aiModel}
                      onChange={(e) => updateSetting('aiModel', e.target.value)}
                    >
                      {(fetchedModels.length > 0 ? fetchedModels : [localSettings.aiModel || 'gpt-4']).map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    {fetchedModels.length === 0 && (
                      <div style={{ fontSize: '11px', color: 'var(--fg-overlay0)', marginTop: '4px' }}>
                        点击"测试"按钮可自动获取可用模型列表
                      </div>
                    )}
                  </div>

                  <div className="settings-field" style={{ marginBottom: '14px' }}>
                    <label className="settings-label">视觉模型 <span style={{ fontSize: '11px', color: 'var(--fg-overlay1)' }}>用于发票图片识别</span></label>
                    <select
                      className="settings-select"
                      value={localSettings.aiVisionModel || localSettings.aiModel}
                      onChange={(e) => updateSetting('aiVisionModel', e.target.value)}
                    >
                      {(fetchedModels.length > 0 ? fetchedModels : [localSettings.aiVisionModel || localSettings.aiModel || 'gpt-4o']).map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>

                  <div className="settings-field" style={{ marginBottom: '14px' }}>
                    <label className="settings-label">Temperature: {localSettings.aiTemperature?.toFixed(1) ?? '0.3'}</label>
                    <input
                      type="range"
                      min="0" max="2" step="0.1"
                      value={localSettings.aiTemperature ?? 0.3}
                      onChange={(e) => updateSetting('aiTemperature', parseFloat(e.target.value))}
                      style={{ width: '100%' }}
                      className="settings-range"
                    />
                  </div>

                  <div className="settings-field">
                    <label className="settings-label">最大 Tokens</label>
                    <input
                      className="settings-input"
                      type="number"
                      min={256} max={32768}
                      value={localSettings.aiMaxTokens ?? 4096}
                      onChange={(e) => updateSetting('aiMaxTokens', parseInt(e.target.value) || 4096)}
                    />
                  </div>
                </div>
              )}

              {activeTab === 'print' && (
                <div>
                  <div className="settings-field" style={{ marginBottom: '14px' }}>
                    <label className="settings-label">纸张大小</label>
                    <select
                      className="settings-select"
                      value={localSettings.paperSize}
                      onChange={(e) => updateSetting('paperSize', e.target.value)}
                    >
                      <option value="A4">A4</option>
                      <option value="A5">A5</option>
                      <option value="Letter">Letter</option>
                    </select>
                  </div>
                  <div className="settings-field" style={{ marginBottom: '14px' }}>
                    <label className="settings-label">默认份数</label>
                    <input
                      className="settings-input"
                      type="number"
                      min={1} max={10}
                      value={localSettings.defaultCopies}
                      onChange={(e) => updateSetting('defaultCopies', parseInt(e.target.value) || 1)}
                    />
                  </div>
                  <div className="settings-field" style={{ marginBottom: '14px' }}>
                    <label className="settings-label">缩放</label>
                    <input
                      className="settings-input"
                      type="number"
                      min={50} max={150}
                      value={localSettings.scalePercent}
                      onChange={(e) => updateSetting('scalePercent', parseInt(e.target.value) || 100)}
                    />
                    <span style={{ fontSize: '11px', color: 'var(--fg-overlay0)', marginLeft: '4px' }}>%</span>
                  </div>
                  <div className="settings-field" style={{ marginBottom: '14px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--fg-text)', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={localSettings.duplexPrint}
                        onChange={(e) => updateSetting('duplexPrint', e.target.checked)}
                      />
                      双面打印
                    </label>
                  </div>
                  <div className="settings-field" style={{ marginBottom: '14px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--fg-text)', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={localSettings.colorPrint}
                        onChange={(e) => updateSetting('colorPrint', e.target.checked)}
                      />
                      彩色打印
                    </label>
                  </div>
                </div>
              )}

              {activeTab === 'naming' && (
                <div>
                  <div className="settings-field" style={{ marginBottom: '14px' }}>
                    <label className="settings-label">命名模板</label>
                    <input
                      className="settings-input"
                      type="text"
                      placeholder="{date}_{category}_{seller}_{amount}"
                      value={localSettings.fileNamingPattern}
                      onChange={(e) => {
                        setLocalSettings((ls) => ({ ...ls, fileNamingPattern: e.target.value }))
                        setDirty(true)
                      }}
                    />
                    <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {[{v: '{date}', l: '日期'}, {v: '{category}', l: '分类'}, {v: '{seller}', l: '销售方'}, {v: '{amount}', l: '金额'}, {v: '{code}', l: '发票号码'}, {v: '{invoice_code}', l: '发票代码'}, {v: '{buyer}', l: '购买方'}, {v: '{format}', l: '文件格式'}].map((v) => (
                        <button
                          key={v.v}
                          onClick={() => {
                            const next = (localSettings.fileNamingPattern || '{date}_{category}') + v.v
                            setLocalSettings((ls) => ({ ...ls, fileNamingPattern: next }))
                            setDirty(true)
                          }}
                          style={{
                            padding: '2px 8px',
                            fontSize: '11px',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--border-default)',
                            background: 'var(--bg-surface0)',
                            color: 'var(--fg-subtext0)',
                            cursor: 'pointer'
                          }}
                        >
                          {v.l}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="settings-field" style={{ marginBottom: '14px' }}>
                    <label className="settings-label">日期格式</label>
                    <select
                      className="settings-select"
                      value={localSettings.dateFormat}
                      onChange={(e) => updateSetting('dateFormat', e.target.value)}
                    >
                      <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                      <option value="YYYYMMDD">YYYYMMDD</option>
                      <option value="YYYY年MM月DD日">YYYY年MM月DD日</option>
                    </select>
                  </div>
                  <div className="settings-field" style={{ marginBottom: '14px' }}>
                    <label className="settings-label">预览</label>
                    <div style={{
                      padding: '8px 12px',
                      background: 'var(--bg-crust)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '12px',
                      color: 'var(--fg-overlay0)',
                      fontFamily: 'monospace'
                    }}>
                      {(localSettings.fileNamingPattern || '{date}_{category}_{seller}_{amount}')
                        .replace('{date}', localSettings.dateFormat === 'YYYYMMDD' ? '20240115' : localSettings.dateFormat === 'YYYY年MM月DD日' ? '2024年01月15日' : '2024-01-15')
                        .replace('{category}', '餐饮')
                        .replace('{seller}', '某公司')
                        .replace('{amount}', '158.00')
                        .replace('{code}', '12345678')
                        .replace('{invoice_code}', '012001800311')
                        .replace('{buyer}', '本公司')
                        .replace('{format}', 'pdf')}
                    </div>
                  </div>
                  <button className="settings-btn primary" onClick={handleApplyNaming}>
                    <FileOutput size={12} />
                    应用到已有文件
                  </button>
                </div>
              )}

              {activeTab === 'storage' && (
                <div>
                  <div className="settings-field" style={{ marginBottom: '14px' }}>
                    <label className="settings-label">发票下载路径</label>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <input
                        className="settings-input"
                        type="text"
                        value={localSettings.storagePath}
                        onChange={(e) => {
                          setLocalSettings((s) => ({ ...s, storagePath: e.target.value }))
                          setDirty(true)
                        }}
                        placeholder="默认：应用数据目录/invoices"
                        style={{ flex: 1 }}
                      />
                      <button
                        className="settings-btn"
                        onClick={async () => {
                          const folder = await window.electronAPI?.dialog?.openFolderDialog?.()
                          if (folder) {
                            setLocalSettings((s) => ({ ...s, storagePath: folder }))
                            setDirty(true)
                          }
                        }}
                      >
                        <FolderOpen size={14} />
                        浏览
                      </button>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--fg-subtext0)', marginTop: '4px' }}>
                      从邮箱下载的发票附件将保存到此目录
                    </div>
                  </div>

                  <div className="settings-field" style={{ marginBottom: '14px' }}>
                    <label className="settings-label">存储策略</label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                      {[
                        { value: 'all', label: '全部文件（PDF + OFD + XML）' },
                        { value: 'pdf_only', label: '仅 PDF 文件' },
                        { value: 'xml_only', label: '仅 XML 文件' }
                      ].map((s) => (
                        <label key={s.value} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px' }}>
                          <input
                            type="radio"
                            name="storageStrategy"
                            checked={localSettings.storageStrategy === s.value}
                            onChange={() => {
                              setLocalSettings((ls) => ({ ...ls, storageStrategy: s.value as 'all' | 'pdf_only' | 'xml_only' }))
                              setDirty(true)
                            }}
                          />
                          {s.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="settings-field" style={{ marginBottom: '14px' }}>
                    <label className="settings-label">当前下载目录</label>
                    <div style={{
                      fontSize: '12px',
                      color: 'var(--fg-subtext0)',
                      background: 'var(--bg-surface0)',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      wordBreak: 'break-all'
                    }}>
                      {localSettings.storagePath || '应用数据目录/invoices（默认）'}
                    </div>
                  </div>

                  <button
                    className="settings-btn"
                    onClick={async () => {
                      const path = localSettings.storagePath || await window.electronAPI?.app?.getDataPath?.()
                      if (path) {
                        await window.electronAPI?.file?.openWithDefaultApp?.(path)
                      }
                    }}
                  >
                    <FolderOpen size={14} />
                    打开下载目录
                  </button>
                </div>
              )}

              {activeTab === 'privacy' && (
                <div>
                  <div className="settings-field" style={{ marginBottom: '14px' }}>
                    <label className="settings-label">数据库位置</label>
                    <div style={{
                      fontSize: '12px',
                      color: 'var(--fg-subtext0)',
                      background: 'var(--bg-surface0)',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      wordBreak: 'break-all'
                    }}>
                      {localSettings.storagePath
                        ? localSettings.storagePath.replace(/[/\\]invoices?$/, '') + '/invoices.db'
                        : '应用数据目录/invoices.db（默认）'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <button className="settings-btn secondary" onClick={handleExportExcel}>
                      <Download size={12} />
                      导出 Excel
                    </button>
                    <button className="settings-btn secondary" onClick={handleClearCache}>
                      <Trash2 size={12} />
                      清除缓存
                    </button>
                    <button className="settings-btn secondary" onClick={handleBackupData}>
                      <Download size={12} />
                      备份数据
                    </button>
                    <button className="settings-btn secondary" onClick={handleRestoreData}>
                      <Upload size={12} />
                      恢复数据
                    </button>
                  </div>
                </div>
              )}

              {activeTab === 'about' && (
                <div>
                  <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                    <div style={{ fontSize: '18px', fontWeight: 600, color: 'var(--fg-text)', marginBottom: '4px' }}>
                      发票管理助手
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--fg-overlay0)' }}>
                      版本 {appVersion}
                    </div>
                  </div>

                  <div style={{
                    padding: '16px',
                    background: 'var(--bg-crust)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-default)'
                  }}>
                    <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--fg-text)', marginBottom: '12px' }}>
                      更新检查
                    </div>

                    {updateState === 'idle' && (
                      <button
                        className="settings-btn primary"
                        onClick={async () => {
                          setUpdateState('checking')
                          try {
                            const result = await window.electronAPI?.update?.checkForUpdates?.()
                            if (result && !result.updateAvailable) {
                              setUpdateState('not-available')
                            }
                          } catch {
                            setUpdateState('idle')
                          }
                        }}
                      >
                        <RefreshCw size={12} />
                        检查更新
                      </button>
                    )}

                    {updateState === 'checking' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--fg-overlay0)' }}>
                        <div style={{ width: '14px', height: '14px', border: '2px solid transparent', borderTopColor: 'var(--accent-blue)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                        正在检查更新...
                      </div>
                    )}

                    {updateState === 'not-available' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <CheckCircle2 size={16} style={{ color: 'var(--accent-green)' }} />
                        <span style={{ fontSize: '13px', color: 'var(--fg-text)' }}>已是最新版本</span>
                        <button
                          className="settings-btn secondary"
                          style={{ marginLeft: 'auto', fontSize: '12px', padding: '4px 10px' }}
                          onClick={async () => {
                            setUpdateState('checking')
                            try {
                              const result = await window.electronAPI?.update?.checkForUpdates?.()
                              if (result && !result.updateAvailable) {
                                setUpdateState('not-available')
                              }
                            } catch {
                              setUpdateState('idle')
                            }
                          }}
                        >
                          重新检查
                        </button>
                      </div>
                    )}

                    {updateState === 'available' && updateInfo && (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                          <AlertCircle size={16} style={{ color: 'var(--accent-blue)' }} />
                          <span style={{ fontSize: '13px', color: 'var(--fg-text)' }}>
                            发现新版本 <strong>v{updateInfo.version}</strong>
                          </span>
                        </div>
                        {updateInfo.releaseNotes && (
                          <div style={{
                            fontSize: '12px',
                            color: 'var(--fg-overlay0)',
                            marginBottom: '12px',
                            padding: '8px',
                            background: 'var(--bg-mantle)',
                            borderRadius: 'var(--radius-sm)',
                            maxHeight: '80px',
                            overflow: 'auto'
                          }}>
                            {updateInfo.releaseNotes}
                          </div>
                        )}
                        <button
                          className="settings-btn primary"
                          onClick={() => {
                            setUpdateState('downloading')
                            setDownloadProgress(0)
                            window.electronAPI?.update?.downloadUpdate?.()
                          }}
                        >
                          <Download size={12} />
                          下载更新
                        </button>
                      </div>
                    )}

                    {updateState === 'downloading' && (
                      <div>
                        <div style={{ fontSize: '13px', color: 'var(--fg-text)', marginBottom: '8px' }}>
                          正在下载更新... {downloadProgress}%
                        </div>
                        <div style={{
                          width: '100%',
                          height: '6px',
                          background: 'var(--bg-surface0)',
                          borderRadius: '3px',
                          overflow: 'hidden'
                        }}>
                          <div style={{
                            width: `${downloadProgress}%`,
                            height: '100%',
                            background: 'var(--accent-blue)',
                            borderRadius: '3px',
                            transition: 'width 0.3s ease'
                          }} />
                        </div>
                      </div>
                    )}

                    {updateState === 'downloaded' && (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                          <CheckCircle2 size={16} style={{ color: 'var(--accent-green)' }} />
                          <span style={{ fontSize: '13px', color: 'var(--fg-text)' }}>更新已下载完成</span>
                        </div>
                        <button
                          className="settings-btn primary"
                          onClick={() => window.electronAPI?.update?.installUpdate?.()}
                        >
                          重启安装
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '8px',
              paddingTop: '16px',
              borderTop: '1px solid var(--border-default)',
              flexShrink: 0,
              marginTop: '8px'
            }}>
              <button
                className="settings-btn secondary"
                onClick={() => { setLocalSettings(storeSettings); setDirty(false) }}
                disabled={!dirty}
              >
                <RotateCcw size={12} />
                重置
              </button>
              <button
                className="settings-btn primary"
                onClick={handleSave}
                disabled={saving}
                style={{ minWidth: '80px' }}
              >
                {saving ? (
                  <>
                    <div style={{ width: '12px', height: '12px', border: '2px solid transparent', borderTopColor: 'currentColor', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                    保存中...
                  </>
                ) : (
                  <>
                    <Save size={12} />
                    保存
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}