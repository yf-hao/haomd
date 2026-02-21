## 背景与目标

当前 HaoMD 已支持按文档维度的会话 Session 管理，并有会话压缩（Summary + Tail）等能力。但所有偏好、习惯、写作风格等信息仍分散在各个文档的会话历史中，无法沉淀为可以跨文档复用的「全局记忆」。

本方案目标：

- **全局记忆层（Global Memory）**：在文档级 Session 之上增加一层全局记忆，用于表达用户的长期偏好、个性特征与稳定习惯；
- **自动产生与更新**：从所有文档的压缩会话中，自动抽取与更新全局记忆，支持事件触发 + 时间间隔 + 数量阈值；
- **自动过滤与注入**：在每次 AI 调用时，通过自动过滤机制，从全局记忆中选出少量高度相关的条目注入，实现个性化回答；
- **可视化与可管理**：在 `AI → Session` 下新增 Global Memory 子菜单，以及 `GlobalMemoryDialog`，提供 User Persona 与 Manage Memory 两个视图；
- **可扩展、低耦合**：领域模型、服务与 UI 解耦，后续可扩展多工作区、多 profile 等能力。

---

## 一、领域模型设计

### 1.1 基本概念

在现有按文档 Session 领域模型基础上，新增三类核心对象：

- **SessionDigest**：文档会话的压缩摘要，用于全局记忆抽取的输入。
- **UserProfile**：全局用户画像，高度概括用户的偏好与个性（少量长文本）。
- **GlobalMemoryItem**：可管理的全局记忆条目（小颗粒度事实/偏好），用于在调用时自动过滤与注入。

> 注意：下面类型定义为示意结构，不限定具体实现语言。

### 1.2 SessionDigest

**用途**：承接现有文档 Session 压缩结果，作为全局记忆更新的输入，避免直接用原始对话全文。

- 来源于每个 `DocConversationRecord` 的压缩过程（Summary + Tail）；
- 仅保存摘要文本和少量元信息（文档路径、时间范围、主题标签等）。

示意结构：

```ts
SessionDigest = {
  docPath: string,
  period: { from: number; to: number },
  summaries: string[],  // 一批 summary message 的 content
  topics?: string[],    // 可选：话题标签
}
```

### 1.3 UserProfile（用户画像）

**用途**：在 UI 中展示“AI 眼中的我”，并作为高层偏好的集中表达，用于指导全局行为。

- 表达用户整体写作/对话场景；
- 语言偏好与风格；
- 兴趣主题；
- 常用模型/工具偏好（可选）。

示意结构：

```ts
UserProfile = {
  id: 'user-profile',
  updatedAt: number,
  summary: string,         // 总体画像自然语言摘要
  writingStyle: string,    // 写作/回答风格（正式/口语/简洁/详细等）
  interests: string[],     // 兴趣主题标签列表
  languages: string[],     // 常用语言，例如 ['zh-CN', 'en']
  preferredModels: string[] | undefined, // 可选：常用模型
}
```

### 1.4 GlobalMemoryItem（记忆条目）

**用途**：表达可枚举的偏好/事实/习惯，每条都可单独启用/禁用/固定（Pin），支持自动过滤与注入。

示意结构：

```ts
GlobalMemoryItem = {
  id: string,
  type: 'preference' | 'habit' | 'fact' | 'instruction',
  title: string,
  content: string,
  sourceDocs: string[],      // 来源文档路径集合
  sourceSessions: string[],  // 来源 Session 标识集合
  createdAt: number,
  updatedAt: number,
  weight: number,            // 0–1 或 0–100，代表重要度/置信度
  tags?: string[],           // 例如 ['language', 'style', 'format', 'code']
  pinned?: boolean,          // 用户固定，始终高优先级
  disabled?: boolean,        // 用户禁用，不再在调用中使用
}
```

### 1.5 全局存储结构

