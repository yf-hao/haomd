## AIChat 指令系统设计方案（/clear, /compress, /history）

### 1. 目标与需求概述

- **功能目标**：在 AI Chat 输入框中支持「斜杠指令」：
  - **`/clear`**：清空当前文档的 AI 会话（等价于菜单中的清空会话）。
  - **`/compress`**：压缩当前文档的会话历史（等价于菜单中的会话压缩）。
  - **`/history`**：显示当前文档的 AI Session History 浮窗。
- **行为要求**：
  - 指令本身 **不发送给大模型**，也 **不作为用户消息出现在对话气泡中**。
  - 执行结果需要有可感知反馈：
    - `/clear`：当前聊天窗口的消息立即被清空或重置。
    - `/compress`：触发会话压缩，并给用户一个“已压缩”的提示。
    - `/history`：打开已有的 Session History 浮窗。
  - 对未知指令（如 `/abc`）给出友好提示，例如：
    - `未知指令：/abc，可用指令：/clear, /compress, /history`。
- **架构目标**：
  - 尽量复用现有命令系统和文档会话服务，避免重复业务逻辑。
  - 通过抽象上下文和桥接层，降低与 UI 和具体服务的耦合度。
  - 方便后续扩展更多 `/xxx` 指令（如 `/help`、`/settings` 等）。

---

### 2. 现有代码结构与可复用点分析

#### 2.1 Ai Chat UI 与发送路径

- **Dock 模式组件**：`app/src/modules/ai/ui/AiChatPane.tsx`
  - 核心发送逻辑：

```192:213:app/src/modules/ai/ui/AiChatPane.tsx
  const doSend = async () => {
    const contentToSend = input
    setInput('')
    autoResizeInput()
    await sendMessage(contentToSend, {
      contextPrefix,
      contextPrefixUsed,
      onContextUsed: () => {
        setContextPrefixUsed(true)
        setContextPrefix(null)
      },
      attachedImageDataUrl,
      onClearAttachedImage: () => setAttachedImageDataUrl(null),
    })
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (isComposingRef.current) return
    await doSend()
  }
```

- **浮窗模式组件**：`app/src/modules/ai/ui/AiChatDialog.tsx`
  - 发送逻辑与 `AiChatPane` 基本一致：

```187:206:app/src/modules/ai/ui/AiChatDialog.tsx
  const doSend = async () => {
    const contentToSend = input
    setInput('')
    autoResizeInput()
    await sendMessage(contentToSend, {
      contextPrefix,
      contextPrefixUsed,
      onContextUsed: () => {
        setContextPrefixUsed(true)
        setContextPrefix(null)
      },
      attachedImageDataUrl,
      onClearAttachedImage: () => setAttachedImageDataUrl(null),
    })
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    await doSend()
  }
```

- **结论（可插入点）**：
  - 两个组件都在本地维护 `input`，通过 `useAiChatSession` 暴露的 `sendMessage` 发送给 `ChatSession`。
  - 目前没有“指令解析”逻辑，所有内容都会直接当作 prompt 发给模型。
  - **理想插入点**：在各自的 `doSend` 中，在调用 `sendMessage` 之前加一层“斜杠指令解析器”。

#### 2.2 会话状态与文档级会话服务

- **会话入口 Hook**：`app/src/modules/ai/ui/hooks/useAiChatSession.ts`
  - 负责根据 `docPath` 载入文档会话历史、绑定 `ChatSession`、同步状态：

```63:83:app/src/modules/ai/ui/hooks/useAiChatSession.ts
  useEffect(() => {
    if (!open) return

    let cancelled = false
    setLoading(true)
    setError(null)

    const startSession = async () => {
      try {
        let initialState: ConversationState | undefined
        let initialDifyConversationId: string | undefined

        if (docPath) {
          const saved: DocConversationRecord | null = await docConversationService.getByDocPath(docPath)
          if (saved) {
            initialState = buildStateFromDocRecord(saved, entryMode)
            if (saved.difyConversationId) {
              initialDifyConversationId = saved.difyConversationId
            }
          }
        }

        const startOptions: StartChatOptions = {
          entryMode,
          initialContext,
          ...(initialState ? { initialState } : {}),
          ...(docPath ? { docPath } : {}),
          ...(initialDifyConversationId ? { initialDifyConversationId } : {}),
          onStateChange: (nextState) => {
            if (cancelled) return
            setState(nextState)
          },
        }
```

