import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { getDatabase } from './database'
import { imapService } from './imap'
import { basename, dirname, extname, join, resolve } from 'path'
import { statSync, readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync } from 'fs'
import { execSync, spawn } from 'child_process'
import type * as pdfjs from 'pdfjs-dist'

function extractContentFromChunk(chunk: Record<string, unknown>): string {
  if (chunk.choices && Array.isArray(chunk.choices) && chunk.choices.length > 0) {
    const choice = chunk.choices[0] as Record<string, unknown>
    const message = choice.message as Record<string, unknown> | undefined
    if (message) {
      const mc = extractTextFromContent(message.content)
      if (mc) return mc
      const mrc = extractTextFromContent(message.reasoning_content)
      if (mrc) return mrc
    }
    const delta = choice.delta as Record<string, unknown> | undefined
    if (delta) {
      const dc = extractTextFromContent(delta.content)
      if (dc) return dc
      const rc = extractTextFromContent(delta.reasoning_content)
      if (rc) return rc
    }
    if (choice.text) return String(choice.text)
  }
  if (typeof chunk.content === 'string') return chunk.content
  if (chunk.response && typeof chunk.response === 'string') return chunk.response
  if (chunk.text && typeof chunk.text === 'string') return chunk.text
  if (chunk.message && typeof chunk.message === 'object' && chunk.message !== null) {
    const msg = chunk.message as Record<string, unknown>
    const mc = extractTextFromContent(msg.content)
    if (mc) return mc
  }
  return ''
}

function extractTextFromContent(content: unknown): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((part): part is Record<string, unknown> => typeof part === 'object' && part !== null)
      .map(part => {
        if (part.type === 'text' && typeof part.text === 'string') return part.text
        return ''
      })
      .filter(Boolean)
      .join('')
  }
  return ''
}

