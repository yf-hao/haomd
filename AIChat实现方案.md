## AI Chat 模块实施方案（高内聚 / 低耦合版本）

本文档描述在桌面应用中实现“Open AI Chat / Ask AI about File / Ask AI about Selection”一整套功能的设计与实施步骤，重点满足：

- **高内聚**：对话会话、提示词、Provider、UI 各自职责清晰，逻辑聚合在对应模块。
- **低耦合**：UI 不直接依赖 Provider 细节；会话逻辑不依赖具体编辑器/剪贴板实现。
- **可扩展**：便于后续新增 Provider 类型、入口模式（如 diff、错误日志）、更多 AI 操作按钮。

---

### 一、目标与行为概述

**1. 功能目标**

- 在 AI 菜单点击 `Open AI Chat` 时，弹出模态窗口 `AiChatDialog`，支持多轮流式对话。
- 支持从三种入口发起对话：
  - **Chat**：普通聊天（用户在输入框输入第一条问题）。
  - **File**：`Ask AI about File`，发送“当前文件内容”作为上下文，但对话窗口中 **不展示文件全文**，只展示 AI 回复。
  - **Selection**：`Ask AI about Selection`，发送“当前选区”作为上下文，对话窗口中同样只展示 AI 回复。
- 支持从 Prompt Settings 中选择角色，并将角色的 `prompt` 作为系统提示词，动态影响后续对话。
- 每条 AI 回复流式结束后，在该条气泡下方显示 **纯图标按钮**：
  - 一个用于“复制为 Markdown”。
  - 一个用于“插入到编辑器当前光标下一行”。

**2. 关键约束**

- 不破坏已有 `AI Settings` 与 `Test` 功能，Chat 逻辑独立于 Test。
- 使用现有 Provider 抽象（Dify / OpenAI 兼容），通过工厂函数自动选择实现。
- 入口模式（Chat / File / Selection）对 UI 友好，可扩展更多模式。

---

### 二、分层架构设计

整体采用自内向外的四层结构：

- **领域层（domain）**：
  - 定义对话相关的核心模型与规则：会话状态、入口模式、Engine 消息与 UI 消息的区别等。
  - 不依赖具体 Provider、UI 或平台 API。

- **应用层（application）**：
  - `systemPromptService`：负责 Prompt Settings → 系统提示词 / 角色列表 的逻辑。
  - `chatSessionService`：封装“会话生命周期、入口模式策略、角色切换、流式对话”用例，对 UI 提供统一的 `ChatSession` 接口。

- **基础设施层（infrastructure）**：
  - Provider 工厂：`createStreamingClientFromSettings` + 各 Provider 实现（Dify / OpenAI 兼容）。
  - 剪贴板服务：封装复制文本到系统剪贴板。
  - 编辑器插入服务：封装“将 Markdown 插入到当前编辑器光标下一行”。

- **UI 层（ui）**：
  - `AiChatDialog` 组件 + `useAiChat` Hook，负责模态窗布局、角色选择、对话区展示、输入框、图标按钮点击事件等。
  - 不直接调用 Provider / Tauri / 编辑器，只依赖应用层服务与平台服务接口。

目录示意（不要求一次性全部创建）：

```text
app/src/modules/ai/
  domain/
    types.ts           // 已有：UiProvider, PromptRole, IStreamingChatClient...
    chatSession.ts     // 新：ChatEntryMode, EngineMessage, ChatMessageView, ConversationState 等
  application/
    systemPromptService.ts   // 新：角色与系统提示词逻辑
    chatSessionService.ts    // 新：会话用例（Chat / File / Selection）
  config/
    aiSettingsRepo.ts        // 已有：AI Settings 持久化
    promptSettingsRepo.ts    // 已有：Prompt Settings 持久化
  providers/
    dify/...
    openai/...
    streamingClientFactory.ts // 已有：Provider → IStreamingChatClient
  platform/
    clipboardService.ts      // 新：复制到剪贴板抽象
    editorInsertService.ts   // 新：编辑器插入抽象
  ui/
    AiChatDialog.tsx         // 新：模态窗
    hooks/useAiChat.ts       // 新：UI Hook
  client.ts                  // 已有：IAiClient façade（菜单入口层）
```

---

### 三、领域层设计（domain）

