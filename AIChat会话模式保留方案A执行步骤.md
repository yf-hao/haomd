## AI Chat 模式切换保留会话 - 方案 A 执行步骤

### 一、设计目标与约束

- **功能目标**
  - **切换 `floating / dock left / dock right` 时，继续使用同一个会话**（同一个 `ChatSession` 与同一份消息列表）。
  - 仅在用户明确“结束/清空会话”或关闭工作区时，才真正销毁会话。

- **设计原则**
  - **高内聚**：
    - 所有与“AI 会话生命周期、状态管理”相关的逻辑集中在独立的会话服务/Store 中，而不是分散在 `WorkspaceShell`、`AiChatPane`、`AiChatDialog` 等 UI 组件里。
  - **低耦合**：
    - UI 层只负责“如何展现”（浮窗 / 停靠 / 左右）和交互，不直接掌控会话的创建/销毁细节。
    - 会话服务不依赖具体 UI 组件，仅通过简洁 API（`getOrCreateSession`、`getSession`、`disposeSession` 等）对外提供能力。

---

### 二、重构前的现状梳理（执行前准备）

> 目标：搞清楚现有 AI Chat 是如何创建、销毁会话的，为后续拆分提供基础。

- **步骤 2.1：阅读核心文件**
  - **查看 `useAiChat`**：
    - 文件：`app/src/modules/ai/hooks/useAiChat.ts`（具体路径以实际项目为准）。
    - 关注点：
      - `useEffect` 中何时调用 `createChatSession`；
      - cleanup 中如何 `dispose` 会话；
      - `state` 和 `session` 的结构是什么。
  - **查看 UI 组件**：
    - `AiChatPane`：停靠模式的聊天面板。
    - `AiChatDialog`：浮窗模式的聊天对话框。
    - 关注点：
      - 它们各自如何使用 `useAiChat`；
      - 是否各自维护独立的状态/会话。
  - **查看 `WorkspaceShell`**：
    - 关注点：
      - `aiChatMode`（`'docked' | 'floating'`）、`aiChatDockSide`（`'left' | 'right'`）、`aiChatOpen` 的状态定义和切换逻辑；
      - 不同模式/位置下，是如何条件渲染 `AiChatPane` / `AiChatDialog` 的。

- **步骤 2.2：列出现有问题**
  - 切模式时卸载旧组件 -> `useAiChat` cleanup -> `dispose` 会话 -> 对话被清空。
  - 会话生命周期掌握在 UI Hook 中，导致 UI 与领域逻辑强耦合。

---

### 三、抽象领域模型与会话标识（Session Key 设计）

> 目标：先在“概念层面”确定我们要管理的对象是什么，以及如何唯一标识一个会话。

- **步骤 3.1：抽象会话领域模型**
  - **`ChatSessionRecord`（示意）**：
    - **字段建议**：
      - `id: string`：内部使用的唯一 ID（可用 UUID）。
      - `key: string`：业务维度的会话键（Session Key），由外部传入，例如：
        - 简单模式：永远为 `'global'`；
        - 按文件：`'file:' + activeFilePath`；
        - 按模式/入口：`'file:' + activeFilePath + ':entry:' + entryMode`。
      - `session: ChatSession`：底层会话对象（负责和模型服务交互）。
      - `state: ConversationState`：对 UI 友好的状态（消息列表、loading、错误等）。
      - `createdAt: number`，`lastActiveAt: number`：用于后续排序、清理、持久化。
      - `disposed: boolean`：标记是否已被销毁。

- **步骤 3.2：确定 Session Key 策略**
  - 根据实际需求，在以下策略中**选一种**作为第一阶段的实现：
    - **全局单会话策略**：
      - 所有模式、所有文档共用一个 `sessionKey = 'global'`。
      - 实现简单，适合作为第一版重构目标。
    - **按文档会话策略**：
      - 每个打开的 Markdown 文档拥有自己的会话 `sessionKey = 'file:' + filePath`。
      - 切换文档时切换会话，但在同一文档内切模式不丢失对话。
  - 把选定策略写在项目的设计文档或注释中，后续所有代码以此为标准，避免隐式约定。

---

### 四、新增 `AiChatSessionService`：集中管理会话

> 目标：把“会话的创建、缓存、状态更新、销毁”集中到一个高内聚的服务中。

- **步骤 4.1：创建服务文件**
  - 建议路径：`app/src/modules/ai/core/AiChatSessionService.ts`（具体可以根据项目模块划分调整）。

- **步骤 4.2：定义核心数据结构**
  - 定义 `ChatSessionRecord` 接口，包含第三章中提到的各字段。
  - 使用 `Map<string, ChatSessionRecord>` 来缓存所有活跃会话，key 即为业务 Session Key。

