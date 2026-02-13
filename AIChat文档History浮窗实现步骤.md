# AI Chat 文档 History 浮窗实现步骤

> 目标：在 HaoMD 中实现“当前文档会话历史”的浮动窗口视图（按一问一答分组展示，支持分页），并支持导出当前文档的全部历史对话（Markdown/JSON）。

---

## 一、功能目标回顾

1. **History 作用范围**
   - 仅针对 **当前文档**（`docPath`）展示 AI 会话历史；不再展示所有文档的汇总索引。
   - 历史数据来源：`DocConversationRecord`（`docConversationService.getByDocPath(docPath)`）。

2. **展示形式**
   - 以 **浮动窗口**（modal）形式展示，类似现有 `AiChatDialog`，但内容是只读时间线。
   - 时间线按 **一问一答** 分组（一个 User + 对应的 Assistant 回复），每组之间有分割线。
   - 顶部不显示文档路径，仅可选显示“最近活跃时间、总消息数”等 summary 信息。
   - 支持分页（按“对话组数”分页，比如每页 10 组）。

3. **导出功能**
   - 从 History 浮窗中添加“导出”按钮，导出 **当前文档的全部历史对话**：
     - 主格式：**Markdown**（按对话组展开）。
     - 可选：JSON（结构接近 `DocConversationRecord`）。
   - 导出不受分页限制，始终导出完整时间线。

---

## 二、整体改造结构

从结构上，改造分为三层：

1. **UI 层**：新增 `DocConversationHistoryDialog` 组件，用于：
   - 加载并展示当前文档的历史对话时间线；
   - 实现分页、分组展示和导出按钮。

2. **壳层（WorkspaceShell）集成**：
   - 管理 History 浮窗的打开/关闭状态和绑定的 `docPath`；
   - 提供 `openDocConversationsHistory(docPath)` 回调给命令系统。

3. **命令层（Command Registry）**：
   - 改造 `ai_conversation_history` 命令：
     - 不再生成全局 Markdown 索引；
     - 改为：基于当前文件路径，打开 History 浮窗。

导出逻辑复用 UI 层的数据（`DocConversationRecord` + 分组结果），调用 Tauri 命令完成文件写入。

---

## 三、实施步骤明细

### 步骤 1：新增 `DocConversationHistoryDialog` 组件

**1.1 文件位置与命名**

- 建议新建文件：
  - `app/src/modules/ai/ui/DocConversationHistoryDialog.tsx`

**1.2 Props 设计**

```ts
export type DocConversationHistoryDialogProps = {
  open: boolean
  docPath: string
  onClose: () => void
}
```

后续可按需扩展（例如注入自定义标题、主题等）。

**1.3 内部状态与数据加载**

组件内部需要管理：

- `loading: boolean`：加载历史中？
- `error: Error | null`：加载失败信息。
- `record: DocConversationRecord | null`：当前文档的会话记录。
- `groups: ConversationGroup[]`：将 `messages` 按一问一答分组后的结果。
- 分页：
  - `pageIndex: number`（当前页，从 0 或 1 开始都可，统一即可）；
  - `pageSize: number`（每页多少组对话，初始值如 10）。

加载逻辑（伪代码）：

```ts
useEffect(() => {
  if (!open) return
  let cancelled = false
  setLoading(true)
  setError(null)

  ;(async () => {
    try {
      const rec = await docConversationService.getByDocPath(docPath)
      if (cancelled) return
      setRecord(rec)
      const groups = rec ? buildConversationGroups(rec.messages) : []
      setGroups(groups)

      // 初次打开时跳到最后一页（最新的对话）
      if (groups.length > 0) {
        const lastPageIndex = Math.max(0, Math.ceil(groups.length / pageSize) - 1)
        setPageIndex(lastPageIndex)
      } else {
        setPageIndex(0)
      }
    } catch (e) {
      if (cancelled) return
      setError(e as Error)
    } finally {
      if (!cancelled) setLoading(false)
    }
  })()

  return () => { cancelled = true }
}, [open, docPath, pageSize])
```