#### 3.1 核心类型：入口模式与消息

在 `domain/chatSession.ts` 中定义与会话相关的纯类型：

- **入口模式**：

```ts
type ChatEntryMode = 'chat' | 'file' | 'selection'
```

- **Engine 消息（发给 LLM）**：

```ts
type EngineMessageRole = 'system' | 'user' | 'assistant'

type EngineMessage = {
  role: EngineMessageRole
  content: string
}
```

- **UI 消息（展示用）**：

```ts
type ChatRole = 'user' | 'assistant'

type ChatMessageView = {
  id: string
  role: ChatRole
  content: string        // AI 回复为 Markdown 文本
  streaming?: boolean    // 是否流式输出中
}
```

- **会话状态**：

```ts
type ConversationState = {
  engineHistory: EngineMessage[]   // LLM 视角的完整对话
  viewMessages: ChatMessageView[]  // UI 视角的气泡列表
  entryMode: ChatEntryMode         // 当前入口模式
  activeRoleId?: string            // 当前角色 id
}
```

> 关键点：**Engine 与 View 分离**。Engine 会记录系统提示词、文件全文/选区等上下文；
> View 只展现用户/AI 需要看到的消息，避免在对话区显示整份文件或大段选区。

#### 3.2 入口模式策略（纯函数）

在 `chatSession.ts` 中定义若干纯函数，用于构造首轮 Engine 消息，而不做任何 IO：

- `applyEntryContext(mode, context, systemPrompt)`：根据入口模式与上下文构造首轮 `EngineMessage[]`。

  - `mode='chat'`：
    - 若有 `systemPrompt`，首条为 `{ role: 'system', content: systemPrompt }`；
    - 首轮真正的用户输入由 UI 发送时再 append。

  - `mode='file'`：
    - system（可选）
    - 一条 user 消息：
      - 内容类似：`这是当前文件 ${fileName} 的内容，请先理解并给出分析/建议：\n\n${fileContent}`。
    - View 层 **不显示** 这条 user 消息，只在 Engine 中存在。

  - `mode='selection'`：
    - 与 file 类似，只是提示语和内容换成选区。

- `appendUserInput(state, text)` / `appendAssistantReply(state, text)`：
  - 同时更新 `engineHistory` 与 `viewMessages`；
  - UI 层只需做 `setState`，不关心拼接细节。

领域层只负责状态与列表操作，完全独立于网络、Provider、UI 细节，满足高内聚、易测试。

---

### 四、应用层设计（application）

#### 4.1 系统提示词与角色服务：`systemPromptService.ts`

**职责**：把 Prompt Settings 的持久化结构转换为聊天用的“角色列表 + 当前角色 + 系统提示词”。

- 类型：

```ts
type SystemPromptInfo = {
  roles: PromptRole[]
  activeRoleId?: string
  systemPrompt?: string
}
```

- 加载入口：

```ts
async function loadSystemPromptInfo(): Promise<SystemPromptInfo> {
  const state = await loadPromptSettingsState()
  const roles = state.roles
  const activeRoleId = state.defaultRoleId ?? roles[0]?.id
  const activeRole = roles.find(r => r.id === activeRoleId)

  return {
    roles,
    activeRoleId,
    systemPrompt: activeRole?.prompt.trim() || undefined,
  }
}
```

- 角色切换工具：

```ts
function getSystemPromptByRoleId(
  roles: PromptRole[],
  roleId?: string,
): { activeRoleId?: string; systemPrompt?: string } {
  const id = roleId ?? roles[0]?.id
  const activeRole = roles.find(r => r.id === id)
  return {
    activeRoleId: id,
    systemPrompt: activeRole?.prompt.trim() || undefined,
  }
}
```

这样**所有角色 → 系统提示词的逻辑集中在这里**，Chat 会话只依赖 `SystemPromptInfo`，不关心 Prompt Settings 的持久化细节。

#### 4.2 会话服务：`chatSessionService.ts`

**目标**：为 UI 提供一个 Provider 无关、入口模式无关的会话对象 `ChatSession`。

- 对外接口：

