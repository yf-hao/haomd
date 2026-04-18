import type { OpenAIToolDef } from '../ai/domain/types'
import { runSkillScript } from './application/skillsRuntimeService'
import { listSkills, readSkill } from './storage/skillsRepo'
import type { SkillDocument, SkillScript } from './domain/types'

export const SKILLS_SEARCH_TOOL_NAME = 'skills_search'
export const SKILLS_READ_TOOL_NAME = 'skills_read'
export const SKILLS_RUN_TOOL_NAME = 'skills_run'

export const skillsSearchToolSchema: OpenAIToolDef = {
  type: 'function',
  function: {
    name: SKILLS_SEARCH_TOOL_NAME,
    description:
      '搜索当前已启用的 Skills。' +
      '当用户需求可能对应某个预置工作流、Markdown 模板、文本处理或自动化技能时，先调用此工具查找。' +
      '如果用户明确提到某个 skill 名称，也可以先用此工具确认它是否存在以及是否 trusted。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词，可为空，例如“翻译”“总结”“markdown”“格式化”。',
        },
      },
      required: [],
    },
  },
}

export const skillsReadToolSchema: OpenAIToolDef = {
  type: 'function',
  function: {
    name: SKILLS_READ_TOOL_NAME,
    description:
      '读取某个 Skill 的详细 Markdown 说明和脚本摘要。' +
      '当你已经确定了 skillId，需要了解其使用说明、脚本入口和参数约定时调用。' +
      '如果某个 trusted skill 的描述已经足够明确，也可以在读取后直接决定是否执行它。',
    parameters: {
      type: 'object',
      properties: {
        skillId: {
          type: 'string',
          description: 'Skill ID，例如“hello-skill”。',
        },
      },
      required: ['skillId'],
    },
  },
}

export const skillsRunToolSchema: OpenAIToolDef = {
  type: 'function',
  function: {
    name: SKILLS_RUN_TOOL_NAME,
    description:
      '执行某个 Skill 中的脚本。' +
      '调用前应优先通过 skills_search / skills_read 确认 skill 的适用场景和参数。' +
      '仅允许执行已启用且标记为 trusted 的 skill。' +
      '在调用前，必须根据该 skill 的 SKILL.md 和 argsSchema 先整理出结构化参数。' +
      '除非某个 skill 明确要求接收原始文本，否则不要把整句自然语言直接传给脚本。',
    parameters: {
      type: 'object',
      properties: {
        skillId: {
          type: 'string',
          description: 'Skill ID，例如“hello-skill”。',
        },
        scriptId: {
          type: 'string',
          description: '脚本 ID，例如“run”。',
        },
        args: {
          type: 'object',
          description: '传给脚本的结构化 JSON 参数对象。参数应根据该 skill 的说明和 argsSchema 组织，而不是直接传原始自然语言。',
        },
      },
      required: ['skillId', 'scriptId'],
    },
  },
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export type DynamicSkillScriptTool = {
  toolName: string
  skillId: string
  scriptId: string
  tool: OpenAIToolDef
}

const DYNAMIC_SKILL_TOOL_PREFIX = 'skill__'
const MAX_DYNAMIC_SKILL_TOOL_NAME_LENGTH = 64

function sanitizeToolSegment(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  return normalized || 'script'
}

function buildDynamicSkillToolName(skillId: string, scriptId: string): string {
  const skillPart = sanitizeToolSegment(skillId)
  const scriptPart = sanitizeToolSegment(scriptId)
  const baseName = `${DYNAMIC_SKILL_TOOL_PREFIX}${skillPart}__${scriptPart}`
  if (baseName.length <= MAX_DYNAMIC_SKILL_TOOL_NAME_LENGTH) {
    return baseName
  }

  const available = MAX_DYNAMIC_SKILL_TOOL_NAME_LENGTH - DYNAMIC_SKILL_TOOL_PREFIX.length - 2
  const skillBudget = Math.max(12, Math.floor(available * 0.55))
  const scriptBudget = Math.max(8, available - skillBudget)
  const truncatedSkillPart = skillPart.slice(0, skillBudget)
  const truncatedScriptPart = scriptPart.slice(0, scriptBudget)
  return `${DYNAMIC_SKILL_TOOL_PREFIX}${truncatedSkillPart}__${truncatedScriptPart}`.slice(
    0,
    MAX_DYNAMIC_SKILL_TOOL_NAME_LENGTH,
  )
}

function parseArgsSchema(script: SkillScript): unknown {
  if (!script.argsSchema?.trim()) {
    return {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: true,
    }
  }

  try {
    const parsed = JSON.parse(script.argsSchema)
    if (parsed && typeof parsed === 'object') {
      return parsed
    }
  } catch {
    // Fall back to generic object schema when stored argsSchema is invalid JSON.
  }

  return {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: true,
  }
}

function buildDynamicSkillToolDescription(skill: SkillDocument, script: SkillScript): string {
  return (
    `执行 Skill "${skill.name}" 中的脚本 "${script.label}"。` +
    `仅在已阅读 ${skill.id} 的 SKILL.md 后调用。` +
    '参数必须严格遵循该脚本的 argsSchema 和说明，传结构化参数，不要传整句自然语言。'
  )
}

export async function buildDynamicSkillScriptTools(
  readSkillIds: Iterable<string>,
): Promise<DynamicSkillScriptTool[]> {
  const toolDefs: DynamicSkillScriptTool[] = []
  const seenNames = new Set<string>()

  for (const skillId of readSkillIds) {
    const skill = await readSkill(skillId)
    if (!skill || !skill.enabled || !skill.trusted) continue

    for (const script of skill.scripts) {
      if (script.approvalPolicy === 'manual_only') continue

      let toolName = buildDynamicSkillToolName(skill.id, script.id)
      let suffix = 2
      while (seenNames.has(toolName)) {
        toolName = `${buildDynamicSkillToolName(skill.id, script.id)}_${suffix}`
        suffix += 1
      }
      seenNames.add(toolName)

      toolDefs.push({
        toolName,
        skillId: skill.id,
        scriptId: script.id,
        tool: {
          type: 'function',
          function: {
            name: toolName,
            description: buildDynamicSkillToolDescription(skill, script),
            parameters: parseArgsSchema(script),
          },
        },
      })
    }
  }

  return toolDefs
}

export async function executeSkillsSearch(args: { query?: string }): Promise<string> {
  void normalizeText(args.query)
  const skills = (await listSkills())
    .filter((skill) => skill.enabled)
    .sort((left, right) => left.name.localeCompare(right.name))

  return JSON.stringify(
    skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description ?? '',
      trusted: skill.trusted,
      scriptCount: skill.scriptCount,
      runnable: skill.trusted,
    })),
    null,
    2,
  )
}