**1.4 分组函数：`buildConversationGroups`**

目的：按“一问一答”划分对话块，以便 UI 显示时一个块内是一个 User 段 + 对应 Assistant 段。

简单策略（伪代码）：

```ts
type ConversationGroup = {
  id: string
  userMessages: DocConversationMessage[]
  assistantMessages: DocConversationMessage[]
  systemMessages: DocConversationMessage[]
  startedAt: number // 组的起始时间（首条 user 或 system）
}

function buildConversationGroups(messages: DocConversationMessage[]): ConversationGroup[] {
  const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp)
  const groups: ConversationGroup[] = []
  let current: ConversationGroup | null = null

  for (const m of sorted) {
    if (!current) {
      current = {
        id: m.id,
        userMessages: [],
        assistantMessages: [],
        systemMessages: [],
        startedAt: m.timestamp,
      }
      groups.push(current)
    }

    if (m.role === 'system') {
      current.systemMessages.push(m)
      continue
    }

    if (m.role === 'user') {
      // 简单策略：遇到新的 user 即开启一个新的组
      if (current.userMessages.length > 0 || current.assistantMessages.length > 0) {
        current = {
          id: m.id,
          userMessages: [m],
          assistantMessages: [],
          systemMessages: [],
          startedAt: m.timestamp,
        }
        groups.push(current)
      } else {
        current.userMessages.push(m)
      }
      continue
    }

    if (m.role === 'assistant') {
      current.assistantMessages.push(m)
      continue
    }
  }

  return groups
}
```

说明：

- 一个组内允许多个 user/assistant 连续消息，但简单实现即可满足大多数“问一句答一句”的场景。
- 后续如需更精细，可以用消息 ID 或中间 meta 信息来划分轮次。

**1.5 分页与展示**

分页仅作用于 `groups`：

```ts
const totalGroups = groups.length
const totalPages = Math.max(1, Math.ceil(totalGroups / pageSize))
const safePageIndex = Math.min(pageIndex, totalPages - 1)
const pageGroups = groups.slice(safePageIndex * pageSize, (safePageIndex + 1) * pageSize)
```

UI 展示：

- 顶部：
  - 标题：`AI Session History`
  - 可选 summary：`最近活跃时间、总消息数`。
- 中间：
  - 遍历 `pageGroups`，每个 group：
    - 先渲染 systemMessages（如有）；
    - 再渲染 userMessages（合并显示，也可以分多条）
    - 再渲染 assistantMessages（附上 provider/model 信息）
    - 组与组之间用一条横线或大间距隔开。
- 底部分页条：
  - `上一页` / `下一页` 按钮；
  - 当前页信息：`第 X / Y 页 · 每页 N 组对话`；
  - 可选过滤（角色/模型/含图片筛选）可在后续迭代中添加。

**1.6 导出按钮与处理函数**

在对话框标题栏右侧增加 `导出` 按钮：

- 点击后可直接导出为 Markdown（简化版），或弹出菜单选择 Markdown / JSON。

导出 handler 设计：

```ts
const handleExportMarkdown = async () => {
  if (!record || !groups.length) return
  const markdown = buildMarkdownFromDocRecord(record, groups)
  // 调用 Tauri 命令或前端下载逻辑保存文件
}

const handleExportJson = async () => {
  if (!record) return
  const payload = buildJsonPayloadFromRecord(record)
  const json = JSON.stringify(payload, null, 2)
  // 保存 json 文件
}
```

Markdown 构建函数示意：

