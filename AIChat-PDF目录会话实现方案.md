## AI Chat 按完整目录路径管理 Markdown 与 PDF 会话方案

### 1. 背景与目标

- **现状问题**：
  - AI 文档会话目前按 `docPath` 聚合，但 `docPath` 的来源不统一：
    - 早期实现中，`docPath` 有时是文件路径，有时是目录 key。
    - 切换到 PDF 标签后，`filePath` 不再更新，导致 PDF 会话仍然挂在最近一个 Markdown 文档所在目录的会话下面。
  - 不同目录下的 PDF 有时仍会“共享会话”，尤其是根目录下的文件会被统一映射为 `'/'`，进一步加重混淆。
- **目标**：
  - 所有文档（Markdown + PDF）的 AI 会话都按照 **“完整目录路径”** 聚合：
    - `docPath` 始终为“该文件的父目录的完整路径（已规范化）”。
    - 同一目录下的 Markdown 与 PDF 共用该目录的会话（按目录聚合）。
    - 不同目录下的文件（无论后缀）会话完全隔离。
  - 统一入口：任何地方只要需要文档会话，都使用同一套规则计算 `docPath`。

---

### 2. 核心设计

#### 2.1 目录 key 统一规则

- 使用已有工具函数 `getDirKeyFromDocPath(docPath)` 作为唯一入口，将“文件路径”转换为“目录会话 key”：

```19:1:app/src/modules/ai/domain/docPathUtils.ts
export function getDirKeyFromDocPath(docPath?: string | null): string | undefined {
  if (!docPath) return undefined

  const normalized = docPath.replace(/\\/g, '/').trim()
  if (!normalized) return undefined

  const idx = normalized.lastIndexOf('/')
  // 严格模式：仅使用本目录作为 key，不向上合并父目录，也不包含子目录
  // - 绝对路径如 "/Users/me/notes/todo.md" → "/Users/me/notes"
  // - 相对路径如 "notes/todo.md" → "notes"
  // - 根目录下文件如 "/todo.md" 或 "todo.md" 统一视作根目录会话
  if (idx <= 0) {
    // 将整个工作区根视为一个特殊目录 key
    return '/'
  }

  return normalized.slice(0, idx)
}
```

- **约定**：
  - 调用 `getDirKeyFromDocPath` 时，传入参数必须是 **文件的完整路径**（来自 Tauri 后端的绝对路径）或在当前工作区唯一的相对路径。
  - 任何需要 `docPath` 的地方都不直接手写字符串，而是：
    1. 拿到文件路径 `filePath`；
    2. 调 `getDirKeyFromDocPath(filePath)` 得到 `dirKey`；
    3. 将 `dirKey` 作为会话 key 传入 `useAiChatSession` / `docConversationService` / 命令系统等。

#### 2.2 Markdown 与 PDF 的统一入口

- 在 `WorkspaceShell` 中引入 AI Chat 专用的文件路径 `aiChatFilePath`：
  - Markdown 标签：使用 `filePath`（当前文本文件绝对路径）。
  - PDF 标签：使用 `activePdfPath`（当前激活 PDF 的绝对路径）。

```724:732:app/src/components/WorkspaceShell.tsx
// 当前激活的 PDF 文件路径（仅在 isPdfActive 时有值）
const activePdfPath = isPdfActive ? activeTab?.path ?? null : null

// AI Chat 使用的“文档路径”：
// - Markdown 标签：使用当前文本文件的路径（filePath）
// - PDF 标签：使用当前激活的 PDF 文件路径（activePdfPath）
const aiChatFilePath = isPdfActive ? activePdfPath : filePath
```

- Dock 模式 & 浮窗模式中的 `AiChatPane` / `AiChatDialog` 统一接收 `aiChatFilePath`：

```1729:1737:app/src/components/WorkspaceShell.tsx
<AiChatPane
  sessionKey={aiChatSessionKey}
  entryMode={aiChatState.entryMode}
  initialContext={aiChatState.initialContext}
  onClose={closeAiChatDialog}
  currentFilePath={aiChatFilePath}
  sourceTabId={activeTab?.id ?? null}
/>
```

