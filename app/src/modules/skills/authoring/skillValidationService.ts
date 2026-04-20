import type { ParsedSkillArtifact, SkillArtifact, SkillValidationResult, ValidationError } from './types'
import { parseSkillArtifact } from './skillArtifactParser'
import { validateSkillJson } from './validators/skillJsonValidator'
import { validateSkillMarkdown } from './validators/skillMarkdownValidator'
import { validateSkillScript } from './validators/skillScriptValidator'

function parseSkillJsonObject(skillJsonText: string): ParsedSkillArtifact['skill'] | null {
  try {
    return JSON.parse(skillJsonText) as ParsedSkillArtifact['skill']
  } catch {
    return null
  }
}

function validateArtifactConsistency(artifact: SkillArtifact): ValidationError[] {
  const errors: ValidationError[] = []
  const skill = parseSkillJsonObject(artifact.skillJson)
  if (!skill) return errors

  const scriptPathMap = new Set(artifact.scripts.map((script) => script.path))
  for (const script of skill.scripts ?? []) {
    if (!scriptPathMap.has(script.entry)) {
      errors.push({
        file: 'skill.json',
        code: 'missing_script_file',
        path: script.entry,
        message: `entry 指向的脚本文件不存在: ${script.entry}`,
      })
    }
  }

  return errors
}

export function validateSkillArtifact(artifact: SkillArtifact): SkillValidationResult {
  const errors: ValidationError[] = []
  errors.push(...validateSkillJson(artifact.skillJson))

  const parsed = (() => {
    try {
      return parseSkillArtifact(JSON.stringify({
        skill: JSON.parse(artifact.skillJson),
        markdown: artifact.skillMarkdown,
        scripts: artifact.scripts,
      }))
    } catch {
      return null
    }
  })()

  if (parsed) {
    errors.push(...validateSkillMarkdown(parsed.markdown, parsed.skill.scripts.map((script) => script.id)))
  }

  for (const script of artifact.scripts) {
    errors.push(...validateSkillScript(script.path, script.content))
  }

  errors.push(...validateArtifactConsistency(artifact))

  return {
    ok: errors.length === 0,
    errors,
  }
}
