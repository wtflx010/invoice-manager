// imapflow import
import { ImapFlow, type FetchMessageObject } from 'imapflow'

interface EmailAccount {
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

interface ImapConnection {
  client: InstanceType<typeof ImapFlow>
  accountId: string
}

interface FetchedEmail {
  uid: number
  subject: string
  from: string
  date: string
  hasAttachments: boolean
  attachmentCount: number
  snippet: string
  isInvoice: boolean
}

interface InvoiceAttachment {
  emailUid: number
  fileName: string
  mimeType: string
  size: number
  partId: string
}

class ImapService {
  private connections = new Map<string, ImapConnection>()

  private invoiceKeywords = [
    '发票', 'invoice', '电子发票', '增值税', 'receipt', 'tax',
    '行程单', '行程', '机票', '火车票', '打车', '滴滴', '高铁',
    'e-invoice', 'fapiao', '报销', '开票', '铁路', '航空',
    '客运', '出租车', '住宿', '酒店', '餐饮', '通行费',
    '税务', '完税', '缴款', '财政', '电子票', '全电',
    'ofd', '专票', '普票', '电子单'
  ]

  private countAttachments(parts: unknown[]): { count: number; hasAttachments: boolean } {
    let attachmentCount = 0
    let hasAttachments = false
    for (const part of parts) {
      const p = part as Record<string, unknown>
      const type = (p.type as string) ?? ''
      const disposition = (p.disposition as string) ?? ''

      if (type && !type.startsWith('multipart/')) {
        const isAttachment = disposition.toLowerCase() === 'attachment'
        const isInlineFile = disposition.toLowerCase() === 'inline'
        const isInvoiceType = type === 'application/pdf' || type === 'application/xml' ||
          type === 'text/xml' || type === 'application/zip' || type === 'application/octet-stream'

        let name = ''
        const params = p.parameters as Record<string, string> | undefined
        if (params) name = params.name || params.filename || ''
        if (!name) {
          const dp = p.dispositionParameters as Record<string, string> | undefined
          if (dp) name = dp.filename || dp.name || ''
        }
        const hasInvoiceName = name && /\.(pdf|ofd|xml|jpg|jpeg|png|zip)$/i.test(name)

        if (isAttachment || (isInlineFile && hasInvoiceName)) {
          attachmentCount++
          hasAttachments = true
        }
      }
      if (p.childNodes) {
        const childResult = this.countAttachments(p.childNodes as unknown[])
        attachmentCount += childResult.count
        if (childResult.hasAttachments) hasAttachments = true
      }
    }
    return { count: attachmentCount, hasAttachments }
  }

  private processFetchedMessage(msg: FetchMessageObject): FetchedEmail {
    const subject = msg.envelope?.subject ?? '(无主题)'
    const fromAddr = msg.envelope?.from?.[0]
    const from = fromAddr?.name ?? fromAddr?.address ?? '(未知)'

    let attachmentResult = { count: 0, hasAttachments: false }
    if (msg.bodyStructure) {
      attachmentResult = this.countAttachments([msg.bodyStructure as unknown])
    }

    const keywordLower = this.invoiceKeywords.map((k) => k.toLowerCase())
    const lowerSubject = subject.toLowerCase()
    const fromEmail = (fromAddr?.address ?? '').toLowerCase()
    const fromName = (fromAddr?.name ?? '').toLowerCase()
    const combined = `${lowerSubject} ${fromEmail} ${fromName}`
    const isInvoice = keywordLower.some((kw) => combined.includes(kw))

    const snippet = msg.source
      ? msg.source.toString('utf-8').substring(0, 200).replace(/[\r\n\s]+/g, ' ').trim()
      : ''

    return {
      uid: msg.uid as number,
      subject,
      from,
      date: msg.envelope?.date?.toISOString() ?? '',
      hasAttachments: attachmentResult.hasAttachments,
      attachmentCount: attachmentResult.count,
      snippet,
      isInvoice
    }
  }

  isConnected(accountId: string): boolean {
    const conn = this.connections.get(accountId)
    return conn?.client.usable ?? false
  }

