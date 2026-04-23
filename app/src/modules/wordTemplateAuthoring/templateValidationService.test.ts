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
          source: {
            kind: 'heading',
            match: '决议',
          },
        },
      ],
    },
    usageMarkdown:
      '# 使用说明\n\n' +
      '- front matter 中填写 `title`\n' +
      '- 使用 `# 决议` 标题组织正文\n' +
      '- `meta.title` 对应 front matter 的 `title`\n' +
      '- `sections.decisions` 对应标题为 `决议` 的章节\n',
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
})