export function registerIpcHandlers(): void {
  const db = getDatabase()

  function decryptPassword(encryptedPassword: string, fallbackPassword: string): string {
    if (!encryptedPassword || !safeStorage.isEncryptionAvailable()) return fallbackPassword
    try {
      return safeStorage.decryptString(Buffer.from(encryptedPassword, 'base64'))
    } catch {
      return fallbackPassword
    }
  }

  ipcMain.handle('db:getAllInvoices', () => db.getAllInvoices())

  ipcMain.handle('db:getInvoiceById', (_e, { id }: { id: string }) => db.getInvoiceById(id))

  ipcMain.handle('db:insertInvoice', (_e, invoice: Record<string, unknown>) => db.insertInvoice(invoice))

  ipcMain.handle('db:insertInvoices', (_e, { invoices }: { invoices: Record<string, unknown>[] }) => {
    db.insertInvoices(invoices)
  })

  ipcMain.handle('db:updateInvoice', (_e, { id, updates }: { id: string; updates: Record<string, unknown> }) => {
    db.updateInvoice(id, updates)
  })

  ipcMain.handle('db:deleteInvoice', (_e, { id }: { id: string }) => {
    db.deleteInvoice(id)
  })

  ipcMain.handle('db:clearAllInvoices', () => db.clearAllInvoices())

  ipcMain.handle('db:getSetting', (_e, { key }: { key: string }) => db.getSetting(key))

  ipcMain.handle('db:setSetting', (_e, { key, value }: { key: string; value: string }) => {
    db.setSetting(key, value)
  })

  ipcMain.handle('db:getAllSettings', () => db.getAllSettings())

  ipcMain.handle('db:getEmailAccounts', () => db.getEmailAccounts())

  ipcMain.handle('db:insertEmailAccount', (_e, account: Record<string, unknown>) => {
    try {
      if (account.encryptedPassword && safeStorage.isEncryptionAvailable()) {
        try {
          const encrypted = safeStorage.encryptString(account.encryptedPassword as string)
          account.encryptedPassword = encrypted.toString('base64')
        } catch (encryptErr) {
          console.error('[DB] Failed to encrypt password:', encryptErr)
          throw new Error('密码加密失败，请检查系统安全存储功能是否可用')
        }
      }
      const result = db.insertEmailAccount(account)
      return result
    } catch (err) {
      console.error('[DB] Failed to insert email account:', err)
      throw err
    }
  })

  ipcMain.handle('db:deleteEmailAccount', (_e, { id }: { id: string }) => {
    db.deleteEmailAccount(id)
  })

  ipcMain.handle('imap:connect', async (_e, { accountId }: { accountId: string }) => {
    const account = db.getEmailAccountWithPassword(accountId) as Record<string, unknown> | null
    if (!account) {
      const allIds = db.getEmailAccounts().map((a: Record<string, unknown>) => a.id)
      console.error(`[IMAP] Account ${accountId} not found in DB. Available IDs:`, allIds)
      return { success: false, error: `账户不存在 (共 ${allIds.length} 个账户)` }
    }
    let password = (account.encryptedPassword as string) ?? ''
    if (password && safeStorage.isEncryptionAvailable()) {
      password = decryptPassword(password, '')
    }
    if (!password) {
      return { success: false, error: '密码为空或解密失败，请重新输入邮箱密码' }
    }
    try {
      const connected = await imapService.connect(account as never, password)
      return { success: connected, error: connected ? null : '连接失败，请检查邮箱配置和网络' }
    } catch (err) {
      console.error(`[IMAP] Connection error for ${account.email}:`, err)
      const errMsg = err instanceof Error ? err.message : String(err)
      let hint = ''
      if (errMsg.includes('ENOTFOUND') || errMsg.includes('getaddrinfo')) {
        hint = '\n提示：无法解析服务器地址，请检查 IMAP 服务器地址是否正确'
      } else if (errMsg.includes('ECONNREFUSED')) {
        hint = '\n提示：连接被拒绝，请检查端口号是否正确（SSL 通常为 993，非 SSL 通常为 143）'
      } else if (errMsg.includes('ETIMEDOUT') || errMsg.includes('timeout') || errMsg.includes('Timeout')) {
        hint = '\n提示：连接超时，请检查网络连接和防火墙设置'
      } else if (errMsg.includes('auth') || errMsg.includes('Auth') || errMsg.includes('login') || errMsg.includes('Login') || errMsg.includes('credentials')) {
        hint = '\n提示：认证失败，请检查邮箱地址和授权码是否正确'
      } else if (errMsg.includes('TLS') || errMsg.includes('ssl') || errMsg.includes('SSL')) {
        hint = '\n提示：TLS/SSL 握手失败，请尝试切换端口号（993 用 SSL，143 用 STARTTLS）'
      }
      return { success: false, error: `连接失败: ${errMsg.substring(0, 150)}${hint}` }
    }
  })

  ipcMain.handle('imap:disconnect', async (_e, { accountId }: { accountId: string }) => {
    await imapService.disconnect(accountId)
    return { success: true }
  })

  ipcMain.handle('imap:fetchEmails', async (_e, { accountId, limit }: {
    accountId: string
    limit?: number
  }) => {
    try {
      return await imapService.fetchEmails(accountId, { limit })
    } catch (err) {
      return { emails: [], total: 0, error: String(err) }
    }
  })

  ipcMain.handle('imap:searchInvoices', async (_e, { accountId }: {
    accountId: string
  }) => {
    try {
      return await imapService.searchInvoiceEmails(accountId)
    } catch (err) {
      return { emails: [], total: 0, searched: 0, error: String(err) }
    }
  })

  ipcMain.handle('imap:getAttachments', async (_e, { accountId, emailUid }: {
    accountId: string
    emailUid: number
  }) => {
    try {
      const result = await imapService.getAttachments(accountId, emailUid)
      return result
    } catch (err) {
      console.error(`[imap:getAttachments] Error for uid=${emailUid}:`, err)
      return []
    }
  })

  ipcMain.handle('imap:getEmailBody', async (_e, { accountId, emailUid }: {
    accountId: string
    emailUid: number
  }) => {
    try {
      const body = await imapService.getEmailBody(accountId, emailUid)
      return { success: true, body }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('imap:downloadAttachment', async (_e, { accountId, emailUid, partId }: {
    accountId: string
    emailUid: number
    partId: string
  }) => {
    try {
      const result = await imapService.downloadAttachment(accountId, emailUid, partId)
      if (!result.data || result.data.length === 0) {
        console.warn(`[imap:downloadAttachment] Empty data for uid=${emailUid} partId=${partId}`)
        return { error: '附件数据为空', fileName: result.fileName, data: '', mimeType: result.mimeType }
      }
      const base64Data = result.data.toString('base64')
      return { fileName: result.fileName, data: base64Data, mimeType: result.mimeType }
    } catch (err) {
      console.error(`[imap:downloadAttachment] Error:`, err)
      return { error: String(err) }
    }
  })

  ipcMain.handle('imap:isConnected', (_e, { accountId }: { accountId: string }) => {
    return imapService.isConnected(accountId)
  })

  // ===== Download invoice from URL (e.g., JD.com invoice links in email body) =====

  ipcMain.handle('file:downloadFromUrl', async (_e, { url }: { url: string }) => {
    try {
      // URL should already be properly decoded - no QP decoding needed
      const fetchUrl = url

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30000)
      const resp = await fetch(fetchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/pdf,application/xml,text/xml,application/octet-stream,*/*'
        },
        signal: controller.signal,
        redirect: 'follow'
      })
      clearTimeout(timeout)
      if (!resp.ok) {
        return { success: false, error: `HTTP ${resp.status}: ${resp.statusText}` }
      }
      const contentType = resp.headers.get('content-type') || ''
      const contentDisp = resp.headers.get('content-disposition') || ''

      const buffer = Buffer.from(await resp.arrayBuffer())

      if (buffer.length === 0) return { success: false, error: '下载的文件为空' }

      // Detect HTML responses that aren't actual invoices
      if (contentType.includes('text/html') || buffer.subarray(0, 100).toString('utf-8').includes('<!DOCTYPE') || buffer.subarray(0, 100).toString('utf-8').includes('<html')) {
        return { success: false, error: '该链接返回的是网页而非发票文件，可能需要登录或链接已过期' }
      }

      let fileName = 'download'
      // Handle RFC 5987 filename*=UTF-8''xxx format first
      const utf8NameMatch = contentDisp.match(/filename\*=UTF-8''(.+?)(?:;|$)/i)
      if (utf8NameMatch) {
        fileName = decodeURIComponent(utf8NameMatch[1])
      } else {
        const nameMatch = contentDisp.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/i)
        if (nameMatch) {
          fileName = nameMatch[1].replace(/['"]/g, '')
        } else {
          const urlPath = new URL(fetchUrl).pathname.split('/').pop() || ''
          if (urlPath.includes('.')) fileName = decodeURIComponent(urlPath)
        }
      }
      const ext = fileName.split('.').pop()?.toLowerCase()
      if (!ext || !['pdf', 'ofd', 'xml'].includes(ext)) {
        if (contentType.includes('pdf')) fileName += '.pdf'
        else if (contentType.includes('xml')) fileName += '.xml'
        else if (contentType.includes('ofd')) fileName += '.ofd'
        else fileName += '.pdf'
      }
      return { success: true, fileName, data: buffer.toString('base64'), mimeType: contentType || 'application/octet-stream' }
    } catch (err) {
      console.error(`[downloadFromUrl] Error:`, err instanceof Error ? err.message : String(err))
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('print:invoice', async (_e, { filePath, options }: { filePath: string; options?: { paperSize?: string; copies?: number; duplex?: boolean; preview?: boolean } }) => {
    try {
      if (!filePath || !existsSync(filePath)) {
        return { success: false, error: `文件不存在: ${filePath}` }
      }
      const ext = extname(filePath).slice(1).toLowerCase()
      if (ext === 'pdf') {
        const printWin = new BrowserWindow({
          width: 900,
          height: 700,
          show: true,
          title: options?.preview ? '发票预览' : '发票打印',
          webPreferences: { sandbox: false }
        })
        try {
          await printWin.loadFile(filePath)
          if (options?.preview) {
            printWin.setTitle('发票预览 - 按 Ctrl+P / Cmd+P 打印')
            return { success: true, preview: true }
          }
          // 尝试直接打印，设置超时防止挂起
          const printOpts: Record<string, unknown> = {
            silent: false,
            printBackground: db.getSetting('colorPrint') !== 'false',
            copies: options?.copies ?? (Number(db.getSetting('defaultCopies')) || 1),
            pageSize: options?.paperSize ?? (db.getSetting('paperSize') || 'A4'),
            scaleFactor: Number(db.getSetting('scalePercent')) || 100
          }
          // 使用 Promise.race 设置超时，防止无打印机时挂起
          const printPromise = printWin.webContents.print(printOpts as Electron.WebContentsPrintOptions)
          const timeoutPromise = new Promise<{ success: boolean; error: string }>((resolve) => {
            setTimeout(() => resolve({ success: false, error: '打印超时，请检查是否已连接打印机' }), 30000)
          })
          const result = await Promise.race([printPromise, timeoutPromise])
          if (result && typeof result === 'object' && 'error' in result) {
            printWin.setTitle('发票预览 - 打印失败，请按 Ctrl+P / Cmd+P 手动打印')
            return result
          }
          return { success: true }
        } catch (err) {
          console.error('[Print] Error:', err)
          printWin.setTitle('发票预览 - 打印失败，请按 Ctrl+P / Cmd+P 手动打印')
          printWin.show()
          return { success: false, error: String(err) }
        }
        // 注意：不关闭窗口，让用户可以手动打印或预览
      } else {
        await shell.openPath(filePath)
        return { success: true, opened: true }
      }
    } catch (err) {
      console.error('[Print] Outer error:', err)
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('file:openFileWithDefault', async (_e, { filePath }: { filePath: string }) => {
    return shell.openPath(filePath)
  })

  ipcMain.handle('file:importFiles', (_e, { filePaths }: { filePaths: string[] }) => {
    return filePaths.filter(filePath => {
      try { return existsSync(filePath) } catch { return false }
    }).map(filePath => ({
      filePath,
      fileName: basename(filePath),
      fileFormat: extname(filePath).replace('.', '')
    }))
  })

  ipcMain.handle('file:getFileInfo', (_e, { filePath }: { filePath: string }) => {
    try {
      const stats = statSync(filePath)
      return {
        fileName: basename(filePath),
        fileFormat: extname(filePath).replace('.', ''),
        size: stats.size
      }
    } catch (err) {
      return { fileName: '', fileFormat: '', size: 0, error: String(err) }
    }
  })

  ipcMain.handle('file:readFile', (_e, { filePath }: { filePath: string }) => {
    const data = readFileSync(filePath)
    const ext = extname(filePath).slice(1).toLowerCase()
    const mimeTypes: Record<string, string> = {
      pdf: 'application/pdf',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      ofd: 'application/octet-stream'
    }
    return {
      data: data.toString('base64'),
      mimeType: mimeTypes[ext] || 'application/octet-stream'
    }
  })

  ipcMain.handle('file:pdfToImage', async (_e, { filePath }: { filePath: string }) => {
    try {
      const ext = extname(filePath).slice(1).toLowerCase()
      if (ext === 'pdf') {
        const imageBase64 = await convertPdfToPng(filePath)
        return { success: true, data: imageBase64, mimeType: 'image/png' }
      }
      const data = readFileSync(filePath)
      const mimeTypes: Record<string, string> = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp'
      }
      return { success: true, data: data.toString('base64'), mimeType: mimeTypes[ext] || 'image/png' }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('file:openFileDialog', async () => {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '发票文件', extensions: ['pdf', 'ofd', 'jpg', 'jpeg', 'png'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    return result.filePaths
  })

  ipcMain.handle('file:openFolderDialog', async () => {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    })
    return result.filePaths
  })

  ipcMain.handle('file:saveFile', (_e, { fileName, data, mimeType, targetPath }: {
    fileName: string
    data: string
    mimeType: string
    targetPath?: string
  }) => {
    try {
      let filePath: string
      const safeName = fileName.replace(/[<>:"/\\|?*]/g, '_')
      if (targetPath) {
        const resolvedTarget = resolve(targetPath)
        const allowedDirs = [resolve(app.getPath('userData'))]
        const customDir = db.getSetting('storagePath')
        if (customDir && customDir.trim()) allowedDirs.push(resolve(customDir))
        if (!allowedDirs.some(d => resolvedTarget.startsWith(d))) {
          return { filePath: '', fileName: safeName, error: '目标路径不在允许的目录范围内' }
        }
        filePath = resolvedTarget
      } else {
        const customDir = db.getSetting('storagePath')
        const invoicesDir = (customDir && customDir.trim()) || join(app.getPath('userData'), 'invoices')
        if (!existsSync(invoicesDir)) {
          mkdirSync(invoicesDir, { recursive: true })
        }
        const timestamp = Date.now()
        filePath = join(invoicesDir, `${timestamp}_${safeName}`)
      }

      if (!data) {
        console.error(`[file:saveFile] No data provided for ${fileName}`)
        return { filePath: '', fileName: safeName, error: 'No data provided' }
      }

      const buffer = Buffer.from(data, 'base64')
      if (buffer.length === 0) {
        console.error(`[file:saveFile] Decoded buffer is empty for ${fileName}`)
        return { filePath: '', fileName: safeName, error: 'Decoded buffer is empty' }
      }

      const dir = dirname(filePath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }

      writeFileSync(filePath, buffer)

      const verifyStat = statSync(filePath)
      if (verifyStat.size === 0) {
        console.error(`[file:saveFile] File saved but size is 0: ${filePath}`)
        return { filePath: '', fileName: safeName, error: 'File saved but size is 0' }
      }

      return { filePath, fileName: safeName }
    } catch (err) {
      console.error(`[file:saveFile] Error saving ${fileName}:`, err)
      return { filePath: '', fileName, error: String(err) }
    }
  })

  ipcMain.handle('file:parseInvoice', async (_e, { filePath }: { filePath: string }) => {
    const ext = extname(filePath).slice(1).toLowerCase()
    try {
      let result: Record<string, unknown>

      if (ext === 'pdf') {
        // 第一层：pdfplumber 快速提取文字（电子发票毫秒级完成）
        const extractResult = runPdfPlumberExtract(filePath)
        if (extractResult.success && extractResult.fullText) {
          // 合并文字和表格文字
          const combinedText = extractResult.fullText + (extractResult.tablesText ? '\n' + extractResult.tablesText : '')
          result = extractInvoiceFields(combinedText, 'pdf')
          result.rawText = combinedText
        } else {
          // pdfplumber 失败（扫描件），回退到 pdfjs
          result = await parsePdfInvoice(filePath)
        }
      } else if (ext === 'ofd') {
        result = parseOfdInvoice(filePath)
      } else if (ext === 'xml') {
        result = parseXmlInvoice(filePath)
      } else {
        return { success: false, error: '不支持的文件格式' }
      }

      // 如果关键字段缺失，尝试使用 PaddleOCR 视觉识别（本地模型，无需联网）
      const missingFields = !result.invoiceNumber || !result.totalAmount || !result.sellerName
      if (missingFields) {
        try {
          const ocrResult = await runOcrAndExtract(filePath)
          if (ocrResult.success && ocrResult.fullText) {
            const ocrFields = extractInvoiceFields(ocrResult.fullText as string, 'pdf', {
              leftText: ocrResult.leftText as string | undefined,
              rightText: ocrResult.rightText as string | undefined
            })
            for (const key of ['invoiceCode', 'invoiceNumber', 'invoiceType', 'issueDate',
              'sellerName', 'sellerTaxNumber', 'buyerName', 'buyerTaxNumber',
              'amountWithoutTax', 'taxAmount', 'totalAmount']) {
              if (!result[key] && ocrFields[key]) {
                result[key] = ocrFields[key]
              }
            }
            if (!result.rawText && ocrFields.rawText) {
              result.rawText = ocrFields.rawText
            }
          }
        } catch (ocrErr) {
          console.error('[parseInvoice] PaddleOCR fallback failed:', ocrErr)
        }
      }

      return result
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('file:parseInvoiceWithAI', async (_e, { rawText }: { rawText: string }) => {
    try {
      return await parseInvoiceWithAI(rawText, db)
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('file:parseInvoiceWithVision', async (_e, { filePath }: { filePath: string }) => {
    try {
      const apiKey = db.getSetting('aiApiKey')
      const apiEndpoint = db.getSetting('aiApiEndpoint')
      const aiModel = db.getSetting('aiVisionModel') || db.getSetting('aiModel') || 'gpt-4o'
      if (!apiKey || !apiEndpoint) {
        return { success: false, error: 'AI 模型未配置，无法使用视觉识别' }
      }
      return await parseInvoiceWithVision(filePath, apiKey, apiEndpoint, aiModel)
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('ai:chat', async (_e, { endpoint, apiKey, body }: { endpoint: string; apiKey: string; body: Record<string, unknown> }) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120000)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (apiKey && apiKey !== 'no-key') {
        headers['Authorization'] = `Bearer ${apiKey}`
      }
      const cleanEndpoint = endpoint.replace(/\/+$/, '')
      const response = await fetch(`${cleanEndpoint}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...body, stream: false }),
        signal: controller.signal
      })
      if (!response.ok) {
        const errorText = await response.text()
        return { ok: false, status: response.status, error: errorText }
      }
      const json = await response.json() as Record<string, unknown>
      const content = extractContentFromChunk(json)

      // Extract tool_calls from the response if present
      const choices = json.choices as Array<Record<string, unknown>> | undefined
      let toolCalls: unknown
      if (choices && choices.length > 0) {
        const message = choices[0].message as Record<string, unknown> | undefined
        toolCalls = message?.tool_calls
      }

      const result: Record<string, unknown> = { ok: true, content }
      if (toolCalls) result.tool_calls = toolCalls
      return result
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, status: 0, error: msg }
    } finally {
      clearTimeout(timeout)
    }
  })

  ipcMain.handle('ai:testConnection', async (_e, { endpoint, apiKey }: { endpoint: string; apiKey: string }) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (apiKey && apiKey !== 'no-key') {
        headers['Authorization'] = `Bearer ${apiKey}`
      }

      let models: string[] = []

      const cleanEndpoint = endpoint.replace(/\/+$/, '')
      const openaiRes = await fetch(`${cleanEndpoint}/models`, { headers, signal: controller.signal })
      if (openaiRes.ok) {
        const json = await openaiRes.json()
        const dataArr = json.data && Array.isArray(json.data) ? json.data :
                        Array.isArray(json) ? json :
                        json.models && Array.isArray(json.models) ? json.models : []
        for (const m of dataArr) {
          if (typeof m === 'string') models.push(m)
          else if (m.id && typeof m.id === 'string') models.push(m.id)
        }
      }

      if (models.length === 0) {
        try {
          const ollamaRes = await fetch(`${endpoint.replace(/\/v1\/?$/, '')}/api/tags`, {
            signal: controller.signal
          })
          if (ollamaRes.ok) {
            const ollamaJson = await ollamaRes.json()
            if (ollamaJson.models && Array.isArray(ollamaJson.models)) {
              for (const m of ollamaJson.models) {
                const name = m.name || m.model || m.id
                if (name && typeof name === 'string') models.push(name)
              }
            }
          }
        } catch { /* not ollama */ }
      }

      if (models.length > 0) {
        return { success: true, models }
      }
      if (openaiRes.ok) {
        return { success: true, models: [] }
      }
      return { success: false, error: `HTTP ${openaiRes.status}` }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('ECONNREFUSED')) {
        return { success: false, error: '连接被拒绝，请确认推理引擎已启动' }
      }
      if (msg.includes('abort') || msg.includes('timeout') || msg.includes('Timeout')) {
        return { success: false, error: '连接超时（10秒），请确认推理引擎已启动且地址正确' }
      }
      return { success: false, error: msg }
    } finally {
      clearTimeout(timeout)
    }
  })

  ipcMain.handle('file:getOfdPreview', async (_e, { filePath }: { filePath: string }) => {
    try {
      const AdmZip = require('adm-zip')
      const zip = new AdmZip(filePath)
      const imageEntries = zip.getEntries().filter(
        (e: { entryName: string }) => /\.(png|jpg|jpeg|bmp)$/i.test(e.entryName)
      )
      if (imageEntries.length === 0) return { success: false, error: 'OFD 文件中未找到可预览的图片' }
      const entry = imageEntries[0]
      const data = zip.readFile(entry)
      const ext = entry.entryName.split('.').pop().toLowerCase()
      const mimeTypes: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', bmp: 'image/bmp' }
      return { success: true, data: data.toString('base64'), mimeType: mimeTypes[ext] || 'image/png' }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('file:renameInvoice', async (_e, { id, oldPath, newName }: { id: string; oldPath: string; newName: string }) => {
    try {
      // 检查源文件是否存在
      if (!existsSync(oldPath)) {
        return { success: false, error: `源文件不存在: ${oldPath}` }
      }

      const dir = dirname(oldPath)
      const ext = extname(oldPath)

      // 检查 newName 是否已经包含扩展名
      let finalName = newName
      const nameExt = extname(newName).toLowerCase()
      const origExt = ext.toLowerCase()
      if (nameExt && nameExt === origExt) {
        // newName 已包含正确扩展名，不再重复添加
        finalName = newName
      } else if (nameExt && nameExt !== origExt) {
        // newName 包含不同扩展名（如 .pdf 被 {format} 替换成了 pdf），
        // 去掉 newName 的扩展名，用原始文件的扩展名
        finalName = basename(newName, nameExt) + ext
      } else {
        // newName 没有扩展名，添加原始文件的扩展名
        finalName = newName + ext
      }

      let newPath = join(dir, finalName)

      // 如果新旧路径完全相同，跳过
      if (resolve(oldPath) === resolve(newPath)) {
        return { success: true, newPath, newFileName: basename(newPath), skipped: true }
      }

      // 如果目标文件已存在，自动添加序号后缀
      if (existsSync(newPath)) {
        const nameWithoutExt = basename(finalName, ext)
        let counter = 1
        let candidate = `${nameWithoutExt}_${counter}${ext}`
        newPath = join(dir, candidate)
        while (existsSync(newPath) && counter < 1000) {
          counter++
          candidate = `${nameWithoutExt}_${counter}${ext}`
          newPath = join(dir, candidate)
        }
      }

      renameSync(oldPath, newPath)
      db.updateInvoice(id, { filePath: newPath, fileName: basename(newPath) } as Record<string, unknown>)
      return { success: true, newPath, newFileName: basename(newPath) }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('app:getDataPath', () => app.getPath('userData'))

  ipcMain.handle('dialog:saveFileDialog', async (_e, { defaultName }: { defaultName: string }) => {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
      filters: [
        { name: 'Excel 文件', extensions: ['xlsx'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    return result.filePath
  })

  ipcMain.handle('dialog:openFolderDialog', async () => {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('db:checkDuplicate', (_e, { invoiceCode, invoiceNumber, sellerName }: { invoiceCode: string; invoiceNumber: string; sellerName?: string }) => {
    return db.checkDuplicate(invoiceCode, invoiceNumber, sellerName)
  })

  ipcMain.handle('memory:createConversation', (_e, { id, title }: { id: string; title: string }) => {
    db.createConversation(id, title)
  })

  ipcMain.handle('memory:getConversations', () => {
    return db.getAllConversations()
  })

  ipcMain.handle('memory:updateConversation', (_e, { id, updates }: { id: string; updates: Record<string, unknown> }) => {
    db.updateConversation(id, updates)
  })

  ipcMain.handle('memory:deleteConversation', (_e, { id }: { id: string }) => {
    db.deleteConversation(id)
  })

  ipcMain.handle('memory:saveMessage', (_e, msg: Record<string, unknown>) => {
    db.insertMessage(msg)
  })

  ipcMain.handle('memory:getMessages', (_e, { conversationId }: { conversationId: string }) => {
    return db.getMessages(conversationId)
  })

  ipcMain.handle('memory:saveMemory', (_e, memory: Record<string, unknown>) => {
    db.insertMemory(memory)
  })

  ipcMain.handle('memory:getMemoriesByConversation', (_e, { conversationId }: { conversationId: string }) => {
    return db.getMemoriesByConversation(conversationId)
  })

  ipcMain.handle('memory:getAllMemories', () => {
    return db.getAllMemories()
  })

  ipcMain.handle('memory:searchMemories', (_e, { query }: { query: string }) => {
    return db.searchMemoriesByKey(query)
  })

  ipcMain.handle('memory:deleteMemory', (_e, { id }: { id: string }) => {
    db.deleteMemory(id)
  })

  ipcMain.handle('skill:getConfigs', () => {
    return db.getSkillConfigs()
  })

  ipcMain.handle('skill:setConfig', (_e, { skillName, enabled, config }: {
    skillName: string
    enabled: boolean
    config?: Record<string, unknown>
  }) => {
    db.setSkillConfig(skillName, enabled, config || {})
  })

  ipcMain.handle('skill:setConfigs', (_e, { configs }: {
    configs: Array<{ skillName: string; enabled: boolean; config?: Record<string, unknown> }>
  }) => {
    db.setSkillConfigs(configs)
  })

  // ===== Web Search Handler =====

  ipcMain.handle('webSearch:search', async (_e, { query }: { query: string }) => {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: controller.signal
      })
      clearTimeout(timeout)
      if (!resp.ok) return { success: false, error: `Search failed: ${resp.status}` }
      const html = await resp.text()
      const results: Array<{ title: string; url: string; snippet: string }> = []
      const resultRegex = /<a[^>]*class="result[^"]*"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/g
      const snippetRegex = /<a[^>]*class="result[^"]*"[^>]*>.*?<\/a>[\s\S]*?<p class="result__snippet[^"]*">(.*?)<\/p>/g
      let m
      while ((m = resultRegex.exec(html)) !== null) {
        const url = m[1]
        const title = m[2].replace(/<[^>]*>/g, '').trim()
        if (url && title && url.startsWith('http')) {
          results.push({ title, url, snippet: '' })
        }
      }
      return { success: true, results: results.slice(0, 5) }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ===== OCR Engine Handlers =====

  ipcMain.handle('ocr:getStatus', async () => {
    try {
      const scriptPath = findScript('ocr_check.py')
      if (!scriptPath) {
        return { ready: false, version: '', error: 'OCR check script not found' }
      }
      const output = execSync(`python3 "${scriptPath}"`, {
        timeout: 10000,
        maxBuffer: 1024 * 1024
      }).toString()
      const result = JSON.parse(output) as Record<string, unknown>
      return {
        ready: Boolean(result.ready),
        version: String(result.version || ''),
        error: result.error ? String(result.error) : ''
      }
    } catch {
      return { ready: false, version: '', error: 'Failed to check OCR status' }
    }
  })

  ipcMain.handle('ocr:downloadModel', async () => {
    try {
      const scriptPath = findScript('setup_ocr.py')
      if (!scriptPath) {
        return { success: false, error: 'OCR setup script not found' }
      }
      const output = execSync(`python3 "${scriptPath}"`, {
        timeout: 600000, // 10 minutes for downloading
        maxBuffer: 5 * 1024 * 1024
      }).toString()
      const result = JSON.parse(output) as Record<string, unknown>
      if (result.success) {
        return { success: true, version: 'PaddleOCR', steps: result.steps }
      }
      return { success: false, error: '安装失败，请查看日志', steps: result.steps }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('ocr:recognize', async (_e, { filePath }: { filePath: string }) => {
    try {
      const scriptPath = findScript('ocr_extract.py')
      if (!scriptPath) {
        return { success: false, error: 'OCR script not found' }
      }
      if (!existsSync(filePath)) {
        return { success: false, error: `File not found: ${filePath}` }
      }
      const output = execSync(`python3 "${scriptPath}" "${filePath}"`, {
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024
      }).toString()
      const result = JSON.parse(output) as Record<string, unknown>
      if (!result.success) {
        return { success: false, error: String(result.error || 'OCR failed') }
      }
      return {
        success: true,
        fullText: String(result.full_text || ''),
        leftText: String(result.left_text || ''),
        rightText: String(result.right_text || ''),
        lineCount: Number(result.line_count || 0),
        pageCount: Number(result.page_count || 0)
      }
    } catch (err) {
      return { success: false, error: `OCR error: ${err instanceof Error ? err.message : String(err)}` }
    }
  })

  // ===== Batch Re-recognize Invoices =====

  ipcMain.handle('invoice:batchReRecognize', async (_e, { invoiceIds }: { invoiceIds: string[] }) => {
    const results: Array<{ id: string; success: boolean; data?: Record<string, unknown>; error?: string }> = []

    for (const id of invoiceIds) {
      try {
        const inv = db.getInvoiceById(id)
        if (!inv || !inv.file_path) {
          results.push({ id, success: false, error: '发票不存在或无文件路径' })
          continue
        }

        const filePath = String((inv as Record<string, unknown>).file_path || '')
        const ext = extname(filePath).slice(1).toLowerCase()
        let parsed: Record<string, unknown> | null = null

        if (ext === 'pdf') {
          const extractResult = runPdfPlumberExtract(filePath)
          if (extractResult.success && extractResult.fullText) {
            const combinedText = extractResult.fullText + (extractResult.tablesText ? '\n' + extractResult.tablesText : '')
            parsed = extractInvoiceFields(combinedText, 'pdf')
          } else {
            const ocrResult = await runOcrAndExtract(filePath)
            if (ocrResult.success && ocrResult.fullText) {
              parsed = extractInvoiceFields(ocrResult.fullText as string, 'pdf', {
                leftText: ocrResult.leftText as string | undefined,
                rightText: ocrResult.rightText as string | undefined
              })
            }
          }
        } else if (ext === 'ofd') {
          parsed = parseOfdInvoice(filePath)
        } else if (ext === 'xml') {
          parsed = parseXmlInvoice(filePath)
        }

        if (!parsed || !parsed.success) {
          results.push({ id, success: false, error: (parsed?.error as string) || '识别失败' })
          continue
        }

        const updates: Record<string, unknown> = {
          invoice_code: parsed.invoiceCode || '',
          invoice_number: parsed.invoiceNumber || '',
          invoice_type: parsed.invoiceType || '',
          issue_date: parsed.issueDate || '',
          seller_name: parsed.sellerName || '',
          seller_tax_number: parsed.sellerTaxNumber || '',
          buyer_name: parsed.buyerName || '',
          buyer_tax_number: parsed.buyerTaxNumber || '',
          amount_without_tax: Number(parsed.amountWithoutTax) || 0,
          tax_amount: Number(parsed.taxAmount) || 0,
          total_amount: Number(parsed.totalAmount) || 0
        }

        db.updateInvoice(id, updates)
        results.push({ id, success: true, data: {
          invoiceNumber: parsed.invoiceNumber || '',
          invoiceCode: parsed.invoiceCode || '',
          invoiceType: parsed.invoiceType || '',
          issueDate: parsed.issueDate || '',
          sellerName: parsed.sellerName || '',
          sellerTaxNumber: parsed.sellerTaxNumber || '',
          buyerName: parsed.buyerName || '',
          buyerTaxNumber: parsed.buyerTaxNumber || '',
          amountWithoutTax: Number(parsed.amountWithoutTax) || 0,
          taxAmount: Number(parsed.taxAmount) || 0,
          totalAmount: Number(parsed.totalAmount) || 0
        }})
      } catch (err) {
        results.push({ id, success: false, error: err instanceof Error ? err.message : String(err) })
      }
    }

    return { success: true, results }
  })
}

/**
 * Find a script file in various possible locations.
 */
function findScript(name: string): string | null {
  const candidates = [
    join(__dirname, '../../scripts', name),
    join(__dirname, '../scripts', name),
    join(app.getAppPath(), 'scripts', name),
    join(app.getAppPath(), '..', 'scripts', name)
  ]
  // Also check the project root for development
  if (app.isPackaged) {
    const resourcePath = process.resourcesPath
    candidates.push(join(resourcePath, 'scripts', name))
    candidates.push(join(resourcePath, 'app.asar.unpacked', 'scripts', name))
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Run fast PDF text extraction using pdfplumber (milliseconds for electronic invoices).
 * Returns { success, full_text, tables_text, has_text } or { success: false, error }.
 */
function runPdfPlumberExtract(filePath: string): { success: boolean; fullText?: string; tablesText?: string; hasText?: boolean; error?: string } {
  const candidates = [
    join(__dirname, '../../scripts/pdf_extract.py'),
    join(__dirname, '../scripts/pdf_extract.py'),
    join(app.getAppPath(), 'scripts/pdf_extract.py'),
    '/Users/wtflx/Desktop/w/发票整理/invoice-manager/scripts/pdf_extract.py'
  ]
  for (const scriptPath of candidates) {
    if (existsSync(scriptPath)) {
      try {
        const output = execSync(`python3 "${scriptPath}" "${filePath}"`, {
          timeout: 10000,
          maxBuffer: 10 * 1024 * 1024
        }).toString()
        const result = JSON.parse(output) as Record<string, unknown>
        if (!result.success) {
          return { success: false, error: String(result.error || 'pdfplumber failed') }
        }
        return {
          success: true,
          fullText: String(result.full_text || ''),
          tablesText: String(result.tables_text || ''),
          hasText: Boolean(result.has_text)
        }
      } catch (err) {
        return { success: false, error: `pdfplumber error: ${err instanceof Error ? err.message : String(err)}` }
      }
    }
  }
  return { success: false, error: 'pdf_extract.py not found' }
}

async function runOcrAndExtract(filePath: string): Promise<{ success: boolean; fullText?: string; leftText?: string; rightText?: string; error?: string }> {
  const scriptPath = findScript('ocr_extract.py')
  if (!scriptPath) return { success: false, error: 'OCR script not found' }

  try {
    const output = execSync(`python3 "${scriptPath}" "${filePath}"`, {
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024
    }).toString()
    const data = JSON.parse(output) as Record<string, unknown>
    if (!data.success) return { success: false, error: String(data.error || 'OCR failed') }
    return {
      success: true,
      fullText: String(data.full_text || ''),
      leftText: String(data.left_text || ''),
      rightText: String(data.right_text || '')
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function runPaddleOCRWithScript(scriptPath: string, filePath: string): { success: boolean; fullText?: string; lines?: Array<{ text: string; confidence: number; bbox: number[][] }>; error?: string } {
  try {
    const output = execSync(`python3 "${scriptPath}" "${filePath}"`, {
      timeout: 120000, // 2 min timeout for OCR
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer
    }).toString()
    const result = JSON.parse(output) as Record<string, unknown>
    if (!result.success) {
      return { success: false, error: String(result.error || 'OCR failed') }
    }
    return {
      success: true,
      fullText: String(result.full_text || ''),
      lines: (result.lines as Array<{ text: string; confidence: number; bbox: number[][] }>) || []
    }
  } catch (err) {
    return { success: false, error: `PaddleOCR error: ${err instanceof Error ? err.message : String(err)}` }
  }
}

async function parsePdfInvoice(filePath: string): Promise<Record<string, unknown>> {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc = ''
  const data = new Uint8Array(readFileSync(filePath))
  const loadingTask = pdfjsLib.getDocument({ data })
  const pdf = await loadingTask.promise

  interface TextBlock { x: number; y: number; str: string; width: number }
  const allBlocks: TextBlock[] = []

  let pageWidth = 0

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const viewport = page.getViewport({ scale: 1 })

    if (i === 1) pageWidth = viewport.width

    for (const item of content.items) {
      if (!('str' in item) || typeof (item as Record<string, unknown>).str !== 'string') continue
      const str = ((item as Record<string, unknown>).str as string).trim()
      if (!str) continue
      const transform = (item as Record<string, unknown>).transform as number[]
      const x = transform[4]
      const y = viewport.height - transform[5]
      const w = (item as Record<string, unknown>).width as number || str.length * 8
      allBlocks.push({ x, y, str, width: w })
    }
  }

  const yTolerance = 5
  allBlocks.sort((a, b) => a.y - b.y || a.x - b.x)

  interface TextLine { y: number; blocks: TextBlock[] }
  const lines: TextLine[] = []
  let currentLine: TextLine | null = null

  for (const block of allBlocks) {
    if (!currentLine || Math.abs(block.y - currentLine.y) > yTolerance) {
      currentLine = { y: block.y, blocks: [block] }
      lines.push(currentLine)
    } else {
      currentLine.blocks.push(block)
    }
  }

  for (const line of lines) {
    line.blocks.sort((a, b) => a.x - b.x)
  }

  const midX = pageWidth / 2
  let leftText = ''
  let rightText = ''
  let fullText = ''

  for (const line of lines) {
    const lineStr = line.blocks.map(b => b.str).join(' ')
    fullText += lineStr + '\n'

    const avgX = line.blocks.reduce((s, b) => s + b.x, 0) / line.blocks.length
    if (pageWidth > 0 && avgX > midX * 0.8) {
      rightText += lineStr + '\n'
    } else if (pageWidth > 0 && avgX < midX * 0.5) {
      leftText += lineStr + '\n'
    }
  }

  const structuredLines: Array<{ text: string; avgX: number; isRight: boolean }> = []
  for (const line of lines) {
    const text = line.blocks.map(b => b.str).join(' ')
    const avgX = line.blocks.reduce((s, b) => s + b.x, 0) / line.blocks.length
    structuredLines.push({ text, avgX, isRight: avgX > midX * 0.7 })
  }

  return extractInvoiceFields(fullText, 'pdf', { leftText, rightText, structuredLines })
}

function parseOfdInvoice(filePath: string): Record<string, unknown> {
  try {
    const AdmZip = require('adm-zip')
    const zip = new AdmZip(filePath)
    const xmlEntries = zip.getEntries().filter(
      (e: { entryName: string }) => e.entryName.endsWith('.xml')
    )
    let xml = ''
    for (const entry of xmlEntries) {
      const content = zip.readAsText(entry)
      if (content.includes('发票') || content.includes('Invoice') || content.includes('EInvoice')) {
        xml = content
        break
      }
    }
    if (!xml) {
      for (const entry of xmlEntries) {
        xml += zip.readAsText(entry) + '\n'
      }
    }
    return extractInvoiceFields(xml, 'ofd')
  } catch {
    const xml = readFileSync(filePath, 'utf-8')
    return extractInvoiceFields(xml, 'ofd')
  }
}

function parseXmlInvoice(filePath: string): Record<string, unknown> {
  const xml = readFileSync(filePath, 'utf-8')
  return extractInvoiceFields(xml, 'xml')
}

function extractInvoiceFields(text: string, format: string, layout?: {
  leftText?: string; rightText?: string;
  structuredLines?: Array<{ text: string; avgX: number; isRight: boolean }>
}): Record<string, unknown> {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const lineText = lines.join('\n')
  // 移除中文字符间的空格（pdfjs 常见输出格式：合 计 金 额）
  const clean = text.replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2').replace(/\s+/g, ' ').trim()
  const leftClean = (layout?.leftText || '').replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2').replace(/\s+/g, ' ').trim()
  const rightClean = (layout?.rightText || '').replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2').replace(/\s+/g, ' ').trim()
  // 完全无空格的版本（用于数字/符号匹配）
  const noSpace = clean.replace(/\s/g, '')
  // 按行处理的版本
  const cleanLines = lines.map(l => l.replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2').trim()).filter(Boolean)

  const invoiceCode = extractPattern(clean, [
    /发票代码[：:]?\s*(\d{10,12})/,
    /发票代码[:：]?(\d{10,12})/
  ])

  const invoiceNumber = extractPattern(clean, [
    /发票号码[：:]?\s*(\d{8,20})/,
    /发票号码[:：]?(\d{8,20})/,
    /发票号[：:]?\s*(\d{8,20})/,
    /发票号[:：]?(\d{8,20})/,
    /No[：:]?\s*(\d{8,20})/,
    /No[:：]?(\d{8,20})/
  ])

  const issueDate = extractPattern(clean, [
    /开票日期[：:]?\s*(\d{4}[-年]\d{1,2}[-月]\d{1,2}[日]?)/,
    /开票日期[:：]?(\d{4}[-年]\d{1,2}[-月]\d{1,2}[日]?)/,
    /日期[：:]?\s*(\d{4}[-年]\d{1,2}[-月]\d{1,2}[日]?)/,
    /日期[:：]?(\d{4}[-年]\d{1,2}[-月]\d{1,2}[日]?)/
  ])

  let totalAmount: string | null = null
  let taxAmount: string | null = null
  let amountWithoutTax: string | null = null

  // 1. 价税合计 — 支持多种格式
  // 格式：价税合计（大写）壹佰元整（小写）¥100.00
  const totalPatterns = [
    /价税合计[（(]大写[)）]?[：:]?[\u4e00-\u9fa5]+[（(]小写[)）]?[：:]?\s*[¥￥]?\s*([\d,.]+)/,
    /价税合计[（(]小写[)）]?[：:]?\s*[¥￥]?\s*([\d,.]+)/,
    /价税合计[：:]?\s*[¥￥]?\s*([\d,.]+)/,
    /价税合计.*?[¥￥]\s*([\d,.]+)/,
    // 数电发票格式：合 计 ¥235.00
    /合\s*计[：:]?\s*[¥￥]?\s*([\d,.]+)/,
    // 单独"合计"行格式：合计 ¥235.00
    /^合计\s*[¥￥]?([\d,.]+)/m,
    /(?<!\w)合计[：:]?\s*[¥￥]?([\d,.]+)/,
    /[¥￥]\s*([\d,.]+)\s*$/,  // 行末尾的金额
  ]

  // 先按行匹配（更精确）
  // 优先匹配"价税合计"行获取 totalAmount
  for (const line of cleanLines) {
    if (line.includes('价税合计')) {
      for (const pat of totalPatterns) {
        const m = line.match(pat)
        if (m) { totalAmount = m[1]; break }
      }
      if (!totalAmount) {
        const allNums = [...line.matchAll(/([\d,]+\.\d{2})/g)]
        if (allNums.length >= 1) {
          let maxVal = 0; let maxStr = ''
          for (const n of allNums) {
            const val = parseFloat(n[1].replace(/,/g, ''))
            if (val > maxVal) { maxVal = val; maxStr = n[1] }
          }
          if (maxStr) { totalAmount = maxStr }
        }
      }
      if (totalAmount) break
    }
  }

  // 匹配"合 计"行获取不含税金额和税额（"合 计 ¥79.12 ¥10.28"）
  for (const line of cleanLines) {
    const isHejiLine = (line.includes('合计') || /合\s*计/.test(line)) && !line.includes('价税合计') && !line.includes('不含税')
    if (isHejiLine) {
      const allNums = [...line.matchAll(/([\d,]+\.\d{2})/g)]
      if (allNums.length >= 2) {
        // "合 计 ¥79.12 ¥10.28"：第一个=不含税金额，第二个=税额
        if (!amountWithoutTax) amountWithoutTax = allNums[0][1]
        if (!taxAmount) taxAmount = allNums[1][1]
      } else if (allNums.length === 1 && !totalAmount) {
        // 只有一个金额且没有价税合计，可能是总额
        totalAmount = allNums[0][1]
      }
      break
    }
  }

  // 如果行匹配失败，尝试全文匹配
  if (!totalAmount) {
    totalAmount = extractPattern(clean, totalPatterns)
  }

  // 2. 税额
  const taxPatterns = [
    /税\s*额[：:]?\s*[¥￥]?\s*([\d,.]+)/,
    /税额[：:]?\s*[¥￥]?\s*([\d,.]+)/,
    /税额[：:]?[¥￥]?([\d,.]+)/,
    /税额.*?[¥￥]\s*([\d,.]+)/,
    // 数电发票格式：税额/征收率 税额
    /税\s*额[\/／].*?[¥￥]?\s*([\d,.]+)/,
  ]

  if (!taxAmount) {
    for (const line of cleanLines) {
      if (line.includes('税额') || line.includes('税 额') || line.includes('税项') || (line.includes('税') && line.includes('额'))) {
        for (const pat of taxPatterns) {
          const m = line.match(pat)
          if (m) { taxAmount = m[1]; break }
        }
        if (taxAmount) break
      }
    }
  }
  if (!taxAmount) {
    taxAmount = extractPattern(clean, taxPatterns)
  }
  // 也尝试从 structuredLines 匹配
  if (!taxAmount && layout?.structuredLines) {
    for (const line of layout.structuredLines) {
      if (line.text.includes('税额') || line.text.includes('税 额')) {
        const m = line.text.replace(/\s/g, '').match(/[¥￥]?([\d,.]+)/)
        if (m) { taxAmount = m[1]; break }
      }
    }
  }

  // 3. 不含税金额（金额/合计金额）
  const noTaxPatterns = [
    /金额[（(]不含税[)）]?[：:]?\s*[¥￥]?\s*([\d,.]+)/,
    /金额[（(]不含税[)）]?[：:]?[¥￥]?([\d,.]+)/,
    /不含税金额[：:]?\s*[¥￥]?\s*([\d,.]+)/,
    /不含税金额[：:]?[¥￥]?([\d,.]+)/,
    /金\s*额.*?[¥￥]\s*([\d,.]+)/,
    // 数电发票格式：金 额（不含税）
    /金\s*额[（(]不含税[)）]?[：:]?\s*[¥￥]?\s*([\d,.]+)/,
  ]

  if (!amountWithoutTax) {
    for (const line of cleanLines) {
      if ((line.includes('金额') || line.includes('金 额')) && !line.includes('价税') && !line.includes('税额')) {
        for (const pat of noTaxPatterns) {
          const m = line.match(pat)
          if (m) { amountWithoutTax = m[1]; break }
        }
        if (amountWithoutTax) break
      }
    }
  }
  if (!amountWithoutTax) {
    amountWithoutTax = extractPattern(clean, noTaxPatterns)
  }
  // 也尝试从 structuredLines 匹配
  if (!amountWithoutTax && layout?.structuredLines) {
    for (const line of layout.structuredLines) {
      if ((line.text.includes('金额') || line.text.includes('金 额')) && !line.text.includes('价税') && !line.text.includes('税额')) {
        const nums = [...line.text.replace(/\s/g, '').matchAll(/[¥￥]?([\d,.]+)/g)]
        if (nums.length > 0) { amountWithoutTax = nums[0][1]; break }
      }
    }
  }

  let sellerName = ''
  let sellerTaxNumber = ''
  let buyerName = ''
  let buyerTaxNumber = ''

  // 构建左右分栏文本
  let leftJoined = ''
  let rightJoined = ''
  if (layout?.structuredLines && layout.structuredLines.length > 0) {
    const leftLines = layout.structuredLines.filter(l => !l.isRight).map(l => l.text)
    const rightLines = layout.structuredLines.filter(l => l.isRight).map(l => l.text)
    leftJoined = leftLines.join('\n')
    rightJoined = rightLines.join('\n')
  }

  // OCR 专用名称提取：当没有结构化布局数据时，基于相邻行关系提取
  const extractAdjacentName = (text: string, keyword: string): string => {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(keyword)) {
        // 尝试同行提取
        const inlineMatch = lines[i].match(/名\s*称\s*[：:]\s*(.+)/)
        if (inlineMatch?.[1]) {
          const cleaned = cleanExtractedName(inlineMatch[1])
          if (isValidCompanyName(cleaned)) return cleaned
        }
        // 尝试下一行提取
        if (i + 1 < lines.length) {
          const cleaned = cleanExtractedName(lines[i + 1])
          if (isValidCompanyName(cleaned)) return cleaned
        }
        // 尝试再下一行
        if (i + 2 < lines.length) {
          const cleaned = cleanExtractedName(lines[i + 2])
          if (isValidCompanyName(cleaned)) return cleaned
        }
      }
    }
    return ''
  }

  const isOCR = !layout?.structuredLines?.length

  // 提取卖方名称（多个候选来源，按优先级排序）
  const sellerCandidates: string[] = []
  // 1. 从"销售方"区块直接提取
  const sellerBlock = extractNameFromSellerBlock(lineText)
  if (sellerBlock) sellerCandidates.push(sellerBlock)
  // 2. OCR 相邻行提取
  if (isOCR) {
    const sOCR = extractAdjacentName(lineText, '销售方') || extractAdjacentName(lineText, '销货方')
    if (sOCR) sellerCandidates.push(sOCR)
  }
  // 3. 从右侧结构化文本提取
  if (rightJoined) {
    const sRight = extractNameFromSection(rightJoined)
    if (sRight) sellerCandidates.push(sRight)
  }
  // 4. 从右侧clean文本提取
  const sClean = extractNameFromSection(rightClean)
  if (sClean) sellerCandidates.push(sClean)
  // 5. 全文正则fallback
  const sFull = extractSellerName(lineText, clean)
  if (sFull) sellerCandidates.push(sFull)

  // 提取买方名称（多个候选来源，按优先级排序）
  const buyerCandidates: string[] = []
  // 1. 从"购买方"区块直接提取
  const buyerBlock = extractNameFromBuyerBlock(lineText)
  if (buyerBlock) buyerCandidates.push(buyerBlock)
  // 2. OCR 相邻行提取
  if (isOCR) {
    const bOCR = extractAdjacentName(lineText, '购买方') || extractAdjacentName(lineText, '购货方')
    if (bOCR) buyerCandidates.push(bOCR)
  }
  // 3. 从左侧结构化文本提取
  if (leftJoined) {
    const bLeft = extractNameFromSection(leftJoined)
    if (bLeft) buyerCandidates.push(bLeft)
  }
  // 4. 从左侧clean文本提取
  const bClean = extractNameFromSection(leftClean)
  if (bClean) buyerCandidates.push(bClean)
  // 5. 全文正则fallback
  const bFull = extractBuyerName(lineText, clean)
  if (bFull) buyerCandidates.push(bFull)

  // 选择卖方：取第一个有效候选
  for (const c of sellerCandidates) {
    if (isValidCompanyName(c)) {
      sellerName = c
      break
    }
  }

  // 选择买方：取第一个有效且不与卖方重复的候选
  for (const c of buyerCandidates) {
    if (isValidCompanyName(c) && c !== sellerName) {
      buyerName = c
      break
    }
  }

  // 如果买方仍为空，尝试所有候选（放宽验证）
  if (!buyerName) {
    for (const c of buyerCandidates) {
      if (c && c.length >= 2 && c !== sellerName) {
        buyerName = c
        break
      }
    }
  }

  // 最终去重
  if (buyerName === sellerName) {
    buyerName = ''
  }

  // 提取税号
  buyerTaxNumber = extractTaxFromSection(leftJoined) || extractTaxFromSection(leftClean) || extractBuyerTaxNumber(lineText, clean) || ''
  sellerTaxNumber = extractTaxFromSection(rightJoined) || extractTaxFromSection(rightClean) || extractSellerTaxNumber(lineText, clean) || ''

  const invoiceType = extractPattern(clean, [
    /(增值税电子专用发票)/,
    /(增值税电子普通发票)/,
    /(增值税专用发票)/,
    /(增值税普通发票)/,
    /(全电增值税专用发票)/,
    /(全电增值税普通发票)/,
    /(电子发票[（(]增值税专用发票[)）])/,
    /(电子发票[（(]增值税普通发票[)）])/,
    /(航空运输电子客票行程单)/,
    /(铁路\S*票)/,
    /(通用机打发票)/,
    /(定额发票)/,
    /(增值税\S*发票)/
  ]) || '增值税普通发票'

  const parsedTotal = parseFloat(totalAmount?.replace(/,/g, '') ?? '0') || 0
  const parsedTax = parseFloat(taxAmount?.replace(/,/g, '') ?? '0') || 0
  const parsedNoTax = parseFloat(amountWithoutTax?.replace(/,/g, '') ?? '0') || Math.max(0, parsedTotal - parsedTax)

  return {
    success: true,
    invoiceCode: invoiceCode || '',
    invoiceNumber: invoiceNumber || '',
    invoiceType,
    issueDate: issueDate?.replace(/[年月]/g, '-').replace(/日$/, '') || '',
    sellerName: sellerName || '',
    sellerTaxNumber: sellerTaxNumber || '',
    buyerName: buyerName || '',
    buyerTaxNumber: buyerTaxNumber || '',
    amountWithoutTax: parsedNoTax,
    taxAmount: parsedTax,
    totalAmount: parsedTotal || parsedNoTax + parsedTax,
    rawText: clean.substring(0, 2000)
  }
}

function extractNameFromSection(text: string): string {
  const patterns = [
    /名\s*称[：:]\s*(.+?)(?:\n|纳税人识别号|地址|开户行|电话|$)/,
    /名\s*称[：:]\s*(.+?)(?:纳税人识别号|地址|开户行|$)/
  ]
  for (const pat of patterns) {
    pat.lastIndex = 0
    const m = text.match(pat)
    if (m?.[1]) {
      const cleaned = cleanExtractedName(m[1])
      if (isValidCompanyName(cleaned)) return cleaned
    }
  }
  return ''
}

function extractTaxFromSection(text: string): string {
  const pat = /纳税人识别号[：:]?\s*([0-9A-Za-z]{15,20})/
  const m = text.match(pat)
  return m?.[1] || ''
}

/**
 * 验证提取的名称是否为有效的公司名称。
 * 过滤掉表格表头、无关文字、过短/过长的字符串等。
 */
function isValidCompanyName(name: string): boolean {
  if (!name || typeof name !== 'string') return false
  const trimmed = name.trim()
  // 长度检查：公司名称至少 2 个字符，最多 100 个字符
  if (trimmed.length < 2 || trimmed.length > 100) return false
  // 过滤掉纯英文/数字（除非有特殊前缀）
  if (!/[\u4e00-\u9fa5]/.test(trimmed)) return false
  // 过滤掉发票表头常见关键词
  const tableHeaderKeywords = [
    '规格型号', '单位', '数量', '单价', '金额', '税率', '征收率', '税额',
    '货物', '应税劳务', '服务', '项目名称', '车牌号', '类型', '起运地',
    '到达地', '吨数', '运费', '装卸费', '保管费', '其他', '备注',
    '合计', '价税合计', '不含税', '小写', '大写', '开票人', '复核',
    '收款人', '销售方', '购买方', '密码区', '机器编号', '校 验 码'
  ]
  for (const kw of tableHeaderKeywords) {
    if (trimmed.includes(kw)) return false
  }
  // 过滤掉过短的单字/双字（可能是 OCR 错误）
  if (trimmed.length < 4 && !trimmed.includes('公司') && !trimmed.includes('厂') && !trimmed.includes('店')) return false
  return true
}

/**
 * 清理名称：去除末尾的无关文字（如纳税人识别号、地址、电话等）。
 */
function cleanExtractedName(raw: string): string {
  if (!raw) return ''
  let name = raw.trim()
  // 去除前导冒号（京东等电子发票格式：": 公司名称"）
  name = name.replace(/^[：:]+\s*/, '')
  // 去除"名称："前缀
  name = name.replace(/^名\s*称\s*[：:]\s*/, '')
  // 截断：遇到"销名称"、"销 货方"、"销售方"等关键词时截断
  name = name.replace(/销\s*名\s*称.*$/, '')
  name = name.replace(/销\s*货?\s*方.*$/, '')
  name = name.replace(/购\s*货?\s*方.*$/, '')
  name = name.replace(/名\s*称\s*[：:].*$/, '')
  // 去除末尾的纳税人识别号相关文字
  name = name.replace(/\s*纳\s*税\s*人\s*识\s*别\s*号.*$/, '')
  name = name.replace(/\s*识别号.*$/, '')
  name = name.replace(/\s*税\s*号.*$/, '')
  // 去除地址、电话、开户行等
  name = name.replace(/\s*地\s*址[：:].*$/, '')
  name = name.replace(/\s*电\s*话[：:].*$/, '')
  name = name.replace(/\s*开户行.*$/, '')
  name = name.replace(/\s*帐\s*号.*$/, '')
  name = name.replace(/\s*账\s*号.*$/, '')
  // 去除多余空白
  name = name.replace(/\s+/g, '').trim()
  return name
}

/**
 * 从"购买方"区块提取名称（限定在购买方段落内）
 */
function extractNameFromBuyerBlock(lineText: string): string {
  // 格式1：购 名称：XXX 销 名称：YYY 或 买 名 称 XXX 售 名 称 YYY（电子发票同行格式）
  const inlinePatterns = [
    /购\s*名\s*称[：:]\s*(.+?)\s*销\s*名\s*称/,
    /买\s*名\s*称[：:]?\s*(.+?)\s*售\s*名\s*称/,
    /购\s*名\s*称[：:]?\s*(.+?)\s*售\s*名\s*称/,
    /买\s*名\s*称[：:]\s*(.+?)\s*销\s*名\s*称/,
  ]
  for (const pat of inlinePatterns) {
    const inlineMatch = lineText.match(pat)
    if (inlineMatch?.[1]) {
      const cleaned = cleanExtractedName(inlineMatch[1])
      if (isValidCompanyName(cleaned)) return cleaned
      // For personal names (not companies), also accept
      if (cleaned.length >= 2 && cleaned.length <= 10 && !/规格|型号|单位|数量|单价|金额|税率/.test(cleaned)) return cleaned
    }
  }

  // 格式2：购买方区块（支持关键词被换行分隔）
  const buyerStart = lineText.search(/购\s*买\s*方|购\s*货\s*方/)
  if (buyerStart >= 0) {
    const sellerStart = lineText.search(/销\s*售\s*方|销\s*货\s*方/)
    const buyerBlock = sellerStart >= 0
      ? lineText.substring(buyerStart, sellerStart)
      : lineText.substring(buyerStart, buyerStart + 500)

    const patterns = [
      /名\s*称[：:]\s*([^\n]+)/,
      /名\s*称[：:]\s*(.+?)(?:纳税人识别号|地址|电话|开户行|$)/
    ]
    for (const pat of patterns) {
      const m = buyerBlock.match(pat)
      if (m?.[1]) {
        const cleaned = cleanExtractedName(m[1])
        if (isValidCompanyName(cleaned)) return cleaned
      }
    }
  }
  return ''
}

/**
 * 从"销售方"区块提取名称（限定在销售方段落内）
 */
function extractNameFromSellerBlock(lineText: string): string {
  // 格式1：购 名称：XXX 销 名称：YYY 或 买 名 称 XXX 售 名 称 YYY（电子发票同行格式）
  const inlinePatterns = [
    /销\s*名\s*称[：:]\s*(.+?)(?:\n|纳税人识别号|地址|电话|开户行|$)/,
    /售\s*名\s*称[：:]?\s*(.+?)(?:\n|纳税人识别号|地址|电话|开户行|$)/,
    /销\s*名\s*称[：:]?\s*(.+?)(?:\n|纳税人识别号|地址|电话|开户行|$)/,
    /售\s*名\s*称[：:]\s*(.+?)(?:\n|纳税人识别号|地址|电话|开户行|$)/,
  ]
  for (const pat of inlinePatterns) {
    const inlineMatch = lineText.match(pat)
    if (inlineMatch?.[1]) {
      const cleaned = cleanExtractedName(inlineMatch[1])
      if (isValidCompanyName(cleaned)) return cleaned
    }
  }

  // 格式2：销售方区块（支持关键词被换行分隔）
  const sellerStart = lineText.search(/销\s*售\s*方|销\s*货\s*方/)
  if (sellerStart >= 0) {
    const sellerBlock = lineText.substring(sellerStart, sellerStart + 500)

    const patterns = [
      /名\s*称[：:]\s*([^\n]+)/,
      /名\s*称[：:]\s*(.+?)(?:纳税人识别号|地址|电话|开户行|$)/
    ]
    for (const pat of patterns) {
      const m = sellerBlock.match(pat)
      if (m?.[1]) {
        const cleaned = cleanExtractedName(m[1])
        if (isValidCompanyName(cleaned)) return cleaned
      }
    }
  }
  return ''
}

function extractSellerName(lineText: string, clean: string): string {
  // 优先尝试：在"销售方"区块内找"名称"（支持关键词被换行分隔）
  const sellerBlockPatterns = [
    /销\s*售\s*方[\s\S]*?名\s*称\s*[：:]\s*([^\n\r]+)/,
    /销\s*货\s*方[\s\S]*?名\s*称\s*[：:]\s*([^\n\r]+)/,
    /销\s*售\s*方\s*[：:]\s*([^\n\r]{2,50}?)(?:\n|地址|电话|开户行|纳税人识别号|$)/,
  ]
  for (const pat of sellerBlockPatterns) {
    const m = lineText.match(pat)
    if (m?.[1]) {
      const cleaned = cleanExtractedName(m[1])
      if (isValidCompanyName(cleaned)) return cleaned
    }
  }

  // 其次：找所有"名称：XXX"匹配，选择在"销售方"关键词之后最近的
  const namePattern = /名\s*称\s*[：:]\s*(.+?)(?:\n|地址|电话|开户行|纳税人识别号|$)/g
  let match: RegExpExecArray | null
  const allNameMatches: { name: string; index: number }[] = []
  while ((match = namePattern.exec(lineText)) !== null) {
    const cleaned = cleanExtractedName(match[1])
    if (cleaned && cleaned.length > 1) {
      allNameMatches.push({ name: cleaned, index: match.index })
    }
  }

  if (allNameMatches.length === 0) return ''

  // 如果有"销售方"关键词，选择在其之后最近的名字
  const sellerIdx = lineText.search(/销\s*售\s*方|销\s*货\s*方/)
  if (sellerIdx >= 0) {
    const afterSeller = allNameMatches.filter(m => m.index > sellerIdx)
    if (afterSeller.length > 0) {
      // 按索引排序，取第一个有效的
      afterSeller.sort((a, b) => a.index - b.index)
      const best = afterSeller[0]
      if (isValidCompanyName(best.name)) return best.name
    }
  }

  // 默认取最后一个（发票通常销售方在后）
  const last = allNameMatches[allNameMatches.length - 1]
  if (isValidCompanyName(last.name)) return last.name

  // 如果验证失败，取第一个
  if (isValidCompanyName(allNameMatches[0].name)) return allNameMatches[0].name

  return ''
}

function extractBuyerName(lineText: string, clean: string): string {
  // 优先尝试：在"购买方"区块内找"名称"（支持关键词被换行分隔）
  const buyerBlockPatterns = [
    /购\s*买\s*方[\s\S]*?名\s*称\s*[：:]\s*([^\n\r]+)/,
    /购\s*货\s*方[\s\S]*?名\s*称\s*[：:]\s*([^\n\r]+)/,
    /购\s*买\s*方\s*[：:]\s*([^\n\r]{2,50}?)(?:\n|地址|电话|开户行|纳税人识别号|$)/,
  ]
  for (const pat of buyerBlockPatterns) {
    const m = lineText.match(pat)
    if (m?.[1]) {
      const cleaned = cleanExtractedName(m[1])
      if (isValidCompanyName(cleaned)) return cleaned
    }
  }

  // 其次：找所有"名称：XXX"匹配，选择在"购买方"之后、"销售方"之前的
  const namePattern = /名\s*称\s*[：:]\s*(.+?)(?:\n|地址|电话|开户行|纳税人识别号|$)/g
  let match: RegExpExecArray | null
  const allNameMatches: { name: string; index: number }[] = []
  while ((match = namePattern.exec(lineText)) !== null) {
    const cleaned = cleanExtractedName(match[1])
    if (cleaned && cleaned.length > 1) {
      allNameMatches.push({ name: cleaned, index: match.index })
    }
  }

  if (allNameMatches.length === 0) return ''

  // 如果有"购买方"关键词，选择在其之后、"销售方"之前的名字
  const buyerIdx = lineText.search(/购\s*买\s*方|购\s*货\s*方/)
  if (buyerIdx >= 0) {
    const sellerIdx = lineText.search(/销\s*售\s*方|销\s*货\s*方/)
    const candidate = allNameMatches.find(m => {
      if (m.index <= buyerIdx) return false
      if (sellerIdx >= 0 && m.index > sellerIdx) return false
      return true
    })
    if (candidate) {
      if (isValidCompanyName(candidate.name)) return candidate.name
    }
  }

  // 默认取第一个（发票通常购买方在前）
  const first = allNameMatches[0]
  if (isValidCompanyName(first.name)) return first.name

  return ''
}

function extractSellerTaxNumber(lineText: string, clean: string): string | null {
  const taxPattern = /纳税人识别号[：:]?\s*([0-9A-Za-z]{15,20})/g
  let match: RegExpExecArray | null
  const allMatches: { number: string; index: number }[] = []
  while ((match = taxPattern.exec(lineText)) !== null) {
    allMatches.push({ number: match[1], index: match.index })
  }
  if (allMatches.length === 0) {
    taxPattern.lastIndex = 0
    while ((match = taxPattern.exec(clean)) !== null) {
      allMatches.push({ number: match[1], index: match.index })
    }
  }
  if (allMatches.length === 0) return null
  if (allMatches.length === 1) return allMatches[0].number

  const sellerIdx = lineText.search(/销售方|销货方/)
  if (sellerIdx >= 0) {
    let best: { number: string; index: number } | null = null
    for (const m of allMatches) {
      if (m.index > sellerIdx && (!best || m.index < best.index)) {
        best = m
      }
    }
    if (best) return best.number
  }

  return allMatches.length > 1 ? allMatches[allMatches.length - 1].number : allMatches[0].number
}

function extractBuyerTaxNumber(lineText: string, clean: string): string | null {
  const taxPattern = /纳税人识别号[：:]?\s*([0-9A-Za-z]{15,20})/g
  let match: RegExpExecArray | null
  const allMatches: { number: string; index: number }[] = []
  while ((match = taxPattern.exec(lineText)) !== null) {
    allMatches.push({ number: match[1], index: match.index })
  }
  if (allMatches.length === 0) {
    taxPattern.lastIndex = 0
    while ((match = taxPattern.exec(clean)) !== null) {
      allMatches.push({ number: match[1], index: match.index })
    }
  }
  if (allMatches.length === 0) return null
  if (allMatches.length === 1) return allMatches[0].number

  const buyerIdx = lineText.search(/购买方|购货方/)
  if (buyerIdx >= 0) {
    let best: { number: string; index: number } | null = null
    for (const m of allMatches) {
      if (m.index > buyerIdx) {
        const sellerIdx = lineText.search(/销售方|销货方/)
        if (sellerIdx < 0 || m.index < sellerIdx) {
          if (!best || m.index < best.index) {
            best = m
          }
        }
      }
    }
    if (best) return best.number
  }

  return allMatches.length > 1 ? allMatches[0].number : allMatches[0].number
}

function extractPattern(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) {
      return match[1].trim()
    }
  }
  return null
}

async function parseInvoiceWithAI(rawText: string, db: ReturnType<typeof getDatabase>): Promise<Record<string, unknown>> {
  const apiKey = db.getSetting('aiApiKey')
  const apiEndpoint = db.getSetting('aiApiEndpoint')
  const aiModel = db.getSetting('aiModel') || 'gpt-4'

  if (!apiKey || !apiEndpoint) {
    return { success: false, error: 'AI 模型未配置，无法使用 AI 解析' }
  }

  return parseInvoiceWithAIConfig(rawText, apiKey, apiEndpoint, aiModel)
}

async function parseInvoiceWithAIConfig(rawText: string, apiKey: string, apiEndpoint: string, aiModel: string): Promise<Record<string, unknown>> {
  const prompt = `请从以下中国发票文本中提取发票信息，以 JSON 格式返回。需要提取的字段：
- invoiceCode: 发票代码（10-12位数字，全电发票可能没有）
- invoiceNumber: 发票号码（8-20位数字）
- invoiceType: 发票类型（如：增值税普通发票、增值税专用发票、全电增值税普通发票等）
- issueDate: 开票日期（格式 YYYY-MM-DD）
- sellerName: 销售方名称
- sellerTaxNumber: 销售方纳税人识别号
- buyerName: 购买方名称
- buyerTaxNumber: 购买方纳税人识别号
- amountWithoutTax: 不含税金额（数字）
- taxAmount: 税额（数字）
- totalAmount: 价税合计（数字）

注意：如果某个字段无法提取，设为空字符串或0。只返回 JSON，不要其他内容。

发票文本：
${rawText}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)

  try {
    const response = await fetch(`${apiEndpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: aiModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 1024
      }),
      signal: controller.signal
    })

    if (!response.ok) {
      return { success: false, error: `AI API 请求失败 (${response.status})` }
    }

    const result = await response.json() as Record<string, unknown>
    const choices = (result.choices as Array<Record<string, unknown>> | undefined)
    const content = choices?.[0]?.message ? String((choices[0].message as Record<string, unknown>).content) : ""
    if (!content) {
      return { success: false, error: 'AI 返回了空内容' }
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { success: false, error: 'AI 返回的内容无法解析为 JSON' }
    }

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
    return {
      success: true,
      invoiceCode: parsed.invoiceCode || '',
      invoiceNumber: parsed.invoiceNumber || '',
      invoiceType: parsed.invoiceType || '增值税普通发票',
      issueDate: parsed.issueDate || '',
      sellerName: parsed.sellerName || '',
      sellerTaxNumber: parsed.sellerTaxNumber || '',
      buyerName: parsed.buyerName || '',
      buyerTaxNumber: parsed.buyerTaxNumber || '',
      amountWithoutTax: Number(parsed.amountWithoutTax) || 0,
      taxAmount: Number(parsed.taxAmount) || 0,
      totalAmount: Number(parsed.totalAmount) || 0,
      rawText: rawText.substring(0, 500)
    }
  } catch (err) {
    if (controller.signal.aborted) {
      return { success: false, error: 'AI 解析超时（30秒），请检查网络或 API 服务' }
    }
    return { success: false, error: `AI 解析失败: ${err instanceof Error ? err.message : String(err)}` }
  } finally {
    clearTimeout(timeout)
  }
}

async function convertPdfToPng(filePath: string): Promise<string> {
  const tmpDir = join(app.getPath('temp'), 'invoice-vision')
  if (!existsSync(tmpDir)) {
    mkdirSync(tmpDir, { recursive: true })
  }
  const pngPath = join(tmpDir, `${Date.now()}.png`)
  try {
    // 使用 macOS 的 sips 命令转换 PDF 为 PNG
    // --resampleHeightWidthMax 确保最大边至少 2000 像素
    const sipsCmd = `sips -s format png --resampleHeightWidthMax 2000 "${filePath}" --out "${pngPath}"`
    execSync(sipsCmd, { timeout: 20000 })
    if (!existsSync(pngPath)) {
      throw new Error('sips 转换失败，未生成 PNG 文件')
    }
    // 验证文件大小
    const stat = require('fs').statSync(pngPath)
    if (stat.size < 5000) {
      throw new Error(`sips 转换生成的图片过小（${stat.size} bytes），PDF 可能为空或损坏`)
    }
    const pngBase64 = readFileSync(pngPath).toString('base64')
    return pngBase64
  } catch (err) {
    throw new Error(`PDF 转图片失败: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    try { unlinkSync(pngPath) } catch { /* cleanup */ }
  }
}

async function parseInvoiceWithVision(filePath: string, apiKey: string, apiEndpoint: string, aiModel: string): Promise<Record<string, unknown>> {
  const ext = extname(filePath).slice(1).toLowerCase()
  const imageExts = ['jpg', 'jpeg', 'png', 'webp', 'bmp']

  let imageBase64: string
  let mimeType: string

  if (ext === 'pdf') {
    try {
      imageBase64 = await convertPdfToPng(filePath)
      mimeType = 'image/png'
    } catch (err) {
      return { success: false, error: `PDF 转图片失败: ${err instanceof Error ? err.message : String(err)}。请尝试用支持 PDF 直接识别的视觉模型（如 gpt-4o）` }
    }
  } else if (imageExts.includes(ext)) {
    imageBase64 = readFileSync(filePath).toString('base64')
    mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
  } else {
    return { success: false, error: `不支持的视觉识别文件格式: .${ext}，请使用 PDF/PNG/JPG 文件` }
  }

  const prompt = `你是一位专业的发票信息提取助手。请仔细观察这张中国发票图片，提取以下信息并以JSON格式返回。

要求：
1. 只返回有效的JSON对象，不要包含其他文字、解释或markdown标记
2. 如果某个字段无法识别，字符串字段设为空字符串""，数字字段设为0
3. 日期格式必须为 YYYY-MM-DD
4. 金额字段必须是纯数字（不要带¥、¥、元等单位）

需要提取的JSON字段：
{
  "invoiceCode": "发票代码，10-12位数字，全电发票可能没有",
  "invoiceNumber": "发票号码，8-20位数字",
  "invoiceType": "发票类型，如增值税普通发票、增值税专用发票、电子发票等",
  "issueDate": "开票日期",
  "sellerName": "销售方名称",
  "sellerTaxNumber": "销售方纳税人识别号",
  "buyerName": "购买方名称",
  "buyerTaxNumber": "购买方纳税人识别号",
  "amountWithoutTax": 不含税金额（数字）,
  "taxAmount": 税额（数字）,
  "totalAmount": 价税合计（数字）
}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60000)

  try {
    const response = await fetch(`${apiEndpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: aiModel,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}`, detail: 'high' } }
          ]
        }],
        temperature: 0.1,
        max_tokens: 1024
      }),
      signal: controller.signal
    })

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '')
      return { success: false, error: `AI 视觉识别请求失败 (${response.status}): ${errorBody.slice(0, 300)}` }
    }

    const result = await response.json() as Record<string, unknown>
    const content = extractContentFromChunk(result)
    if (!content) {
      return { success: false, error: 'AI 视觉识别返回了空内容' }
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { success: false, error: `AI 视觉识别返回的内容无法解析为 JSON（内容: ${content.slice(0, 200)}）` }
    }

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>

    // 验证 AI 是否返回了有效数据（不能是空 JSON）
    const hasInvoiceNumber = parsed.invoiceNumber && String(parsed.invoiceNumber).trim() !== ''
    const hasTotalAmount = Number(parsed.totalAmount) > 0
    const hasSeller = parsed.sellerName && String(parsed.sellerName).trim() !== ''

    if (!hasInvoiceNumber && !hasTotalAmount && !hasSeller) {
      return { success: false, error: 'AI 视觉识别未能提取到有效发票信息，请检查图片是否清晰' }
    }

    return {
      success: true,
      invoiceCode: parsed.invoiceCode || '',
      invoiceNumber: parsed.invoiceNumber || '',
      invoiceType: parsed.invoiceType || '增值税普通发票',
      issueDate: parsed.issueDate || '',
      sellerName: parsed.sellerName || '',
      sellerTaxNumber: parsed.sellerTaxNumber || '',
      buyerName: parsed.buyerName || '',
      buyerTaxNumber: parsed.buyerTaxNumber || '',
      amountWithoutTax: Number(parsed.amountWithoutTax) || 0,
      taxAmount: Number(parsed.taxAmount) || 0,
      totalAmount: Number(parsed.totalAmount) || 0,
      rawText: ''
    }
  } catch (err) {
    if (controller.signal.aborted) {
      return { success: false, error: 'AI 视觉识别超时（60秒）' }
    }
    return { success: false, error: `AI 视觉识别失败: ${err instanceof Error ? err.message : String(err)}` }
  } finally {
    clearTimeout(timeout)
  }
}
