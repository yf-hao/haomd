import type { ValidationError } from '../types'

function buildError(code: string, path: string | undefined, message: string): ValidationError {
  return {
    file: 'skill.json',
    code,
    path,
    message,
  }
}

function isSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
}

export function validateSkillJson(skillJsonText: string): ValidationError[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(skillJsonText)
  } catch (error) {
    return [buildError('invalid_json', undefined, `skill.json 不是合法 JSON: ${String(error)}`)]
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return [buildError('invalid_root', undefined, 'skill.json 顶层必须是 object')]
  }

  const skill = parsed as Record<string, unknown>
  const errors: ValidationError[] = []

  const requiredStringFields = ['id', 'name', 'description', 'load_policy']
  for (const field of requiredStringFields) {
    const value = skill[field]
    if (typeof value !== 'string' || !value.trim()) {
      errors.push(buildError('missing_required_field', field, `${field} 为必填字符串`))
    }
  }

  if (typeof skill.id === 'string' && !isSlug(skill.id)) {
    errors.push(buildError('invalid_id', 'id', 'id 必须是合法 slug（小写字母、数字、短横线）'))
  }

  if (typeof skill.enabled !== 'boolean') {
    errors.push(buildError('invalid_type', 'enabled', 'enabled 必须是 boolean'))
  }
  if (typeof skill.trusted !== 'boolean') {
    errors.push(buildError('invalid_type', 'trusted', 'trusted 必须是 boolean'))
  }

  const scripts = skill.scripts
  if (!Array.isArray(scripts) || scripts.length === 0) {
    errors.push(buildError('missing_required_field', 'scripts', 'scripts 必须是非空数组'))
    return errors
  }

  const seenScriptIds = new Set<string>()
  scripts.forEach((script, index) => {
    const path = `scripts[${index}]`
    if (!script || typeof script !== 'object' || Array.isArray(script)) {
      errors.push(buildError('invalid_script', path, 'script 必须是 object'))
      return
    }
    const scriptObj = script as Record<string, unknown>
    const fields = ['id', 'label', 'runtime', 'entry', 'approval_policy']
    for (const field of fields) {
      const value = scriptObj[field]
      if (typeof value !== 'string' || !value.trim()) {
        errors.push(buildError('missing_required_field', `${path}.${field}`, `${field} 为必填字符串`))
      }
    }
    if (typeof scriptObj.id === 'string') {
      if (!isSlug(scriptObj.id)) {
        errors.push(buildError('invalid_script_id', `${path}.id`, 'script id 必须是合法 slug'))
      }
      if (seenScriptIds.has(scriptObj.id)) {
        errors.push(buildError('duplicate_script_id', `${path}.id`, `重复的 script id: ${scriptObj.id}`))
      }
      seenScriptIds.add(scriptObj.id)
    }
    const argsSchema = scriptObj.args_schema
    if (typeof argsSchema !== 'string' || !argsSchema.trim()) {
      errors.push(buildError('missing_required_field', `${path}.args_schema`, 'args_schema 为必填字符串'))
    } else {
      try {
        JSON.parse(argsSchema)
      } catch (error) {
        errors.push(buildError('invalid_args_schema', `${path}.args_schema`, `args_schema 不是合法 JSON: ${String(error)}`))
      }
    }
  })

  return errors
}
