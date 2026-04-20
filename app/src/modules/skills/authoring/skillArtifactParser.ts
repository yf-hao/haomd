import type { ParsedSkillArtifact, SkillArtifact, ValidationError } from './types'

function buildTopLevelError(message: string): ValidationError {
  return {
    file: 'artifact',
    code: 'invalid_artifact',
    message,
  }
}

export function parseSkillArtifact(raw: string): ParsedSkillArtifact {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Skill artifact 不是合法 JSON: ${String(error)}`)
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Skill artifact 顶层必须是 object')
  }

  const obj = parsed as Record<string, unknown>
  const skill = obj.skill
  const markdown = obj.markdown
  const scripts = obj.scripts

  if (!skill || typeof skill !== 'object' || Array.isArray(skill)) {
    throw new Error('Skill artifact 缺少 skill object')
  }
  if (typeof markdown !== 'string') {
    throw new Error('Skill artifact 缺少 markdown string')
  }
  if (!Array.isArray(scripts)) {
    throw new Error('Skill artifact 缺少 scripts array')
  }

  return {
    skill: skill as ParsedSkillArtifact['skill'],
    markdown,
    scripts: scripts as ParsedSkillArtifact['scripts'],
  }
}

export function parsedSkillArtifactToArtifact(parsed: ParsedSkillArtifact): SkillArtifact {
  return {
    skillJson: JSON.stringify(parsed.skill, null, 2),
    skillMarkdown: parsed.markdown,
    scripts: parsed.scripts.map((script) => ({
      path: script.path,
      content: script.content,
    })),
  }
}

export function tryParseSkillArtifact(raw: string): { artifact: SkillArtifact | null; errors: ValidationError[] } {
  try {
    const parsed = parseSkillArtifact(raw)
    return {
      artifact: parsedSkillArtifactToArtifact(parsed),
      errors: [],
    }
  } catch (error) {
    return {
      artifact: null,
      errors: [buildTopLevelError(String(error))],
    }
  }
}