- **文档会话服务**：`docConversationService`（由 AI 模块提供）
  - 在命令系统中已经被用于清空/压缩文档级会话：

```381:415:app/src/modules/commands/registry.ts
    ai_conversation_clear: async () => {
      ...
      await docConversationService.clearByDocPath(docPath)
      ctx.setStatusMessage('已清空当前文档的 AI 会话历史')
    },
    ai_conversation_compress: async () => {
      ...
      await docConversationService.compressByDocPath(docPath)
      ctx.setStatusMessage('已触发文档会话压缩（当前版本仅占位，未真正执行 AI 摘要）')
    },
```

- **结论（可复用点）**：
  - `/clear` 与 `/compress` 完全可以复用 `docConversationService.clearByDocPath` 与 `docConversationService.compressByDocPath`，避免在 Ai Chat 内部重复业务逻辑。

#### 2.3 全局命令系统与 Session History

- **命令系统入口 Hook**：`app/src/hooks/useCommandSystem.ts`

```64:101:app/src/hooks/useCommandSystem.ts
  const commands: CommandRegistry = useMemo(
    () =>
      createCommandRegistry({
        ...
        aiClient,
        openAiChatDialog,
        getCurrentMarkdown,
        getCurrentFileName,
        getCurrentSelectionText,
        getCurrentFilePath,
        openDocConversationsHistory,
        addStandaloneFile,
      }),
```

- **AI 相关命令定义**：`createAiCommands` 中已经包括：

```360:415:app/src/modules/commands/registry.ts
    ai_conversation_history: async () => { ... ctx.openDocConversationsHistory(docPath) ... },
    ai_conversation_clear: async () => { ... docConversationService.clearByDocPath(docPath) ... },
    ai_conversation_compress: async () => { ... docConversationService.compressByDocPath(docPath) ... },
```

- **Session History 浮窗组件**：`app/src/modules/ai/ui/DocConversationHistoryDialog.tsx`

```129:177:app/src/modules/ai/ui/DocConversationHistoryDialog.tsx
  useEffect(() => {
    if (!open) return
    ...
    const rec = await docConversationService.getByDocPath(docPath)
    ...
    const built = buildConversationGroups(rec.messages)
    setGroups(built)
```

- **结论（可复用点）**：
  - `/history` 指令可以复用已有的 UI 打开逻辑：通过 `openDocConversationsHistory(docPath)` 打开会话历史浮窗，而无需在 Ai Chat 里重新实现一套历史展示。
  - 清空/压缩/历史这三种行为已经由命令系统封装，斜杠指令可以通过“桥接命令”直接复用。

---

### 3. 设计方案：低耦合的 Ai Chat 斜杠指令系统

#### 3.1 总体设计思路

- **核心思想**：
  - 在 Ai Chat 文本发送前增加一层独立的「斜杠指令解析模块」，负责：
    - 解析用户输入是否为指令（以 `/` 开头）；
    - 根据指令名调用对应的 handler；
    - 告知上层是否已经“处理完毕”，从而决定是否还要将内容发送给大模型。
  - 解析模块不直接依赖 React、UI 组件和具体服务，只依赖一组抽象的上下文接口（如 `docPath`、`runAppCommand`、`openDocHistory` 等）。

- **复用现有能力**：
  - 清空与压缩会话 → 复用 `docConversationService.clearByDocPath` / `compressByDocPath` 或 `ai_conversation_clear` / `ai_conversation_compress` 命令。
  - 展示 Session History → 复用 `openDocConversationsHistory(docPath)` 与 `DocConversationHistoryDialog`。

