import { skillRegistry } from '../skills/registry'
import type { SkillParamDef } from '../skills/types'

export const toolSkillMap: Record<string, string> = {
  web_search: 'web_search',
  recognize_pdf: 'pdf_recognize',
  recognize_image: 'image_recognize'
}

export interface AgentTool {
  name: string
  description: string
  parameters: Record<
    string,
    {
      type: string
      description: string
      required?: boolean
      enum?: string[]
    }
  >
}

function paramDefToAgentParam(def: SkillParamDef): {
  type: string
  description: string
  required?: boolean
  enum?: string[]
} {
  return {
    type: def.type,
    description: def.description,
    required: def.required,
    enum: def.enum
  }
}

export const agentTools: AgentTool[] = skillRegistry.getEnabled().map(skill => ({
  name: skill.name,
  description: skill.description,
  parameters: Object.fromEntries(
    Object.entries(skill.parameters).map(([key, def]) => [key, paramDefToAgentParam(def)])
  )
}))

export function refreshAgentTools(): AgentTool[] {
  const enabled = skillRegistry.getEnabled()
  return enabled.map(skill => ({
    name: skill.name,
    description: skill.description,
    parameters: Object.fromEntries(
      Object.entries(skill.parameters).map(([key, def]) => [key, paramDefToAgentParam(def)])
    )
  }))
}

export function toOpenAITools(): Array<Record<string, unknown>> {
  return skillRegistry.toOpenAITools()
}