```ts
type StartChatOptions = {
  entryMode: ChatEntryMode
  initialContext?: {
    type: 'file' | 'selection'
    content: string
    fileName?: string
  }
}

type ChatSession = {
  getState(): ConversationState
  getSystemPromptInfo(): SystemPromptInfo
  setActiveRole(roleId: string): Promise<void>
  sendUserMessage(content: string): Promise<void>
  dispose(): void
}

async function createChatSession(options: StartChatOptions): Promise<ChatSession>
```

- `createChatSession` 的主要流程：

  1. **选 Provider**：通过 `loadAiSettingsState()` 找到默认 `UiProvider` + `defaultModelId`。
  2. **加载角色与系统提示词**：调用 `loadSystemPromptInfo()`。
  3. **构造初始会话状态**：
     - 使用 `applyEntryContext(entryMode, initialContext, systemPrompt)` 得到 `engineHistory`。
     - `viewMessages` 初始为空。
  4. **创建 streaming 客户端**：

     ```ts
     const client = createStreamingClientFromSettings(provider, systemPrompt)
     ```

  5. **首轮请求（File / Selection 入口）**：
     - 若 `entryMode` 为 `file` 或 `selection`：
       - 不在 view 中添加用户气泡；
       - 只在 view 中添加一个空的 AI 消息（`streaming: true`）；
       - 使用 `engineHistory` 作为 `askStream` 的 `messages` 参数发起流式请求；
       - 结果填充该 AI 气泡，并 append 一条 assistant EngineMessage。

  6. 返回封装好的 `ChatSession` 对象（内部持有 `client`、`conversationState`、`SystemPromptInfo`）。

- `sendUserMessage(content)`：

  1. 在 `engineHistory` 中 append `{ role: 'user', content }`；
  2. 在 view 中 append 用户气泡 + 空 AI 气泡；
  3. 调用 `client.askStream(...)`：
     - `messages = engineHistory + 当前 user`；
     - `onChunk` 中追加 AI 文本到最后一条 AI 气泡；
     - 完成后标记 `streaming=false`，并 append assistant EngineMessage。

- `setActiveRole(roleId)`：

  1. 调用 `getSystemPromptByRoleId(roles, roleId)` 更新当前 `SystemPromptInfo`；
  2. 根据新的 `systemPrompt` 创建新的 `IStreamingChatClient` 实例（或调用 Provider 客户端的 `reset` 方法）；
  3. `viewMessages` 与 `engineHistory` 保留，下一次 `sendUserMessage` 会使用新的系统提示词。

> 会话服务**只做业务流程与状态管理，不知道 React / DOM**，也不关心具体 Provider 类型。

---

### 五、基础设施层设计（infrastructure）

#### 5.1 Provider 工厂：`streamingClientFactory.ts`

签名扩展为：

```ts
function createStreamingClientFromSettings(
  provider: UiProvider,
  systemPrompt?: string,
): IStreamingChatClient
```

- **Dify 分支**：
  - 配置 `{ apiKey, baseUrl, modelId, systemPrompt }` 传给 `createDifyStreamingClient`；
  - 内部使用 `SimpleChat.init` 将 system prompt 放入 `inputs.system`。

- **OpenAI 兼容分支**：
  - 配置 `{ apiKey, baseUrl, modelId, systemPrompt }` 传给 `createOpenAIStreamingClient`；
  - 在构造请求体时：
    - 若 `systemPrompt` 非空，在 `messages` 数组前 `unshift` 一条 `{ role: 'system', content: systemPrompt }`。

#### 5.2 剪贴板服务：`clipboardService.ts`

统一对外 API：

```ts
async function copyTextToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // 可选：封装 Tauri 的剪贴板 API 作为降级方案
  }
}
```

所有复制行为（包括 AI Chat 中的“复制为 Markdown”）只调用这个函数，便于平台切换。

#### 5.3 编辑器插入服务：`editorInsertService.ts`

统一抽象“在当前编辑区光标下一行插入 Markdown 文本”行为：

```ts
async function insertMarkdownAtCursorBelow(text: string): Promise<void> {
  // 由具体编辑器实现：
  // 1. 获取当前光标所在行
  // 2. 在下一行插入 \n + text
  // 3. 确保 undo/redo 正常
}
```

AI Chat UI 不需要知道编辑器细节，只调用此服务。

---

### 六、UI 层设计：`AiChatDialog` 与 Hook

#### 6.1 Hook：`useAiChat`

封装 `ChatSession` 使用逻辑，把应用层会话服务适配为 React 状态：

