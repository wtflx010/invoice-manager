import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'

class AppDatabase {
  private db: Database.Database
  private static DB_VERSION = 3

  constructor() {
    const userDataPath = app.getPath('userData')
    const dataDir = join(userDataPath, 'data')
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true })
    }
    const dbPath = join(dataDir, 'invoices.db')
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.initTables()
    this.runMigrations()
    this.createIndexes()
    this.createMemoryIndexes()
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        invoice_code TEXT,
        invoice_number TEXT,
        invoice_type TEXT,
        category TEXT,
        sub_category TEXT,
        status TEXT DEFAULT 'pending',
        issue_date TEXT,
        seller_name TEXT,
        seller_tax_number TEXT,
        buyer_name TEXT,
        buyer_tax_number TEXT,
        amount_without_tax REAL,
        tax_amount REAL,
        total_amount REAL,
        file_path TEXT,
        file_name TEXT,
        file_format TEXT,
        source TEXT,
        tags TEXT DEFAULT '[]',
        notes TEXT,
        created_at TEXT,
        updated_at TEXT
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS email_accounts (
        id TEXT PRIMARY KEY,
        name TEXT,
        email TEXT,
        provider TEXT,
        imap_host TEXT,
        imap_port INTEGER,
        smtp_host TEXT,
        smtp_port INTEGER,
        use_tls INTEGER DEFAULT 1,
        encrypted_password TEXT,
        created_at TEXT
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS db_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT,
        created_at TEXT,
        updated_at TEXT
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT,
        role TEXT,
        content TEXT,
        images TEXT,
        tool_calls TEXT,
        created_at TEXT,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        conversation_id TEXT,
        key TEXT,
        content TEXT,
        embedding TEXT,
        importance INTEGER DEFAULT 1,
        created_at TEXT,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS skill_configs (
        skill_name TEXT PRIMARY KEY,
        enabled INTEGER DEFAULT 1,
        config TEXT DEFAULT '{}'
      )
    `)
  }

  private createIndexes(): void {
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices(created_at DESC)`)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_invoices_code_number ON invoices(invoice_code, invoice_number)`)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_email_accounts_created_at ON email_accounts(created_at DESC)`)
  }

  private runMigrations(): void {
    const currentVersion = this.getMeta('version') || '1'
    const version = parseInt(currentVersion, 10)

    if (isNaN(version)) {
      this.setMeta('version', String(AppDatabase.DB_VERSION))
      return
    }

    if (version < 2) {
      try {
        this.db.exec(`ALTER TABLE invoices ADD COLUMN check_number TEXT`)
      } catch { /* column may already exist */ }
      try {
        this.db.exec(`ALTER TABLE invoices ADD COLUMN check_date TEXT`)
      } catch { /* column may already exist */ }
    }

    if (version < 3) {
      try {
        this.db.exec(`CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT, created_at TEXT, updated_at TEXT)`)
      } catch { /* table may already exist */ }
      try {
        this.db.exec(`CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT, role TEXT, content TEXT, images TEXT, tool_calls TEXT, created_at TEXT)`)
      } catch { /* table may already exist */ }
      try {
        this.db.exec(`CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, conversation_id TEXT, key TEXT, content TEXT, embedding TEXT, importance INTEGER DEFAULT 1, created_at TEXT)`)
      } catch { /* table may already exist */ }
      try {
        this.db.exec(`CREATE TABLE IF NOT EXISTS skill_configs (skill_name TEXT PRIMARY KEY, enabled INTEGER DEFAULT 1, config TEXT DEFAULT '{}')`)
      } catch { /* table may already exist */ }
    }

    this.setMeta('version', String(AppDatabase.DB_VERSION))
  }

  private getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM db_meta WHERE key = ?').get(key) as { value: string } | undefined
    return row ? row.value : null
  }

  private setMeta(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO db_meta (key, value) VALUES (?, ?)').run(key, value)
  }

  getAllInvoices() {
    const rows = this.db.prepare('SELECT * FROM invoices ORDER BY created_at DESC').all() as Record<string, unknown>[]
    return rows.map((row) => this.toCamelCase(row))
  }

  getInvoiceById(id: string) {
    const row = this.db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? this.toCamelCase(row) : null
  }

  insertInvoice(invoice: Record<string, unknown>) {
    const data = this.toSnakeCase(invoice)
    const defaults: Record<string, unknown> = {
      sub_category: data.sub_category ?? '',
      check_number: data.check_number ?? '',
      check_date: data.check_date ?? '',
      notes: data.notes ?? '',
      tags: data.tags ?? '[]'
    }
    const merged = { ...data, ...defaults }
    this.db.prepare(`
      INSERT OR REPLACE INTO invoices (
        id, invoice_code, invoice_number, invoice_type, category, sub_category,
        status, issue_date, seller_name, seller_tax_number, buyer_name,
        buyer_tax_number, amount_without_tax, tax_amount, total_amount,
        file_path, file_name, file_format, source, tags, notes,
        check_number, check_date, created_at, updated_at
      ) VALUES (
        @id, @invoice_code, @invoice_number, @invoice_type, @category, @sub_category,
        @status, @issue_date, @seller_name, @seller_tax_number, @buyer_name,
        @buyer_tax_number, @amount_without_tax, @tax_amount, @total_amount,
        @file_path, @file_name, @file_format, @source, @tags, @notes,
        @check_number, @check_date, @created_at, @updated_at
      )
    `).run(merged)
    return invoice
  }

  insertInvoices(invoices: Record<string, unknown>[]) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO invoices (
        id, invoice_code, invoice_number, invoice_type, category, sub_category,
        status, issue_date, seller_name, seller_tax_number, buyer_name,
        buyer_tax_number, amount_without_tax, tax_amount, total_amount,
        file_path, file_name, file_format, source, tags, notes,
        check_number, check_date, created_at, updated_at
      ) VALUES (
        @id, @invoice_code, @invoice_number, @invoice_type, @category, @sub_category,
        @status, @issue_date, @seller_name, @seller_tax_number, @buyer_name,
        @buyer_tax_number, @amount_without_tax, @tax_amount, @total_amount,
        @file_path, @file_name, @file_format, @source, @tags, @notes,
        @check_number, @check_date, @created_at, @updated_at
      )
    `)
    const insertMany = this.db.transaction((items: Record<string, unknown>[]) => {
      for (const invoice of items) {
        const data = this.toSnakeCase(invoice)
        const defaults: Record<string, unknown> = {
          sub_category: data.sub_category ?? '',
          check_number: data.check_number ?? '',
          check_date: data.check_date ?? '',
          notes: data.notes ?? '',
          tags: data.tags ?? '[]'
        }
        stmt.run({ ...data, ...defaults })
      }
    })
    insertMany(invoices)
  }

  updateInvoice(id: string, updates: Record<string, unknown>) {
    const snakeUpdates: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(updates)) {
      const snakeKey = key.replace(/[A-Z]/g, (m: string) => '_' + m.toLowerCase())
      if (snakeKey === 'tags' && Array.isArray(value)) {
        snakeUpdates[snakeKey] = JSON.stringify(value)
      } else {
        snakeUpdates[snakeKey] = value
      }
    }
    snakeUpdates['updated_at'] = new Date().toISOString()
    snakeUpdates['id'] = id

    const allowedColumns = new Set([
      'invoice_code', 'invoice_number', 'invoice_type', 'category', 'sub_category',
      'status', 'issue_date', 'seller_name', 'seller_tax_number', 'buyer_name',
      'buyer_tax_number', 'amount_without_tax', 'tax_amount', 'total_amount',
      'file_path', 'file_name', 'file_format', 'source', 'tags', 'notes',
      'check_number', 'check_date', 'updated_at'
    ])

    const setClauses = Object.keys(snakeUpdates)
      .filter(k => k !== 'id' && allowedColumns.has(k))
      .map(k => `${k} = @${k}`)

    if (setClauses.length > 0) {
      this.db.prepare(`UPDATE invoices SET ${setClauses.join(', ')} WHERE id = @id`).run(snakeUpdates)
    }
  }

  deleteInvoice(id: string) {
    // 先获取发票信息以便删除文件
    let invoice: { file_path: string } | undefined
    try {
      invoice = this.db.prepare('SELECT file_path FROM invoices WHERE id = ?').get(id) as { file_path: string } | undefined
    } catch {
      // column might not exist in older databases
    }
    if (invoice?.file_path) {
      try {
        const { existsSync, unlinkSync } = require('fs')
        const filePath = invoice.file_path
        if (existsSync(filePath)) {
          unlinkSync(filePath)
        }
      } catch {
        // ignore file deletion errors
      }
    }
    this.db.prepare('DELETE FROM invoices WHERE id = ?').run(id)
  }

  clearAllInvoices() {
    this.db.prepare('DELETE FROM invoices').run()
  }

  getSetting(key: string) {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    return row ? row.value : null
  }

  setSetting(key: string, value: string) {
    this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
  }

  getAllSettings() {
    const rows = this.db.prepare('SELECT * FROM settings').all() as { key: string; value: string }[]
    const obj: Record<string, string> = {}
    for (const row of rows) {
      obj[row.key] = row.value
    }
    return obj
  }

  getEmailAccounts() {
    const rows = this.db.prepare('SELECT * FROM email_accounts ORDER BY created_at DESC').all() as Record<string, unknown>[]
    return rows.map((row) => {
      const result = this.toCamelCase(row)
      delete result.encryptedPassword
      return result
    })
  }

  getEmailAccountWithPassword(id: string) {
    const row = this.db.prepare('SELECT * FROM email_accounts WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? this.toCamelCase(row) : null
  }

  insertEmailAccount(account: Record<string, unknown>) {
    const data = this.toSnakeCase(account)
    this.db.prepare(`
      INSERT OR REPLACE INTO email_accounts (
        id, name, email, provider, imap_host, imap_port,
        smtp_host, smtp_port, use_tls, encrypted_password, created_at
      ) VALUES (
        @id, @name, @email, @provider, @imap_host, @imap_port,
        @smtp_host, @smtp_port, @use_tls, @encrypted_password, @created_at
      )
    `).run(data)
    return account
  }

  deleteEmailAccount(id: string) {
    this.db.prepare('DELETE FROM email_accounts WHERE id = ?').run(id)
  }

  checkDuplicate(invoiceCode: string, invoiceNumber: string, sellerName?: string): boolean {
    if (invoiceCode && invoiceNumber) {
      const row = this.db.prepare(
        'SELECT id FROM invoices WHERE invoice_code = ? AND invoice_number = ?'
      ).get(invoiceCode, invoiceNumber)
      return !!row
    }
    if (invoiceNumber) {
      if (sellerName) {
        const row = this.db.prepare(
          'SELECT id FROM invoices WHERE invoice_number = ? AND seller_name = ?'
        ).get(invoiceNumber, sellerName)
        return !!row
      }
      const row = this.db.prepare(
        'SELECT id FROM invoices WHERE invoice_number = ?'
      ).get(invoiceNumber)
      return !!row
    }
    if (invoiceCode) {
      const row = this.db.prepare(
        'SELECT id FROM invoices WHERE invoice_code = ?'
      ).get(invoiceCode)
      return !!row
    }
    return false
  }

  close() {
    this.db.close()
  }

  createConversation(id: string, title: string): void {
    const now = new Date().toISOString()
    this.db.prepare(
      'INSERT OR REPLACE INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)'
    ).run(id, title, now, now)
  }

  getConversation(id: string): Record<string, unknown> | null {
    const row = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? this.toCamelCase(row) : null
  }

  getAllConversations(): Record<string, unknown>[] {
    const rows = this.db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all() as Record<string, unknown>[]
    return rows.map(row => this.toCamelCase(row))
  }

  updateConversation(id: string, updates: Record<string, unknown>): void {
    const snake: Record<string, unknown> = { id, updated_at: new Date().toISOString() }
    if (updates.title !== undefined) snake.title = updates.title
    const setClauses = Object.keys(snake).filter(k => k !== 'id').map(k => `${k} = @${k}`)
    this.db.prepare(`UPDATE conversations SET ${setClauses.join(', ')} WHERE id = @id`).run(snake)
  }

  deleteConversation(id: string): void {
    this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
  }

  insertMessage(msg: Record<string, unknown>): void {
    const data = this.toSnakeCase(msg)
    const defaults = { images: data.images ?? '[]', tool_calls: data.tool_calls ?? '[]' }
    const merged = { ...data, ...defaults }
    this.db.prepare(
      `INSERT OR REPLACE INTO messages (id, conversation_id, role, content, images, tool_calls, created_at)
       VALUES (@id, @conversation_id, @role, @content, @images, @tool_calls, @created_at)`
    ).run(merged)
  }

  getMessages(conversationId: string): Record<string, unknown>[] {
    const rows = this.db.prepare(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
    ).all(conversationId) as Record<string, unknown>[]
    return rows.map(row => this.toCamelCase(row))
  }

  deleteMessages(conversationId: string): void {
    this.db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId)
  }

  insertMemory(memory: Record<string, unknown>): void {
    const data = this.toSnakeCase(memory)
    this.db.prepare(
      `INSERT OR REPLACE INTO memories (id, conversation_id, key, content, embedding, importance, created_at)
       VALUES (@id, @conversation_id, @key, @content, @embedding, @importance, @created_at)`
    ).run(data)
  }

  getMemoriesByConversation(conversationId: string): Record<string, unknown>[] {
    const rows = this.db.prepare(
      'SELECT * FROM memories WHERE conversation_id = ? ORDER BY importance DESC, created_at DESC'
    ).all(conversationId) as Record<string, unknown>[]
    return rows.map(row => this.toCamelCase(row))
  }

  getAllMemories(): Record<string, unknown>[] {
    const rows = this.db.prepare(
      'SELECT * FROM memories ORDER BY importance DESC, created_at DESC LIMIT 500'
    ).all() as Record<string, unknown>[]
    return rows.map(row => this.toCamelCase(row))
  }

  searchMemoriesByKey(keyword: string): Record<string, unknown>[] {
    const rows = this.db.prepare(
      "SELECT * FROM memories WHERE key LIKE ? OR content LIKE ? ORDER BY importance DESC LIMIT 50"
    ).all(`%${keyword}%`, `%${keyword}%`) as Record<string, unknown>[]
    return rows.map(row => this.toCamelCase(row))
  }

  deleteMemory(id: string): void {
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(id)
  }

  deleteMemoriesByConversation(conversationId: string): void {
    this.db.prepare('DELETE FROM memories WHERE conversation_id = ?').run(conversationId)
  }

  getSkillConfigs(): Record<string, unknown>[] {
    const rows = this.db.prepare('SELECT * FROM skill_configs').all() as Record<string, unknown>[]
    return rows.map(row => this.toCamelCase(row))
  }

  setSkillConfig(skillName: string, enabled: boolean, config: Record<string, unknown> = {}): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO skill_configs (skill_name, enabled, config) VALUES (?, ?, ?)'
    ).run(skillName, enabled ? 1 : 0, JSON.stringify(config))
  }

  getSkillConfig(skillName: string): Record<string, unknown> | null {
    const row = this.db.prepare('SELECT * FROM skill_configs WHERE skill_name = ?').get(skillName) as Record<string, unknown> | undefined
    if (!row) return null
    const result = this.toCamelCase(row)
    try {
      result.config = typeof result.config === 'string' ? JSON.parse(result.config as string) : result.config
    } catch {
      result.config = {}
    }
    return result
  }

  setSkillConfigs(configs: Array<{ skillName: string; enabled: boolean; config?: Record<string, unknown> }>): void {
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO skill_configs (skill_name, enabled, config) VALUES (?, ?, ?)'
    )
    const insertMany = this.db.transaction((items: typeof configs) => {
      for (const c of items) {
        stmt.run(c.skillName, c.enabled ? 1 : 0, JSON.stringify(c.config || {}))
      }
    })
    insertMany(configs)
  }

  createMemoryIndexes(): void {
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_conversation ON memories(conversation_id)`)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_key ON memories(key)`)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)`)
  }

  private toCamelCase(row: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) {
      const camelKey = key.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase())
      if (camelKey === 'tags' && typeof value === 'string') {
        try {
          result[camelKey] = JSON.parse(value || '[]')
        } catch {
          result[camelKey] = []
        }
      } else {
        result[camelKey] = value
      }
    }
    return result
  }

  private toSnakeCase(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      const snakeKey = key.replace(/[A-Z]/g, (m: string) => '_' + m.toLowerCase())
      if (value === undefined) continue
      if (typeof value === 'boolean') {
        result[snakeKey] = value ? 1 : 0
      } else if (snakeKey === 'tags' && Array.isArray(value)) {
        result[snakeKey] = JSON.stringify(value)
      } else if (value !== null && typeof value === 'object' && !Buffer.isBuffer(value)) {
        result[snakeKey] = JSON.stringify(value)
      } else {
        result[snakeKey] = value
      }
    }
    return result
  }
}

let database: AppDatabase | null = null

export function getDatabase(): AppDatabase {
  if (!database) {
    database = new AppDatabase()
  }
  return database
}