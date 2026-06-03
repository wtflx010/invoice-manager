import { skillRegistry } from '../skills/registry'

export interface ToolResult {
  success: boolean
  data?: unknown
  error?: string
  message?: string
}

export async function executeTool(
  toolName: string,
  params: Record<string, unknown>
): Promise<ToolResult> {
  return skillRegistry.execute(toolName, params)
}

export function buildToolsDescription(): string {
  return skillRegistry.buildCompactPrompt()
}

export function getOpenAITools(): Record<string, unknown>[] {
  return skillRegistry.toOpenAITools()
}