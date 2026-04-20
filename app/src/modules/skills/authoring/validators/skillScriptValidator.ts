import type { ValidationError } from '../types'

function buildError(path: string, code: string, message: string): ValidationError {
  return {
    file: path,
    code,
    message,
  }
}

const RETURN_FIELD_PATTERNS = ['ok', 'stdout', 'stderr', 'exitCode']

export function validateSkillScript(path: string, content: string): ValidationError[] {
  const errors: ValidationError[] = []

  if (!/function\s+run\s*\(\s*args\s*\)/.test(content)) {
    errors.push(buildError(path, 'missing_run_function', '脚本必须定义 function run(args)'))
  }

  for (const field of RETURN_FIELD_PATTERNS) {
    const fieldPattern = new RegExp(`\\b${field}\\b`)
    if (!fieldPattern.test(content)) {
      errors.push(buildError(path, 'missing_return_field', `脚本返回结构缺少字段: ${field}`))
    }
  }

  return errors
}
