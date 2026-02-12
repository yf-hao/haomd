## AI Chat 文档级会话历史 & Dify 集成实施方案

### 一、目标与约束

- **按文档维度管理会话历史**：
  - 以 `docPath` 作为会话聚合的主键（不再按模型拆分）。
  - 同一文档下，所有模型（包括 Dify）产生的对话都出现在同一时间线视图中。

- **Dify 特殊规则**：
  - Dify 的“真正上下文”由其云端维护，通过 `conversationId` 识别。
  - 本地只需：
    - 记录每个文档当前的 `difyConversationId`，用于续对话；
    - 将本轮问答以“视图消息”的形式记入本地会话时间线，供 UI 展示。

- **其他模型规则**：
  - 除 Dify 外，其他模型（OpenAI、本地模型、Coze 等）**共用同一套 `messages`**（按 `docPath`）：
    - 构造请求时，从该文档的历史消息中截取最近 N 条作为上下文。
    - 回复完成后，将本轮 user/assistant 双方消息追加到同一历史中。

- **持久化方式**：
  - 使用“**全量索引 + 单个数据文件**”结构：
    - `conversations_index.json`：轻量索引，按 `docPath` 快速列出有哪些文档有会话。
    - `conversations_data.json`：存放所有文档的完整会话历史与 Dify 元数据。
  - 写入频率：**每次一轮消息完成后写入一次**（从运行时会话状态生成 snapshot）。

- **菜单与功能范围**：
  - 顶层菜单增加 `AI > Conversation` 分组：
    - `History`：查看当前文档的会话时间线。
    - `Compress`：对当前文档的历史做摘要压缩，折叠旧消息。
    - `Clear`：清空当前文档的会话历史（包括本地 messages 和 Dify conversationId）。

---

### 二、核心数据模型设计

#### 2.1 文档级会话记录：`DocConversationRecord`

```ts
// 按 docPath 聚合一份会话记录
export type DocConversationRecord = {
  docPath: string               // 文档唯一标识（绝对路径或规范化路径）
  sessionId: string             // 当前文档会话的逻辑 ID，用于 Clear/重置
  lastActiveAt: number          // 最近一次用户/模型交互时间戳（ms）

  // Dify 专用：仅用于续上 Dify 云端会话上下文
  difyConversationId?: string

  // 本地“会话时间线” + 非 Dify 模型的上下文来源
  messages: DocConversationMessage[]
}
```

> 说明：
> - `docPath` 是唯一键（不按模型拆分会话）。
> - `sessionId` 用于区分“本次会话”和历史（清空时可以换一个新 ID）。
> - `difyConversationId` 只影响 Dify 请求，不参与键的构建。

#### 2.2 单条消息结构：`DocConversationMessage`

```ts
export type DocConversationMessage = {
  id: string                    // 唯一 ID（可复用 UI 中 viewMessages 的 id）
  docPath: string               // 冗余字段，方便调试和诊断
  timestamp: number             // 消息时间戳
  role: 'user' | 'assistant' | 'system'
  content: string               // 文本内容（可为裁剪/摘要版）

  // 只用于展示/分析，不参与会话键
  meta?: {
    providerType?: 'dify' | 'openai' | 'local' | 'coze' | 'other'
    modelName?: string          // 模型名，纯展示
    hasImage?: boolean          // 是否携带图片/附件
    tokensUsed?: number         // 可选，用于统计
  }
}
```

> 说明：
> - 对于 Dify：`meta.providerType = 'dify'`，`content` 可以是 Dify 最终 answer 文本。
> - 对于 Vision 或附图场景：`hasImage = true` 即可，图片本身无需存入此处（另有附件系统）。

#### 2.3 索引结构：`ConversationIndexEntry`

```ts
export type ConversationIndexEntry = {
  docPath: string
  sessionId: string
  lastActiveAt: number
  hasDifyConversation: boolean   // 是否拥有有效的 difyConversationId
  messageCount: number           // 该文档下消息条数（用于列表展示/排序）
}
```

---

### 三、存储结构与路径设计

#### 3.1 文件布局

- 建议在 Tauri 应用数据目录下建立专用子目录，例如：
  - 根目录：`<appDataDir>/haomd/ai-conversations/`
  - 索引文件：`conversations_index.json`
  - 数据文件：`conversations_data.json`

> Tauri 侧使用 `appDataDir()` + `join()` 组合出上述路径；前端通过命令/插件读写。

#### 3.2 文件内容示例

**`conversations_index.json`**：