全局记忆可以用一个持久化文件或本地数据库表示，示例 JSON 结构如下：

```json
{
  "profile": {
    "id": "user-profile",
    "updatedAt": 1739500000000,
    "summary": "...",
    "writingStyle": "...",
    "interests": ["..."],
    "languages": ["zh-CN"],
    "preferredModels": ["openai:gpt-4o-mini"]
  },
  "items": [
    {
      "id": "mem_language_1",
      "type": "preference",
      "title": "Language Preference",
      "content": "User prefers answers in Simplified Chinese with necessary English terms.",
      "sourceDocs": ["AISettings.md", "HaoMD-项目分析报告.md"],
      "sourceSessions": ["doc-xxx-20250214"],
      "createdAt": 1739500000000,
      "updatedAt": 1739500000000,
      "weight": 0.9,
      "tags": ["language"],
      "pinned": true,
      "disabled": false
    }
  ]
}
```

---

## 二、菜单与对话框设计

### 2.1 菜单结构

在现有 `AI → Session` 菜单下新增 `Global Memory` 子菜单及二级菜单：

- `AI`
  - `Session`
    - `History`（已有）
    - `Compress`（已有）
    - `Global Memory`
      - `User Persona`
      - `Manage Global Memory`

**命令 ID 建议：**

- `ai.session.globalMemory.userPersona`
- `ai.session.globalMemory.manage`

两个命令都打开统一的 `GlobalMemoryDialog`，仅初始激活的 Tab 不同。

### 2.2 GlobalMemoryDialog 总体结构

点击 `Global Memory` 子菜单中的任一项时，弹出模态对话框：

- 标题：`Global Memory`
- 结构：
  - Header：标题 + Close 按钮 + Tabs
  - Body：随 Tab 切换的内容区
  - Footer：全局状态和操作按钮

#### 2.2.1 Header

- 左侧标题：`Global Memory`
- 右侧：关闭按钮 `×`
- 下方 Tab：
  - `User Persona`
  - `Manage Memory`

`ai.session.globalMemory.userPersona` → 打开并激活 `User Persona` Tab。

`ai.session.globalMemory.manage` → 打开并激活 `Manage Memory` Tab。

#### 2.2.2 Body - User Persona Tab

目标：展示 `UserProfile`，让用户理解 AI 眼中的自己。

内容分区：

1. **Overview**
   - 标题：`Overview`
   - 内容：`UserProfile.summary`，约 1–3 段自然语言描述。

2. **Preferences**
   - `Language & Style`
     - 默认回答语言、是否混合中英文、风格（简洁/详细/口语/正式等）。
   - `Format`
     - 是否偏好列表结构、标题结构、是否偏好附带代码示例等。

3. **Interests**
   - 标签列表：来自 `UserProfile.interests`，例如 `frontend`, `AI prompts`, `Markdown`, `Tauri` 等。

4. **Meta Info**
   - 文本：`Last updated at: ...`
   - 文本：`Learned from N sessions across M documents`

后续可扩展：

- `Edit` 按钮允许用户手动修改部分字段，写回 `UserProfile` 并影响后续行为。

#### 2.2.3 Body - Manage Memory Tab

目标：管理所有 `GlobalMemoryItem` 条目，控制启用/禁用/固定等。

1. **Filter Bar（顶部）**

- 搜索输入：`Search memories...`（全文搜索 title + content）
- 下拉：`Type` → `All / Preference / Habit / Fact / Instruction`
- 下拉：`Status` → `All / Enabled / Disabled / Pinned`
- 可选：Tag 多选 → `Language`, `Style`, `Format`, `Code`, `Paper` 等

2. **Memory List（中部）**

