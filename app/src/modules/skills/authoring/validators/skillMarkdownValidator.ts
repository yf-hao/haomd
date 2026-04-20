import type { ValidationError } from '../types'

function buildError(code: string, path: string | undefined, message: string): ValidationError {
  return {
    file: 'SKILL.md',
    code,
    path,
    message,
  }
}

export function validateSkillMarkdown(markdown: string, scriptIds: string[]): ValidationError[] {
  const errors: ValidationError[] = []
  const requiredSections = ['## 适用场景', '## 使用原则', '## Scripts']

  for (const section of requiredSections) {
    if (!markdown.includes(section)) {
      errors.push(buildError('missing_section', section, `缺少必需章节: ${section}`))
    }
  }

  for (const scriptId of scriptIds) {
    const scriptHeading = `### ${scriptId}`
    if (!markdown.includes(scriptHeading)) {
      errors.push(buildError('missing_script_section', scriptHeading, `缺少脚本说明小节: ${scriptHeading}`))
    }
  }

  return errors
}
