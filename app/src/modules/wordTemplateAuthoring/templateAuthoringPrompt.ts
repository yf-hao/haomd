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
4. source.kind 只能是 frontMatter、heading、table 或 inline
5. usageMarkdown 必须说明 front matter、标题组织和字段映射
6. sampleMarkdown 必须包含 front matter 和至少一个标题
7. binding.field 必须使用运行时支持的两段路径：frontMatter 和 inline 来源写 meta.<字段名>，heading 来源写 sections.<字段名>，table 来源写 tables.<字段名>
8. front matter 中所有键名以及 frontMatter.source.key 必须是英文 ASCII 标识符，格式为 ^[A-Za-z][A-Za-z0-9_]*$；禁止中文、空格和连字符，允许下划线；值仍可使用中文。heading 的 source.match 或 source.matchAny 是 Markdown 标题文本；table 的 source.header 是被 {{}} 包围的 Markdown 表头标记；inline 的 source.label 是 Markdown 内联标记中的中文字段名
9. usageMarkdown 必须单独说明如何编辑 template.docx：在 Word 文档中需要插入哪些占位符，以及 text 与 richText 占位符的放置方式
10. usageMarkdown 必须逐项说明每个 binding 的数据来源；inline binding 说明 Markdown 的 {{字段名:值}} 写法和 Word 英文占位符之间的映射，并给出示例；table binding 说明配置的英文 key 前缀、对应 source.header 和 Word 中带行号的实际占位符，并说明行号从 1 开始且只计算表头之后的数据行
11. 占位符支持 {{key}} 与 \${key} 两种形式；括号内 key 前后可有一个或多个空格，匹配时会忽略这些首尾空格
12. text 占位符可放在段落文字中；richText 占位符必须独占一个段落，因为导出时会用整段富文本替换该段落
13. placeholder 内的 key 必须是 ASCII 英文标识符，匹配 ^[A-Za-z][A-Za-z0-9_]*$；不能包含中文、空格或连字符
14. AI 生成的 placeholder 使用紧凑写法，如 {{projectTitle}} 或 \${projectTitle}；Word 文档中的 key 两侧空格仍可兼容
15. 中文字段名称应作为 template.docx 中的普通说明文字，不能写进 placeholder key
16. 每个 richText binding 必须设置 richTextStyleSource，值只能是 normal 或 placeholder；根据用户需求自然语言推断，不要假设所有 richText 必须使用相同来源
17. 用户统一描述格式来源时应用到所有 richText；用户按章节描述时分别设置对应 binding。未描述来源时默认 normal
18. richTextStyleSource 为 normal 时使用 Normal 样式；为 placeholder 时从 template.docx 中占位符所在段落继承段落和文字格式
19. 修改现有模板时，除非用户明确要求调整格式来源，否则保留现有各 richText binding 的 richTextStyleSource
20. usageMarkdown 必须逐项说明每个 richText 字段的实际格式来源；placeholder 模式还要说明占位符应单独成段并设置所需格式
21. usageMarkdown 应说明两种占位符形式、英文 key 规则及其空格兼容规则，并建议优先复制 binding.placeholder
22. inline 标记格式为 {{字段名:值}}，同时接受半角冒号 : 和全角冒号 ：；以第一个冒号分隔字段名和值，并 trim 两者首尾空格；字段名和值内部的空格保留；同一字段出现多次时取第一个
23. usageMarkdown 必须明确说明 front matter 键名也只能使用英文 ASCII 标识符（允许字母、数字和下划线，且以字母开头），front matter 的值可以是中文`

const TEMPLATE_SHAPE = `Word 模板配置格式：
- templateJson 字段：
  - templateId
  - name
  - bindings[]
- 每个 binding 字段：
  - field：必须是 meta.<key>、sections.<key> 或 tables.<key>，且只能两段
  - placeholder：定义占位符对应的英文 key；template.docx 可使用 {{englishKey}} 或 \${englishKey}，并允许 key 两侧有空格
  - type
  - richTextStyleSource：richText 专用，由用户需求推断；normal 使用 Normal 样式，placeholder 继承对应占位段格式；用户未指定时默认 normal
  - source?
- Front matter 键名以及 frontMatter.source.key 必须是英文 ASCII 标识符：以字母开头，后续只能包含英文字母、数字和下划线
- field 与 source.kind 的对应关系：
  - source.kind 为 frontMatter 时，field 必须以 meta. 开头
  - source.kind 为 heading 时，field 必须以 sections. 开头
  - source.kind 为 table 时，field 必须以 tables. 开头，binding.type 必须为 text
  - source.kind 为 inline 时，field 必须以 meta. 开头，binding.type 必须为 text
- 示例：
  - Front Matter 短字段：{"field":"meta.projectTitle","placeholder":"{{projectTitle}}","type":"text","source":{"kind":"frontMatter","key":"projectTitle"}}
  - 标题下的富文本：{"field":"sections.projectIntroduction","placeholder":"{{projectIntroduction}}","type":"richText","richTextStyleSource":"placeholder","source":{"kind":"heading","match":"课题简介","includeHeading":false}}
  - Markdown 表格列：{"field":"tables.deadline","placeholder":"{{deadline}}","type":"text","source":{"kind":"table","header":"{{起止日期}}"}}；Word 中 {{deadline1}} 取表头之后第一行，{{deadline2}} 取第二行
  - Markdown 内联字段：{"field":"meta.author","placeholder":"{{author}}","type":"text","source":{"kind":"inline","label":"作者"}}；Markdown 中 {{作者:张三}} 或 {{ 作者 ： 张三 }} 均映射为 Word 占位符 {{author}} 的值“张三”
- table source.header 必须与 Markdown 表头标记完全一致；placeholder key 由模板自行定义，不能在程序中固定为 no、deadline 或 task
- table binding.placeholder 不带行号；Word 占位符在英文 key 后追加正整数行号，行号从 1 开始且不计表头
- sampleMarkdown 必须包含 table source 对应的标记表头和数据行
- 用户可以只用自然语言描述表格数量和列名，不要求用户指定标记或英文 key；根据需求为每列生成 table binding，并在 sampleMarkdown 中将对应表头写为 {{列名}}
- 为每列自行选择清晰、互不冲突的英文 key；usageMarkdown 说明对应关系和 Word 中带行号的占位符
- source.kind 只允许：
  - frontMatter
  - heading
  - table
  - inline
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
  - childHeadingBold?
- table source 可用字段：
  - kind
  - header
- inline source 可用字段：
  - kind
  - label
- inline 标记中，冒号前的中文字段名映射到 inline.source.label，冒号后的值写入对应 binding.field`

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
