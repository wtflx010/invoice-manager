import type { Skill, SkillResult, SkillManifest } from './types'
import { skillToOpenAITool, skillToManifest, buildSkillsPrompt } from './types'
import { builtinSkills } from './builtin'

class SkillRegistry {
  private skills: Map<string, Skill> = new Map()
  private enabledNames: Set<string> = new Set()

  constructor() {
    for (const skill of builtinSkills) {
      this.register(skill)
      this.enabledNames.add(skill.name)
    }
  }

  register(skill: Skill): void {
    this.skills.set(skill.name, skill)
  }

  unregister(name: string): void {
    this.skills.delete(name)
    this.enabledNames.delete(name)
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name)
  }

  getAll(): Skill[] {
    return Array.from(this.skills.values())
  }

  getEnabled(): Skill[] {
    return this.getAll().filter(s => this.enabledNames.has(s.name))
  }

  isEnabled(name: string): boolean {
    return this.enabledNames.has(name)
  }

  setEnabled(name: string, enabled: boolean): void {
    if (!this.skills.has(name)) return
    if (enabled) {
      this.enabledNames.add(name)
    } else {
      this.enabledNames.delete(name)
    }
  }

  setEnabledAll(names: string[]): void {
    this.enabledNames = new Set(names.filter(n => this.skills.has(n)))
  }

  async execute(name: string, params: Record<string, unknown>): Promise<SkillResult> {
    const skill = this.skills.get(name)
    if (!skill) {
      return { success: false, error: `未知工具: ${name}` }
    }
    return skill.execute(params)
  }

  getManifests(): SkillManifest[] {
    return this.getEnabled().map(skillToManifest)
  }

  toOpenAITools(): Record<string, unknown>[] {
    return this.getEnabled().map(skillToOpenAITool)
  }

  buildPrompt(): string {
    return buildSkillsPrompt(this.getEnabled())
  }

  buildCompactPrompt(): string {
    return this.getEnabled()
      .map(s => `${s.name}(${Object.keys(s.parameters).filter(k => s.parameters[k].required).join(',')})`)
      .join(', ')
  }
}

export const skillRegistry = new SkillRegistry()