- 每一条 `GlobalMemoryItem` 作为列表项或卡片：
  - 标题（`title`）
  - 内容摘要（`content`，支持折叠/展开）
  - Meta 信息（小字）：
    - Type / Tags
    - `Source docs: X`
    - `Updated: 2025-02-14`
  - 操作按钮：
    - `Pin / Unpin` → 更新 `pinned`
    - `Enable / Disable` → 更新 `disabled`
    - `Delete` → 彻底删除此条记忆（不影响原始会话数据）
    - 可选：`View Sources` → 小浮层展示来源文档/Session 列表

3. **Side / Bottom Controls**

- 开关：`Enable Global Memory`
  - 全局开关：关闭后，调用 AI 时完全不使用全局记忆。
- 开关：`Allow auto update`
  - 控制是否允许自动从新 Session 学习全局记忆（见第四节策略）。
- 危险操作按钮：
  - `Clear all global memories...` → 弹窗确认，仅清空全局记忆，不删会话历史。

#### 2.2.4 Footer

- 左侧文本：
  - `Last global update: 2025-02-14 23:10`
- 右侧按钮：
  - `Update Now` → 手动触发一次全局记忆更新
  - `Close`

---

## 三、全局记忆产生与更新流程

### 3.1 自动更新策略概览

采用「事件触发 + 时间间隔 + 数量阈值」结合的增量更新机制：

- **事件触发**：当执行会话压缩（`Compress`）时产生新的 `SessionDigest`，加入待学习队列；
- **数量阈值**：待学习队列中摘要数量 ≥ `minDigests` 时，触发更新；
- **时间间隔**：距离上次全局更新 ≥ `minIntervalHours` 时，即使数量未达阈值，也触发一次；
- **频率限制**：`maxAutoUpdatesPerDay` 控制每日自动更新次数上限；
- **增量更新**：每次处理新摘要批次（最多 `maxDigestsPerBatch` 个），合并为对 `UserProfile` 和 `GlobalMemoryItem` 的增量改动。

### 3.2 配置项建议

可在全局设置或 AI 设置中增加以下配置（仅示意命名）：

```ts
GlobalMemorySettings = {
  enabled: boolean,              // 是否启用全局记忆
  autoUpdateEnabled: boolean,    // 是否允许自动从新 Session 学习
  minDigests: number,           // 数量阈值，例如 10
  minIntervalHours: number,     // 时间间隔阈值，例如 24
  maxDigestsPerBatch: number,   // 每次更新最多处理的摘要数，例如 30
  maxAutoUpdatesPerDay: number, // 每日自动更新次数上限，例如 2
}
```

### 3.3 事件触发：Session 压缩 → SessionDigest

1. 在已有的会话压缩流程（文档级 `Compress`）中，加入钩子：
   - 当某个文档的 `DocConversationRecord` 完成一次压缩后：
     - 收集其 Summary 消息（含 `summaryLevel`, `coversMessageIds`, `coveredTimeRange` 等 meta）；
     - 构建 `SessionDigest`：
       - `docPath`
       - `period`（由首尾消息时间决定）
       - `summaries`（所有摘要消息文本）
       - 可选：自动打 Topic 标签（由一次轻量模型或规则生成）。

2. 将 `SessionDigest` 入队：
   - 写入待学习队列（内存 + 持久化，例如本地 JSON/数据库）；
   - 队列中只存“新增”摘要，不重复放入已处理过的摘要。

### 3.4 自动更新触发逻辑

在应用空闲或后台定期检查时执行以下逻辑：

1. 若 `GlobalMemorySettings.enabled === false` 或 `autoUpdateEnabled === false` → 直接返回；
2. 如果当前时间与 `lastGlobalUpdateTime` 之差 < `minIntervalHours` 且队列长度 < `minDigests` → 不更新；
3. 如果当天自动更新次数 ≥ `maxAutoUpdatesPerDay` → 不更新；
4. 否则：
   - 从队列中取出最多 `maxDigestsPerBatch` 个 `SessionDigest` 作为本次输入批次；
   - 调用 `GlobalMemoryService.updateFromSessions(digestsBatch)`；
   - 更新 `lastGlobalUpdateTime` 与 `autoUpdateCountToday`；
   - 将已处理的 digests 从队列删除或标记为已处理。