  async connect(account: EmailAccount, password: string): Promise<boolean> {
    try {
      await this.disconnect(account.id)

      const port = Number(account.imapPort) || 993
      const useTls = Boolean(account.useTls)
      const isImplicitTls = port === 993

      const client = new ImapFlow({
        host: account.imapHost,
        port,
        secure: isImplicitTls,
        auth: {
          user: account.email,
          pass: password
        },
        logger: false,
        connectionTimeout: 30000,
        greetingTimeout: 15000,
        ...(useTls ? { tls: { rejectUnauthorized: false } } : {})
      })

      await client.connect()
      this.connections.set(account.id, { client, accountId: account.id })
      return true
    } catch (err) {
      console.error(`IMAP connect failed for ${account.email}:`, err)
      throw err
    }
  }

  async disconnect(accountId: string): Promise<void> {
    const conn = this.connections.get(accountId)
    if (conn) {
      try {
        await conn.client.logout()
      } catch {
        // ignore
      }
      this.connections.delete(accountId)
    }
  }

  async disconnectAll(): Promise<void> {
    const ids = Array.from(this.connections.keys())
    await Promise.all(ids.map((id) => this.disconnect(id)))
  }

  async fetchEmails(
    accountId: string,
    options: { limit?: number } = {}
  ): Promise<{ emails: FetchedEmail[]; total: number }> {
    const conn = this.connections.get(accountId)
    if (!conn || !conn.client.usable) {
      throw new Error('IMAP 未连接')
    }

    const limit = options.limit ?? 50

    const mailbox = await conn.client.mailboxOpen('INBOX')
    const total = mailbox.exists ?? 0
    if (total === 0) return { emails: [], total: 0 }

    const start = Math.max(1, total - limit + 1)
    const range = `${start}:${total}`
    const messages: FetchedEmail[] = []

    for await (const msg of conn.client.fetch(
      { seq: range },
      { uid: true, envelope: true, bodyStructure: true, source: { maxLength: 200 } }
    )) {
      messages.push(this.processFetchedMessage(msg))
    }

    messages.sort((a, b) => b.date.localeCompare(a.date))

    return { emails: messages, total }
  }

  async searchInvoiceEmails(
    accountId: string
  ): Promise<{ emails: FetchedEmail[]; total: number; searched: number }> {
    const conn = this.connections.get(accountId)
    if (!conn || !conn.client.usable) {
      throw new Error('IMAP 未连接')
    }

    const mailbox = await conn.client.mailboxOpen('INBOX')
    const total = mailbox.exists ?? 0

    if (total === 0) {
      return { emails: [], total: 0, searched: 0 }
    }

    const searchLimit = Math.min(total, 2000)
    const start = Math.max(1, total - searchLimit + 1)
    const range = `${start}:${total}`

    const messages: FetchedEmail[] = []

    for await (const msg of conn.client.fetch(
      { seq: range },
      { uid: true, envelope: true, bodyStructure: true, source: { maxLength: 500 } }
    )) {
      messages.push(this.processFetchedMessage(msg))
    }

    const sorted = messages.sort((a, b) => b.date.localeCompare(a.date))

    return { emails: sorted, total, searched: searchLimit }
  }

