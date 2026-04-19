import type { WorkflowStepRunResult } from '../domain/types'

export type WorkflowResolutionContext = {
  input: unknown
  steps: Record<string, WorkflowStepRunResult>
}

const EXACT_TEMPLATE_PATTERN = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/
const INLINE_TEMPLATE_PATTERN = /\{\{\s*([^}]+?)\s*\}\}/g

function toPathSegments(path: string): string[] {
  return path
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function getValueByPath(root: unknown, segments: string[]): unknown {
  let current = root
  for (const segment of segments) {
    if (current == null || typeof current !== 'object' || !(segment in current)) {
      throw new Error(`模板引用不存在: ${segments.join('.')}`)
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

export function resolveWorkflowReference(path: string, context: WorkflowResolutionContext): unknown {
  const segments = toPathSegments(path)
  if (segments.length === 0) {
    throw new Error('模板引用不能为空')
  }

  const [head, ...rest] = segments
  if (head === 'input') {
    return getValueByPath(context.input, rest)
  }

  if (head === 'steps') {
    const [stepId, source, ...tail] = rest
    if (!stepId || !source) {
      throw new Error(`步骤引用格式错误: ${path}`)
    }
    const step = context.steps[stepId]
    if (!step) {
      throw new Error(`未找到步骤结果: ${stepId}`)
    }
    if (source === 'stdout') {
      if (tail.length > 0) {
        throw new Error(`stdout 不支持继续取子字段: ${path}`)
      }
      return step.stdout
    }
    if (source === 'json') {
      if (typeof step.json === 'undefined') {
        throw new Error(`步骤 ${stepId} 没有可用 JSON 输出`)
      }
      return tail.length > 0 ? getValueByPath(step.json, tail) : step.json
    }
    throw new Error(`不支持的步骤输出源: ${source}`)
  }

  throw new Error(`不支持的模板引用: ${path}`)
}

export function resolveWorkflowTemplateValue(value: unknown, context: WorkflowResolutionContext): unknown {
  if (typeof value === 'string') {
    const exactMatch = value.match(EXACT_TEMPLATE_PATTERN)
    if (exactMatch) {
      return resolveWorkflowReference(exactMatch[1], context)
    }
    return value.replace(INLINE_TEMPLATE_PATTERN, (_, rawPath: string) => {
      const resolved = resolveWorkflowReference(rawPath, context)
      if (typeof resolved === 'string') return resolved
      if (resolved == null) return ''
      return typeof resolved === 'object' ? JSON.stringify(resolved) : String(resolved)
    })
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveWorkflowTemplateValue(item, context))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveWorkflowTemplateValue(item, context)]),
    )
  }

  return value
}