```ts
function buildMarkdownFromDocRecord(
  record: DocConversationRecord,
  groups: ConversationGroup[],
): string {
  const lines: string[] = []

  lines.push('# AI 会话历史（当前文档）')
  lines.push('')
  lines.push(`- 导出时间：${new Date().toLocaleString()}`)
  lines.push(`- 总消息数：${record.messages.length}`)
  lines.push(`- 总对话轮次：${groups.length}`)
  lines.push('')
  lines.push('---')
  lines.push('')

  groups.forEach((g, index) => {
    lines.push(`## 对话 ${index + 1}`)
    lines.push('')

    // system messages
    g.systemMessages.forEach((m) => {
      lines.push('**System**')
      lines.push('')
      lines.push(`> ${m.content}`)
      lines.push('')
    })

    // user
    if (g.userMessages.length) {
      const first = g.userMessages[0]
      lines.push(`- 时间：${new Date(first.timestamp).toLocaleString()}`)
      lines.push('')
      lines.push('**User**')
      lines.push('')
      g.userMessages.forEach((m) => {
        lines.push(`> ${m.content}`)
        lines.push('')
      })
    }

    // assistant
    if (g.assistantMessages.length) {
      const first = g.assistantMessages[0]
      const meta = first.meta || {}
      const providerLabel = meta.providerType || 'unknown'
      const modelLabel = meta.modelName || ''
      lines.push(`**Assistant（${providerLabel}${modelLabel ? ' / ' + modelLabel : ''}）**`)
      lines.push('')
      g.assistantMessages.forEach((m) => {
        lines.push(`> ${m.content}`)
        lines.push('')
      })
    }

    lines.push('---')
    lines.push('')
  })

  return lines.join('\n')
}
```

JSON payload 构建函数可以直接在 `DocConversationRecord` 基础上加上 `exportedAt` 和 `version` 字段。

导出保存时可调用 Tauri 命令，如：

- `save_text_file({ defaultFileName, content })`
- 或前端生成 Blob + 下载（在 Tauri 环境下优先使用原生日志更统一）。

> 注意：本步骤仅设计接口和伪代码，具体命令名和实现按现有 Tauri 命令风格对齐。

---

### 步骤 2：在 `WorkspaceShell` 中集成 History 浮窗

**2.1 新增状态与控制函数**

在 `WorkspaceShell` 组件中：

```ts
const [docHistoryState, setDocHistoryState] = useState<{
  open: boolean
  docPath: string | null
}>({ open: false, docPath: null })

const openDocHistoryDialog = useCallback((docPath: string) => {
  setDocHistoryState({ open: true, docPath })
}, [])