  async getAttachments(
    accountId: string,
    emailUid: number
  ): Promise<InvoiceAttachment[]> {
    const conn = this.connections.get(accountId)
    if (!conn || !conn.client.usable) {
      throw new Error('IMAP 未连接')
    }

    const attachments: InvoiceAttachment[] = []

    // === Approach 1: Parse bodyStructure ===
    try {
      const msg = await conn.client.fetchOne(
        String(emailUid),
        { uid: true, bodyStructure: true },
        { uid: true }
      )

      if (!msg) return []
      if (msg.bodyStructure) {
        const extractName = (node: Record<string, unknown>): string => {
          const params = node.parameters as Record<string, string> | undefined
          if (params) {
            const n = params.name || params.filename || ''
            if (n) return n
          }
          const dp = node.dispositionParameters as Record<string, string> | undefined
          if (dp) {
            const n = dp.filename || dp.name || ''
            if (n) return n
          }
          return ''
        }

        const collectLeafParts = (node: Record<string, unknown>, depth = 0): Array<{ part: string; type: string; disposition: string; name: string; size: number }> => {
          const result: Array<{ part: string; type: string; disposition: string; name: string; size: number }> = []
          const type = (node.type as string) ?? ''
          const disposition = (node.disposition as string) ?? ''
          const size = (node.size as number) ?? 0
          const part = (node.part as string) ?? ''
          const name = extractName(node)

          if (type.startsWith('multipart/')) {
            const childNodes = node.childNodes as Record<string, unknown>[] | undefined
            if (childNodes && Array.isArray(childNodes)) {
              for (const child of childNodes) {
                result.push(...collectLeafParts(child, depth + 1))
              }
            }
          } else if (type) {
            const isTextBody = type.startsWith('text/plain') || type.startsWith('text/html')
            if (!isTextBody) {
              result.push({ part, type, disposition, name, size })
            }
          }

          return result
        }

        const parts = collectLeafParts(msg.bodyStructure as unknown as Record<string, unknown>)
        for (const part of parts) {
          attachments.push({
            emailUid,
            fileName: part.name || `attachment_${part.part}`,
            mimeType: part.type,
            size: part.size,
            partId: part.part
          })
        }
      }
    } catch (err) {
      console.error(`[IMAP] A1 failed:`, err instanceof Error ? err.message : String(err))
    }

    if (attachments.length > 0) return attachments

    // === Approach 2: MIME header probe ===
    try {
      const probeParts = ['1.mime', '2.mime', '3.mime', '4.mime', '5.mime', '6.mime', '7.mime', '8.mime']
      const msg = await conn.client.fetchOne(
        String(emailUid),
        { uid: true, bodyParts: probeParts },
        { uid: true }
      )

      if (!msg) return []
      if (msg.bodyParts) {
        for (const [key, value] of msg.bodyParts.entries()) {
          if (!key.endsWith('.mime') || !value || value.length === 0) continue
          const partNum = key.replace('.mime', '')
          const headers = value.toString('utf-8')

          const ctMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i)
          const contentType = ctMatch ? ctMatch[1].split(';')[0].trim().toLowerCase() : ''

          if (!contentType || contentType.startsWith('text/plain') || contentType.startsWith('text/html') || contentType.startsWith('multipart/')) {
            continue
          }

          let fileName = `attachment_${partNum}`
          const nameMatch = headers.match(/name="([^"]+)"/i) || headers.match(/filename="([^"]+)"/i)
            || headers.match(/name=([^\s;]+)/i) || headers.match(/filename=([^\s;]+)/i)
          if (nameMatch) fileName = nameMatch[1]

          attachments.push({
            emailUid,
            fileName,
            mimeType: contentType || 'application/octet-stream',
            size: 0,
            partId: partNum
          })
        }
      }
    } catch (err) {
      console.error(`[IMAP] A2 failed:`, err instanceof Error ? err.message : String(err))
    }

    if (attachments.length > 0) return attachments

    // === Approach 3: Direct download probe ===
    for (let partNum = 1; partNum <= 5; partNum++) {
      try {
        const downloadResult = await conn.client.download(String(emailUid), String(partNum), { uid: true, maxBytes: 4096 })
        if (!downloadResult?.content) continue

        const buffer = Buffer.from(await this.streamToBuffer(downloadResult.content))
        if (buffer.length === 0) continue

        const meta = downloadResult.meta as Record<string, unknown> | undefined
        const contentType = ((meta?.contentType as string) || '').toLowerCase()

        if (contentType.startsWith('text/plain') || contentType.startsWith('text/html') || contentType.startsWith('multipart/')) {
          continue
        }

        let fileName = `attachment_${partNum}`
        const dp = meta?.dispositionParameters as Record<string, string> | undefined
        const cp = meta?.parameters as Record<string, string> | undefined
        if (dp) fileName = dp.filename || dp.name || fileName
        if (cp) fileName = cp.name || cp.filename || fileName

        if (buffer.length > 100 && (contentType.includes('pdf') || contentType.includes('xml') || contentType.includes('octet-stream') || fileName.match(/\.(pdf|ofd|xml|zip)$/i))) {
          attachments.push({
            emailUid,
            fileName,
            mimeType: contentType || 'application/octet-stream',
            size: buffer.length,
            partId: String(partNum)
          })
        }
      } catch {
        break
      }
    }