- 输入：`entryMode` + `initialContext`（File/Selection 时携带内容）。
- 输出：
  - `loading`：会话是否初始化完成。
  - `state`：`ConversationState`（主要用于渲染 `viewMessages`）。
  - `systemPromptInfo`：角色列表与当前角色 id。
  - `send(content)`：发送用户输入。
  - `changeRole(roleId)`：切换角色。

Hook 内部：

- 首次执行时调用 `createChatSession`，并在 `useEffect` 中维护生命周期（`dispose`）。
- 每次调用 `send`/`changeRole` 后，从 session 读取最新状态并 `setState`。

#### 6.2 组件：`AiChatDialog.tsx`

**整体布局**（参考线框，文本描述）：

- **顶部**：
  - 左侧：标题 `AI Chat`。
  - 右侧：关闭按钮 `[X]`。
- **标题下方工具栏**：
  - `Role` 标签 + 扁平 `select` 下拉，展示 `systemPromptInfo.roles`；
  - 下方一行灰色小字展示当前角色描述（如果有）。
- **中部对话区**（可滚动）：
  - 遍历 `state.viewMessages`：
    - 用户消息：基础气泡样式；
    - AI 消息：
      - 气泡内用 Markdown 渲染 `content`；
      - 如果 `streaming === false`，在气泡下方渲染**纯图标按钮操作区**。
- **底部输入区**：
  - 标签 `Your message`；
  - 多行输入框（支持换行、回车 + 修饰键发送）；
  - 底部右侧 `[发送]` 主按钮、左侧 `[清空]` 或其它辅助操作。

#### 6.3 AI 消息操作按钮（纯图标）

当某条 AI 消息 `streaming === false` 时，在其气泡下方渲染操作区：

```text
[AI - RoleName]
┌──────────────────────────────────────────────┐
│ AI 回复内容（已完整）                      │
└──────────────────────────────────────────────┘
操作:  [📄]  [↙]
```

- 左侧图标按钮 `[📄]`：复制为 Markdown。
- 右侧图标按钮 `[↙]`：插入到编辑器。

按钮结构（JSX 思路）：

```tsx
<div className="ai-chat-message-actions">
  <button
    type="button"
    className="icon-button"
    title="复制为 Markdown"
    aria-label="复制为 Markdown"
    onClick={() => handleCopyMarkdown(msg)}
  >
    📄
  </button>
  <button
    type="button"
    className="icon-button"
    title="插入到编辑器"
    aria-label="插入到编辑器"
    onClick={() => handleInsert(msg)}
  >
    ↙
  </button>
</div>
```

样式规范（思路）：

- `.ai-chat-message-actions`：`display: flex; gap: 4px; margin-top: 4px;`。
- `.icon-button`：
  - `width/height ~ 24px`，小方形扁平按钮；
  - `border: 1px solid rgba(148,163,184,0.45)`；
  - `background: transparent; color: #9ca3af; border-radius: 6px;`；
  - `display: inline-flex; align-items: center; justify-content: center;`；
  - `cursor: pointer; transition: none;`。
- `:hover`：背景轻微高亮（如 `rgba(255,255,255,0.05)`），仍保持扁平。
- `:focus`：`outline: none; border-color: #5c7cfa;`。

纯图标 + `title` + `aria-label` 既保持简洁，又兼顾可用性与无障碍。

---

### 七、入口模式行为细化（Chat / File / Selection）

在本方案中，三种入口模式只体现在 **首轮 Engine 消息构造与首轮 UI 行为** 上，后续流程完全一致。

**1. Open AI Chat（`entryMode='chat'`）**

- 初始：
  - `engineHistory` 仅包含 system 消息（如果有）；
  - `viewMessages` 为空。
- 用户在输入框中输入问题并发送后：
  - View：追加用户气泡 + 空 AI 气泡；
  - Engine：append `{ role: 'user', content }` 并发起请求；
  - 流式完成后追加 assistant 消息，AI 气泡下方显示图标按钮。

**2. Ask AI about File（`entryMode='file'`）**

- 在 UI 层打开 `AiChatDialog` 前，收集：
  - `fileContent`，`fileName`。