### 3.5 GlobalMemoryService.updateFromSessions

此服务负责**从新摘要中抽取增量用户画像与记忆条目，并合并到现有全局记忆中**。

伪流程：

1. 读取当前全局记忆：
   - `currentProfile = loadUserProfile()`
   - `currentItems = loadGlobalMemoryItems()`

2. 构造 AI 输入：
   - 包含：
     - 新的 `SessionDigest` 集合（`docPath`, `period`, `summaries` 等）；
     - `currentProfile` 的简要摘要（例如只给 summary + interests + languages）；
     - `currentItems` 的精简版（只给 title + content + weight + type，以减少 token）。

3. 调用全局分析模型，得到增量结果：

```ts
GlobalMemoryDelta = {
  profileDelta: Partial<UserProfile>,
  newItems: GlobalMemoryItem[],      // 新增条目
  updatedItems: GlobalMemoryItem[],  // 已有条目更新后的版本
  disableItemIds: string[],          // 建议禁用的条目
}
```

4. 合并逻辑：

- 对 `profileDelta`：
  - 使用字段级合并，保留用户手动编辑优先；
  - 更新时间戳 `updatedAt`。

- 对 `newItems`：
  - 为每条分配新 id；
  - 若 content 与已有条目高度相似，可选择合并为同一条，增加 `weight` 与 `sourceDocs`；

- 对 `updatedItems`：
  - 按 id 替换现有条目；
  - 若条目被用户 `pinned`，则不降低其权重，仅在安全方向调整内容；

- 对 `disableItemIds`：
  - 将对应条目的 `disabled` 标记为 true，但不删除。

5. 将合并后的 `UserProfile` 与 `GlobalMemoryItem[]` 写回持久化存储。

---

## 四、使用时的自动过滤与注入

### 4.1 RequestContext 与 CurrentContext

为避免引入新的 UI 状态字段，`taskType` 在**每次调用 AI 之前临时推断**，用完即丢。整体分两层：

1. **RequestContext**：本次调用天然就有的上下文信息；
2. **CurrentContext**：在 RequestContext 基础上推断 `taskType` 之后，用于全局记忆过滤的结构。

示意结构：

```ts
// 与具体入口强相关的“本次调用上下文”（不需要持久化）
RequestContext = {
  // 调用来源：AI Chat 面板、命令/菜单等
  source: 'chat-pane' | 'command' | 'other',
  // AI Chat 的入口模式：来自 ai_chat / ai_ask_file / ai_ask_selection
  entryMode?: 'chat' | 'file' | 'selection',
  // 触发本次调用的命令 id（可选）：ai_chat / ai_ask_file / ai_ask_selection ...
  sourceCommand?: string,
  // 当前这一轮用户输入文本（在 Chat Pane 中）
  userInput: string,
  // 当前文档路径
  docPath?: string | null,
}

// 用于全局记忆过滤的抽象上下文
CurrentContext = {
  docPath: string | null,
  taskType: 'chat' | 'file' | 'selection' | 'code' | 'paper' | 'summarize' | 'design' | 'command',
  language: 'zh-CN' | 'en' | ...,   // 当前任务主要语言
  recentInstructions: string[],      // 当前会话中最近几条用户显式指令
}
```

在实际调用中：

- 对 AI Chat 来说，可以在 `AiChatPane.doSend` 中构造 `RequestContext`：
  - `source = 'chat-pane'`
  - `entryMode` 来自 `AiChatPaneProps.entryMode`（`'chat' | 'file' | 'selection'`）
  - `sourceCommand` 可选地从打开对话框时的命令 id 透传（如 `ai_chat` / `ai_ask_file` / `ai_ask_selection`）
  - `userInput` 为本次发送的文本 `contentToSend`
  - `docPath` 为 `currentFilePath`
