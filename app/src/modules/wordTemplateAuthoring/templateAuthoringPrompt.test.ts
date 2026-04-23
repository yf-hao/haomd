import { describe, expect, it } from 'vitest'
import {
  buildCreateTemplateAuthoringPrompt,
  buildRepairTemplateAuthoringPrompt,
  buildReviseTemplateAuthoringPrompt,
} from './templateAuthoringPrompt'
import type { TemplateValidationError, WordTemplateDraft } from './types'

const draft: WordTemplateDraft = {
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
    ],
  },
  usageMarkdown: '# 使用说明\n\n请在 front matter 中填写 title。\n正文使用标题组织章节。',
  sampleMarkdown: '---\ntitle: 周会\n---\n\n# 决议\n\n内容',
}

const validationErrors: TemplateValidationError[] = [
  {
    file: 'template.json',
    code: 'invalid_binding_type',
    path: 'bindings[0].type',
    message: 'binding.type 只能是 text 或 richText',
  },
]

describe('templateAuthoringPrompt', () => {
  it('should build create prompt with output protocol', () => {
    const prompt = buildCreateTemplateAuthoringPrompt({
      userRequest: '生成一个会议纪要模板',
    })

    expect(prompt.system).toContain('输出必须是严格 JSON 对象')
    expect(prompt.system).toContain('Word 模板配置格式')
    expect(prompt.user).toContain('生成一个新的 HaoMD Word 模板配置草稿')
    expect(prompt.user).toContain('会议纪要模板')
  })

  it('should build revise prompt with current draft', () => {
    const prompt = buildReviseTemplateAuthoringPrompt({
      userRequest: '把标题改成 front matter 字段',
      currentDraft: draft,
    })

    expect(prompt.user).toContain('增量修改')
    expect(prompt.user).toContain('把标题改成 front matter 字段')
    expect(prompt.user).toContain('"templateId": "meeting-notes"')
  })

  it('should build repair prompt with validation errors', () => {
    const prompt = buildRepairTemplateAuthoringPrompt({
      userRequest: '修复这个模板',
      currentDraft: draft,
      validationErrors,
    })

    expect(prompt.user).toContain('未通过校验')
    expect(prompt.user).toContain('invalid_binding_type')
    expect(prompt.user).toContain('bindings[0].type')
  })
})