- **步骤 4.3：设计服务 API**
  - **核心方法建议**：
    - **`getSession(key: string): ChatSessionRecord | null`**：按 `sessionKey` 获取已有会话，不创建新会话。
    - **`getOrCreateSession(key: string, startOptions: StartOptions): ChatSessionRecord`**：
      - 若 `Map` 中不存在该 key，则：
        - 调用现有逻辑（或封装后的逻辑）创建 `ChatSession`；
        - 初始化 `ConversationState`；
        - 新建 `ChatSessionRecord` 放入 `Map`；
      - 若已存在，则直接返回。
    - **`updateSessionState(key: string, updater: (prev: ConversationState) => ConversationState)`**：
      - 对指定会话的 `state` 做不可变更新，并负责通知订阅者（例如通过内部的订阅机制或事件）。
    - **`disposeSession(key: string): void`**：
      - 找到对应 `ChatSessionRecord`，调用其 `session.dispose()`；
      - 将 `disposed` 标记为 `true`；
      - 从 `Map` 中删除记录，通知订阅者该会话已结束。
    - **可选扩展**：`listSessions()`、`clearAll()` 等。

- **步骤 4.4：实现订阅机制（供 React Hook 使用）**
  - 为 `AiChatSessionService` 增加简单的订阅/通知能力，例如：
    - `subscribe(key: string, listener: (state: ConversationState) => void)`；
    - `unsubscribe(key: string, listener: ...)`；
    - 在 `updateSessionState` / `disposeSession` 时调用相应 listener。
  - 这样，React Hook 可以通过订阅来驱动组件更新，而不需要服务直接依赖 React。

- **步骤 4.5：从现有逻辑中抽取共用的创建/更新代码**
  - 把当前 `useAiChat` 中关于：
    - 创建 `ChatSession`；
    - 设置回调（消息追加、状态改变时的处理）；
    - 错误处理；
    - 更新 `ConversationState`；
    - **迁移**到 `AiChatSessionService` 中，保证这些逻辑集中在同一处。

---

### 五、增加 `AiChatProvider`：通过 Context 暴露服务

> 目标：让任意组件都能方便地访问同一个会话服务实例，实现共享会话。

- **步骤 5.1：创建 Provider 文件**
  - 建议路径：`app/src/modules/ai/context/AiChatContext.tsx`。

- **步骤 5.2：定义 Context 类型**
  - Context 中至少包含：
    - `sessionService: AiChatSessionService`。
  - 可以根据需要再扩展例如：全局 AI 配置、默认模型、工具配置等。

- **步骤 5.3：实现 `AiChatProvider` 组件**
  - 负责：
    - 创建单例的 `AiChatSessionService` 实例；
    - 把该实例通过 React Context 提供给子树；
    - 将来若需要持久化/恢复会话，可在此处统一处理。

- **步骤 5.4：在应用入口或 Workspace 层包一层 Provider**
  - 在 `app/src/main.tsx` 或 `WorkspaceShell` 的上层，将整个工作区包裹在 `AiChatProvider` 内部，使 `AiChatPane`、`AiChatDialog` 等都能访问同一个服务。

---

### 六、实现 `useAiChatSession(sessionKey)` Hook（领域访问层）

> 目标：为 UI 组件提供一个统一、简洁的入口，以访问和操作同一个会话，而不用关心具体服务实现细节。

- **步骤 6.1：创建 Hook 文件**
  - 建议路径：`app/src/modules/ai/hooks/useAiChatSession.ts`。

- **步骤 6.2：Hook 的输入参数设计**
  - 必需参数：
    - `sessionKey: string`：会话标识（由上层如 `WorkspaceShell` 传入）。
  - 可选参数：
    - `startOptions?: StartOptions`：首次创建会话时的上下文信息，例如初始 prompt、当前文件路径、选中文本等。

- **步骤 6.3：Hook 内部逻辑**
  - 从 `AiChatContext` 中获取 `sessionService`。
  - 使用 `useState` 或 `useReducer` 存储当前 `ConversationState` 和 `ChatSessionRecord` 的轻量包装。
  - 在 `useEffect` 中：
    - 通过 `sessionService.getOrCreateSession(sessionKey, startOptions)` 获取或创建会话；
    - 将返回的 `ConversationState` 同步到 Hook 的本地状态；
    - 调用 `sessionService.subscribe(sessionKey, listener)` 订阅该会话后续状态变化；
    - cleanup 时只做 `unsubscribe`，**不调用 `disposeSession`**（避免切模式时销毁会话）。
  - 向外返回：
    - `state`：会话状态（消息列表、是否思考中、错误信息等）；
    - `actions`：`sendMessage`、`appendUserMessage`、`retryLastMessage`、`stopCurrentRequest` 等，这些内部调用 `sessionService` 提供的对应函数或 `ChatSession` 的方法；
    - `meta`：例如 `createdAt`、`lastActiveAt`、`isNew` 等。