- 对其它 AI 命令入口（未来可能直接从命令系统调用模型）也同样在调用点构造对应的 `RequestContext`。

在构造 `CurrentContext` 时，语言与近期指令：

- `language`：来自当前文档语言设置、自动检测或用户配置；
- `recentInstructions`：从当前 Session 最近几条消息中提取（例如包含“这次用英文回答”“尽量简短”等的句子）。

### 4.2 推断 taskType（inferTaskType）

`taskType` 由一个纯函数在本地推断，不调用任何 AI 接口：

```ts
type TaskType =
  | 'chat'
  | 'file'
  | 'selection'
  | 'summarize'
  | 'code'
  | 'paper'
  | 'design'
  | 'command'

function inferTaskType(req: RequestContext): TaskType {
  // 1) 入口模式优先（entryMode 来自 ai_chat / ai_ask_file / ai_ask_selection）
  if (req.entryMode === 'file') return 'file'
  if (req.entryMode === 'selection') return 'selection'

  // 2) 根据命令 id 进一步细分（可选扩展）
  if (req.sourceCommand === 'ai_ask_file') return 'file'
  if (req.sourceCommand === 'ai_ask_selection') return 'selection'

  // 3) 基于当前输入的简单关键字判断（纯本地规则，可按需扩展）
  const text = req.userInput.toLowerCase()
  if (text.includes('论文') || text.includes('paper')) return 'paper'
  if (text.includes('代码') || text.includes('bug') || text.includes('typescript')) return 'code'

  // 4) 默认：普通聊天
  return 'chat'
}
```

在构造 `CurrentContext` 时：

```ts
const taskType = inferTaskType(requestContext)
const currentContext: CurrentContext = {
  docPath: requestContext.docPath ?? null,
  taskType,
  language: detectLanguageOrUseSetting(...),
  recentInstructions: collectRecentInstructionsFromSession(...),
}
```

> 注意：Slash 命令（`/clear`、`/compress`、`/history`）在 `AiChatPane.doSend` 中已通过 `tryHandleSlashCommand` 拦截并返回 `'handled'`，**不会**进入 `sendMessage`，因此也不会触发全局记忆过滤逻辑。

### 4.3 过滤候选 GlobalMemoryItem

在获得 `CurrentContext` 之后，对全局记忆条目进行自动过滤：

1. 加载所有全局记忆条目：`items = loadGlobalMemoryItems()`；
2. 初步过滤：
   - 丢弃 `disabled === true` 的条目；
   - 若 `GlobalMemorySettings.enabled === false`，直接返回空列表；
3. 根据 `taskType` 派生“场景标签”：

```ts
function inferScenarioTags(taskType: TaskType): string[] {
  switch (taskType) {
    case 'file':
    case 'summarize':
      return ['file', 'summarize']
    case 'selection':
      return ['selection', 'rewrite']
    case 'code':
      return ['code']
    case 'paper':
      return ['paper', 'format']
    case 'design':
      return ['design']
    default: // 'chat' 等
      return ['language', 'style']
  }
}
```

4. 语境硬过滤：
   - 根据 `language`：
     - 当前用户明确要求英文，而某些记忆条目强制要求中文时，可以降低其优先级或直接跳过；
   - 根据 `taskType` / `scenarioTags`：
     - 代码相关任务优先考虑标签含 `code` 的条目；
     - 论文写作任务优先考虑标签 `paper`, `format` 等；
     - 一般 Chat 任务则优先 `language`, `style` 类标签。

得到 `filteredCandidates`。

### 4.4 相关性打分、缓存与 Top K 选取

为每个候选条目计算一个相关性分数 `score(item, context)`，并结合简单缓存避免重复重算：

1. 相关性打分示意：

- 标签匹配分：
  - 若 `item.tags` 与 `scenarioTags` 有交集，则加分；
- 权重分：
  - 使用 `item.weight`（模型/历史综合出的重要度）；