- **扩展性**：
  - 指令采用注册表形式（`slashCommands`），新指令只需要添加一条配置与 handler，不需要修改 Ai Chat 组件内部逻辑。

#### 3.2 新增模块：`aiSlashCommands`（解析与注册表）

- **新文件建议**：`app/src/modules/ai/ui/aiSlashCommands.ts`

##### 3.2.1 上下文定义（解耦 UI 与实现）

```ts
export type AiSlashCommandContext = {
  /** 当前关联文档路径；无文档时为 undefined */
  docPath?: string
  /** 运行已有的 App 命令（通过命令系统桥接） */
  runAppCommand?: (actionId: string) => Promise<void>
  /** 直接访问文档会话服务（可选） */
  clearDocConversation?: (docPath: string) => Promise<void>
  compressDocConversation?: (docPath: string) => Promise<void>
  openDocHistory?: (docPath: string) => void
  /** 在当前 Ai Chat 中插入系统提示消息（可选，将来用于反馈） */
  pushSystemMessage?: (content: string) => void
}
```

- **说明**：
  - `AiSlashCommandContext` 由上层（Ai Chat 容器）构造并传入解析器。
  - 解析模块仅通过这些抽象能力与外界交互，不直接 import 具体服务或组件。

##### 3.2.2 指令定义与注册表

```ts
export type AiSlashCommandHandler = (ctx: AiSlashCommandContext, args: string[]) => Promise<void> | void

export type AiSlashCommandDef = {
  name: string
  description: string
  handler: AiSlashCommandHandler
}

const slashCommands: Record<string, AiSlashCommandDef> = {
  clear: {
    name: 'clear',
    description: '清空当前文档的 AI 会话历史',
    async handler(ctx) {
      if (!ctx.docPath && ctx.runAppCommand) {
        await ctx.runAppCommand('ai_conversation_clear')
        return
      }
      if (!ctx.docPath || !ctx.clearDocConversation) return
      await ctx.clearDocConversation(ctx.docPath)
      ctx.pushSystemMessage?.('已清空当前文档的 AI 会话历史。')
    },
  },
  compress: {
    name: 'compress',
    description: '压缩当前文档的 AI 会话历史',
    async handler(ctx) {
      if (!ctx.docPath && ctx.runAppCommand) {
        await ctx.runAppCommand('ai_conversation_compress')
        return
      }
      if (!ctx.docPath || !ctx.compressDocConversation) return
      await ctx.compressDocConversation(ctx.docPath)
      ctx.pushSystemMessage?.('已触发当前文档会话压缩。')
    },
  },
  history: {
    name: 'history',
    description: '显示当前文档的 AI Session History',
    async handler(ctx) {
      if (!ctx.docPath && ctx.runAppCommand) {
        await ctx.runAppCommand('ai_conversation_history')
        return
      }
      if (!ctx.docPath || !ctx.openDocHistory) return
      ctx.openDocHistory(ctx.docPath)
    },
  },
}
```

- **说明**：
  - `/clear`、`/compress`、`/history` 优先使用专门注入的 service 方法；如果不存在，则退回到运行对应的 App 命令（使得逻辑复用命令系统）。
  - `pushSystemMessage` 用于在 Ai Chat 内部添加一条系统提示气泡（可选能力，后续可以扩展为特定的“系统消息” UI）。

##### 3.2.3 解析与调度 API

```ts
export function parseSlashCommand(input: string): { cmd: string; args: string[] } | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return null
  const [rawCmd, ...args] = trimmed.slice(1).split(/\s+/)
  const cmd = rawCmd.toLowerCase()
  if (!cmd) return null
  return { cmd, args }
}

export async function tryHandleSlashCommand(
  input: string,
  ctx: AiSlashCommandContext,
): Promise<'handled' | 'not_command'> {
  const parsed = parseSlashCommand(input)
  if (!parsed) return 'not_command'

  const def = slashCommands[parsed.cmd]
  if (!def) {
    ctx.pushSystemMessage?.(`未知指令：/${parsed.cmd}。可用指令：/clear, /compress, /history`)
    return 'handled'
  }

  await Promise.resolve(def.handler(ctx, parsed.args))
  return 'handled'
}
```

