import type {
  ParsedWordTemplateArtifact,
  TemplateValidationError,
  WordTemplateDraft,
} from './types'

function buildTopLevelError(message: string): TemplateValidationError {
  return {
    file: 'artifact',
    code: 'invalid_artifact',
    message,
  }
}

export function parseWordTemplateArtifact(raw: string): ParsedWordTemplateArtifact {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Word template artifact 不是合法 JSON: ${String(error)}`)
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Word template artifact 顶层必须是 object')
  }

  const obj = parsed as Record<string, unknown>
  const templateId = obj.templateId
  const templateName = obj.templateName
  const templateJson = obj.templateJson
  const usageMarkdown = obj.usageMarkdown
  const sampleMarkdown = obj.sampleMarkdown

  if (typeof templateId !== 'string' || !templateId.trim()) {
    throw new Error('Word template artifact 缺少 templateId string')
  }
  if (typeof templateName !== 'string' || !templateName.trim()) {
    throw new Error('Word template artifact 缺少 templateName string')
  }
  if (!templateJson || typeof templateJson !== 'object' || Array.isArray(templateJson)) {
    throw new Error('Word template artifact 缺少 templateJson object')
  }
  if (typeof usageMarkdown !== 'string') {
    throw new Error('Word template artifact 缺少 usageMarkdown string')
  }
  if (typeof sampleMarkdown !== 'string') {
    throw new Error('Word template artifact 缺少 sampleMarkdown string')
  }

  return {
    templateId,
    templateName,
    templateJson: templateJson as ParsedWordTemplateArtifact['templateJson'],
    usageMarkdown,
    sampleMarkdown,
  }
}

export function parsedWordTemplateArtifactToDraft(
  parsed: ParsedWordTemplateArtifact,
): WordTemplateDraft {
  return {
    templateId: parsed.templateId,
    templateName: parsed.templateName,
    templateRequest: '',
    templateJson: parsed.templateJson,
    usageMarkdown: parsed.usageMarkdown,
    sampleMarkdown: parsed.sampleMarkdown,
  }
}

export function tryParseWordTemplateArtifact(raw: string): {
  draft: WordTemplateDraft | null
  errors: TemplateValidationError[]
} {
  try {
    const parsed = parseWordTemplateArtifact(raw)
    return {
      draft: parsedWordTemplateArtifactToDraft(parsed),
      errors: [],
    }
  } catch (error) {
    return {
      draft: null,
      errors: [buildTopLevelError(String(error))],
    }
  }
}