- 时间分：
  - 对 `updatedAt` 越近的条目加分；
- 范围分：
  - `log(1 + sourceDocs.length)`，表示在多少文档中重复出现；
- 冲突惩罚：
  - 若条目内容与 `recentInstructions` 明显冲突（比如条目说“默认中文”，但用户刚说“这次全英文”），施加惩罚或直接剔除；
- Pinned 加成：
  - `pinned === true` 的条目加一段固定分值，保证其优先级更高。

2. 结果排序与 Top K：

- 将所有候选条目按 `score` 排序；
- 取前 `K` 条（例如 3–7 条）作为 `selectedMemories`。

3. 选择性的缓存优化：

- 可以用 `(docPath, taskType, language)` 作为缓存 key，缓存上一轮选出的 `selectedMemories`；
- 当下次调用的 `(docPath, taskType, language)` 未变化，且 `recentInstructions` 没有明显冲突时，可以复用缓存结果，避免每次都全量重算；
- 一旦 taskType / language / 近期显式指令发生变化，则重新计算并更新缓存。

4. 合并为提示并注入：

- 将 `selectedMemories` 的 `content` 进行本地合并，生成一段简短的“用户偏好说明”，例如：

> User preferences:
> - Answer in Simplified Chinese by default, with necessary English terms.
> - Prefer concise, structured responses with headings and bullet lists.
> - When showing code, use TypeScript and wrap in Markdown code blocks.

- 在构建 AI 请求时，将这段文字作为 system prompt / meta 信息的一部分注入，与其他系统设定拼接：

  - System：
    - 基本角色设定 + 安全约束
    - Global Memory 提取的用户偏好段落
  - User：
    - 当前用户消息
  - Context：
    - 选中文本 / 文档内容 / Outline 等

- 优先级原则：
  - 内置系统规则 > 当前对话中用户的最新显式指令 > 全局记忆；
  - 若发生冲突，以当前会话中用户显式指令为准。

---

## 五、User Persona 生成与更新

### 5.1 生成时机

User Persona 的生成/更新与全局记忆更新挂钩：

- 每次 `GlobalMemoryService.updateFromSessions` 被调用时，同时更新 `UserProfile`；
- 也可在用户点击 `Update Now` 时强制更新一次。

### 5.2 输入数据

- `SessionDigest[]`：本次新增的摘要批次；
- 当前 `UserProfile` 精简版（现有 summary、interests、languages 等）；
- 当前 `GlobalMemoryItem` 精简版（已存在的偏好条目）。

### 5.3 输出目标

- 更新后的 `UserProfile`：
  - `summary`：整体画像的自然语言描述；
  - `writingStyle`：总结写作/回答风格；
  - `interests`：更新兴趣标签集；
  - `languages`：确认常用语言集合；
  - `preferredModels`：可选，记录偏好模型。

生成时应努力体现用户个性与习惯，例如：

- 长期倾向于使用中文，偶尔需要英文术语；
- 偏好把复杂问题拆分为步骤；
- 在技术讨论里重点关注实现细节与边界情况；
- 常写的主题领域（如前端、AI 提示词、知识管理、Tauri 等）。

### 5.4 与条目级记忆的关系

- `UserProfile` 是高层的、汇总性的视图，用于：
  - UI 展示（User Persona Tab）；
  - 高级别行为控制（例如默认语言）。
- `GlobalMemoryItem` 是可操作的细粒度单元，用于：
  - 精准的自动过滤与注入；
  - 在 `Manage Memory` 中逐条管理。

两者更新可以同时进行：

- Persona 更偏向**“描述这位用户是谁”**；
- MemoryItem 更偏向**“列出 AI 应该遵守的具体习惯与偏好”**。

---

## 六、实现步骤汇总

### 步骤 1：领域模型与存储

