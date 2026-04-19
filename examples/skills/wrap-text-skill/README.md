# Wrap Text Skill

这个目录提供一个最小可运行的 Skill 案例，用于测试：

- 多参数结构化输入
- builtin-js 执行
- 严格输出格式
- 作为 Workflow 下游步骤消费上一步 JSON 字段

## 作用

把一段正文按：

- `prefix + text + suffix`

拼接输出。

## 输入

脚本 `run` 需要三个参数：

```json
{
  "text": "张三",
  "prefix": "联系人：",
  "suffix": ""
}
```

## 输出

`stdout` 应为：

```text
联系人：张三
```

## 使用建议

这个 Skill 很适合作为 Workflow 的下游步骤：

- 接收上一步提取出的字段
- 格式化成最终展示结果
