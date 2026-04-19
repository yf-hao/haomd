# Extract Contact Skill

这个目录提供一个最小可运行的 Skill 案例，用于测试：

- 单 Skill 的结构化参数传入
- `args_schema`
- builtin-js 执行
- 输出 JSON 字符串
- 作为 Workflow 上游步骤被调用

## 作用

从一段联系人文本中提取：

- `name`
- `email`
- `phone`

## 输入

脚本 `run` 只接受一个结构化参数：

```json
{
  "text": "张三，邮箱 zhangsan@example.com，电话 13800138000"
}
```

## 输出

`stdout` 应返回 JSON 字符串，例如：

```json
{
  "name": "张三",
  "email": "zhangsan@example.com",
  "phone": "13800138000"
}
```

## 使用建议

这个 Skill 很适合作为 Workflow 的第一步：

- 先提取结构化联系人
- 再交给其它 Skill 或 Workflow 后续步骤继续处理
