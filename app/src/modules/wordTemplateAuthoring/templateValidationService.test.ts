import { describe, expect, it } from 'vitest'
import type { WordTemplateDraft } from './types'
import { validateWordTemplateDraft } from './templateValidationService'

function createDraft(overrides: Partial<WordTemplateDraft> = {}): WordTemplateDraft {
  return {
    templateId: 'meeting-notes',
    templateName: '会议纪要模板',
    templateRequest: '生成一个会议纪要模板',
    templateJson: {
      templateId: 'meeting-notes',
      name: '会议纪要模板',
      bindings: [
        {
          field: 'meta.title',
          placeholder: '{{title}}',
          type: 'text',
          source: {
            kind: 'frontMatter',
            key: 'title',
          },
        },
        {
          field: 'sections.decisions',
          placeholder: '{{decisions}}',
          type: 'richText',
          richTextStyleSource: 'normal',
          source: {
            kind: 'heading',
            match: '决议',
          },
        },
      ],
    },
    usageMarkdown:
      '# 使用说明\n\n' +
      '- 在 `template.docx` 中按原样放置 `{{title}}` 和 `{{decisions}}` 占位符\n' +
      '- 占位符支持 `{{key}}` 和 `${key}`；key 前后的多个空格会被忽略\n' +
      '- placeholder key 使用英文 ASCII 标识符\n' +
      '- front matter 键名使用英文 ASCII 标识符，允许下划线；值可以是中文\n' +
      '- `text` 占位符可放在段落文字中；`richText` 占位符必须独占一个段落\n' +
      '- front matter 中填写 `title`\n' +
      '- 使用 `# 决议` 标题组织正文\n' +
      '- `meta.title` 对应 front matter 的 `title` 和 `{{title}}`\n' +
      '- `sections.decisions` 对应标题为 `决议` 的章节和 `{{decisions}}`\n' +
      '- `sections.decisions` 使用 Normal 样式作为富文本格式来源\n',
    sampleMarkdown:
      '---\n' +
      'title: 周会纪要\n' +
      '---\n\n' +
      '# 决议\n\n' +
      '本周结论。\n',
    ...overrides,
  }
}