```json
[
  {
    "docPath": "/workspace/docs/intro.md",
    "sessionId": "2025-02-10T12:00:00.000Z#1",
    "lastActiveAt": 1739270400000,
    "hasDifyConversation": true,
    "messageCount": 42
  }
]
```

**`conversations_data.json`**：

```json
[
  {
    "docPath": "/workspace/docs/intro.md",
    "sessionId": "2025-02-10T12:00:00.000Z#1",
    "lastActiveAt": 1739270400000,
    "difyConversationId": "conv_abc123",
    "messages": [
      {
        "id": "u1",
        "docPath": "/workspace/docs/intro.md",
        "timestamp": 1739270400000,
        "role": "user",
        "content": "帮我总结这篇文档",
        "meta": { "providerType": "openai", "modelName": "gpt-4.1" }
      },
      {
        "id": "a1",
        "docPath": "/workspace/docs/intro.md",
        "timestamp": 1739270405000,
        "role": "assistant",
        "content": "这是文档摘要……",
        "meta": { "providerType": "openai", "modelName": "gpt-4.1" }
      },
      {
        "id": "u2",
        "docPath": "/workspace/docs/intro.md",
        "timestamp": 1739270410000,
        "role": "user",
        "content": "再帮我生成一个大纲",
        "meta": { "providerType": "dify", "modelName": "dify-app-1" }
      },
      {
        "id": "a2",
        "docPath": "/workspace/docs/intro.md",
        "timestamp": 1739270415000,
        "role": "assistant",
        "content": "大纲如下……",
        "meta": { "providerType": "dify", "modelName": "dify-app-1" }
      }
    ]
  }
]
```

---

### 四、运行时集成方案

本节按“现有模块”拆解如何接入文档级会话历史。

#### 4.1 与 `ConversationState` / `chatSessionService` 集成

现状：
- `ConversationState` 包含：
  - `engineHistory: EngineMessage[]`
  - `viewMessages: ChatMessageView[]`
- 在 `chatSessionService.ts` 中：
  - `appendUserInput` 在 Engine + View 双线追加用户输入；
  - `appendAssistantPlaceholder` + `appendAssistantChunk` + `completeAssistantMessage` 记录模型的回复；
  - `engineHistoryToChatMessages` 将 `engineHistory` 转成 `ChatMessage[]` 并传给 Provider。

改造思路：

- **新增一个纯函数，将当前会话状态映射为 DocConversationMessage[]：**

```ts
function toDocMessages(
  docPath: string,
  state: ConversationState,
  providerType: ProviderType,
  modelName: string,
): DocConversationMessage[] {
  const now = Date.now()

  // 以 viewMessages 为基准，因为它已经排好顺序，且包含 user/assistant 角色
  return state.viewMessages
    .filter((m) => !m.hidden)               // 可选：过滤掉仅用于上下文、不需展示的消息
    .map((m): DocConversationMessage => ({
      id: m.id,
      docPath,
      timestamp: now,                      // 简化：如需精确，可在 ChatMessageView 中扩展时间戳字段
      role: m.role,
      content: m.content,
      meta: {
        providerType,
        modelName,
      },
    }))
}
```

- **在会话一轮完成时调用**：
  - 触发点：`runStreamWithCurrentHistory` / `runVisionStream` 的 `finally` 块，在 `completeAssistantMessage` 之后。
  - 在这里，我们调用“文档会话服务”（见 4.3）将当前 `state` 同步到持久化层。

#### 4.2 与 Dify Streaming 客户端集成

现状：
- `createDifyStreamingClient.ts` 创建 `SimpleChat` 实例，并在 `askStream` 中：
  - 把 `StreamingChatRequest.messages` 映射为 `SimpleChat` 的 `messages`；
  - 实际请求时，`SimpleChat.getLastUserMessage` 仅取最后一条用户消息作为 `query`；
  - `SimpleChat` 在流式解析 SSE 事件时更新内部 `conversationId`，并提供 `clearHistory` 等方法。

目标（与新规则对齐）：
- **上下文规则**：
  - Dify 调用只用“最后一条用户提问 + conversationId”。
  - 当前实现已经满足这个要求，无需额外修改上下文构造逻辑。
- **持久化规则**：
  - 仍然把 Dify 的 user/assistant 消息记录在 `state.engineHistory` / `viewMessages` 中（当前逻辑已经如此）。
  - 每轮结束时，统一通过 4.3 的文档会话服务写入到 `DocConversationRecord` 中。
