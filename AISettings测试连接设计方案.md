## AI Settings Test 按钮测试连接设计方案

### 1. 目标概述

- **功能目标**：在 AI Settings 菜单中点击 `Test` 按钮时，基于当前输入的 Provider 配置信息（`Base URL`、`API Key`、`Models`），发起一次真实的对话请求，验证配置是否可用。
- **判定规则**：测试过程中统一使用系统提示词：`严格根据用户的要求回答问题，不要自己发挥`，如果能从后端获得任意非空回复，则视为连接成功；否则视为失败，并向用户反馈错误信息。
- **设计约束**：
  - 保持 **高内聚、低耦合**：AI 访问逻辑集中在 `modules/ai` 下的独立模块中，React 组件仅负责收集表单数据和展示结果。
  - 保证 **可扩展性**：未来可以支持多种 Provider 类型（Dify、OpenAI 等），以及更多测试策略，而无需修改现有 UI 组件。

---

### 2. 模块划分

#### 2.1 复用 `web-chat` 聊天实现

从 `@web-chat/src/web` 中复制以下文件，并放置到当前项目的 AI 模块目录中：

- **目标目录结构（建议）**：
  - `app/src/modules/ai/dify/BrowserLogger.ts`
  - `app/src/modules/ai/dify/SimpleChat.ts`

- **源文件与目标对应关系**：
  - `web-chat/src/web/logger.ts` → `app/src/modules/ai/dify/BrowserLogger.ts`
  - `web-chat/src/web/simple-chat.ts` → `app/src/modules/ai/dify/SimpleChat.ts`

- **适配原则**：
  - 保留原有的核心类型与接口：`SimpleChat`、`MessageRole`、`ChatConfig`、`StreamConfig` 等，以便后续在其他模块中复用。
  - 删除或避免依赖 DOM 结构和具体 UI 元素的逻辑，只保留与 Dify API 交互相关的部分（`fetch`、SSE 解析、日志记录等）。
  - 日志器使用 `BrowserLogger`，仅包装 `console.*`，不引入额外依赖。

> 说明：不直接引入 `app.ts`，因为其中包含 Web 专用的 DOM 操作和事件绑定逻辑，不适合作为通用 AI 模块的一部分。

#### 2.2 Provider 测试服务模块

新增一个纯业务模块，负责根据 Provider 配置执行连接测试：

- **文件**：`app/src/modules/ai/testConnection.ts`
- **主要职责**：
  - 提供一个与 UI 解耦的、可复用的测试函数：
    - `testProviderConnection(input: ProviderTestInput): Promise<ProviderTestResult>`
  - 封装 Dify 调用细节（基于 `SimpleChat`），对上层只暴露简单的成功/失败结果和错误消息。

- **类型设计**：
  - `ProviderTestInput`：
    - `baseUrl: string`  // 表单中的 `Base URL`
    - `apiKey: string`   // 表单中的 `API Key`
    - `modelId: string`  // 从 `Models` 中解析出的首个模型 ID
  - `ProviderTestResult`：
    - `ok: boolean`      // 是否连接成功
    - `message: string`  // 用户可读的提示信息
    - `rawContent?: string` // 后端返回的原始内容（可选，用于调试）

- **核心流程**：
  1. 校验输入：
     - 若 `baseUrl` 或 `apiKey` 或 `modelId` 为空，直接返回 `ok=false` 和友好的错误提示。
  2. 构造 `ChatConfig`：
     - `apiKey`: 来自表单输入
     - `baseURL`: 来自表单输入（去掉末尾多余 `/`）
     - `model`: 使用 `modelId`
     - `systemPrompt`: 固定为 `严格根据用户的要求回答问题，不要自己发挥`
     - `temperature`: 0 ~ 0.3，偏保守，减少随机性
     - `maxTokens`: 适度限制，例如 256
  3. 创建并初始化 `SimpleChat` 实例：
     - `const chat = new SimpleChat()`
     - `chat.init(config)`
  4. 组装测试请求：
     - 使用一个简单的用户消息，例如：`"请严格根据我的要求，仅回复两个字：成功"`。
     - 封装为 `CompletionRequest`：
       - `messages: [{ role: MessageRole.User, content: testMessage }]`
  5. 执行流式请求：
     - 构造 `StreamConfig`，在 `onChunk` 中累积返回内容：
       - `enabled: true`
       - `onChunk: (chunk) => { buffer += chunk.content ?? '' }`
       - `onError: (error) => { 记录日志，并在结果中返回错误 }`
     - 调用：`chat.askStream(request, streamConfig)`。
  6. 结果判定：
     - 若请求抛出异常或 `result.error` 非空，则返回 `ok=false`，并附带错误信息；
     - 若最终累计的 `buffer` 为非空字符串，则视为连接成功，返回：
       - `ok=true`
       - `message='连接成功：已收到模型回复'`
       - `rawContent=buffer`
     - 若 `buffer` 为空，则视为失败：
       - `ok=false`
       - `message='连接失败：未收到模型回复，请检查配置'`

> 该模块不依赖 React，只依赖 `SimpleChat`，因此可以在其他命令（如“测试默认 Provider”、“健康检查”等）中重用。

---

### 3. React 组件层集成方案

#### 3.1 `AiSettingsDialog` 中的表单数据

`AiSettingsDialog` 组件当前已经通过 `useAiSettingsState` 管理一个 `draft`：

- `draft.name`
- `draft.baseUrl`
- `draft.apiKey`
- `draft.modelsInput` // 逗号分隔的模型列表，如 `gpt-4.1, gpt-4o-mini`
- `draft.description`