- **说明**：
  - `parseSlashCommand` 专注于语法层面：识别 `/` 开头、拆分命令名与参数。
  - `tryHandleSlashCommand` 尝试在注册表中查找并执行 handler，并返回是否“已经处理”。
  - Ai Chat UI 只需要根据返回值决定是否继续走 `sendMessage`。

#### 3.3 Ai Chat 与命令/服务之间的桥接层

为了保持 Ai Chat 组件对外部服务的低耦合，建议引入一个轻量级的 **AiChatCommandBridge**：

- **桥接类型定义**（示例文件：`app/src/modules/ai/ui/AiChatCommandBridge.tsx`）：

```ts
export type AiChatCommandBridge = {
  runAppCommand: (id: string) => Promise<void>
  openDocHistory: (docPath: string) => void
  clearDocConversation: (docPath: string) => Promise<void>
  compressDocConversation: (docPath: string) => Promise<void>
}

export const AiChatCommandBridgeContext = createContext<AiChatCommandBridge | null>(null)
```

- **在顶层（例如 `WorkspaceShell`）中实现**：
  - 使用 `useCommandSystem` 获取 `dispatchAction`，作为 `runAppCommand` 的实现。
  - 直接基于现有的 `docConversationService` 与 `openDocConversationsHistory` 实现其它方法：
    - `clearDocConversation(docPath)` → 调用 `docConversationService.clearByDocPath(docPath)`。
    - `compressDocConversation(docPath)` → 调用 `docConversationService.compressByDocPath(docPath)`。
    - `openDocHistory(docPath)` → 调用 `openDocConversationsHistory(docPath)`。
  - 用 `<AiChatCommandBridgeContext.Provider value={bridge}>` 将桥接对象注入 Ai Chat 所在的子树。

> 这样，Ai Chat 组件不需要直接 import `docConversationService`、命令注册表或 History 对话框，只依赖一个非常窄的桥接接口，符合低耦合原则。

#### 3.4 在 Ai Chat 发送逻辑中接入指令系统

指令处理的入口统一放在 `AiChatPane` 与 `AiChatDialog` 的 `doSend` 中：

- **以 `AiChatPane` 为例**：

```ts
const bridge = useContext(AiChatCommandBridgeContext)

const doSend = async () => {
  const contentToSend = input
  setInput('')
  autoResizeInput()

  // 1. 先尝试作为斜杠指令处理
  const handled = await tryHandleSlashCommand(contentToSend, {
    docPath: currentFilePath ?? undefined,
    runAppCommand: bridge?.runAppCommand,
    clearDocConversation: bridge?.clearDocConversation,
    compressDocConversation: bridge?.compressDocConversation,
    openDocHistory: bridge?.openDocHistory,
    // pushSystemMessage: ...（可以在这里实现为往当前对话插入系统提示气泡）
  })

  if (handled === 'handled') {
    // 已作为指令处理完毕：不再发送给大模型
    return
  }

  // 2. 普通消息：交给大模型
  await sendMessage(contentToSend, {
    contextPrefix,
    contextPrefixUsed,
    onContextUsed: () => {
      setContextPrefixUsed(true)
      setContextPrefix(null)
    },
    attachedImageDataUrl,
    onClearAttachedImage: () => setAttachedImageDataUrl(null),
  })
}
```

- **`AiChatDialog`** 采用同样的方式改造其 `doSend`，保证两种入口行为一致。

- **说明**：
  - 这样一来，当用户输入 `/clear`、`/compress`、`/history` 并按下回车时：
    - `tryHandleSlashCommand` 会拦截并执行指令；
    - `handled === 'handled'`，不会走到 `sendMessage`，也就不会发给大模型。
  - 普通内容则仍然按原有流程发送给模型，保持现有体验。

#### 3.5 指令执行后的 UI 刷新与反馈