const closeDocHistoryDialog = useCallback(() => {
  setDocHistoryState((prev) => ({ ...prev, open: false }))
}, [])
```

**2.2 在 JSX 中渲染 `DocConversationHistoryDialog`**

在 `WorkspaceShell` 的 JSX 结尾附近（和 `AiChatDialog` 同级）增加：

```tsx
{docHistoryState.open && docHistoryState.docPath && (
  <DocConversationHistoryDialog
    open={docHistoryState.open}
    docPath={docHistoryState.docPath}
    onClose={closeDocHistoryDialog}
  />
)}
```

**2.3 将打开方法挂到命令系统上下文**

在调用 `useCommandSystem` 时，增加一个回调给 `AiCommandContext`：

```ts
useCommandSystem({
  ...,
  getCurrentFilePath,
  openDocConversationsHistory: (docPath: string) => openDocHistoryDialog(docPath),
  ...
})
```

说明：

- 这里的 `openDocConversationsHistory` 是给命令层调用的入口。
- `getCurrentFilePath` 已经在现有代码中实现，直接复用。

---

### 步骤 3：改造 `ai_conversation_history` 命令

**3.1 现状回顾**

当前实现（简化）：

- 调用 `docConversationService.getIndex()`，生成包含所有文档的 Markdown 索引；
- 通过 `newDocument/applyOpenedContent/setFilePath` 打开一个只读 Markdown 标签页。

**3.2 目标行为**

改为：

- 基于当前文件路径 `docPath`：
  - 若没有 `docPath` 或文件未保存 → 状态栏提示：
    - “请先打开并保存一个文档，再使用 History 查看会话历史”；
  - 若有 `docPath` 且存在 `openDocConversationsHistory` 回调 → 调用该回调打开 History 浮窗；
  - 不再生成全局索引 Markdown 文档。

**3.3 伪代码**

在 `app/src/modules/commands/registry.ts` 中的 `createAiCommands` 内：

```ts
ai_conversation_history: async () => {
  try {
    if (!ctx.getCurrentFilePath) {
      ctx.setStatusMessage('当前编辑器状态不可用，无法打开文档会话历史')
      return
    }
    const docPath = ctx.getCurrentFilePath()
    if (!docPath) {
      ctx.setStatusMessage('请先打开并保存一个文档，再使用 History 查看会话历史')
      return
    }

    if (!ctx.openDocConversationsHistory) {
      ctx.setStatusMessage('当前版本未注册 History 浮窗，无法展示文档会话历史')
      return
    }

    ctx.openDocConversationsHistory(docPath)
  } catch (err) {
    console.error('[commands] ai_conversation_history error', err)
    ctx.setStatusMessage('打开文档会话历史失败，请检查控制台日志')
  }
},
```

> 注意：同时保留 `getIndex()` 的能力（用于未来全局索引视图），可以在后续新增一个命令如 `ai_conversation_overview` 专门用于打开全局索引。

---

### 步骤 4：导出文件的 Tauri 命令（可选）

> 如果项目中已有通用的“保存文本到文件”命令，可以直接复用；否则可以按下面的思路新增一个命令。

**4.1 命令设计示意**

在 `src-tauri/src/lib.rs` 中新增一个简单命令：

```rust
#[tauri::command]
async fn save_text_file(path: String, content: String) -> Result<(), String> {
    use tokio::fs;
    fs::write(&path, content)
        .await
        .map_err(|e| format!("写入文件失败: {e}"))
}
```

或者封装一个带文件对话框的命令，让前端只传默认文件名：

```rust
#[tauri::command]
async fn save_text_with_dialog(default_file_name: String, content: String) -> Result<(), String> {
    // 1. 调用系统保存对话框获取路径
    // 2. 写入文本内容
}
```

**4.2 前端调用时机**

在 `DocConversationHistoryDialog` 中的导出 handler：

```ts
import { invoke } from '@tauri-apps/api/core'

async function handleExportMarkdown() {
  if (!record || !groups.length) return
  const content = buildMarkdownFromDocRecord(record, groups)
  const now = new Date()
  const ts = formatTimestampForFileName(now) // 自行实现，如 20250210-1430
  const defaultName = `AI History - ${extractFileBaseName(record.docPath)} - ${ts}.md`

  await invoke('save_text_with_dialog', {
    defaultFileName: defaultName,
    content,
  })
}
```

> 说明：这里仅描述命令形式和调用方式，具体实现细节需与现有 Tauri 命令和 UX 规范对齐。

---

## 四、验证清单

1. **基础展示**
   - 打开一个已保存的文档，触发 `AI > Session > History`：
     - 浮窗正常弹出；
     - 若该文档有历史，对话块按时间顺序显示；
     - 若无历史，显示空态提示。

2. **分页**
   - 当历史记录较多（> N 组）时：
     - 分页条显示正确的页数和当前页；
     - 点击“上一页/下一页”能在不同组之间切换；
     - 默认打开时落在最新一页。

3. **导出 Markdown**
   - 在有历史的文档上点击“导出为 Markdown”：
     - 弹出保存对话框；
     - 保存后打开导出的文件，内容结构符合预期（头部 summary + 多个“对话 N”块）。

4. **导出 JSON（如果实现）**
   - 导出的 JSON 包含 `docPath/sessionId/lastActiveAt/difyConversationId/messages` 等字段；
   - `messages` 内容与持久化文件中的记录一致。

5. **无路径场景**
   - 在未保存的新文档上触发 History：
     - 不弹窗；
     - 状态栏显示“请先打开并保存一个文档，再使用 History 查看会话历史”。

---

以上步骤落地后，即可完成：

- 当前文档维度的 AI 会话历史浮窗；
- 一问一答分组展示 + 分页；
- 导出当前文档全部历史对话为 Markdown/JSON 的能力。