组件顶部已经引入了：

```ts
import { useAiSettingsState, type ProviderDraft, parseModelsInput } from '../hooks/useAiSettingsState'
```

我们可以复用 `parseModelsInput` 来从 `draft.modelsInput` 中解析出首个模型 ID。

#### 3.2 为 Test 按钮添加事件处理函数

在 `AiSettingsDialog` 内部新增一个专门处理测试的函数：

- 函数签名：

```ts
const handleTestConnection = async () => { /* ... */ }
```

- 核心逻辑：
  1. 从 `draft` 中取出 `baseUrl`、`apiKey`、`modelsInput`，进行基本 `trim`：
     - 若三个字段中任一为空，则通过 `setError` 提示用户填写完整信息。
  2. 使用 `parseModelsInput(draft.modelsInput)` 解析模型列表，取首个模型作为 `modelId`：
     - 若解析后数组为空，则通过 `setError` 提示用户至少填写一个模型。
  3. 调用 `testProviderConnection`：

```ts
const result = await testProviderConnection({
  baseUrl: draft.baseUrl.trim(),
  apiKey: draft.apiKey.trim(),
  modelId: models[0],
})
```

  4. 根据 `result.ok` 判断：
     - `true`：
       - 可使用 `alert(result.message)` 或在表单中单独显示一条绿色的成功提示（例如新增 `testResult` 状态）；
     - `false`：
       - 调用 `setError(result.message)`，在现有的 `error` 区域中显示错误信息。

> 说明：为避免 UI 过于复杂，首版可以使用系统弹框提示成功，将错误仍然展示在表单的 `error` 区域。

#### 3.3 替换当前 Test 按钮行为

当前 `Test` 按钮实现为触发一个 DOM 事件：

```ts
<button type="button" className="ghost" onClick={() => {
  const testEvent = new CustomEvent('testConnection', { detail: { draft } })
  document.dispatchEvent(testEvent)
}}>
  Test
</button>
```

该事件目前在代码中没有任何监听者，可以直接替换为新的测试函数调用：

```ts
<button type="button" className="ghost" onClick={handleTestConnection}>
  Test
</button>
```

这样：

- `AiSettingsDialog` 对外只依赖 `testProviderConnection` 这一清晰的业务接口；
- 测试逻辑集中在 `modules/ai/testConnection.ts`，实现高内聚；
- 组件本身依然保持职责单一，仅负责表单状态和用户交互。

---

### 4. 系统提示词与对话流程设计

#### 4.1 系统提示词

- 在 `ChatConfig` 中统一设置：

```text
严格根据用户的要求回答问题，不要自己发挥
```

- 作用：
  - 限制大模型不要“自我发挥”，避免随机扩展内容导致测试结果难以预期；
  - 配合测试用的用户消息（例如“仅回复两个字：成功”），能够比较稳定地判断“是否有回复”。

#### 4.2 测试用对话内容

- 系统提示词（systemPrompt）：固定如上。
- 用户消息（user message）：可以选用简洁、易判定的内容，例如：

```text
请严格根据我的要求，仅回复两个字：成功。
```

- 判定方式：
  - **宽松判定**（首版）：只要收到的内容非空，就认为连接成功；
  - **严格判定**（可选扩展）：若后续需要更严格判断，可要求回复内容等于“成功”或包含某个关键字。

---

### 5. 可扩展性与后续演进

#### 5.1 支持多 Provider 类型

当前方案默认按照 Dify 的接口约定调用（`/chat-messages` + SSE）。未来如果要支持 OpenAI / 其他兼容接口，可以考虑：

- 在 `AiSettingsState` 中增加 `providerType` 字段（例如 `'dify' | 'openai' | 'custom'`）。
- 在 `testProviderConnection` 中根据 `providerType` 分发到不同的实现：
  - `testDifyConnection`（复用当前逻辑）；
  - `testOpenAIConnection`（使用 Chat Completions API）；
  - 其他自定义实现。

接口保持不变：

```ts
testProviderConnection(input: ProviderTestInput & { providerType?: string }): Promise<ProviderTestResult>
```

#### 5.2 复用测试逻辑到其他命令

由于测试逻辑被封装为纯函数模块：

- 可以在命令面板中增加“测试默认 Provider”命令，直接复用 `testProviderConnection`；
- 可以在应用启动时做一次后台“健康检查”，并在状态栏展示当前 AI 服务健康状态。

#### 5.3 与未来 Chat UI 的整合

当前只在 AI Settings 的 `Test` 按钮中使用 Dify 客户端。后续如果实现内置 Chat 面板：

- 可以直接基于 `SimpleChat` 实例管理完整的会话（conversationId、历史消息等）；
- `loadDefaultChatConfig()` 与当前 `createDefaultAiClient()` 也可以改为返回一个真正可用的 `SimpleChat` 或统一的 `IAiClient` 实现，而不是仅返回文本说明。

---

### 6. 小结

- **核心思想**：
  - 把 Dify 调用逻辑（`SimpleChat` + `BrowserLogger`）集中在 `modules/ai/dify` 下；
  - 使用一个独立的 `testProviderConnection` 服务模块，将“连接测试”这一业务逻辑从 UI 中抽离；
  - `AiSettingsDialog` 仅调用该服务并对结果做简单展示。
- **收益**：
  - 满足“高内聚、低耦合与可扩展性”的要求；
  - 复用现有 `web-chat` 代码，减少重复造轮子；
  - 为未来扩展更多 Provider 类型和聊天特性打下基础。