- **会话持久化层变化**：
  - `/clear` 与 `/compress` 会对当前 `docPath` 的会话记录进行修改（清空或压缩）。

- **Ai Chat UI 刷新**（建议）：
  - 目前 `useAiChatSession` 在打开时会从 `docConversationService` 载入一次历史，但不会在指令完成后自动 reload。
  - 为了更好的体验，建议在 `useAiChatSession` 的返回值中预留一个方法，例如：
    - `reloadFromDocHistory(): Promise<void>` 或 `resetConversation(): Promise<void>`。
  - 之后在 `/clear` 指令 handler 中，在持久化层操作成功后调用该方法，让当前 Ai Chat 立刻显示“空会话”状态。

- **系统提示消息**：
  - 通过 `AiSlashCommandContext.pushSystemMessage`，可以在会话中插入一条系统风格提示，例如：
    - `/clear` 后：`已清空当前文档的 AI 会话历史。`
    - `/compress` 后：`已触发当前文档会话压缩。`
    - 未知指令：`未知指令：/xxx，可用指令：/clear, /compress, /history`。
  - 具体如何在 UI 上呈现“系统消息气泡”，可以复用现有的 message 类型（如 `role: 'system'`）或增加专门的样式。

---

### 4. 可扩展性与低耦合性分析

#### 4.1 低耦合性

- Ai Chat 组件（`AiChatPane` / `AiChatDialog`）只做两件事：
  - 在发送前调用 `tryHandleSlashCommand`；
  - 当解析器未处理时，将内容交给 `sendMessage`。
- 斜杠指令的业务实现完全封装在：
  - `aiSlashCommands` 模块（解析与注册表）；
  - `AiChatCommandBridge`（桥接命令系统与文档会话服务）。
- Ai Chat 不依赖 `docConversationService`、命令注册表或 History 组件，避免硬耦合。

#### 4.2 可扩展性

- 新增指令无需修改 Ai Chat UI，只需：
  - 在 `slashCommands` 注册表中增加一个 `AiSlashCommandDef`；
  - 在 handler 中调用 `AiSlashCommandContext` 提供的能力（或通过 `runAppCommand` 触发新的 App 命令）。
- 如果未来需要支持 `/help`、`/settings` 等指令，只要扩展注册表即可。

#### 4.3 与命令系统的一致性

- 斜杠指令通过 `AiChatCommandBridge` 调用现有命令或服务：
  - `/clear` ↔ `ai_conversation_clear`
  - `/compress` ↔ `ai_conversation_compress`
  - `/history` ↔ `ai_conversation_history`
- 当命令实现升级（例如真正接入 AI 会话压缩算法），斜杠指令将自动获得相同的行为，无需重复维护逻辑。

---

### 5. 实施步骤概要

1. **新增 `aiSlashCommands` 模块**：
   - 定义 `AiSlashCommandContext`、指令注册表与 `tryHandleSlashCommand`。
   - 实现 `/clear`、`/compress`、`/history` 三个基础指令。
2. **新增 `AiChatCommandBridge` 及其 Context**：
   - 在顶层（如 `WorkspaceShell`）中封装命令系统与文档会话服务，并注入到 Ai Chat 子树。
3. **改造 `AiChatPane` 与 `AiChatDialog`**：
   - 在各自的 `doSend` 中调用 `tryHandleSlashCommand`；
   - 当返回值为 `handled` 时，不再发送给大模型。
4. **（可选）增强会话 UI 刷新能力**：
   - 为 `useAiChatSession` 增加 `reloadFromDocHistory` 或 `resetConversation`，用于 `/clear` 命令后刷新 UI。
5. **（可选）系统消息展示**：
   - 利用 `pushSystemMessage` 在当前会话中插入系统提示气泡，增强指令反馈体验。

以上方案在复用现有命令系统与文档会话服务的基础上，引入一层轻量的解析与桥接，既满足 `/clear`、`/compress`、`/history` 的需求，又为未来扩展更多指令预留了空间，并保持 Ai Chat UI 与业务逻辑的低耦合。