    return attachments
  }

  async downloadAttachment(
    accountId: string,
    emailUid: number,
    partId: string
  ): Promise<{ fileName: string; data: Buffer; mimeType: string }> {
    const conn = this.connections.get(accountId)
    if (!conn || !conn.client.usable) {
      throw new Error('IMAP 未连接')
    }

    let downloadResult: { content: NodeJS.ReadableStream; meta?: { contentType?: string; disposition?: string; dispositionParameters?: Record<string, string>; parameters?: Record<string, string> } } | null = null
    try {
      downloadResult = await conn.client.download(String(emailUid), partId, { uid: true })
    } catch (downloadErr) {
    }

    if (!downloadResult || !downloadResult.content) {
      try {
        const msg = await conn.client.fetchOne(
          String(emailUid),
          { uid: true, bodyStructure: true },
          { uid: true }
        )
        if (!msg || !msg.bodyStructure) {
          throw new Error(`No bodyStructure for uid=${emailUid}`)
        }
        const allParts = this.flattenParts([msg.bodyStructure] as unknown[])
        const found = allParts.find((p) => p.partId === partId)
        if (!found) {
          throw new Error(`Part ${partId} not found in email ${emailUid}`)
        }
        downloadResult = await conn.client.download(String(emailUid), found.partId, { uid: true })
      } catch (retryErr) {
        throw new Error(`Failed to download attachment: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`)
      }
    }

    if (!downloadResult?.content) {
      throw new Error(`Download returned no content for uid=${emailUid} partId=${partId}`)
    }

    let fileName = `attachment_${partId}`
    const meta = downloadResult.meta as Record<string, unknown> | undefined
    if (meta) {
      const dp = meta.dispositionParameters as Record<string, string> | undefined
      const cp = meta.parameters as Record<string, string> | undefined
      fileName = dp?.filename || cp?.name || dp?.name || cp?.filename || fileName
    }

    if (fileName === `attachment_${partId}`) {
      const msg = await conn.client.fetchOne(
        String(emailUid),
        { uid: true, bodyStructure: true },
        { uid: true }
      )
      if (msg && msg.bodyStructure) {
        const allParts = this.flattenParts([msg.bodyStructure] as unknown[])
        const found = allParts.find((p) => p.partId === partId)
        if (found?.name) fileName = found.name
      }
    }

    let buffer: Buffer
    try {
      buffer = Buffer.from(await this.streamToBuffer(downloadResult.content))
    } catch (streamErr) {
      console.error(`[IMAP] streamToBuffer failed:`, streamErr)
      throw new Error(`Failed to read attachment stream: ${streamErr instanceof Error ? streamErr.message : String(streamErr)}`)
    }

    if (buffer.length === 0) {
      console.warn(`[IMAP] Downloaded buffer is empty for uid=${emailUid} partId=${partId}`)
    }

    return {
      fileName,
      data: buffer,
      mimeType: (meta?.contentType as string) ?? 'application/octet-stream'
    }
  }

