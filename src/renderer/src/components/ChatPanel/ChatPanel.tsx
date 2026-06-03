import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, User, Square, Upload, ScanSearch } from 'lucide-react'
import { useInvoiceStore } from '../../stores/invoiceStore'
import appIcon from '../../assets/icon.png'
import { useAppStore } from '../../stores/appStore'
import { useToastStore } from '../../stores/toastStore'
import { classifyInvoice } from '../../utils/classificationRules'
import { analyzeInvoices, generateImportReport, type AnalysisAlert } from '../../utils/smartAnalysis'
import type { Invoice, AppSettings } from '../../types/invoice'
import { executeTool, getOpenAITools } from '../../tools/toolExecutor'
import { memoryManager } from '../../memory/memoryManager'
import { knowledgeGraphClient } from '../../memory/knowledgeGraph'

interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  images?: string[]
  tool_calls?: Array<{
    tool: string
    params: Record<string, unknown>
  }>
  tool_call_id?: string
  toolStatus?: string
}


function extractContentFromResponse(json: Record<string, unknown>): string {
  if (json.choices && Array.isArray(json.choices) && json.choices.length > 0) {
    const choice = json.choices[0] as Record<string, unknown>
    const message = choice.message as Record<string, unknown> | undefined
    if (message?.content && typeof message.content === 'string') return message.content
    if (message?.reasoning_content && typeof message.reasoning_content === 'string') return String(message.reasoning_content)
    if (choice.text) return String(choice.text)
  }
  if (typeof json.content === 'string') return json.content
  if (json.response && typeof json.response === 'string') return json.response
  return ''
}

function buildSystemPrompt(
  invoices: Invoice[],
  parsedFiles: string,
  webContext: string,
  memoryContext?: string
): string {
  const totalAmount = invoices.reduce((s, i) => s + i.totalAmount, 0)
  const pending = invoices.filter((i) => i.status === 'pending').length
  const reimbursed = invoices.filter((i) => i.status === 'reimbursed').length

  const statsLine = invoices.length > 0
    ? `当前系统共有${invoices.length}张发票，总额¥${totalAmount.toFixed(2)}，待报销${pending}张，已报销${reimbursed}张`
    : '暂无发票'

  const fileSection = parsedFiles ? `\n已识别发票内容:\n${parsedFiles}` : ''

  return `你是智能发票管理助手。
1. 你可以通过工具查询、统计、分析用户的发票数据
2. 当用户的问题涉及发票查询、统计、分析时，应当先调用合适的工具获取真实数据，再基于工具结果回答
3. 回答要基于实际数据，有数据支撑，不要凭想象回答
4. 如果发现数据不完整（如金额为0、缺少关键字段），要如实指出
5. 回答简洁、有条理

当前状态: ${statsLine}${fileSection}${webContext ? '\n' + webContext : ''}${memoryContext ? '\n历史记忆:\n' + memoryContext : ''}`
}

function encodeImageToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [parsedFiles, setParsedFiles] = useState<string>('')
  const [streamingContent, setStreamingContent] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)
  const [batchParsing, setBatchParsing] = useState(false)

  const addInvoices = useInvoiceStore((s) => s.addInvoices)
  const invoices = useInvoiceStore((s) => s.invoices)
  const updateInvoice = useInvoiceStore((s) => s.updateInvoice)
  const settings = useAppStore((s) => s.settings)
  const addToast = useToastStore((s) => s.addToast)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const pendingImagesRef = useRef<string[]>([])
  const [pendingImages, setPendingImages] = useState<string[]>([])
  const dragCounterRef = useRef(0)

  useEffect(() => {
    memoryManager.init().catch(() => {})
    knowledgeGraphClient.connect().catch(() => {})
  }, [])

  useEffect(() => {
    if (invoices.length === 0) return
    const alerts = analyzeInvoices(invoices)
    if (alerts.length === 0) return
    const hasHighAlert = alerts.some(a => a.level === 'error' || a.level === 'warning')
    if (!hasHighAlert) return
    const lines: string[] = ['📋 智能提醒：']
    for (const alert of alerts) {
      if (alert.level === 'info') continue
      const icon = alert.level === 'error' ? '❗' : '⚠️'
      lines.push(`${icon} ${alert.title}: ${alert.message}`)
    }
    if (lines.length > 1) {
      const welcomeMsg: Message = {
        id: `msg-welcome-${Date.now()}`,
        role: 'assistant',
        content: lines.join('\n')
      }
      setMessages(prev => {
        if (prev.length > 0 && prev[0].content.includes('智能提醒')) return prev
        return [welcomeMsg, ...prev]
      })
    }
  }, [invoices.length])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])


  const callAI = async (
    apiMessages: Record<string, unknown>[],
    onStreamChunk?: (chunk: string) => void
  ): Promise<{ content: string; isStream: boolean }> => {
    const apiKey = settings.aiApiKey || 'no-key'
    const body: Record<string, unknown> = {
      model: settings.aiModel || 'gpt-4',
      stream: false,
      messages: apiMessages,
      temperature: settings.aiTemperature ?? 0.3,
      max_tokens: Math.min(settings.aiMaxTokens ?? 4096, 1024)
    }
    const result = await window.electronAPI!.ai.chat(settings.aiApiEndpoint, apiKey, body)
    if (!result.ok) {
      throw new Error(`API 请求失败 (${result.status || 'N/A'}): ${result.error || '未知错误'}`)
    }

    if (result.content && typeof result.content === 'string' && result.content.length > 0) {
      onStreamChunk?.(result.content)
      return { content: result.content, isStream: false }
    }

    if (result.body) {
      const json = result.body as Record<string, unknown>
      const content = extractContentFromResponse(json)
      if (content) {
        onStreamChunk?.(content)
        return { content, isStream: false }
      }
    }

    return { content: '', isStream: false }
  }

  const handleSend = async () => {
    if ((!input.trim() && pendingImages.length === 0) || isGenerating) return
    const images = [...pendingImages]
    setPendingImages([])

    const userMsg: Message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'user',
      content: input.trim() || '[图片]',
      images: images.length > 0 ? images : undefined
    }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setIsGenerating(true)
    setStreamingContent('')

    const controller = new AbortController()
    abortRef.current = controller
    const timeout = setTimeout(() => controller.abort(), 120000)

    const hasAI = settings.aiApiKey && settings.aiApiEndpoint

    if (!hasAI) {
      const assistantMsg: Message = {
        id: `msg-${Date.now()}-a-${Math.random().toString(36).slice(2, 8)}`,
        role: 'assistant',
        content: 'AI 模型尚未配置，请先在设置页面中配置大模型 API。\n\n当前系统提供完整的发票管理功能：\n• 左侧可导入和管理发票文件\n• 右侧可查看发票详情、管理打印队列\n• 设置中可配置 AI 服务商接入智能对话'
      }
      setMessages((prev) => [...prev, assistantMsg])
      setIsGenerating(false)
      abortRef.current = null
      clearTimeout(timeout)
      return
    }

    try {
      const webContext = '用户已开启深度分析模式。如果用户的问题涉及政策法规、税率变化、报销标准等需要最新知识的内容，请调用 web_search 工具搜索后再回答。'

      const userQueryText = userMsg.content || '发票'
      const memoryCtx = await memoryManager.retrieveContext(userQueryText)
      const historyCtx = await memoryManager.getConversationHistory()
      const kgCtx = await knowledgeGraphClient.buildContext(userQueryText)
      const fullMemoryContext = [memoryCtx, historyCtx, kgCtx].filter(Boolean).join('\n')
      const systemPrompt = buildSystemPrompt(invoices, parsedFiles, webContext, fullMemoryContext || undefined)
      const openAITools = getOpenAITools()

      const buildUserContent = (content: string, imgs: string[]): Record<string, unknown>[] => {
        const parts: Record<string, unknown>[] = []
        if (content && content !== '[图片]') {
          parts.push({ type: 'text', text: content })
        }
        for (const img of imgs) {
          parts.push({ type: 'image_url', image_url: { url: img, detail: 'high' } })
        }
        return parts
      }

      const buildApiMessages = (
        history: Message[],
        sysPrompt: string,
        userParts: Record<string, unknown>[]
      ): Record<string, unknown>[] => {
        const msgs: Record<string, unknown>[] = [
          { role: 'system', content: sysPrompt }
        ]
        for (const m of history.slice(-20)) {
          if (m.role === 'tool') {
            msgs.push({ role: 'tool', content: m.content, tool_call_id: m.tool_call_id })
          } else if (m.tool_calls && m.tool_calls.length > 0) {
            msgs.push({
              role: 'assistant',
              content: m.content || null,
              tool_calls: m.tool_calls.map((tc, i) => ({
                id: (tc as Record<string, unknown>).callId ? String((tc as Record<string, unknown>).callId) : `call_${i}_${m.id}`,
                type: 'function' as const,
                function: { name: tc.tool, arguments: JSON.stringify(tc.params) }
              }))
            })
          } else if (m.images && m.images.length > 0) {
            const parts: Record<string, unknown>[] = []
            if (m.content && m.content !== '[图片]') parts.push({ type: 'text', text: m.content })
            m.images.forEach((img) => parts.push({ type: 'image_url', image_url: { url: img, detail: 'high' } }))
            msgs.push({ role: m.role, content: parts })
          } else {
            msgs.push({ role: m.role, content: m.content })
          }
        }
        const merged: Record<string, unknown>[] = [msgs[0]]
        for (let i = 1; i < msgs.length; i++) {
          const last = merged[merged.length - 1]
          const curr = msgs[i]
          if (last.role === 'user' && curr.role === 'user') {
            const lastContent = typeof last.content === 'string' ? last.content : JSON.stringify(last.content)
            const currContent = typeof curr.content === 'string' ? curr.content : JSON.stringify(curr.content)
            last.content = lastContent + '\n' + currContent
          } else {
            merged.push(curr)
          }
        }
        return merged
      }

      const allMessages: Message[] = [...messages, userMsg]
      const userContent = buildUserContent(userMsg.content || '', images)
      const maxToolRounds = 3
      let round = 0
      let finalContent = ''
      let finalMsgId = ''

      while (round < maxToolRounds) {
        if (controller.signal.aborted) break
        round++

        const effectiveSystemPrompt = round === maxToolRounds
          ? systemPrompt + '\n\n当前是最终回复轮次。请基于之前已执行的工具结果，用自然语言简明扼要地回答用户问题。不要再次调用工具。用数据说话，不要空泛分析。'
          : systemPrompt

        const apiMessages = buildApiMessages(allMessages, effectiveSystemPrompt, userContent)

        const assistantMsgId = `msg-${Date.now()}-a-${Math.random().toString(36).slice(2, 8)}`
        finalMsgId = assistantMsgId

        const assistantMsg: Message = { id: assistantMsgId, role: 'assistant', content: '' }
        allMessages.push(assistantMsg)
        setMessages([...allMessages])

        const requestPayload: Record<string, unknown> = {
          model: settings.aiModel || 'gpt-4',
          messages: apiMessages,
          temperature: settings.aiTemperature ?? 0.3,
          max_tokens: settings.aiMaxTokens ?? 4096,
          tools: openAITools.length > 0 ? openAITools : undefined,
          tool_choice: round < maxToolRounds ? 'auto' as const : 'none' as const
        }

        try {
           const result = await window.electronAPI?.ai?.chat(
             settings.aiApiEndpoint,
             settings.aiApiKey || 'no-key',
             requestPayload
           )

          if (!result || !(result as Record<string, unknown>).ok) {
             const errMsg = (result as Record<string, unknown>)?.error || '请求失败'
             assistantMsg.content = `AI 请求失败：${errMsg}`
             setMessages([...allMessages])
             break
           }

           const raw = result as Record<string, unknown>
            const content = raw.content as string | undefined
            const contentText = content || ''
            const toolCallsRaw = Array.isArray(raw.tool_calls) ? raw.tool_calls as Array<Record<string, unknown>> : undefined

           if (!contentText && !toolCallsRaw?.length) {
            if (round === 1) {
              assistantMsg.content = 'AI 返回了空回复，请检查模型是否正常运行。'
              setMessages([...allMessages])
              break
            }
            // No content and no tools in later rounds — use what we have
            assistantMsg.content = assistantMsg.content || '抱歉，模型未能生成有效回复。请检查模型是否支持 function calling。'
            finalContent = assistantMsg.content
            setMessages([...allMessages])
            break
          }

          if (toolCallsRaw && toolCallsRaw.length > 0 && round < maxToolRounds) {
            assistantMsg.content = contentText || '查询中...'
            const generatedCallIds = toolCallsRaw.map((tc, i) => {
              const id = String(tc.id || `call_${i}_${assistantMsgId}`)
              return id
            })
            assistantMsg.tool_calls = toolCallsRaw.map((tc, i) => {
              const fn = tc.function as Record<string, unknown> | undefined
              return {
                tool: String(fn?.name || ''),
                params: (() => { try { return JSON.parse(String(fn?.arguments || '{}')) } catch { return {} } })(),
                callId: generatedCallIds[i]
              }
            })
            assistantMsg.toolStatus = `正在执行 ${toolCallsRaw.length} 个工具...`
            setMessages([...allMessages])

            const toolResults: string[] = []
            for (let ti = 0; ti < toolCallsRaw.length; ti++) {
              if (controller.signal.aborted) break
              const tc = toolCallsRaw[ti]
              const fn = tc.function as Record<string, unknown> | undefined
              const toolName = String(fn?.name || '')
              let toolParams: Record<string, unknown> = {}
              try { toolParams = JSON.parse(String(fn?.arguments || '{}')) } catch { /* skip */ }

              assistantMsg.toolStatus = `执行中 (${ti + 1}/${toolCallsRaw.length}): ${toolName}`
              setMessages([...allMessages])

              const result2 = await executeTool(toolName, toolParams)
              const resultStr = `工具: ${toolName}\n参数: ${JSON.stringify(toolParams)}\n结果: ${JSON.stringify(result2)}`
              toolResults.push(resultStr)
            }

            assistantMsg.toolStatus = `已执行 ${toolCallsRaw.length} 个工具，正在分析结果...`
            setMessages([...allMessages])

            for (let ti = 0; ti < toolCallsRaw.length; ti++) {
              const callId = generatedCallIds[ti]
              const toolMsg: Message = {
                id: `msg-${Date.now()}-tool-${ti}-${Math.random().toString(36).slice(2, 8)}`,
                role: 'tool',
                content: toolResults[ti] || '',
                tool_call_id: callId
              }
              allMessages.push(toolMsg)
            }
            setMessages([...allMessages])
          } else {
            assistantMsg.content = contentText
            finalContent = contentText
            setMessages([...allMessages])
            break
          }
        } catch (err) {
          assistantMsg.content = `AI 请求异常：${err instanceof Error ? err.message : '未知错误'}`
          setMessages([...allMessages])
          break
        }
      }

      if (!finalContent && finalMsgId) {
        const lastMsg = allMessages.find(m => m.id === finalMsgId)
        if (lastMsg) {
          lastMsg.content = lastMsg.content || '抱歉，未能获取到有效回答。请稍后重试。'
          lastMsg.toolStatus = undefined
        }
        setMessages([...allMessages])
      } else if (finalMsgId) {
        const lastMsg = allMessages.find(m => m.id === finalMsgId)
        if (lastMsg) lastMsg.toolStatus = undefined
        setMessages([...allMessages])
      }

      if (parsedFiles) {
        setParsedFiles('')
      }

      const finalAssistantContent = allMessages.find(m => m.id === finalMsgId)?.content || ''
      await memoryManager.saveMessage('user', userMsg.content || '[图片]', images)
      await memoryManager.saveMessage('assistant', finalAssistantContent)
      await memoryManager.autoExtractMemories(userMsg.content || '', finalAssistantContent)
    } catch (err) {
      if (controller.signal.aborted) return
      const errorMsg = err instanceof Error ? err.message : '未知错误'
      const assistantMsg: Message = {
        id: `msg-${Date.now()}-a-${Math.random().toString(36).slice(2, 8)}`,
        role: 'assistant',
        content: `AI 请求失败：${errorMsg}\n\n请检查：\n• API 地址和密钥是否正确\n• 网络连接是否正常\n• 服务商是否支持 /chat/completions 端点`
      }
      setMessages((prev) => [...prev, assistantMsg])
    } finally {
      clearTimeout(timeout)
      if (!controller.signal.aborted) {
        setIsGenerating(false)
        setStreamingContent('')
        abortRef.current = null
      }
    }
  }

  const handleStop = () => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    setIsGenerating(false)
    setStreamingContent('')
  }

  const handleBatchRecognize = async () => {
    const hasAI = settings.aiApiKey && settings.aiApiEndpoint
    if (!hasAI) {
      addToast({ type: 'warning', message: '请先配置 AI 模型后再进行识别' })
      return
    }

    const unparsed = invoices.filter((inv) => {
      const hasInfo = (inv.invoiceNumber && inv.invoiceNumber !== '') ||
        (inv.totalAmount && inv.totalAmount > 0) ||
        (inv.sellerName && inv.sellerName !== '') ||
        (inv.buyerName && inv.buyerName !== '')
      return !hasInfo && inv.filePath
    })

    if (unparsed.length === 0) {
      addToast({ type: 'info', message: '没有需要识别的未解析发票' })
      return
    }

    setBatchParsing(true)
    const assistantMsg: Message = {
      id: `msg-${Date.now()}-a-${Math.random().toString(36).slice(2, 8)}`,
      role: 'assistant',
      content: `正在识别 ${unparsed.length} 张未解析发票...`
    }
    setMessages((prev) => [...prev, assistantMsg])

    let successCount = 0
    let failCount = 0
    const results: string[] = []

    for (let i = 0; i < unparsed.length; i++) {
      const inv = unparsed[i]
      try {
        let p: Record<string, unknown> | null = null

        // 优先调用 parseInvoice（主进程内部已包含视觉识别+文本AI+正则）
        try {
          const parseResult = await window.electronAPI?.file?.parseInvoice?.(inv.filePath)
          if (parseResult?.success) {
            p = parseResult as Record<string, unknown>
          }
        } catch {
          // parseInvoice failed, try vision directly
        }

        // 如果 parseInvoice 失败，尝试直接视觉识别
        if (!p) {
          try {
            const visionResult = await window.electronAPI?.file?.parseInvoiceWithVision?.(inv.filePath)
            if (visionResult?.success) {
              p = visionResult as Record<string, unknown>
            }
          } catch {
            // vision failed
          }
        }

        if (p) {
          await updateInvoice(inv.id, {
            invoiceNumber: (p.invoiceNumber as string) || inv.invoiceNumber,
            invoiceType: (p.invoiceType as string) || inv.invoiceType,
            issueDate: (p.issueDate as string) || inv.issueDate,
            sellerName: (p.sellerName as string) || inv.sellerName,
            sellerTaxNumber: (p.sellerTaxNumber as string) || inv.sellerTaxNumber,
            buyerName: (p.buyerName as string) || inv.buyerName,
            buyerTaxNumber: (p.buyerTaxNumber as string) || inv.buyerTaxNumber,
            amountWithoutTax: (p.amountWithoutTax as number) || inv.amountWithoutTax,
            taxAmount: (p.taxAmount as number) || inv.taxAmount,
            totalAmount: (p.totalAmount as number) || inv.totalAmount
          })
          successCount++
          results.push(`✓ ${inv.fileName}: ${(p.sellerName as string) || '未知'} ¥${(p.totalAmount as number) || 0}`)
        } else {
          failCount++
          results.push(`✗ ${inv.fileName}: 未能识别`)
        }
      } catch {
        failCount++
        results.push(`✗ ${inv.fileName}: 识别异常`)
      }

      assistantMsg.content = `正在识别发票 (${i + 1}/${unparsed.length})...\n\n${results.join('\n')}`
      setMessages((prev) => [...prev.slice(0, -1), { ...assistantMsg }])
    }

    assistantMsg.content = `发票识别完成！\n\n成功: ${successCount} 张 | 失败: ${failCount} 张\n\n${results.join('\n')}`
    setMessages((prev) => [...prev.slice(0, -1), { ...assistantMsg }])
    addToast({ type: successCount > 0 ? 'success' : 'warning', message: `识别完成：成功 ${successCount} 张，失败 ${failCount} 张` })
    setBatchParsing(false)
  }

  const importFromPaths = useCallback(async (paths: string[]) => {
    if (!window.electronAPI) return
    setImporting(true)
    try {
      const fileInfos = await window.electronAPI?.file?.importFiles(paths)
      const now = new Date().toISOString()
      const today = now.substring(0, 10)

      const newInvoices: Invoice[] = []
      const parsedContexts: string[] = []
      const parseResults: { fileName: string; success: boolean; sellerName?: string; totalAmount?: number; error?: string }[] = []

      for (let index = 0; index < fileInfos.length; index++) {
        const fi = fileInfos[index]
        const category = classifyInvoice(fi.fileName)
        const inv: Invoice = {
          id: `import-${Date.now()}-${index}`,
          invoiceCode: '',
          invoiceNumber: '',
          invoiceType: category === '机票' ? '航空运输电子客票行程单' : '增值税普通发票',
          category,
          status: 'pending',
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
          source: 'manual',
          tags: [],
          createdAt: now,
          updatedAt: now
        }

        try {
          const parsed = await (window.electronAPI?.file as Record<string, unknown>)?.parseInvoice
            ? await window.electronAPI?.file?.parseInvoice(fi.filePath)
            : null
          if (parsed && (parsed as Record<string, unknown>).success) {
            const p = parsed as Record<string, unknown>
            Object.assign(inv, {
              invoiceNumber: (p.invoiceNumber as string) || '',
              invoiceType: (p.invoiceType as string) || inv.invoiceType,
              issueDate: (p.issueDate as string) || today,
              sellerName: (p.sellerName as string) || '',
              sellerTaxNumber: (p.sellerTaxNumber as string) || '',
              buyerName: (p.buyerName as string) || '',
              buyerTaxNumber: (p.buyerTaxNumber as string) || '',
              amountWithoutTax: (p.amountWithoutTax as number) || 0,
              taxAmount: (p.taxAmount as number) || 0,
              totalAmount: (p.totalAmount as number) || 0
            })
            inv.category = classifyInvoice(fi.fileName, inv.invoiceType, inv.sellerName)
            parseResults.push({
              fileName: fi.fileName,
              success: true,
              sellerName: inv.sellerName || '未知',
              totalAmount: inv.totalAmount
            })
          } else {
            parseResults.push({
              fileName: fi.fileName,
              success: false,
              error: '解析失败'
            })
          }
        } catch {
          parseResults.push({
            fileName: fi.fileName,
            success: false,
            error: '解析异常'
          })
        }

        if (inv.invoiceNumber) {
          const isDuplicate = await window.electronAPI?.db?.checkDuplicate?.(inv.invoiceCode, inv.invoiceNumber, inv.sellerName)
          if (isDuplicate) {
            addToast({ type: 'warning', message: `发票 ${inv.invoiceNumber} 已存在，已跳过` })
            continue
          }
        }

        newInvoices.push(inv)
        parsedContexts.push(
          `[${fi.fileName}] 类型:${inv.invoiceType} 金额:¥${inv.totalAmount.toFixed(2)} `
          + `分类:${inv.category} 销售方:${inv.sellerName || '未知'} 日期:${inv.issueDate}`
        )
      }

      await addInvoices(newInvoices)

      const successCount = parseResults.filter(r => r.success).length
      const failCount = parseResults.filter(r => !r.success).length

      const reportContent = generateImportReport(newInvoices, parseResults)

      const assistantMsg: Message = {
        id: `msg-${Date.now()}-a-${Math.random().toString(36).slice(2, 8)}`,
        role: 'assistant',
        content: reportContent
      }
      setMessages((prev) => [...prev, assistantMsg])
      addToast({ type: 'success', message: `已导入 ${newInvoices.length} 张发票` })
    } catch (err) {
      console.error('导入发票失败:', err)
      addToast({ type: 'error', message: '导入失败，请重试' })
    } finally {
      setImporting(false)
    }
  }, [addInvoices, addToast])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDragOver(false)
    }
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current = 0
    setIsDragOver(false)

    const files = e.dataTransfer.files
    if (!files || files.length === 0) return

    const imageFiles: File[] = []
    const visionPaths: string[] = []
    const invoicePaths: string[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const filePath = (file as File & { path?: string }).path
      if (!filePath) continue

      const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase()
      if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
        imageFiles.push(file)
      } else if (['.pdf'].includes(ext)) {
        visionPaths.push(filePath)
      } else if (['.ofd', '.xml'].includes(ext)) {
        invoicePaths.push(filePath)
      }
    }

    for (const file of imageFiles) {
      try {
        const base64 = await encodeImageToBase64(file)
        pendingImagesRef.current.push(base64)
      } catch {}
    }
    if (imageFiles.length > 0) {
      setPendingImages([...pendingImagesRef.current])
      addToast({ type: 'info', message: `已添加 ${imageFiles.length} 张图片，发送后将由AI识别` })
    }

    for (const pdfPath of visionPaths) {
      try {
        const result = await window.electronAPI!.file.pdfToImage(pdfPath)
        if (result.success && result.data) {
          const dataUrl = `data:${result.mimeType};base64,${result.data}`
          pendingImagesRef.current.push(dataUrl)
          addToast({ type: 'info', message: 'PDF已转为图片，发送后将由AI识别' })
        } else {
          addToast({ type: 'error', message: `PDF转换失败: ${result.error || '未知错误'}` })
          invoicePaths.push(pdfPath)
        }
      } catch {
        invoicePaths.push(pdfPath)
      }
    }
    if (visionPaths.length > 0) {
      setPendingImages([...pendingImagesRef.current])
    }

    if (invoicePaths.length > 0) {
      await importFromPaths(invoicePaths)
    }
  }, [importFromPaths, addToast])


  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (!file) continue
        const reader = new FileReader()
        reader.onload = () => {
          const base64 = reader.result as string
          pendingImagesRef.current = [...pendingImagesRef.current, base64]
          setPendingImages([...pendingImagesRef.current])
        }
        reader.readAsDataURL(file)
      }
    }
  }
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
  }


  const hintQuestions = [
    '帮我分析发票内容',
    '本月各类别消费统计',
    '待报销发票有哪些',
    '导出本月报销汇总表'
  ]

  const isStreaming = isGenerating

  return (
    <div
      className="chat-panel"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="chat-header">
        <span className="chat-header-title">发票管理助手</span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {invoices.some((inv) => {
            const hasInfo = (inv.invoiceNumber && inv.invoiceNumber !== '') ||
              (inv.totalAmount && inv.totalAmount > 0) ||
              (inv.sellerName && inv.sellerName !== '') ||
              (inv.buyerName && inv.buyerName !== '')
            return !hasInfo && inv.filePath
          }) && settings.aiApiKey && settings.aiApiEndpoint && (
            <button
              onClick={handleBatchRecognize}
              disabled={batchParsing || isGenerating}
              title="使用 AI 识别所有未解析发票"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 10px',
                fontSize: '11px',
                background: batchParsing ? 'var(--bg-surface1)' : 'rgba(var(--accent-blue-rgb, 30, 102, 200), 0.1)',
                color: batchParsing ? 'var(--fg-subtext0)' : 'var(--accent-blue)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: batchParsing ? 'wait' : 'pointer',
                fontWeight: 500
              }}
            >
              <ScanSearch size={13} />
              {batchParsing ? '识别中...' : '识别未解析发票'}
            </button>
          )}

          {isGenerating && (
            <span style={{ fontSize: '12px', color: 'var(--accent-blue)', animation: 'pulse 1.5s infinite', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{
                width: '6px', height: '6px', borderRadius: '50%',
                background: 'var(--accent-blue)', display: 'inline-block',
                animation: 'pulse 0.8s infinite'
              }} />
              正在生成...
            </span>
          )}
        </div>
      </div>

      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="chat-welcome">
            <div className="chat-welcome-icon">📊</div>
            <h2>发票管理助手</h2>
            <p>导入发票文件后，可通过 AI 对话进行发票内容识别、自动归类、金额统计和报销单生成</p>
            <p style={{ fontSize: '12px', color: 'var(--fg-overlay1)', marginTop: '8px' }}>
              支持上传图片和 PDF 文件，AI 会自动识别发票内容
            </p>
            <div className="chat-welcome-hints">
              {hintQuestions.map((q) => (
                <button key={q} className="chat-hint-chip" onClick={() => setInput(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.filter(m => m.role !== 'tool').map((msg) => (
            <div key={msg.id} className={`chat-message ${msg.role}`}>
              <div className="chat-message-avatar">
                {msg.role === 'assistant' ? <img src={appIcon} className="chat-avatar-img" /> : <User size={18} />}
              </div>
              <div className="chat-message-bubble">
                {msg.images && msg.images.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: msg.content ? '8px' : 0 }}>
                    {msg.images.map((img, idx) => (
                      <img
                        key={idx}
                        src={img}
                        alt={`upload-${idx}`}
                        style={{
                          maxWidth: '200px',
                          maxHeight: '150px',
                          borderRadius: 'var(--radius-sm)',
                          objectFit: 'contain'
                        }}
                      />
                    ))}
                  </div>
                )}
                {msg.content && (
                  <span>
                    {msg.content}
                    {isStreaming && msg.id === messages[messages.length - 1]?.id && (
                      <span className="streaming-cursor" />
                    )}
                  </span>
                )}
                {msg.toolStatus && (
                  <div style={{
                    fontSize: '11px',
                    color: 'var(--accent-blue)',
                    marginTop: '6px',
                    padding: '4px 8px',
                    background: 'rgba(59, 130, 246, 0.08)',
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    <span style={{
                      width: '6px', height: '6px', borderRadius: '50%',
                      background: 'var(--accent-blue)', display: 'inline-block',
                      animation: 'pulse 0.8s infinite'
                    }} />
                    {msg.toolStatus}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {isDragOver && (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
          borderRadius: 'var(--radius-md)',
          border: '2px dashed var(--accent-blue)',
          margin: '4px'
        }}>
          <Upload size={48} color="var(--accent-blue)" />
          <p style={{ color: 'var(--accent-blue)', marginTop: '12px', fontSize: '16px', fontWeight: 600 }}>
            拖放图片或发票文件到此处
          </p>
          <p style={{ color: 'var(--fg-overlay1)', marginTop: '4px', fontSize: '12px' }}>
            图片将发送给AI识别
          </p>
          <p style={{ color: 'var(--fg-overlay1)', marginTop: '2px', fontSize: '12px' }}>
            发票文件将自动导入并解析
          </p>
        </div>
      )}

      {pendingImages.length > 0 && (
        <div style={{
          padding: '6px 16px',
          display: 'flex',
          gap: '6px',
          flexWrap: 'wrap',
          borderTop: '1px solid var(--border-default)',
          flexShrink: 0
        }}>
          {pendingImages.map((img, idx) => (
            <div key={idx} style={{ position: 'relative' }}>
              <img
                src={img}
                alt={`preview-${idx}`}
                style={{
                  width: '40px',
                  height: '40px',
                  objectFit: 'cover',
                  borderRadius: 'var(--radius-sm)'
                }}
              />
              <button
                onClick={() => {
                  pendingImagesRef.current = pendingImagesRef.current.filter((_, i) => i !== idx)
                  setPendingImages([...pendingImagesRef.current])
                }}
                style={{
                  position: 'absolute',
                  top: '-4px',
                  right: '-4px',
                  width: '16px',
                  height: '16px',
                  borderRadius: '50%',
                  background: 'var(--accent-red)',
                  color: '#fff',
                  fontSize: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="chat-input-area">



        <textarea
          ref={textareaRef}
          placeholder="输入消息，或上传发票图片自动识别..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          rows={2}
          style={{
            flex: 1,
            resize: 'none',
            minHeight: '36px',
            maxHeight: '120px',
            boxSizing: 'border-box'
          }}
        />



        {isGenerating ? (
          <button
            className="chat-stop-btn"
            onClick={handleStop}
            title="停止生成"
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            className="chat-send-btn"
            onClick={handleSend}
            disabled={!input.trim() && pendingImages.length === 0}
            title="发送 (Enter)"
          >
            <Send size={16} />
          </button>
        )}
      </div>
      <div style={{
        display: 'flex',
        gap: '6px',
        padding: '4px 8px 2px',
        flexWrap: 'wrap'
      }}>
        {[
          { label: '📊 一键统计', prompt: '统计所有发票的汇总数据' },
          { label: '🔍 一键查重', prompt: '检查是否有重复发票' },
          { label: '🏷️ 一键分类', prompt: '按类别列出所有发票' },
          { label: '⏰ 过期检查', prompt: '检查是否有即将过期或已过期的发票' }
        ].map((action) => (
          <button
            key={action.label}
            onClick={() => {
              setInput(action.prompt)
              setTimeout(() => {
                const textarea = textareaRef.current
                if (textarea) {
                  textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
                }
              }, 100)
            }}
            style={{
              padding: '3px 10px',
              fontSize: '11px',
              borderRadius: '12px',
              border: '1px solid var(--border-default)',
              background: 'var(--bg-surface0)',
              color: 'var(--fg-subtext0)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-surface1)'
              e.currentTarget.style.borderColor = 'var(--accent-blue)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--bg-surface0)'
              e.currentTarget.style.borderColor = 'var(--border-default)'
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
      <div style={{ fontSize: '11px', color: 'var(--fg-overlay0)', padding: '2px 8px' }}>
        拖拽文件到窗口上传 · 粘贴图片发送给AI
      </div>
    </div>
  )
}