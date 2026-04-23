import type { TemplateValidationError, WordTemplateDraft } from './types'

const OUTPUT_PROTOCOL = `输出必须是严格 JSON 对象，且只能包含以下顶层字段：
{
  "templateId": "meeting-notes",
  "templateName": "会议纪要模板",
  "templateJson": {
    "templateId": "meeting-notes",
    "name": "会议纪要模板",
    "bindings": []
  },
  "usageMarkdown": "# 使用说明\\n...",
  "sampleMarkdown": "---\\ntitle: 示例\\n---\\n# 小节\\n..."
}

约束：
1. 只输出 JSON，不要输出额外解释
2. templateJson 必须符合 HaoMD 当前 Word 模板配置格式
3. binding.type 只能是 text 或 richText
4. source.kind 只能是 frontMatter 或 heading
5. usageMarkdown 必须说明 front matter、标题组织和字段映射
6. sampleMarkdown 必须包含 front matter 和至少一个标题`

const TEMPLATE_SHAPE = `Word 模板配置格式：
- templateJson 字段：
  - templateId
  - name
  - bindings[]
- 每个 binding 字段：
  - field
  - placeholder
  - type
  - source?
- source.kind 只允许：
  - frontMatter
  - heading
- frontMatter source 可用字段：
  - kind
  - key?
- heading source 可用字段：
  - kind
  - match?
  - matchAny?
  - includeHeading?
  - headingBold?
  - headingFontSizePt?
  - childHeadingBold?`

const FEW_SHOT = `参考样板要点：
- 会议纪要模板：front matter 提取标题、日期，heading 提取决议和待办
- 周报模板：front matter 提取作者、部门，heading 提取进展、风险、计划
- richText 用于承载章节正文，text 用于短字段`

function renderDraft(draft: WordTemplateDraft): string {
  return JSON.stringify(
    {
      templateId: draft.templateId,
      templateName: draft.templateName,
      templateJson: draft.templateJson,
      usageMarkdown: draft.usageMarkdown,
      sampleMarkdown: draft.sampleMarkdown,
    },
    null,
    2,
  )
}

function renderErrors(errors: TemplateValidationError[]): string {
  return JSON.stringify(errors, null, 2)
}

function buildCommonSystemPrompt(): string {
  return [
    '你正在为 HaoMD 生成或修改 Word 模板配置草稿。',
    TEMPLATE_SHAPE,
    OUTPUT_PROTOCOL,
    FEW_SHOT,
  ].join('\n\n')
}

export function buildCreateTemplateAuthoringPrompt(input: { userRequest: string }): {
  system: string
  user: string
} {
  return {
    system: buildCommonSystemPrompt(),
    user: `请根据以下需求生成一个新的 HaoMD Word 模板配置草稿。\n\n用户需求：\n${input.userRequest}`,
  }
}

export function buildReviseTemplateAuthoringPrompt(input: {
  userRequest: string
  currentDraft: WordTemplateDraft
}): {
  system: string
  user: string
} {
  return {
    system: buildCommonSystemPrompt(),
    user:
      '请基于当前 Word 模板草稿做增量修改，保留未被要求修改的正确部分，并输出完整结果。\n\n' +
      `用户修改要求：\n${input.userRequest}\n\n` +
      `当前模板草稿：\n${renderDraft(input.currentDraft)}`,
  }
}

export function buildRepairTemplateAuthoringPrompt(input: {
  userRequest: string
  currentDraft: WordTemplateDraft
  validationErrors: TemplateValidationError[]
}): {
  system: string
  user: string
} {
  return {
    system: buildCommonSystemPrompt(),
    user:
      '下面的 Word 模板草稿未通过校验。请保留已正确的内容，只修复错误项，并输出完整修正后的结果。\n\n' +
      `原始需求：\n${input.userRequest}\n\n` +
      `当前草稿：\n${renderDraft(input.currentDraft)}\n\n` +
      `校验错误：\n${renderErrors(input.validationErrors)}`,
  }
}
