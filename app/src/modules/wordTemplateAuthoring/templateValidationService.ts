import { extractFrontMatter } from '../markdown/frontMatter'
import {
  findInlineFieldValue,
  parseMarkdownToTemplateModel,
} from '../export/word/template/parseMarkdownToTemplateModel'
import type {
  TemplateValidationError,
  WordTemplateDraft,
  WordTemplateValidationResult,
} from './types'

const ENGLISH_IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/

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

function getPlaceholderKey(placeholder: string): string | null {
  const inner = placeholder
    .trim()
    .replace(/^\$\{([\s\S]*)\}$/, '$1')
    .replace(/^\{\{([\s\S]*)\}\}$/, '$1')
  if (inner === placeholder.trim()) return null
  const key = inner.trim()
  return key || null
}

function getFirstTableRowPlaceholder(placeholder: string): string | null {
  const key = getPlaceholderKey(placeholder)
  if (!key) return null
  return placeholder.trim().startsWith('${') ? `\${${key}1}` : `{{${key}1}}`
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
    const field = typeof binding.field === 'string' ? binding.field.trim() : ''
    const fieldParts = field.split('.')
    const scope = fieldParts[0]
    const fieldKey = fieldParts[1]
    if (!field) {
      addError(errors, 'template.json', 'missing_binding_field', 'binding.field 不能为空', `${pathPrefix}.field`)
    } else if (
      fieldParts.length !== 2 ||
      (scope !== 'meta' && scope !== 'sections' && scope !== 'tables') ||
      !fieldKey?.trim()
    ) {
      addError(
        errors,
        'template.json',
        'invalid_binding_field_path',
        'binding.field 必须是两段路径：meta.<字段名>、sections.<字段名> 或 tables.<字段名>',
        `${pathPrefix}.field`,
      )
    }
    if (typeof binding.placeholder !== 'string' || !binding.placeholder.trim()) {
      addError(
        errors,
        'template.json',
        'missing_binding_placeholder',
        'binding.placeholder 不能为空',
        `${pathPrefix}.placeholder`,
      )
    } else {
      const placeholderKey = getPlaceholderKey(binding.placeholder)
      if (!placeholderKey) {
        addError(
          errors,
          'template.json',
          'invalid_placeholder_format',
          'binding.placeholder 必须使用 {{englishKey}} 或 ${englishKey} 格式',
          `${pathPrefix}.placeholder`,
        )
      } else if (!ENGLISH_IDENTIFIER_PATTERN.test(placeholderKey)) {
        addError(
          errors,
          'template.json',
          'invalid_placeholder_key',
          'placeholder key 必须是英文标识符，格式为 ^[A-Za-z][A-Za-z0-9_]*$，不能包含中文、空格或连字符',
          `${pathPrefix}.placeholder`,
        )
      }
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
    if (binding.type === 'richText') {
      if (
        binding.richTextStyleSource !== 'normal' &&
        binding.richTextStyleSource !== 'placeholder'
      ) {
        addError(
          errors,
          'template.json',
          'invalid_richtext_style_source',
          'richText binding 必须设置 richTextStyleSource 为 normal 或 placeholder',
          `${pathPrefix}.richTextStyleSource`,
        )
      }
    } else if (binding.richTextStyleSource != null) {
      addError(
        errors,
        'template.json',
        'richtext_style_source_on_text_binding',
        'richTextStyleSource 只能用于 richText binding',
        `${pathPrefix}.richTextStyleSource`,
      )
    }

    if (binding.source == null) {
      if (scope === 'tables') {
        addError(
          errors,
          'template.json',
          'missing_table_binding_source',
          'tables.<字段名> 必须声明 table source',
          `${pathPrefix}.source`,
        )
      }
      return
    }
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
      if (scope !== 'meta') {
        addError(
          errors,
          'template.json',
          'binding_field_source_mismatch',
          'frontMatter 来源的 binding.field 必须使用 meta.<字段名>',
          `${pathPrefix}.field`,
        )
      }
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
      } else {
        const key =
          typeof binding.source.key === 'string'
            ? binding.source.key.trim()
            : fieldKey
        if (key && !ENGLISH_IDENTIFIER_PATTERN.test(key)) {
          addError(
            errors,
            'template.json',
            'invalid_frontmatter_key_format',
            'frontMatter source.key 必须是英文 ASCII 标识符，格式为 ^[A-Za-z][A-Za-z0-9_]*$，允许下划线',
            `${pathPrefix}.source.key`,
          )
        }
      }
      return
    }

    if (binding.source.kind === 'heading') {
      if (scope !== 'sections') {
        addError(
          errors,
          'template.json',
          'binding_field_source_mismatch',
          'heading 来源的 binding.field 必须使用 sections.<字段名>',
          `${pathPrefix}.field`,
        )
      }
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

    if (binding.source.kind === 'table') {
      if (scope !== 'tables') {
        addError(
          errors,
          'template.json',
          'binding_field_source_mismatch',
          'table 来源的 binding.field 必须使用 tables.<字段名>',
          `${pathPrefix}.field`,
        )
      }
      if (binding.type !== 'text') {
        addError(
          errors,
          'template.json',
          'invalid_table_binding_type',
          'table 来源目前只支持 text binding',
          `${pathPrefix}.type`,
        )
      }
      if (
        typeof binding.source.header !== 'string' ||
        !/^\{\{\s*[^{}]+\s*\}\}$/.test(binding.source.header.trim())
      ) {
        addError(
          errors,
          'template.json',
          'invalid_table_header_marker',
          'table.source.header 必须是 Markdown 表头标记，例如 {{序号}}',
          `${pathPrefix}.source.header`,
        )
      }
      return
    }

    if (binding.source.kind === 'inline') {
      if (scope !== 'meta') {
        addError(
          errors,
          'template.json',
          'binding_field_source_mismatch',
          'inline 来源的 binding.field 必须使用 meta.<字段名>',
          `${pathPrefix}.field`,
        )
      }
      if (binding.type !== 'text') {
        addError(
          errors,
          'template.json',
          'invalid_inline_binding_type',
          'inline 来源目前只支持 text binding',
          `${pathPrefix}.type`,
        )
      }
      if (typeof binding.source.label !== 'string' || !binding.source.label.trim()) {
        addError(
          errors,
          'template.json',
          'missing_inline_label',
          'inline.source.label 必须是非空字段名称',
          `${pathPrefix}.source.label`,
        )
      }
      return
    }

    addError(
      errors,
      'template.json',
      'invalid_source_kind',
      'binding.source.kind 只能是 frontMatter、heading、table 或 inline',
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

  if (!/template\.docx/i.test(text) || !/(占位符|placeholder)/i.test(text)) {
    addError(
      errors,
      'usage.md',
      'missing_docx_placeholder_guidance',
      'usageMarkdown 必须说明如何在 template.docx 中放置占位符',
    )
  }

  if (!text.includes('{{') || !text.includes('${') || !/(空格|空白)/.test(text)) {
    addError(
      errors,
      'usage.md',
      'missing_placeholder_syntax_guidance',
      'usageMarkdown 必须说明 {{key}}、${key} 两种写法及 key 两侧空格会被忽略',
    )
  }

  if (!/(英文|ASCII)/i.test(text)) {
    addError(
      errors,
      'usage.md',
      'missing_english_placeholder_key_guidance',
      'usageMarkdown 必须说明 placeholder key 使用英文标识符',
    )
  }

  if (
    !/(front[\s-]?matter|frontmatter)/i.test(text) ||
    !/(键名|键|key)/i.test(text) ||
    !/(英文|ASCII)/i.test(text)
  ) {
    addError(
      errors,
      'usage.md',
      'missing_frontmatter_key_guidance',
      'usageMarkdown 必须说明 front matter 键名使用英文 ASCII 标识符',
    )
  }

  if (
    draft.templateJson.bindings.some((binding) => binding.type === 'richText') &&
    (!/(richText|富文本)/i.test(text) || !/段落/.test(text))
  ) {
    addError(
      errors,
      'usage.md',
      'missing_richtext_placeholder_guidance',
      'usageMarkdown 必须说明 richText 占位符需要独占一个段落',
    )
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

  const tableBindings = draft.templateJson.bindings.filter(
    (binding) => binding.source?.kind === 'table',
  )
  if (
    tableBindings.length > 0 &&
    !(/(行号|行序号|数据行序号|row number|row index)/i.test(text) &&
      /(表头之后|表头后的|不计表头|不包含表头|after the header|excluding the header)/i.test(text))
  ) {
    addError(
      errors,
      'usage.md',
      'missing_table_row_index_guidance',
      'usageMarkdown 必须说明 table 占位符末尾行号从 1 开始，且只计算表头之后的数据行',
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
    const requiredPlaceholder =
      binding.source?.kind === 'table'
        ? getFirstTableRowPlaceholder(binding.placeholder)
        : binding.placeholder
    if (
      typeof binding.placeholder === 'string' &&
      binding.placeholder.trim() &&
      (!requiredPlaceholder || !text.includes(requiredPlaceholder))
    ) {
      addError(
        errors,
        'usage.md',
        'missing_placeholder_mapping',
        `usageMarkdown 缺少占位符说明: ${requiredPlaceholder ?? binding.placeholder}`,
        binding.placeholder,
      )
    }
    if (
      binding.source?.kind === 'table' &&
      typeof binding.source.header === 'string' &&
      !text.includes(binding.source.header)
    ) {
      addError(
        errors,
        'usage.md',
        'missing_table_header_mapping',
        `usageMarkdown 缺少表格表头标记说明: ${binding.source.header}`,
        binding.field,
      )
    }
    if (binding.source?.kind === 'inline') {
      const label =
        typeof binding.source.label === 'string' ? binding.source.label.trim() : ''
      const hasInlineExample =
        text.includes(`{{${label}:`) || text.includes(`{{${label}：`)
      if (!hasInlineExample) {
        addError(
          errors,
          'usage.md',
          'missing_inline_source_mapping',
          `usageMarkdown 缺少内联字段示例: {{${label}:值}}`,
          binding.field,
        )
      }
    }
    if (binding.type === 'richText') {
      const modeName = binding.richTextStyleSource === 'placeholder' ? '占位段格式' : 'Normal 样式'
      if (!text.includes(modeName)) {
        addError(
          errors,
          'usage.md',
          'missing_richtext_style_source_guidance',
          `usageMarkdown 缺少 ${binding.field} 的 richText 格式来源说明: ${modeName}`,
          binding.field,
        )
      }
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
  const parsedSample = parseMarkdownToTemplateModel(draft.sampleMarkdown, draft.templateJson)

  if (!hasFrontMatter) {
    addError(errors, 'sample.md', 'missing_frontmatter', 'sampleMarkdown 必须包含 front matter')
  }
  for (const key of Object.keys(frontMatter)) {
    if (!ENGLISH_IDENTIFIER_PATTERN.test(key)) {
      addError(
        errors,
        'sample.md',
        'invalid_frontmatter_key_format',
        `sampleMarkdown front matter 键名必须是英文 ASCII 标识符: ${key}`,
        key,
      )
    }
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
      continue
    }

    if (source.kind === 'table') {
      const fieldKey = binding.field.split('.').at(-1) ?? ''
      if (!parsedSample.model.tables[fieldKey]?.length) {
        addError(
          errors,
          'sample.md',
          'missing_table_data_in_sample',
          `sampleMarkdown 必须包含表头标记 ${source.header} 和至少一条数据行`,
          source.header,
        )
      }
      continue
    }

    if (source.kind === 'inline') {
      if (findInlineFieldValue(draft.sampleMarkdown, source.label) == null) {
        addError(
          errors,
          'sample.md',
          'missing_inline_value_in_sample',
          `sampleMarkdown 缺少内联字段标记: {{${source.label}:值}}`,
          source.label,
        )
      }
    }
  }

  return errors
}

export function validateWordTemplateDraft(draft: WordTemplateDraft): WordTemplateValidationResult {
  const errors: TemplateValidationError[] = []
  errors.push(...validateTemplateJson(draft))
  errors.push(...validateUsageMarkdown(draft))
  errors.push(...validateSampleMarkdown(draft))

  return {
    ok: errors.length === 0,
    errors,
  }
}
