import { memoryManager } from '../memory/memoryManager'

interface GraphNode {
  id: string
  type: 'entity' | 'concept' | 'memory'
  label: string
  properties: Record<string, unknown>
  embedding: number[]
}

interface GraphEdge {
  id: string
  sourceId: string
  targetId: string
  type: string
  weight: number
  properties: Record<string, unknown>
}

interface KnowledgeGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

function generateGraphId(): string {
  return `kg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function simpleHash(text: string): number {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function simpleEmbed(text: string, dims = 64): number[] {
  const words = text.toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, ' ').split(/\s+/).filter(Boolean)
  const vec = new Array(dims).fill(0)
  for (const word of words) {
    const idx = simpleHash(word) % dims
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

class KnowledgeGraphClient {
  private graph: KnowledgeGraph = { nodes: [], edges: [] }
  private connected = false
  private serverUrl = ''

  async connect(serverUrl?: string): Promise<boolean> {
    this.serverUrl = serverUrl || 'local'
    this.connected = true

    await this.loadLocalGraph()
    return true
  }

  async disconnect(): Promise<void> {
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected
  }

  private async loadLocalGraph(): Promise<void> {
    const memories = await memoryManager.searchMemories('')
    for (const mem of memories) {
      this.addNode({
        id: `node-${mem.id}`,
        type: 'memory',
        label: mem.key,
        properties: { content: mem.content, importance: mem.importance },
        embedding: simpleEmbed(mem.key + ' ' + mem.content)
      })
    }
  }

  addNode(node: Omit<GraphNode, 'id'> & { id?: string }): GraphNode {
    const newNode: GraphNode = {
      id: node.id || generateGraphId(),
      type: node.type,
      label: node.label,
      properties: node.properties,
      embedding: node.embedding
    }
    const existing = this.graph.nodes.findIndex(n => n.id === newNode.id)
    if (existing >= 0) {
      this.graph.nodes[existing] = newNode
    } else {
      this.graph.nodes.push(newNode)
    }
    return newNode
  }

  addEdge(edge: Omit<GraphEdge, 'id'> & { id?: string }): GraphEdge {
    const newEdge: GraphEdge = {
      id: edge.id || generateGraphId(),
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      type: edge.type,
      weight: edge.weight,
      properties: edge.properties
    }
    const existing = this.graph.edges.findIndex(e => e.sourceId === newEdge.sourceId && e.targetId === newEdge.targetId && e.type === newEdge.type)
    if (existing >= 0) {
      this.graph.edges[existing] = newEdge
    } else {
      this.graph.edges.push(newEdge)
    }
    return newEdge
  }

  removeNode(nodeId: string): void {
    this.graph.nodes = this.graph.nodes.filter(n => n.id !== nodeId)
    this.graph.edges = this.graph.edges.filter(e => e.sourceId !== nodeId && e.targetId !== nodeId)
  }

  removeEdge(edgeId: string): void {
    this.graph.edges = this.graph.edges.filter(e => e.id !== edgeId)
  }

  getNode(nodeId: string): GraphNode | undefined {
    return this.graph.nodes.find(n => n.id === nodeId)
  }

  getNeighbors(nodeId: string, maxDepth = 1): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const visited = new Set<string>()
    const resultNodes: GraphNode[] = []
    const resultEdges: GraphEdge[] = []
    const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId, depth: 0 }]
    visited.add(nodeId)

    while (queue.length > 0) {
      const current = queue.shift()!
      const node = this.getNode(current.nodeId)
      if (node) resultNodes.push(node)

      if (current.depth < maxDepth) {
        const connected = this.graph.edges.filter(e => e.sourceId === current.nodeId || e.targetId === current.nodeId)
        for (const edge of connected) {
          resultEdges.push(edge)
          const neighborId = edge.sourceId === current.nodeId ? edge.targetId : edge.sourceId
          if (!visited.has(neighborId)) {
            visited.add(neighborId)
            queue.push({ nodeId: neighborId, depth: current.depth + 1 })
          }
        }
      }
    }

    return { nodes: resultNodes, edges: resultEdges }
  }

  searchNodes(query: string, topK = 10): Array<{ node: GraphNode; score: number }> {
    const queryEmbedding = simpleEmbed(query)
    return this.graph.nodes
      .map(node => ({
        node,
        score: cosineSimilarity(queryEmbedding, node.embedding)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
  }

  async buildContext(query: string): Promise<string> {
    const results = this.searchNodes(query, 5)
    if (results.length === 0) return ''

    const contextParts: string[] = []
    for (const { node, score } of results) {
      if (score > 0.1) {
        const neighbors = this.getNeighbors(node.id, 1)
        const relatedLabels = neighbors.nodes
          .filter(n => n.id !== node.id)
          .map(n => n.label)
          .join(', ')
        const related = relatedLabels ? ` [关联: ${relatedLabels}]` : ''
        contextParts.push(`- ${node.label}: ${node.properties.content || ''}${related}`)
      }
    }

    return contextParts.length > 0 ? `知识图谱上下文:\n${contextParts.join('\n')}` : ''
  }

  createEntityNode(label: string, properties: Record<string, unknown> = {}): GraphNode {
    return this.addNode({
      type: 'entity',
      label,
      properties,
      embedding: simpleEmbed(label + ' ' + JSON.stringify(properties))
    })
  }

  createConceptNode(label: string, properties: Record<string, unknown> = {}): GraphNode {
    return this.addNode({
      type: 'concept',
      label,
      properties,
      embedding: simpleEmbed(label)
    })
  }

  linkNodes(sourceId: string, targetId: string, type: string, weight = 1): GraphEdge {
    return this.addEdge({
      sourceId,
      targetId,
      type,
      weight,
      properties: {}
    })
  }

  getGraph(): KnowledgeGraph {
    return this.graph
  }

  getStats(): { nodeCount: number; edgeCount: number; entityCount: number; conceptCount: number; memoryCount: number } {
    return {
      nodeCount: this.graph.nodes.length,
      edgeCount: this.graph.edges.length,
      entityCount: this.graph.nodes.filter(n => n.type === 'entity').length,
      conceptCount: this.graph.nodes.filter(n => n.type === 'concept').length,
      memoryCount: this.graph.nodes.filter(n => n.type === 'memory').length
    }
  }
}

export const knowledgeGraphClient = new KnowledgeGraphClient()
export type { GraphNode, GraphEdge, KnowledgeGraph }