describe('templateValidationService', () => {
  it('should pass for a structurally valid draft', () => {
    const result = validateWordTemplateDraft(createDraft())

    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should accept English front matter keys with underscores', () => {
    const draft = createDraft()
    const result = validateWordTemplateDraft({
      ...draft,
      templateJson: {
        ...draft.templateJson,
        bindings: draft.templateJson.bindings.map((binding) =>
          binding.source?.kind === 'frontMatter'
            ? { ...binding, source: { ...binding.source, key: 'meeting_title' } }
            : binding,
        ),
      },
      usageMarkdown: draft.usageMarkdown.replace(
        'front matter 的 `title`',
        'front matter 的 `meeting_title`',
      ),
      sampleMarkdown: draft.sampleMarkdown.replace('title: 周会纪要', 'meeting_title: 周会纪要'),
    })

    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should reject non-English front matter keys in config and sample markdown', () => {
    const draft = createDraft()
    const invalidSourceKey = validateWordTemplateDraft({
      ...draft,
      templateJson: {
        ...draft.templateJson,
        bindings: draft.templateJson.bindings.map((binding) =>
          binding.source?.kind === 'frontMatter'
            ? { ...binding, source: { ...binding.source, key: '标题' } }
            : binding,
        ),
      },
    })
    const invalidSampleKey = validateWordTemplateDraft({
      ...draft,
      sampleMarkdown: draft.sampleMarkdown.replace('title: 周会纪要', '会议标题: 周会纪要'),
    })

    expect(
      invalidSourceKey.errors.some(
        (error) => error.code === 'invalid_frontmatter_key_format' && error.file === 'template.json',
      ),
    ).toBe(true)
    expect(
      invalidSampleKey.errors.some(
        (error) => error.code === 'invalid_frontmatter_key_format' && error.file === 'sample.md',
      ),
    ).toBe(true)
  })

  it('should report invalid binding type and invalid source kind', () => {
    const result = validateWordTemplateDraft(
      createDraft({
        templateJson: {
          templateId: 'meeting-notes',
          name: '会议纪要模板',
          bindings: [
            {
              field: 'meta.title',
              placeholder: '{{title}}',
              type: 'plain' as 'text',
              source: {
                kind: 'unknown' as 'frontMatter',
              },
            },
          ],
        },
      }),
    )

    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.code === 'invalid_binding_type')).toBe(true)
    expect(result.errors.some((error) => error.code === 'invalid_source_kind')).toBe(true)
  })

  it('should report missing usage guidance and incomplete sample markdown', () => {
    const result = validateWordTemplateDraft(
      createDraft({
        usageMarkdown: '# 使用说明',
        sampleMarkdown: '仅正文，没有 front matter',
      }),
    )

    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.code === 'missing_frontmatter_guidance')).toBe(true)
    expect(result.errors.some((error) => error.code === 'missing_heading_guidance')).toBe(true)
    expect(result.errors.some((error) => error.code === 'missing_frontmatter')).toBe(true)
    expect(result.errors.some((error) => error.code === 'missing_heading')).toBe(true)
  })

  it('should report missing sample bindings', () => {
    const result = validateWordTemplateDraft(
      createDraft({
        sampleMarkdown:
          '---\n' +
          'title: 周会纪要\n' +
          '---\n\n' +
          '# 其他标题\n\n' +
          '内容\n',
      }),
    )

    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.code === 'missing_heading_in_sample')).toBe(true)
  })

  it('should validate table bindings with configurable English keys and indexed placeholders', () => {
    const result = validateWordTemplateDraft(
      createDraft({
        templateJson: {
          templateId: 'meeting-notes',
          name: '会议纪要模板',
          bindings: [
            {
              field: 'tables.scheduleDate',
              placeholder: '{{scheduleDate}}',
              type: 'text',
              source: { kind: 'table', header: '{{起止日期}}' },
            },
          ],
        },
        usageMarkdown:
          '# 使用说明\n\n' +
          '- `template.docx` 使用 `{{scheduleDate1}}` 对应表格第一条数据行\n' +
          '- 占位符支持 `{{key}}` 和 `${key}`；英文 key 两侧空格忽略\n' +
          '- front matter 和 heading 用于模板其他字段\n' +
          '- `tables.scheduleDate` 对应 Markdown 的 `{{起止日期}}` 表头和第一条数据\n' +
          '- 行号从 1 开始，只计算表头之后的数据行，不计表头\n',
        sampleMarkdown:
          '---\ntitle: 项目申请\n---\n\n' +
          '# 进度安排\n\n' +
          '| {{起止日期}} |\n| --- |\n| 2025年10月13日-2025年11月09日 |\n',
      }),
    )

    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should require table header mapping and row-index guidance in usage markdown', () => {
    const draft = createDraft({
      templateJson: {
        templateId: 'meeting-notes',
        name: '会议纪要模板',
        bindings: [{
          field: 'tables.scheduleDate',
          placeholder: '{{scheduleDate}}',
          type: 'text',
          source: { kind: 'table', header: '{{起止日期}}' },
        }],
      },
      usageMarkdown:
        '# 使用说明\n\n' +
        '- `{{scheduleDate1}}` 对应 Markdown 表格中的起止日期。\n' +
        '- 占位符使用英文 key。\n' +
        '- front matter 和 heading 说明。\n',
      sampleMarkdown:
        '---\ntitle: 项目申请\n---\n\n' +
        '# 进度安排\n\n' +
        '| {{起止日期}} |\n| --- |\n| 2025年10月13日-2025年11月09日 |\n',
    })

    const result = validateWordTemplateDraft(draft)

    expect(result.errors.some((error) => error.code === 'missing_table_row_index_guidance')).toBe(true)
    expect(result.errors.some((error) => error.code === 'missing_table_header_mapping')).toBe(true)
  })

  it('should validate inline field markers and their Word placeholder mapping', () => {
    const base = createDraft()
    const result = validateWordTemplateDraft({
      ...base,
      templateJson: {
        ...base.templateJson,
        bindings: [
          ...base.templateJson.bindings,
          {
            field: 'meta.author',
            placeholder: '{{author}}',
            type: 'text',
            source: { kind: 'inline', label: '作者' },
          },
        ],
      },
      usageMarkdown:
        base.usageMarkdown +
        '- `{{author}}` 对应 Markdown 内联标记 `{{作者:张三}}`。\n' +
        '- `meta.author` 取自 `{{作者:值}}` 中冒号后的内容。\n',
      sampleMarkdown: base.sampleMarkdown + '\n{{ 作者 ： 张三 }}\n',
    })

    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
  })
})