- `createChatSession` 初始：
  - `engineHistory`：

    ```text
    [
      { role: 'system', content: systemPrompt? },
      { role: 'user', content: `这是当前文件 ${fileName} 的内容，请分析：\n\n${fileContent}` }
    ]
    ```

  - `viewMessages`：仅追加一个空 AI 气泡（`streaming: true`）。
  - 立即执行 `askStream(engineHistory)`：
    - UI 只看到 AI 回复，不看到 “文件全文”。

- 之后用户在输入框中发送消息时，与 Chat 模式完全一致（append user/assistant）。

**3. Ask AI about Selection（`entryMode='selection'`）**

- 类似 File 模式，只是 `initialContext.content` 换成选区文本，提示语改为“这是我在文档中选中的内容…”。
- 同样不在对话区展示大段选区文本，只展示 AI 的分析结果。

> 引入 `ChatEntryMode` 与 `engineHistory/viewMessages` 分离，使得以后新增入口类型（如 diff、错误日志）也只是扩展 `applyEntryContext` 和 `StartChatOptions`，UI 与 Provider 层不需要修改。

---

### 八、与菜单和 `IAiClient` 的集成

`app/src/modules/ai/client.ts` 中的 `IAiClient` 作为菜单入口的 façade，只负责：

- 检查默认 AI 配置是否存在；
- 将不同菜单动作映射为不同的入口模式；
- 通知 UI 层“打开 AI Chat 对话框”。

**1. openChat()**

- 行为：
  - 使用 `loadDefaultChatConfig()` 确认已经配置默认 Provider/Model；
  - 若未配置，返回错误消息（保持当前行为）；
  - 若已配置，通过 UI 层（如 React Context 的 `openAiChat({ entryMode: 'chat' })`）打开 `AiChatDialog`。

**2. askAboutFile()**

- 行为：
  - 从当前编辑器获取文件内容与文件名；
  - 调用 `openAiChat({ entryMode: 'file', initialContext: { type: 'file', content, fileName } })`。

**3. askAboutSelection()**

- 行为：
  - 从当前编辑器获取当前选区文本；
  - 调用 `openAiChat({ entryMode: 'selection', initialContext: { type: 'selection', content } })`。

> `IAiClient` 不直接处理 Provider、系统提示词或流式逻辑，只做“入口到 entryMode 的映射”，高度解耦。

---

### 九、实施步骤清单

1. **领域层**：
   - 在 `domain/chatSession.ts` 中添加 `ChatEntryMode`、`EngineMessage`、`ChatMessageView`、`ConversationState` 类型。
   - 实现 `applyEntryContext`、`appendUserInput`、`appendAssistantReply` 等纯函数。

2. **应用层**：
   - 新建 `systemPromptService.ts`，实现 `loadSystemPromptInfo` 与 `getSystemPromptByRoleId`。
   - 新建 `chatSessionService.ts`，实现 `createChatSession` 与 `ChatSession` 接口。

3. **基础设施层**：
   - 扩展 `createStreamingClientFromSettings(provider, systemPrompt?)` 并调整 Dify/OpenAI 客户端支持 system prompt。
   - 新建 `clipboardService.ts`，封装 `copyTextToClipboard`。
   - 新建 `editorInsertService.ts`，封装 `insertMarkdownAtCursorBelow`。

4. **UI 层**：
   - 新建 `useAiChat` Hook，封装 ChatSession 的使用和 React 状态管理。
   - 新建 `AiChatDialog.tsx`：
     - 构建模态结构（标题、角色选择、对话区、输入区）。
     - 渲染 `viewMessages`，对 AI 消息在流式结束后渲染纯图标按钮 `[📄]` / `[↙]`。
     - 调用 `copyTextToClipboard` 和 `insertMarkdownAtCursorBelow` 完成复制/插入。

5. **菜单 & IAiClient 集成**：
   - 在 `createDefaultAiClient` 中调整 `openChat/askAboutFile/askAboutSelection`，通过 UI 层提供的入口函数打开 `AiChatDialog`，并传递 `entryMode` 与 `initialContext`。

通过以上步骤，可以以高内聚、低耦合的方式，将 AI Settings / Prompt Settings / Provider 抽象 / 编辑器操作 / UI 模态窗有机地组合在一起，同时为未来扩展新的 Provider 类型、新的入口模式和新的 AI 操作按钮预留充足空间。