1. 定义 `SessionDigest`、`UserProfile`、`GlobalMemoryItem` Type/Interface；
2. 在 Tauri/backend 或前端（视架构而定）实现全局记忆存储：
   - 读写 `UserProfile`；
   - 读写 `GlobalMemoryItem[]`；
   - 读写待学习队列（`SessionDigest` 队列）。

### 步骤 2：与现有 Session 压缩集成

1. 在文档 Session 压缩逻辑中加入钩子：
   - 完成一次压缩后，构造 `SessionDigest`；
   - 将其加入待学习队列。
2. 确保 `SessionDigest` 中携带 `docPath`、时间范围、摘要文本等关键字段。

### 步骤 3：GlobalMemoryService 增量更新

1. 实现 `GlobalMemoryService.updateFromSessions(digests: SessionDigest[])`：
   - 加载当前全局记忆；
   - 调用 AI 生成 `GlobalMemoryDelta`；
   - 合并 delta 到 `UserProfile` 与 `GlobalMemoryItem[]`；
   - 写回存储。
2. 处理 pinned/disabled 条目的优先级与保护规则。

### 步骤 4：自动更新调度

1. 在应用启动或定期定时器中，注册自动更新检查逻辑：
   - 根据 `GlobalMemorySettings` 检查数量阈值、时间阈值与每日次数限制；
   - 若条件满足，从队列中取一批 `SessionDigest`，调用 `updateFromSessions`；
   - 更新 `lastGlobalUpdateTime` 与当日计数。
2. 在 `GlobalMemoryDialog` 的 `Manage Memory` Tab 中，暴露：
   - `Enable Global Memory`;
   - `Allow auto update`;
   - `Update Now` 按钮。

### 步骤 5：调用时的自动过滤与注入

1. 在所有 AI 调用入口（Chat、重写、总结、生成大纲等）增加：
   - 构造 `CurrentContext`；
   - 调用 `GlobalMemoryService.selectForContext(context)` 获取 Top K 条记忆；
   - 把选出的条目合并为一段简短偏好说明，注入到 system prompt 中。
2. 在过滤逻辑中实现：
   - 基于 type/tags 的任务相关过滤；
   - 语言与近期指令冲突处理；
   - 权重/时间/来源文档数量综合打分；
   - pinned 条目优先；
   - 只返回少量条目（例如 3–7 条）。

### 步骤 6：GlobalMemoryDialog UI 与交互

1. 在菜单 `AI → Session → Global Memory` 下新增两个命令：
   - `User Persona` → 打开对话框并激活 `User Persona` Tab；
   - `Manage Global Memory` → 打开对话框并激活 `Manage Memory` Tab。
2. 实现 `GlobalMemoryDialog` 组件：
   - Header：标题 + Tabs + Close；
   - Body：
     - `User Persona` Tab 显示 `UserProfile`；
     - `Manage Memory` Tab 显示 `GlobalMemoryItem` 列表与过滤器。
   - Footer：`Last global update` + `Update Now` + `Close`。
3. 连接对话框与服务层：
   - 打开时加载 `UserProfile` 和 `GlobalMemoryItem[]`；
   - 在列表中执行 Pin/Disable/Delete 时更新存储；
   - 点击 `Update Now` 时触发一次 `updateFromSessions`（使用当前队列或最近 digests）。

### 步骤 7：用户体验与隐私

1. 在 `GlobalMemoryDialog` 中明确说明：
   - 全部数据仅存于本地，不上传云端；
   - 清空全局记忆不会删除任何文档和会话历史。
2. 提供一键清空全局记忆与关闭自动更新的选项；
3. 确保全局记忆只作为“偏好参考”，不影响用户当下会话的显式指令优先级。

---

以上即为 HaoMD 全局记忆功能的完整实现方案与步骤。后续在实际编码时，可根据现有模块划分，将服务层逻辑放入 `modules/ai/globalMemory` 之类的子模块中，UI 放入对应的 `components` 目录下，以保持高内聚和低耦合。