- **会话续接规则**：
  - 需要让 Dify 客户端在初始化时能够接收一个已有的 `conversationId`：
    - 方案 A：给 `SimpleChat` 增加 `setConversationId(id: string)` 和 `getConversationId()`；
    - 方案 B：让 `askStream` 支持传入 `conversationId`，内部优先使用参数。
  - 从持久化记录中读取 `difyConversationId` 后，在创建 Dify 客户端时传入，以便续上历史。

实施建议：

1. 在 `SimpleChat` 中：
   - 增加方法：

   ```ts
   public getConversationId(): string | null {
     return this.conversationId
   }

   public setConversationId(id: string | null): void {
     this.conversationId = id
   }
   ```

2. 在 `createDifyStreamingClient` 中：
   - 支持可选的 `initialConversationId?: string` 配置：

   ```ts
   export type DifyChatClientConfig = {
     // ...已有字段
     initialConversationId?: string
   }

   export function createDifyStreamingClient(config: DifyChatClientConfig): IStreamingChatClient {
     const chat = new SimpleChat()
     chat.init({ /* ... */ })
     if (config.initialConversationId) {
       chat.setConversationId(config.initialConversationId)
     }
     // ...
   }
   ```

3. 在调用 Dify 客户端的上层（见 4.3），从 `DocConversationRecord` 中取出 `difyConversationId`，并在创建客户端时透传。

#### 4.3 新增“文档会话服务”（前端）

新增模块：`app/src/modules/ai/application/docConversationService.ts`。

职责：
- 以 **docPath** 为主键，维护文档级会话记录：
  - 从当前运行时会话状态生成 `DocConversationRecord`；
  - 合并到内存中的 `DocConversationRecord[]` 集合；
  - 调用 Tauri 命令读写 `conversations_index.json` & `conversations_data.json`。

核心接口示例：

```ts
export type DocConversationService = {
  loadAll(): Promise<DocConversationRecord[]>        // 启动时加载全量（可缓存）
  getByDocPath(docPath: string): Promise<DocConversationRecord | null>
  upsertFromState(options: {
    docPath: string
    state: ConversationState
    providerType: ProviderType
    modelName: string
    difyConversationId?: string
  }): Promise<void>
  clearByDocPath(docPath: string): Promise<void>
  compressByDocPath(docPath: string): Promise<void>
  getIndex(): Promise<ConversationIndexEntry[]>
}
```

- `upsertFromState`：
  - 用 `toDocMessages` 将 `ConversationState` 转为 `DocConversationMessage[]`；
  - 与已有 `DocConversationRecord.messages` 合并（注意去重与增量逻辑）；
  - 更新 `lastActiveAt` / `sessionId` / `messageCount` / `hasDifyConversation`；
  - 统一写回数据文件与索引文件。

- 在 `chatSessionService` 的 `runStreamWithCurrentHistory` / `runVisionStream` 的 `finally` 中调用：

```ts
await docConversationService.upsertFromState({
  docPath: currentDocPath,             // 从 WorkspaceShell / sessionKey 解析
  state,
  providerType,
  modelName: currentModelId,
  difyConversationId: getDifyConversationIdIfAny(),
})
```

> 其中 `currentDocPath` 可通过 `AiChatSessionKey` 与 WorkspaceShell 当前激活文档关联。

#### 4.4 与 `AiChatSessionService` / `useAiChatSession` 集成

现状：
- `AiChatSessionService` 负责：
  - 复用 `ChatSession` 对象（避免重复创建）；
  - 通过 `sessionKey` 管理不同入口（例如按 tab / 文档等）。
- `useAiChatSession` Hook：
  - 根据 `sessionKey` 向 `sessionService.getOrCreateSession` 要一个会话；
  - 在 `onStateChange` 时更新本地 `state`，驱动 UI。

改造思路：

1. **扩展 `AiChatSessionKey`，确保包含文档路径：**
   - 例如：

   ```ts
   export type AiChatSessionKey = {
     kind: 'doc'
     docPath: string
   } | {
     kind: 'global'
   }
   ```

   - 文档相关的会话（包括 AI > Conversation 菜单）统一使用 `{ kind: 'doc', docPath }`。

2. **在 `getOrCreateSession` 中：**
   - 根据 `sessionKey.docPath` 去 `DocConversationService` 查询是否已有持久记录：
     - 若有，加载对应 `DocConversationRecord`；
     - 根据其中 `messages` 反推一个初始的 `ConversationState`（或至少填充 `viewMessages`）。
   - 创建 `ChatSession` 时，将此 `initialState` 传入（`chatSessionService` 已支持）。
   - 若 `DocConversationRecord` 中存在 `difyConversationId`，创建 Dify 客户端时通过 4.2 的配置注入。

