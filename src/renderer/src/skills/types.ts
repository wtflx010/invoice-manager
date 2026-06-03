import type { InvoiceCategory } from '../types/invoice'

export interface SkillParamDef {
  type: 'string' | 'number'
  description: string
  required?: boolean
  enum?: string[]
}

export interface SkillDefinition {
  name: string
  description: string
  category: 'invoice_query' | 'invoice_write' | 'statistics' | 'utility'
  parameters: Record<string, SkillParamDef>
  enabledByDefault: boolean
}

export interface Skill extends SkillDefinition {
  execute: (params: Record<string, unknown>) => Promise<SkillResult>
}

export interface SkillResult {
  success: boolean
  data?: unknown
  error?: string
  message?: string
}

export interface SkillManifest {
  name: string
  description: string
  category: string
  parameters: Record<string, SkillParamDef>
}

export function skillToManifest(skill: Skill): SkillManifest {
  return {
    name: skill.name,
    description: skill.description,
    category: skill.category,
    parameters: skill.parameters
  }
}

export function skillToOpenAITool(skill: Skill): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [key, param] of Object.entries(skill.parameters)) {
    const prop: Record<string, unknown> = { type: param.type, description: param.description }
    if (param.enum) prop.enum = param.enum
    properties[key] = prop
    if (param.required) required.push(key)
  }
  return {
    type: 'function',
    function: {
      name: skill.name,
      description: skill.description,
      parameters: {
        type: 'object',
        properties,
        required: required.length > 0 ? required : undefined
      }
    }
  }
}

export function buildSkillsPrompt(skills: Skill[]): string {
  return skills.map(s => {
    const params = Object.entries(s.parameters)
      .map(([k, v]) => `    - ${k}: ${v.type}${v.required ? ' (必填)' : ' (可选)'} - ${v.description}${v.enum ? ` [可选值: ${v.enum.join('/')}]` : ''}`)
      .join('\n')
    return `**${s.name}**: ${s.description}\n${params ? '参数:\n' + params : '无参数'}`
  }).join('\n\n')
}