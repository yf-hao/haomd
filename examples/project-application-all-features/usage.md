# 使用说明

本示例模板 ID 为 `project-application-all-features`。示例 Markdown 的 `word_template` 值须与此 ID 一致。

## 数据组织

- Front matter 用于填写标题、申请日期和所属单位。
- Markdown 正文中的内联字段用于作者、项目名称和项目负责人等短字段。字段名和值两端的空格会被忽略；冒号可使用半角 `:` 或全角 `：`。
- 标题“课题简介”“研究计划”“预期成果”下的内容分别作为富文本章节。章节标题本身不写入对应内容。
- “进度安排”章节中的 Markdown 表格包含序号、起止日期和任务三列。

## 字段映射

- `meta.title`：Front matter 的 `title`，对应 Word 占位符 `{{title}}`。
- `meta.applicationDate`：Front matter 的 `applicationDate`，对应 `{{applicationDate}}`。
- `meta.department`：Front matter 的 `department`，对应 `{{department}}`。
- `meta.author`：Markdown 内联字段 `{{作者:值}}`，对应 `{{author}}`。
- `meta.projectName`：Markdown 内联字段 `{{项目名称:值}}`，对应 `{{projectName}}`。
- `meta.projectLeader`：Markdown 内联字段 `{{项目负责人:值}}`，对应 `{{projectLeader}}`。
- `sections.introduction`：标题“课题简介”下的内容，对应 `{{introduction}}`，类型为 richText，格式来源为 Word 占位符所在段落。
- `sections.researchPlan`：标题“研究计划”下的内容，对应 `{{researchPlan}}`，类型为 richText，使用 Normal 样式。
- `sections.expectedOutcomes`：标题“预期成果”下的内容，对应 `{{expectedOutcomes}}`，类型为 richText，使用 Normal 样式。
- `tables.sequence`：表头 `{{序号}}` 下的数据，对应 Word 表格中的 `{{sequence1}}`、`{{sequence2}}` 等。
- `tables.dateRange`：表头 `{{起止日期}}` 下的数据，对应 `{{dateRange1}}`、`{{dateRange2}}` 等。
- `tables.task`：表头 `{{任务}}` 下的数据，对应 `{{task1}}`、`{{task2}}` 等。

## 编辑 template.docx

占位符支持 `{{key}}` 和 `${key}` 两种形式，key 前后的一个或多个空格会被忽略。key 必须是英文 ASCII 标识符，格式为 `^[A-Za-z][A-Za-z0-9_]*$`；建议直接复制本说明中的占位符。

- 普通文本占位符（`text`）可与 Word 段落中的其他文字并列。
- 富文本占位符（`richText`）必须单独占一个段落。
- `{{introduction}}` 使用占位段格式。请在 Word 中单独保留该占位符段落，并预先设置所需的字体、字号、行距、缩进等格式；插入内容会继承该段落格式。
- `{{researchPlan}}` 和 `{{expectedOutcomes}}` 使用 Normal 样式。
- 表格占位符行号从 1 开始，只计算表头之后的数据行，不计算表头。
- 中文字段名可作为 Word 正文中的普通说明文字；不要将中文写入 Word 占位符 key。