```1820:1827:app/src/components/WorkspaceShell.tsx
<AiChatPane
  sessionKey={aiChatSessionKey}
  entryMode={aiChatState.entryMode}
  initialContext={aiChatState.initialContext}
  onClose={closeAiChatDialog}
  currentFilePath={aiChatFilePath}
  sourceTabId={activeTab?.id ?? null}
/>
```

```1846:1853:app/src/components/WorkspaceShell.tsx
<AiChatDialog
  open={aiChatOpen}
  entryMode={aiChatState.entryMode}
  initialContext={aiChatState.initialContext}
  onClose={closeAiChatDialog}
  currentFilePath={aiChatFilePath}
  tabId={aiChatState.tabId}
/>
```

- `AiChatPane` / `AiChatDialog` 内部统一通过 `getDirKeyFromDocPath` 计算目录级 `docPath`：

```51:79:app/src/modules/ai/ui/AiChatPane.tsx
const dirKey = currentFilePath ? getDirKeyFromDocPath(currentFilePath) : undefined

const { ... } = useAiChatSession({
  sessionKey,
  entryMode,
  initialContext,
  open: true,
  docPath: dirKey,
  legacyDocPath: currentFilePath ?? undefined,
})
```

```51:79:app/src/modules/ai/ui/AiChatDialog.tsx
const dirKey = currentFilePath ? getDirKeyFromDocPath(currentFilePath) : undefined

const { ... } = useAiChatSession({
  sessionKey: tabId,
  entryMode,
  initialContext,
  open,
  docPath: dirKey,
  legacyDocPath: currentFilePath ?? undefined,
})
```

- **效果**：
  - Markdown：`docPath = 当前 md 文件父目录的完整路径`。
  - PDF：`docPath = 当前 pdf 文件父目录的完整路径`。
  - 同一目录下的 Markdown 与 PDF 共用该目录的会话；不同目录下的文件会话隔离。

#### 2.3 持久化层与引擎保持“透明”

- `docConversationService`：
  - 不改动 `docPath`，按传入字符串原样存入 JSON 并用作查找 key：

```132:135:app/src/modules/ai/application/docConversationService.ts
async getByDocPath(docPath: string): Promise<DocConversationRecord | null> {
  await ensureLoaded()
  return getCache().find((r) => r.docPath === docPath) ?? null
}
```

```144:171:app/src/modules/ai/application/docConversationService.ts
const idx = records.findIndex((r) => r.docPath === docPath)
...
records.push({
  docPath,
  sessionId: genSessionId(),
  lastActiveAt: now,
  difyConversationId,
  messages: nextMessages,
})
```

- `chatSessionService`：
  - 在每轮对话结束时，将 `docPath` 原样传入 `upsertFromState`：

```241:249:app/src/modules/ai/application/chatSessionService.ts
if (docPath) {
  void docConversationService
    .upsertFromState({
      docPath,
      state,
      providerType,
      modelName: currentModelId,
      difyConversationId,
    })
}
```

- **结论**：
  - 上层一旦统一以“完整目录路径”构造 `docPath`，持久化和对话引擎层会自动按照该 key 聚合会话，不需要额外逻辑。

---

### 3. 实施步骤

#### 步骤 1：统一 AI Chat 的 `currentFilePath`

- **目标**：保证 AI Chat 内部拿到的始终是“当前 Markdown 或当前 PDF 的完整文件路径”。
- **已完成改动**（在 `WorkspaceShell.tsx` 中）：
  1. 引入 `activePdfPath`：
     - 仅在 `isPdfActive` 为 true 时，从 `activeTab.path` 取出当前 PDF 的绝对路径。
  2. 引入 `aiChatFilePath`：
     - Markdown 标签：`aiChatFilePath = filePath`。
     - PDF 标签：`aiChatFilePath = activePdfPath`。
  3. Dock / 浮窗模式下所有 `AiChatPane` / `AiChatDialog` 统一使用 `aiChatFilePath` 作为 `currentFilePath`。