- **步骤 6.4：显式禁止在 Hook cleanup 中销毁会话**
  - 与当前的 `useAiChat` 不同，新 Hook 的 cleanup **只解除订阅**。
  - 会话销毁由上层显式调用 `disposeSession` 控制（详见第八章）。

---

### 七、渐进式改造 `AiChatPane`（停靠模式）

> 目标：让停靠模式的 Chat 面板使用新的 `useAiChatSession`，并与会话服务解耦。

- **步骤 7.1：为 `AiChatPane` 增加 `sessionKey` 属性**
  - 让 `AiChatPane` 接受一个 `sessionKey` prop，而不再内部决定会话身份。
  - 短期内可以兼容旧逻辑：若未传入 `sessionKey`，则使用 `'global'` 作为默认值，方便渐进迁移。

- **步骤 7.2：替换 `useAiChat` 为 `useAiChatSession`**
  - 在 `AiChatPane` 中：
    - 移除对旧 `useAiChat` 的依赖；
    - 改为：
      - 从 props 中拿到 `sessionKey`；
      - 调用 `useAiChatSession(sessionKey, startOptions)`；
      - 使用返回的 `state` 和 `actions` 渲染 UI 与处理事件。

- **步骤 7.3：保持 UI 行为不变**
  - 确保停靠面板在以下行为上与重构前一致：
    - 输入并发送消息；
    - 显示历史对话；
    - 显示模型思考/加载状态；
    - 支持中断、重试等操作。
  - 若 UI 中有“清空对话”按钮，暂时仍可以调用旧逻辑，下一章统一迁移到 `disposeSession`。

---

### 八、改造 `AiChatDialog`（浮窗模式）

> 目标：让浮窗模式与停靠模式共享同一会话，而不是各自独立的会话实例。

- **步骤 8.1：同样接入 `sessionKey` prop**
  - 与 `AiChatPane` 一致，让 `AiChatDialog` 接受 `sessionKey`，由外部传入。
  - 若短期需要兼容，可以给一个默认值 `'global'`，但最终应由 `WorkspaceShell` 明确传入。

- **步骤 8.2：使用 `useAiChatSession(sessionKey)`**
  - 替换原有的 `useAiChat` 调用。
  - 复用同一套 `state` 与 `actions`，只在 UI 层做不同的布局（浮窗 vs 停靠）。

- **步骤 8.3：确保模式切换时复用同一 Key**
  - 当 `WorkspaceShell` 在 docked/floating 模式之间切换时，
    - 确认传给 `AiChatPane` 和 `AiChatDialog` 的 `sessionKey` 是同一个值；
    - 这样，即使组件被卸载/挂载，会话也始终在服务中保留，聊天记录不会丢失。

---

### 九、在 `WorkspaceShell` 中统一管理 `sessionKey` 与模式

> 目标：让模式切换只影响“展示方式”，而不改变会话身份。

- **步骤 9.1：在 `WorkspaceShell` 中引入 `aiChatSessionKey` 状态**
  - 根据第三章确定的策略：
    - 若采用全局单会话策略：
      - 初始化时设置 `aiChatSessionKey = 'global'`；
    - 若按文档划分会话：
      - 在 active file 变化时重新计算 `aiChatSessionKey = 'file:' + activeFilePath`。

- **步骤 9.2：在渲染 Chat 组件时传入统一的 `sessionKey`**
  - Docked 模式：
    - 左右只是位置差异，传入的 `sessionKey` 相同：
      - `aiChatDockSide === 'left'` 时渲染左侧的 `AiChatPane`，`sessionKey={aiChatSessionKey}`；
      - `aiChatDockSide === 'right'` 时渲染右侧的 `AiChatPane`，`sessionKey={aiChatSessionKey}`。
  - Floating 模式：
    - 渲染 `AiChatDialog`，同样传入 `sessionKey={aiChatSessionKey}`。

- **步骤 9.3：模式切换只改变 UI，不改变 `sessionKey`**
  - 在处理切换 docked/floating 的事件时：
    - 只更新 `aiChatMode` / `aiChatDockSide`；
    - 不修改 `aiChatSessionKey`；
    - 不调用 `disposeSession`。
  - 这样，实际的 `ChatSession` 始终由 `AiChatSessionService` 管理，模式切换只是让不同的 UI 组件接管同一个会话的展示。

