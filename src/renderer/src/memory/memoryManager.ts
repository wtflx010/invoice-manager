interface MemoryEntry {
  id: string
  conversationId: string
  key: string
  content: string
  embedding: number[]
  importance: number
  createdAt: string
}

interface ConversationSummary {
  id: string
  title: string
  messageCount: number
  lastMessage: string
  createdAt: string
  updatedAt: string
}

function generateId(): string {
  return `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function simpleEmbed(text: string, dims = 64): number[] {
  const words = text.toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, ' ').split(/\s+/).filter(Boolean)
  const vec = new Array(dims).fill(0)
  for (let i = 0; i < words.length; i++) {
    let hash = 0
    for (let j = 0; j < words[i].length; j++) {
      hash = ((hash << 5) - hash) + words[i].charCodeAt(j)
      hash |= 0
    }
    const idx = Math.abs(hash) % dims
    vec[idx] += 1
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1
  return vec.map(v => v / norm)
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1)
}

function extractKeywords(text: string): string[] {
  const cleaned = text.toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, ' ')
  const words = cleaned.split(/\s+/).filter(w => w.length > 1)
  const freq: Record<string, number> = {}
  for (const w of words) {
    freq[w] = (freq[w] || 0) + 1
  }
  return Object.entries(freq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([w]) => w)
}

class MemoryManager {
  private conversationId: string | null = null
  private initialized = false

  async init(convId?: string): Promise<void> {
    if (convId) {
      this.conversationId = convId
    } else {
      this.conversationId = `conv-${Date.now()}`
    }
    if (window.electronAPI?.memory) {
      await window.electronAPI.memory.createConversation(this.conversationId, '新对话')
    }
    this.initialized = true
  }

  getConversationId(): string | null {
    return this.conversationId
  }

  setConversationId(id: string): void {
    this.conversationId = id
  }

  async saveMessage(role: string, content: string, images?: string[]): Promise<void> {
    if (!this.conversationId || !window.electronAPI?.memory) return
    const msgId = generateId()
    await window.electronAPI.memory.saveMessage({
      id: msgId,
      conversationId: this.conversationId,
      role,
      content,
      images: images || [],
      createdAt: new Date().toISOString()
    })
    await window.electronAPI.memory.updateConversation(this.conversationId, {
      updatedAt: new Date().toISOString()
    })
  }

  async saveMemory(key: string, content: string, importance = 1): Promise<void> {
    if (!this.conversationId || !window.electronAPI?.memory) return
    const embedding = simpleEmbed(key + ' ' + content)
    await window.electronAPI.memory.saveMemory({
      id: generateId(),
      conversationId: this.conversationId,
      key,
      content,
      embedding: JSON.stringify(embedding),
      importance,
      createdAt: new Date().toISOString()
    })
  }

  async retrieveContext(query: string, topK = 5): Promise<string> {
    if (!window.electronAPI?.memory) return ''
    const queryEmbedding = simpleEmbed(query)

    const convMemories = this.conversationId
      ? await window.electronAPI.memory.getMemoriesByConversation(this.conversationId)
      : []

    const allMemories = await window.electronAPI.memory.getAllMemories()

    const scored = [...convMemories, ...allMemories]
      .filter((m, i, arr) => i === arr.findIndex(x => x.id === m.id))
      .map(m => {
        let embedding: number[] = []
        try {
          embedding = typeof m.embedding === 'string' ? JSON.parse(m.embedding as string) : (m.embedding as number[])
        } catch { embedding = [] }
        const score = embedding.length > 0
          ? cosineSimilarity(queryEmbedding, embedding) * (m.importance as number || 1)
          : 0
        return { ...m, score }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)

    if (scored.length === 0) return ''
    return scored
      .map(m => `[记忆] ${m.key}: ${m.content}`)
      .join('\n')
  }

  async getConversationHistory(): Promise<string> {
    if (!this.conversationId || !window.electronAPI?.memory) return ''
    const messages = await window.electronAPI.memory.getMessages(this.conversationId)
    if (!messages || messages.length === 0) return ''
    const recent = messages.slice(-10)
    return recent
      .map(m => `${m.role === 'user' ? '用户' : '助手'}: ${String(m.content).slice(0, 200)}`)
      .join('\n')
  }

  async autoExtractMemories(userMsg: string, assistantMsg: string): Promise<void> {
    if (!window.electronAPI?.memory) return
    const keywords = extractKeywords(userMsg)
    for (const kw of keywords.slice(0, 3)) {
      await this.saveMemory(kw, `用户询问了关于"${kw}"的问题`, 2)
    }
    if (assistantMsg && assistantMsg.length > 100) {
      const summary = assistantMsg.slice(0, 200)
      await this.saveMemory(`对话摘要`, summary, 1)
    }
  }

  async getConversations(): Promise<ConversationSummary[]> {
    if (!window.electronAPI?.memory) return []
    const convs = await window.electronAPI.memory.getConversations()
    return (convs || []).map(c => ({
      id: c.id as string,
      title: c.title as string,
      messageCount: c.messageCount as number || 0,
      lastMessage: c.lastMessage as string || '',
      createdAt: c.createdAt as string,
      updatedAt: c.updatedAt as string
    }))
  }

  async deleteConversation(id: string): Promise<void> {
    if (!window.electronAPI?.memory) return
    await window.electronAPI.memory.deleteConversation(id)
    if (this.conversationId === id) {
      this.conversationId = null
    }
  }

  async searchMemories(query: string): Promise<MemoryEntry[]> {
    if (!window.electronAPI?.memory) return []
    const results = await window.electronAPI.memory.searchMemories(query)
    return (results || []).map(r => ({
      id: r.id as string,
      conversationId: r.conversationId as string,
      key: r.key as string,
      content: r.content as string,
      embedding: typeof r.embedding === 'string' ? JSON.parse(r.embedding as string) : (r.embedding as number[]),
      importance: r.importance as number,
      createdAt: r.createdAt as string
    }))
  }
}

export const memoryManager = new MemoryManager()
export { simpleEmbed, cosineSimilarity, extractKeywords }