  private async streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk as Buffer))
    }
    return Buffer.concat(chunks)
  }

  private flattenParts(parts: unknown[], parentId = ''): Array<{ partId: string; name: string }> {
    const result: Array<{ partId: string; name: string }> = []
    if (!parts || !Array.isArray(parts)) return result
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i] as Record<string, unknown>
      const part = (p.part as string) || (parentId ? `${parentId}.${i + 1}` : `${i + 1}`)
      let name = ''
      const params = p.parameters as Record<string, string> | undefined
      if (params) {
        name = params.name || params.filename || ''
      }
      if (!name) {
        const dp = p.dispositionParameters as Record<string, string> | undefined
        if (dp) {
          name = dp.filename || dp.name || ''
        }
      }
      result.push({ partId: part, name })
      if (p.childNodes) {
        result.push(...this.flattenParts(p.childNodes as unknown[], part))
      }
    }
    return result
  }

  async getEmailBody(accountId: string, emailUid: number): Promise<string> {
    const conn = this.connections.get(accountId)
    if (!conn || !conn.client.usable) {
      throw new Error('IMAP 未连接')
    }

    try {
      // Decode Quoted-Printable encoding in email body
      // Only decode =3D (encoded =), soft line breaks (=\r\n), and =XX for non-URL content
      // This is safe because =3D is the QP encoding of = and is unambiguous
      const decodeQP = (str: string): string => {
        // Check if content is actually QP-encoded (has =3D which is the QP encoding of =)
        if (!str.includes('=3D') && !str.includes('=3d')) return str
        // Decode QP: remove soft line breaks, decode =XX sequences
        // But preserve URL parameter separators (= followed by non-hex)
        const bytes: number[] = []
        const cleaned = str.replace(/=\r?\n/g, '')
        let i = 0
        while (i < cleaned.length) {
          if (cleaned[i] === '=' && i + 2 < cleaned.length && /^[0-9A-Fa-f]{2}$/.test(cleaned.substring(i + 1, i + 3))) {
            bytes.push(parseInt(cleaned.substring(i + 1, i + 3), 16))
            i += 3
          } else {
            bytes.push(cleaned.charCodeAt(i))
            i++
          }
        }
        return Buffer.from(bytes).toString('utf-8')
      }

      const candidateParts = ['1', '1.1', '1.2', '2', '2.1', '2.2', '3', '3.1']

      let bodyMsg = await conn.client.fetchOne(
        String(emailUid),
        { uid: true, bodyParts: candidateParts },
        { uid: true }
      )

      if (bodyMsg && bodyMsg.bodyParts) {
        for (const part of candidateParts) {
          const content = bodyMsg.bodyParts[part]
          if (content && Buffer.isBuffer(content) && content.length > 100) {
            const rawText = content.toString('utf-8')
            // Check if QP-encoded before decoding
            const isQP = rawText.includes('=3D') || rawText.includes('=3d')
            const text = isQP ? decodeQP(rawText) : rawText
            if (text.includes('<!DOCTYPE') || text.includes('<html') || text.includes('<body') || text.includes('<div') || text.includes('<table')) {
              return text
            }
            if (text.length > 50 && !text.startsWith('%PDF') && !text.startsWith('PK')) {
              return text
            }
          }
        }
      }

      const sourceMsg = await conn.client.fetchOne(
        String(emailUid),
        { uid: true, source: true, envelope: true },
        { uid: true }
      )
      if (sourceMsg && sourceMsg.source) {
        const rawSource = sourceMsg.source.toString('utf-8')
        const htmlMatch = rawSource.match(/<html[\s\S]*?<\/html>/i) || rawSource.match(/<body[\s\S]*?<\/body>/i)
        if (htmlMatch) {
          const isQP = htmlMatch[0].includes('=3D') || htmlMatch[0].includes('=3d')
          const decoded = isQP ? decodeQP(htmlMatch[0]) : htmlMatch[0]
          return decoded
        }
        const headDelim = rawSource.indexOf('\r\n\r\n')
        const bodyStart = headDelim >= 0 ? headDelim + 4 : 0
        const bodyText = rawSource.substring(bodyStart)
        if (bodyText.length > 50) {
          const isQP = bodyText.includes('=3D') || bodyText.includes('=3d')
          const decoded = isQP ? decodeQP(bodyText) : bodyText
          return decoded
        }
      }

      const subject = sourceMsg?.envelope?.subject ?? '(无主题)'
      const fromAddr = sourceMsg?.envelope?.from?.[0]
      const from = fromAddr?.name ?? fromAddr?.address ?? '(未知)'
      const date = sourceMsg?.envelope?.date?.toISOString() ?? ''
      return `主题: ${subject}\n发件人: ${from}\n日期: ${date}\n\n（无法提取邮件正文）`
    } catch (err) {
      throw new Error(`获取邮件正文失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

export const imapService = new ImapService()