---

### 十、统一会话销毁与“清空对话”行为

> 目标：把会话销毁从组件卸载阶段移除，改为由显式动作触发，提升可控性。

- **步骤 10.1：从 `useAiChat` cleanup 中移除 `dispose` 行为**
  - 如果仍有旧的 `useAiChat` 存在，应确保其 cleanup 仅用于资源释放（解除订阅），**不再直接 `dispose` 会话**。

- **步骤 10.2：为 UI 中的“清空对话/结束会话”按钮接入 `disposeSession`**
  - 在 `AiChatPane` / `AiChatDialog` 中：
    - 当用户点击“清空对话”时，调用：
      - `sessionService.disposeSession(sessionKey)`；
      - 或通过 `useAiChatSession` 提供的封装方法 `disposeCurrentSession()`。
    - `WorkspaceShell` 可以根据需要在会话销毁后重新赋值 `aiChatSessionKey`（例如生成一个新 key），这样用户清空后再发送消息会创建一个全新的会话。

- **步骤 10.3：定义 Workspace 级别的销毁策略**
  - 如有需要，在以下事件中统一清理会话：
    - 关闭 Workspace 或应用退出；
    - 关闭某个文档时，是否同步销毁该文档绑定的会话；
  - 所有这些销毁行为都应通过 `AiChatSessionService.disposeSession` 实现，保持高内聚。

---

### 十一、清理与收敛：逐步淘汰旧 `useAiChat`

> 目标：避免两套并行的会话管理逻辑造成混乱，最终只保留方案 A 的实现。

- **步骤 11.1：搜索全局 `useAiChat` 引用**
  - 使用项目内搜索工具，找出所有使用旧 Hook 的地方。

- **步骤 11.2：逐一迁移到 `useAiChatSession`**
  - 按以下优先级迁移：
    - 核心 UI：`AiChatPane`、`AiChatDialog`；
    - 其他潜在使用点（如底部工具条、命令面板等）。
  - 确保迁移后这些组件都从 Context 中拿到同一 `sessionService`，不会再自行创建/销毁会话。

- **步骤 11.3：标记旧 Hook 为废弃并最终删除**
  - 短期内可以在旧 Hook 上加上注释：`@deprecated`，提示不要再使用。
  - 当所有调用点迁移完成后，删除旧 Hook 文件，进一步降低维护成本和耦合度。

---

### 十二、测试与验证场景

> 目标：通过具体场景验证重构是否满足“切模式保留会话”的需求，同时确保没有引入新的问题。

- **步骤 12.1：基础功能回归**
  - 打开一个 Markdown 文档，打开 AI Chat：
    - 发送多条消息，确保对话正常进行；
    - 检查 loading、错误提示、工具调用等行为是否与重构前一致。

- **步骤 12.2：模式切换测试**
  - 在有对话历史的前提下：
    - 从 docked 模式切到 floating 模式：
      - 检查对话历史是否完整保留；
      - 再发送新消息，看是否继续追加到同一会话中；
    - 在 docked 模式下切换 `left` / `right`：
      - 确认对话历史不丢失，仅 UI 位置改变。

- **步骤 12.3：会话销毁测试**
  - 点击“清空对话/结束会话”：
    - 确认当前会话记录被 `dispose`；
    - 随后发送新消息，应创建一个全新的会话（根据设计可能重用相同 `sessionKey` 但生成新的 `ChatSessionRecord`）。

- **步骤 12.4：多文档/多 workspace 场景（如适用）**
  - 若采用按文件区分会话策略：
    - 在文档 A 中与 AI 对话，然后切换到文档 B：
      - 确认文档 B 可拥有独立的会话；
      - 切回文档 A 时，对话仍然存在。

---

### 十三、小结：高内聚、低耦合的体现

- **高内聚**
  - 会话创建、缓存、更新、销毁全部集中在 `AiChatSessionService` 中，属于 AI Chat 的领域层逻辑；
  - `useAiChatSession` 作为唯一领域访问入口，屏蔽了底层实现细节。

- **低耦合**
  - UI 组件（`AiChatPane`、`AiChatDialog`）仅关心会话状态和操作接口，不关心会话生命周期策略；
  - `WorkspaceShell` 只负责决定 `sessionKey` 与模式，不直接接触 `ChatSession` 实例；
  - 会话销毁由明确的用户动作触发，避免“组件卸载 == 销毁会话”的隐式耦合。

通过以上步骤逐步实施，可以在不破坏现有功能的前提下，将 AI Chat 模式切换时的会话管理重构为高内聚、低耦合的架构，实现“切模式保留当前会话”的目标。