3. **在 `onStateChange` 回调中：**
   - 除了更新 Hook 的本地 `state` 外，也可选择即时调用 `docConversationService.upsertFromState`。
   - 为避免写入过于频繁，建议只在“完成一轮对话”时写入（由 `chatSessionService` 触发）。

#### 4.5 与 `WorkspaceShell` / 菜单集成

1. **确定 docPath 获取方式：**
   - 在 `WorkspaceShell` 中，当前激活的文档通常已有路径，例如 `activeTab.filePath`。
   - 在打开 AI Chat / Conversation History 时，将 `docPath` 作为 `AiChatSessionKey` 的一部分传递下去。

2. **AI > Conversation 菜单项：**
   - `AI > Conversation > History`：
     - 打开一个“会话时间线”视图（可复用现有 `AiChatDialog` 或新建简单列表组件），数据来源是 `DocConversationService.getByDocPath(currentDocPath)`。
   - `AI > Conversation > Compress`：
     - 调用 `docConversationService.compressByDocPath(currentDocPath)`；
     - 压缩逻辑见下一章。
   - `AI > Conversation > Clear`：
     - 调用 `docConversationService.clearByDocPath(currentDocPath)`；
     - 同时在当前会话中重置 `ConversationState`、`difyConversationId` 等。

---

### 五、会话历史压缩与清空

#### 5.1 会话压缩（Compress）

目标：
- 让“会话时间线”在长对话下仍然可读：
  - 把很久之前的大量细碎消息折叠为少量“摘要消息”；
  - 保留最近 N 条完整消息。

压缩策略示例：

1. 对某个 `docPath`：
   - 读取 `DocConversationRecord.messages`；
   - 按时间排序（若未保证）；
   - 保留最近 `K` 条（例如 K = 20）作为完整消息；
   - 将更早的消息分批（例如按 10 条一批）进行摘要。

2. 摘要实现：
   - 组合一批老消息的文本，调用某个摘要模型（可使用 Dify 或本地模型）；
   - 生成一条新的 `DocConversationMessage`：

   ```ts
   const summaryMessage: DocConversationMessage = {
     id: genId(),
     docPath,
     timestamp: Date.now(),
     role: 'assistant',
     content: '【摘要】……',
     meta: { providerType: 'local', modelName: 'summary' },
   }
   ```

3. 替换规则：
   - 原始被压缩的那批消息从 `messages` 中移除；
   - 插入对应的 `summaryMessage`；
   - 更新 `messageCount` / `lastActiveAt` 等；
   - 写回持久化文件。

> UI 层可将 `content` 中带有 `【摘要】` 前缀的消息以特殊样式展示，提示用户这是折叠后的历史。

#### 5.2 会话清空（Clear）

目标：
- 为当前文档“重新开始”一个会话。

清空流程：

1. 前端调用 `docConversationService.clearByDocPath(docPath)`：
   - 从 `conversations_data.json` 中删除对应 `DocConversationRecord`，或重置为：

   ```ts
   {
     docPath,
     sessionId: genId(),
     lastActiveAt: Date.now(),
     difyConversationId: undefined,
     messages: [],
   }
   ```

   - 在 `conversations_index.json` 中更新/删除对应索引条目。

2. 当前运行时会话：
   - 对当前 `ChatSession`：
     - 重置 `ConversationState` 为 `createInitialConversationState(...)`；
     - 对 Dify 客户端调用 `clearHistory()` 或 `setConversationId(null)`；
     - 将新的空状态通过 `onStateChange` 通知 UI。

> 清空后，下一次提问将作为一轮全新的对话开始；若使用 Dify，则会获得一个新的云端 `conversationId`。

---

### 六、实施步骤拆解

#### 阶段 1：数据模型与文档会话服务

- **任务**：
  - [ ] 在 `app/src/modules/ai/domain` 下定义：
    - `DocConversationRecord`
    - `DocConversationMessage`
    - `ConversationIndexEntry`
  - [ ] 在 `app/src/modules/ai/application` 下新增 `docConversationService.ts`：
    - 内存缓存 + Tauri 命令读写 `conversations_index.json` / `conversations_data.json`；
    - 实现 `loadAll / getByDocPath / upsertFromState / clearByDocPath / compressByDocPath / getIndex`。

