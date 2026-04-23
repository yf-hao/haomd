import { extractFrontMatter } from '../markdown/frontMatter'
import type {
  TemplateValidationError,
  WordTemplateDraft,
  WordTemplateValidationResult,
} from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function addError(
  errors: TemplateValidationError[],
  file: string,
  code: string,
  message: string,
  path?: string,
) {
  errors.push({ file, code, message, path })
}

function validateTemplateJson(draft: WordTemplateDraft): TemplateValidationError[] {
  const errors: TemplateValidationError[] = []
  const { templateJson } = draft

  if (templateJson.templateId !== draft.templateId) {
    addError(
      errors,
      'template.json',
      'template_id_mismatch',
      '顶层 templateId 与 templateJson.templateId 不一致',
      'templateId',
    )
  }

  if ((templateJson.name ?? '').trim() !== draft.templateName.trim()) {
    addError(
      errors,
      'template.json',
      'template_name_mismatch',
      '顶层 templateName 与 templateJson.name 不一致',
      'name',
    )
  }

  if (!Array.isArray(templateJson.bindings) || templateJson.bindings.length === 0) {
    addError(errors, 'template.json', 'missing_bindings', 'bindings 必须是非空数组', 'bindings')
    return errors
  }

  templateJson.bindings.forEach((binding, index) => {
    const pathPrefix = `bindings[${index}]`
    if (typeof binding.field !== 'string' || !binding.field.trim()) {
      addError(errors, 'template.json', 'missing_binding_field', 'binding.field 不能为空', `${pathPrefix}.field`)
    }
    if (typeof binding.placeholder !== 'string' || !binding.placeholder.trim()) {
      addError(
        errors,
        'template.json',
        'missing_binding_placeholder',
        'binding.placeholder 不能为空',
        `${pathPrefix}.placeholder`,
      )
    }
    if (binding.type !== 'text' && binding.type !== 'richText') {
      addError(
        errors,
        'template.json',
        'invalid_binding_type',
        'binding.type 只能是 text 或 richText',
        `${pathPrefix}.type`,
      )
    }

    if (binding.source == null) return
    if (!isRecord(binding.source)) {
      addError(
        errors,
        'template.json',
        'invalid_binding_source',
        'binding.source 必须是 object',
        `${pathPrefix}.source`,
      )
      return
    }

    if (binding.source.kind === 'frontMatter') {
      if (
        binding.source.key != null &&
        (typeof binding.source.key !== 'string' || !binding.source.key.trim())
      ) {
        addError(
          errors,
          'template.json',
          'invalid_frontmatter_key',
          'frontMatter source.key 必须是非空字符串',
          `${pathPrefix}.source.key`,
        )
      }
      return
    }

    if (binding.source.kind === 'heading') {
      const hasMatch =
        typeof binding.source.match === 'string' && binding.source.match.trim().length > 0
      const hasMatchAny =
        Array.isArray(binding.source.matchAny) &&
        binding.source.matchAny.some(
          (item) => typeof item === 'string' && item.trim().length > 0,
        )
      if (!hasMatch && !hasMatchAny) {
        addError(
          errors,
          'template.json',
          'missing_heading_match',
          'heading source 至少需要 match 或 matchAny',
          `${pathPrefix}.source`,
        )
      }
      if (
        binding.source.matchAny != null &&
        (!Array.isArray(binding.source.matchAny) ||
          binding.source.matchAny.some(
            (item) => typeof item !== 'string' || !item.trim(),
          ))
      ) {
        addError(
          errors,
          'template.json',
          'invalid_heading_match_any',
          'heading source.matchAny 必须是非空字符串数组',
          `${pathPrefix}.source.matchAny`,
        )
      }
      return
    }

    addError(
      errors,
      'template.json',
      'invalid_source_kind',
      'binding.source.kind 只能是 frontMatter 或 heading',
      `${pathPrefix}.source.kind`,
    )
  })

  return errors
}

function validateUsageMarkdown(draft: WordTemplateDraft): TemplateValidationError[] {
  const errors: TemplateValidationError[] = []
  const text = draft.usageMarkdown.trim()
  if (!text) {
    addError(errors, 'usage.md', 'empty_usage_markdown', 'usageMarkdown 不能为空')
    return errors
  }

  if (!/(front[\s-]?matter|frontmatter|标题区|元数据|前置字段)/i.test(text)) {
    addError(
      errors,
      'usage.md',
      'missing_frontmatter_guidance',
      'usageMarkdown 必须说明 front matter 或元数据写法',
    )
  }

  if (!/(heading|标题)/i.test(text)) {
    addError(
      errors,
      'usage.md',
      'missing_heading_guidance',
      'usageMarkdown 必须说明 heading 或标题写法',
    )
  }

  for (const binding of draft.templateJson.bindings) {
    if (typeof binding.field === 'string' && binding.field.trim() && !text.includes(binding.field)) {
      addError(
        errors,
        'usage.md',
        'missing_field_mapping',
        `usageMarkdown 缺少字段说明: ${binding.field}`,
        binding.field,
      )
    }
  }

  return errors
}

function collectSampleHeadings(markdown: string): string[] {
  return markdown
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.match(/^(#{1,6})\s+(.+?)\s*$/)?.[2]?.trim() ?? '')
    .filter(Boolean)
}

function validateSampleMarkdown(draft: WordTemplateDraft): TemplateValidationError[] {
  const errors: TemplateValidationError[] = []
  const text = draft.sampleMarkdown.trim()
  if (!text) {
    addError(errors, 'sample.md', 'empty_sample_markdown', 'sampleMarkdown 不能为空')
    return errors
  }

  const { frontMatter, hasFrontMatter } = extractFrontMatter(draft.sampleMarkdown)
  const headings = collectSampleHeadings(draft.sampleMarkdown)

  if (!hasFrontMatter) {
    addError(errors, 'sample.md', 'missing_frontmatter', 'sampleMarkdown 必须包含 front matter')
  }
  if (headings.length === 0) {
    addError(errors, 'sample.md', 'missing_heading', 'sampleMarkdown 至少需要一个标题')
  }

  for (const binding of draft.templateJson.bindings) {
    const source = binding.source
    if (!source) continue
    if (source.kind === 'frontMatter') {
      const key =
        typeof source.key === 'string' && source.key.trim()
          ? source.key.trim()
          : binding.field.split('.').at(-1) ?? ''
      if (key && !Object.hasOwn(frontMatter, key)) {
        addError(
          errors,
          'sample.md',
          'missing_frontmatter_key_in_sample',
          `sampleMarkdown 缺少 front matter 字段: ${key}`,
          key,
        )
      }
      continue
    }

    if (source.kind === 'heading') {
      const candidates = [
        typeof source.match === 'string' ? source.match.trim() : '',
        ...(Array.isArray(source.matchAny) ? source.matchAny.map((item) => item.trim()) : []),
      ].filter(Boolean)
      if (candidates.length > 0 && !candidates.some((candidate) => headings.includes(candidate))) {
        addError(
          errors,
          'sample.md',
          'missing_heading_in_sample',
          `sampleMarkdown 缺少匹配标题: ${candidates.join(' / ')}`,
          binding.field,
        )
      }
    }
  }

  return errors
}

export function validateWordTemplateDraft(
  draft: WordTemplateDraft,
): WordTemplateValidationResult {
  const errors: TemplateValidationError[] = []
  errors.push(...validateTemplateJson(draft))
  errors.push(...validateUsageMarkdown(draft))
  errors.push(...validateSampleMarkdown(draft))

  return {
    ok: errors.length === 0,
    errors,
  }
}
