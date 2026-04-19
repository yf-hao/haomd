# Contact Normalize Workflow

这个目录提供一个最小可运行的 Workflow 案例，用于测试：

- `workflow_search`
- `workflow_read`
- `workflow_run`
- Workflow Runtime 的顺序执行
- `{{input.xxx}}`
- `{{steps.stepId.json.xxx}}`
- `outputFrom`

## 依赖的 Skills

在运行这个 Workflow 之前，需要先准备这两个 Skill：

1. `extract-contact-skill`
2. `wrap-text-skill`

其中：

- `extract-contact-skill/run`
  - 输入：
    - `text`
  - 输出：
    - JSON 字符串，包含 `name`、`email`、`phone`

- `wrap-text-skill/run`
  - 输入：
    - `text`
    - `prefix`
    - `suffix`
  - 输出：
    - `prefix + text + suffix`

## 工作流步骤

1. `extract`
  - 调用 `extract-contact-skill/run`
  - 从 `input.text` 提取联系人结构

2. `wrap`
  - 调用 `wrap-text-skill/run`
  - 把上一步提取到的 `name` 包成展示文本

## 最终输出

通过：

```text
steps.wrap.stdout
```

输出最终结果。

## 手动测试输入

```json
{
  "text": "张三，邮箱 zhangsan@example.com，电话 13800138000"
}
```

## 预期结果

如果两个 Skill 都正常，Workflow 最终输出应类似：

```text
联系人：张三
```

## 使用方式

你可以：

1. 在 Workflow 面板里手动创建一个 `contact-normalize` Workflow
2. 直接参考本目录里的：
   - `workflow.json`
   - `WORKFLOW.md`
3. 先在 Workflow 面板中手动运行
4. 再在 AI Chat 中测试：

```text
请使用合适的 workflow，从这段话中提取联系人并输出格式化结果：张三，邮箱 zhangsan@example.com，电话 13800138000
```