export async function executeSkillsRead(
  args: { skillId?: string },
  readSkillIds?: Set<string>,
): Promise<string> {
  const skillId = args.skillId?.trim() ?? ''
  if (!skillId) {
    return '⚠️ 未提供 skillId。'
  }

  const skill = await readSkill(skillId)
  if (!skill || !skill.enabled) {
    return `⚠️ 未找到已启用的 Skill：${skillId}`
  }
  readSkillIds?.add(skill.id)

  return JSON.stringify(
    {
      id: skill.id,
      name: skill.name,
      description: skill.description ?? '',
      trusted: skill.trusted,
      markdown: skill.markdown,
      executable: skill.trusted,
      scripts: skill.scripts.map((script) => ({
        id: script.id,
        label: script.label,
        toolName: buildDynamicSkillToolName(skill.id, script.id),
        runtime: script.runtime,
        entry: script.entry,
        approvalPolicy: script.approvalPolicy,
        argsSchema: script.argsSchema ?? '',
        runnable: script.approvalPolicy !== 'manual_only' && skill.trusted,
      })),
    },
    null,
    2,
  )
}

export async function executeSkillsRun(args: {
  skillId?: string
  scriptId?: string
  args?: unknown
  [key: string]: unknown
}, readSkillIds?: Set<string>): Promise<string> {
  const skillId = args.skillId?.trim() ?? ''
  const scriptId = args.scriptId?.trim() ?? ''

  if (!skillId || !scriptId) {
    return '⚠️ 缺少 skillId 或 scriptId。'
  }

  if (!readSkillIds?.has(skillId)) {
    return `⚠️ 执行 ${skillId}/${scriptId} 前，必须先调用 skills_read 读取该 Skill 的说明。`
  }

  const skill = await readSkill(skillId)
  if (!skill || !skill.enabled) {
    return `⚠️ 未找到已启用的 Skill：${skillId}`
  }
  if (!skill.trusted) {
    return `⚠️ Skill ${skillId} 尚未标记为 trusted，已拒绝执行脚本。`
  }

  const script = skill.scripts.find((item) => item.id === scriptId)
  if (!script) {
    return `⚠️ Skill ${skillId} 中不存在脚本：${scriptId}`
  }
  if (script.approvalPolicy === 'manual_only') {
    return `⚠️ 脚本 ${scriptId} 仅允许手动执行，当前自动工具调用已拒绝。`
  }

  const payload = args.args && typeof args.args === 'object'
    ? args.args
    : Object.fromEntries(
      Object.entries(args).filter(([key]) => key !== 'skillId' && key !== 'scriptId' && key !== 'args'),
    )
  const result = await runSkillScript(skillId, scriptId, payload)
  return JSON.stringify(result, null, 2)
}