#### 步骤 2：在 AiChatPane / AiChatDialog 中统一使用目录 key

- **目标**：所有会话相关操作（包括 slash 命令）都基于“目录完整路径”。
- **实现要点**：
  1. 通过 `getDirKeyFromDocPath(currentFilePath)` 计算 `dirKey`。
  2. 在 `useAiChatSession` 的参数中，将 `docPath` 设置为 `dirKey`。
  3. 对于旧数据，通过 `legacyDocPath: currentFilePath` 支持懒迁移，不影响新逻辑。

#### 步骤 3：命令系统中统一使用目录 key

- **目标**：菜单/快捷键触发的“历史 / 清空 / 压缩文档会话”与 AI Chat 内部使用相同的 `docPath` 规则。
- **建议改动（在 `app/src/modules/commands/registry.ts` 中）：**

  - 引入 `getDirKeyFromDocPath`：
    - `import { getDirKeyFromDocPath } from '../ai/domain/docPathUtils'`

  - 在 `ai_conversation_history` 中：
    - 由：
      - `const docPath = ctx.getCurrentFilePath()` → 改为：
      - `const filePath = ctx.getCurrentFilePath()`
      - `const docPath = filePath ? getDirKeyFromDocPath(filePath) : undefined`
    - 只在 `docPath` 存在时调用 `ctx.openDocConversationsHistory(docPath)`。

  - 在 `ai_conversation_clear` / `ai_conversation_compress` 中，同理：
    - 先拿 `filePath = ctx.getCurrentFilePath()`；
    - 通过 `getDirKeyFromDocPath(filePath)` 算出目录 key；
    - 再调用 `docConversationService.clearByDocPath(dirKey)` / `compressByDocPath(dirKey)`。

#### 步骤 4：历史对话框中对 docPath 做兜底规范化

- **目标**：即使有调用方仍传入“文件路径”，也能在历史对话框内部统一归一到“目录完整路径”。
- **实现方式**（`DocConversationHistoryDialog` 中）：

  - 使用 `useMemo` 将传入的 `docPath` 归一化：

  ```ts
  const dirKey = useMemo(
    () => getDirKeyFromDocPath(docPath) ?? docPath,
    [docPath],
  )
  ```

  - 后续所有 `docConversationService.getByDocPath` / 渲染逻辑都用 `dirKey`。

#### 步骤 5：验证与回归

- **验证点**：
  1. 打开目录 A 下的 Markdown 文件，与目录 B 下的 Markdown 文件：
     - 在各自文件内用 AI Chat 对话，确认两侧历史互不干扰。
  2. 打开目录 A 下的 PDF，与目录 B 下的 PDF：
     - 启动 AI Chat，确认各自会话独立，不再共享内容。
  3. 同一目录下：
     - Markdown 与该目录下的 PDF 使用同一条目录会话。
  4. 使用菜单 / 快捷键：
     - 在目录 A 的文件上执行“清空/压缩会话”，只影响目录 A 的历史，不影响目录 B。

- **回归点**：
  - 旧的 Markdown 文档会话：
    - 通过 `legacyDocPath` 懒迁移逻辑，能在首次访问时自动转移到新的目录 key 下，或至少保证“旧会话可见”。
  - 全局记忆 / Dify conversationId：
    - 持久化时仍以新的 `docPath` 为 key，`difyConversationId` 会随记录一起更新，不影响云端会话延续。

---

### 4. 总结

- **关键原则**：
  - 所有会话相关操作都必须通过 `getDirKeyFromDocPath` 将“文件路径”映射到“目录完整路径”，且这一转换只做一次。
  - 持久化与会话引擎只把 `docPath` 当作不透明字符串使用，不再在内部做二次解析或截断。
- **实施结果**：
  - Markdown 与 PDF 在同一目录下共享目录级会话；
  - 不同目录下的文件（不论后缀）各自拥有独立的会话历史；
  - 所有入口（AI Chat、命令系统、历史对话框）都遵循同一套规则，实现了“基于目录完整路径”的统一文档会话管理。