- **验证**：
  - 可以在单元测试中构造假的 `ConversationState`，调用 `upsertFromState` 后检查文件内容与索引是否符合预期。

#### 阶段 2：Dify 客户端扩展 conversationId 能力

- **任务**：
  - [ ] 在 `SimpleChat` 中增加 `getConversationId` / `setConversationId`；
  - [ ] 在 `createDifyStreamingClient` 的配置中支持 `initialConversationId`：
    - 初始化时调用 `setConversationId`；
    - 在每次 `askStream` 调用之后，从 `chat.getConversationId()` 读取最新 ID，并回传给上层（可通过 `StreamingChatResult` 扩展字段）。

- **验证**：
  - 使用假请求或集成测试，确认：
    - 第一次对话后，`conversationId` 被正确捕获；
    - 第二次对话传入 `initialConversationId` 时，Dify 能续上同一会话（可通过日志或 Dify 控制台确认）。

#### 阶段 3：chatSessionService 与文档会话服务打通

- **任务**：
  - [ ] 在 `chatSessionService.ts` 中注入 `DocConversationService`：
    - 在 `runStreamWithCurrentHistory` / `runVisionStream` 的 `finally` 内，在 `completeAssistantMessage` 之后调用 `upsertFromState`；
    - 需从外部传入：`docPath`、`providerType`、`currentModelId`、以及 Dify 的 `conversationId`（如有）。
  - [ ] 扩展 `StartChatOptions` 或 `ChatSession` 构造参数，使其能接收 `docPath`。  

- **验证**：
  - 本地跑一轮对话后，检查 `conversations_data.json` 是否新增对应记录；
  - 多轮对话后，确认消息追加逻辑正确（无重复/丢失）。

#### 阶段 4：AiChatSessionService / useAiChatSession 接入 docPath

- **任务**：
  - [ ] 扩展 `AiChatSessionKey`，保证文档入口携带 `docPath`；
  - [ ] 在 `AiChatSessionService.getOrCreateSession` 中：
    - 如存在 `DocConversationRecord`，构造 `initialState` 并传入 `createChatSession`；
    - 如存在 `difyConversationId`，通过 `DifyChatClientConfig.initialConversationId` 注入给 Dify 客户端。

- **验证**：
  - 对某文档先对话，关闭/重开 AI Chat 后，历史能从持久化文件中恢复；
  - Dify 会话在重开后仍能续接（对 Dify 而言是同一个 conversation）。

#### 阶段 5：WorkspaceShell 与菜单集成

- **任务**：
  - [ ] 在 `WorkspaceShell` 中：
    - 为 AI Chat 会话构造 `AiChatSessionKey` 时带上当前文档 `docPath`；
    - 处理 AI > Conversation 菜单事件：
      - `History`：打开一个视图组件，从 `DocConversationService.getByDocPath` 读取并展示时间线；
      - `Compress`：调用 `compressByDocPath`，压缩后刷新视图；
      - `Clear`：调用 `clearByDocPath` 并重置当前 `ChatSession`。

- **验证**：
  - 通过菜单能看到当前文档的会话历史时间线；
  - Compress 后旧消息被折叠为摘要；
  - Clear 后历史视图为空，下一轮会话重新开始。

---

### 七、测试与验证要点

- **文档级会话聚合**：
  - 同一文档使用不同模型（含 Dify）对话，历史都出现在同一时间线中，且顺序正确。

- **Dify 规则正确性**：
  - Dify 每次请求只使用“当前提问 + conversationId”作为上下文；
  - 但本地时间线中仍能看到 Dify 的问答记录。

- **非 Dify 模型共用 messages**：
  - 更换模型后，仍能接着之前的对话继续问（上下文来自同一 `DocConversationRecord.messages` / `engineHistory`）。

- **持久化与恢复**：
  - 应用重启后，同一文档的历史仍然存在；
  - 打开 AI Chat 或 Conversation History 时，从文件中恢复状态并正常展示。

- **压缩与清空**：
  - 压缩操作不会破坏最近 K 条完整消息；
  - 清空操作后，新会话不会再混入旧消息，Dify 也获得新的 `conversationId`。

以上方案在保持当前架构（`ConversationState` + `ChatSession` + Provider 抽象）不大改动的前提下，实现了：
- 基于文档的统一会话时间线；
- Dify conversationId 的正确持久化与续接；
- 其他模型共享上下文的能力；
- 通过菜单操作进行历史查看、压缩与清空。