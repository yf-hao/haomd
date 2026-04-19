# Contact Normalize

这个 workflow 用于从一段原始联系人文本中：

1. 先提取结构化联系人信息
2. 再生成适合直接展示的结果文本

## 适用场景

- 用户要求从文本中提取联系人信息
- 用户要求把联系人结果格式化输出
- 用户请求明显是一个固定多步流程，而不是单个 skill 就能完成

## 输入要求

Workflow 输入是一个结构化 JSON object，当前要求：

- `text`
  - 类型：`string`
  - 含义：待处理的联系人原始文本

调用时应传：

```json
{
  "text": "张三，邮箱 zhangsan@example.com，电话 13800138000"
}
```

不要把额外解释性文字混入 `text`。

## Steps

### extract

用途：

- 调用 `extract-contact-skill/run`
- 从 `input.text` 中提取结构化联系人信息

输入：

```json
{
  "text": "{{input.text}}"
}
```

预期输出：

- `stdout` 应为 JSON 字符串
- 其中至少应包含：
  - `name`
  - `email`
  - `phone`

### wrap

用途：

- 调用 `wrap-text-skill/run`
- 把 `extract` 步骤提取出的 `name` 包装成最终展示文本

输入：

```json
{
  "text": "{{steps.extract.json.name}}",
  "prefix": "联系人：",
  "suffix": ""
}
```

预期输出：

- `stdout` 应为最终展示字符串
- 例如：

```text
联系人：张三
```

## 输出规则

最终输出来自：

```text
steps.wrap.stdout
```

## 失败策略

- `fail_fast`

也就是：

- 如果 `extract` 失败
- 不应继续执行 `wrap`

## 使用原则

- 运行前先 `workflow_read`
- 输入必须遵循 `inputSchema`
- 不要修改步骤顺序
- 不要把这个 workflow 当成单 skill 使用
