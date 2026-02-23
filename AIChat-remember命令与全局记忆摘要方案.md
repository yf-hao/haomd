## AIChat `/remember` 命令与全局记忆摘要方案

### 1. 背景与目标

- **背景**
  - HaoMD 已有：
    - AI Chat 会话（按文档维度）
    - Global Memory（全局用户画像 / 偏好）
    - Session Digest 队列与自动更新链路（pendingDigests → Update now → Persona 更新）。
  - 目前 `/remember` 已能将**用户手写摘要**写入 Global Memory 的待学习队列，但缺少：
    - 无参数时的自动摘要能力；
    - 面向“未来新文档对话”的专门 Prompt 设计；
    - 在手写摘要与自动摘要冲突时的“优先级规则”。

- **总目标**
  - 在 AI Chat 中提供一条统一的命令：`/remember`，用于“把当前这一段对话中对未来有用的内容记住”。
  - 支持两种用法：
    - `/remember`：不带文字 → 系统自动从当前会话生成摘要并入队；
    - `/remember <用户手写摘要>`：带文字 → 用户文本作为高优先级摘要，自动摘要作为可选补充，一并入队。
  - 摘要内容用于**优化未来所有新文档中的 AI 对话体验**，而不是单纯复盘当前文档内容。

---

### 2. 命令协议与交互设计

#### 2.1 命令协议

- **基础命令**：`/remember`
  - **无参数**：`/remember`
    - 含义：
      - “帮我把这段对话里对未来有用的东西记住”。
      - 系统会对“当前文档当前会话”的最近一段对话进行自动摘要。
  - **带参数**：`/remember <用户手写摘要>`
    - 含义：
      - “按照我说的来记，优先相信我这段话”。
      - 用户手写摘要视为“高优先级 / 更可信”的信息，后续更新 Persona 时优先采用。

#### 2.2 使用场景与约束

- **仅在绑定文档的 AI Chat 中生效**
  - Slash 命令上下文需包含：
    - `docPath`: 当前文档路径（已保存）；
  - 未保存的临时文档不允许使用 `/remember`，需要给出明确的错误提示。

- **前置条件与错误场景**
  - 当前文档未保存：
    - 模态提示：
      - 「当前文档尚未保存，无法使用 /remember。请先保存文档后再试。」
  - `/remember` 后未输入任何文字，且自动摘要失败：
    - 模态提示：
      - 「当前会话内容过少或自动总结失败，未能生成可用摘要。」
  - `/remember <文本>`，自动摘要失败：
    - 入队仅包含用户摘要；
    - 模态提示：
      - 「已将你手写的摘要加入 Global Memory 队列（自动总结失败，未加入）。」

#### 2.3 成功反馈

- 入队成功后，在当前 AI Chat 上弹出项目内统一的模态窗口（`ConfirmDialog`）：
  - 成功场景文案示例：
    - 无用户文本，仅自动摘要：
      - 「已根据当前会话生成摘要并加入 Global Memory 队列。」
    - 仅用户文本：
      - 「已将你手写的摘要加入 Global Memory 队列。」
    - 用户文本 + 自动摘要：
      - 「已将你手写摘要及自动总结一起加入 Global Memory 队列。」

---

### 3. 数据结构与优先级策略

#### 3.1 现有结构（简化示意）

```ts
// 实际类型以当前代码为准，这里是简化形式
export type SessionDigest = {
  docPath: string
  period: { from: number; to: number }
  summaries: string[]
  // 可选：source, createdAt 等
}
```

"/remember" 的摘要数据最终需要作为 `SessionDigest` 入队，进入 `pendingDigests`，由 Global Memory 更新流程消费。

#### 3.2 用户摘要与自动摘要的合并策略

为了在不大改类型的前提下表达“用户摘要优先”，推荐使用**顺序 + Prompt 约定**的方式：

- **约定**：
  - 如果存在用户手写摘要 → `summaries[0]` 永远是用户摘要（最高优先级）；
  - 自动摘要放在后面（`summaries[1..]`），作为补充信息。

- **入队规则**：
  - `/remember`（无参数）：
    - 仅自动摘要 → `summaries = [autoSummary]`。
  - `/remember <userSummary>`（有参数）：
    - 轻量版：`summaries = [userSummary]`；
    - 增强版：`summaries = [userSummary, autoSummary]`（若自动摘要成功）。

- **Global Memory 更新时的解释规则**：
  - 当 `summaries.length > 0`：
    - 若 `summaries[0]` 是用户摘要 → 在 Prompt 中显式说明“第一个为用户手写摘要，优先相信”；
    - 后续项视为系统自动摘要，仅作参考；
  - 当只有自动摘要 → 视为普通 Session Digest，按原有逻辑处理。

> 如需更强的类型安全，也可以在未来演进为：
>
> ```ts
> type SessionDigest = {
>   docPath: string
>   period: { from: number; to: number }
>   autoSummaries: string[]
>   userSummary?: string
> }
> ```
>
> 但初版实现可以先用“顺序 + Prompt”方案，以降低改动范围。

---

### 4. 自动摘要的实现思路

自动摘要触发条件：

- 用户输入 `/remember` 且**没有附加任何文字**；
- 或者用户附加文字，但系统选择在后台再做一份自动摘要作为补充（增强版）。

自动摘要的核心流程：

1. 收集“当前文档的近期对话消息”；
2. 将这些消息转换为适合 LLM 的文本格式；
3. 使用专门面向“全局记忆 / 未来对话优化”的 Prompt 调用模型；
4. 得到一段短摘要字符串 `autoSummary`；
5. 按前述规则与用户摘要合并，作为 `SessionDigest.summaries` 入队。

#### 4.1 消息来源的两种路径

- **路径 A：基于前端当前 AI Chat 状态（起步简单，推荐先上）**
  - 来源：`useAiChatSession` 返回的 `state.viewMessages`：
    - 过滤掉隐藏的消息、仅保留用户 / 助手对话；
    - 按时间排序，取最近 N 条（例如 20～50 条）。
  - 新增一个 helper，例如：

    ```ts
    // 设计形态
    type UseAiChatSessionResult = {
      // ... 现有字段
      getRecentMessagesForDigest: (limit: number) => ChatMessageView[]
    }
    ```

  - 优点：实现全在前端，依赖现有 Chat 状态，不涉及 service 层；
  - 缺点：只能看到当前 Chat tab 的内容，不看过去已压缩的长历史。

- **路径 B：复用 `docConversationService` / 会话压缩链路（更统一）**
  - 新增应用命令，例如 `ai_conversation_build_short_digest`：
    - 输入 `docPath`；
    - service 端从 `docConversationService` 拉取对应文档的最近一段记录；
    - 使用统一配置的“短摘要模型 + Prompt”生成 `summary: string`；
    - 返回给前端，而不直接写队列。
  - `/remember` 无参时：前端通过 `ctx.runAppCommand('ai_conversation_build_short_digest')` 获取 `autoSummary`，再走 from-chat 入队逻辑。
  - 优点：所有“如何摘要会话”的策略集中在 service 层，便于统一管理；
  - 缺点：实现稍复杂，需要改命令系统与服务层。

> 推荐路线：**优先实现路径 A 作为 MVP**，验证体验和 Prompt 效果；后续再根据需要逐步往路径 B 收拢。

---

### 5. 自动摘要 Prompt 设计（面向未来新文档对话）

自动摘要的目标不是“复盘当前文档内容”，而是“提取能帮助未来任何文档对话的长期信息”，例如：

- 用户的长期目标与研究方向；
- 用户的工作习惯、协作方式和节奏偏好；
- 对 AI 回答风格、格式、长度的偏好；
- 对模型、参数、工具的偏好与约束；
- 适用于未来项目/代码的统一约定；
- 需要避免的行为或雷区。

#### 5.1 System 提示词（角色设定）

```text
你是一个“用户全局记忆（Global Memory）整理助手”。

你的任务是：
- 阅读一段用户和 AI 助手围绕某个文档的对话记录；
- 只提取那些“对未来任何新文档都可能有用”的长期信息，用于优化以后的 AI 对话体验；
- 将这些信息整理成结构化的、简短的“用户记忆摘要”。

注意：你不是在写本次文档的总结报告，而是在给“未来帮用户写任何文档的 AI”写一份“使用说明书更新”。
```

#### 5.2 User 提示词模板

```text
下面是一段用户与 AI 助手的对话记录，关联的文档路径为：{docPath}。

【对话开始】
{conversation_messages}
【对话结束】

其中 {conversation_messages} 的格式建议为多行文本，例如：
- [用户] ...
- [助手] ...

请基于这些对话，生成一份“面向未来新文档对话场景”的全局记忆摘要，用于更新用户画像和工作偏好。请严格遵守以下要求：

1. 只关注“跨文档可复用的”长期信息，优先包括但不限于：
   - 用户的目标与长期方向（例如：希望产出什么类型的内容、研究方向、写作目标等）；
   - 用户的工作流与协作方式（例如：喜欢先出大纲再细化、偏好分阶段迭代、喜欢你先问问题再给方案等）；
   - 用户对 AI 行为的偏好和禁忌（例如：回答要简洁 / 要详细、不要废话、不要自动改写格式、需要中文回答等）；
   - 用户的内容和风格偏好（例如：更偏工程实现细节 / 更偏概念解释、喜欢表格 / 列表 / 分节结构等）；
   - 用户对工具、模型、参数的偏好（例如：偏好某个模型、temperature 较低、喜欢先跑 lint 再改代码等）；
   - 用户对项目/代码库的一般性约定（例如：命名风格、错误处理策略、测试约定、性能优先级等）。

2. 有意识地“过滤掉”以下内容：
   - 只对当前这一个文档有效、未来很难复用的具体事实和细节（例如某一段文字的具体修改、某一章节的细枝末节内容）；
   - 一次性的临时状态（例如“现在这个分支没推上去”、“这个 bug 今天先不修”等）；
   - 对未来新文档帮助不大的原始问答细节。

3. 在表达上：
   - 使用简体中文；
   - 使用简洁的分条或小段落描述，便于后续模型直接读入；
   - 不要编造对话中没有出现的偏好或设定，如果不确定就写“暂无信息”或省略该点；
   - 当信息有冲突时，以最近一次明确的表述为准，并在总结中采用用户最新的要求。

4. 请按照下面结构化格式输出（如果某一部分没有信息，可以写“暂无信息”）：

- 用户长期目标与关注点：
  - …

- 用户在新文档协作中的工作方式（workflow）：
  - …

- 用户对 AI 回答的风格和格式偏好：
  - …

- 用户对模型 / 参数 / 工具的偏好与约束：
  - …

- 适用于未来文档的一般性约定（代码风格、架构倾向、性能/可读性权衡等）：
  - …

- 需要特别避免的行为或雷区：
  - …

请只输出上述结构化摘要，不要额外加解释性前言或后记。
```

#### 5.3 `conversation_messages` 的构造建议

- 从 `ChatMessageView[]` 中：
  - 过滤条件：
    - 只保留 `role` 为 `user` / `assistant` 的消息；
    - 排除系统提示 / 隐藏消息（如 `hidden` 标记为 true）。
  - 取最近 N 条（例如 20～50 条），按时间从早到晚排序。
- 文本格式示例：

```text
- [用户] 我想把这个文档的大纲拆成 7 个章节，分别是……
- [助手] 可以，建议你按功能分为 A/B/C……
- [用户] 之后所有 AI 回答尽量用简体中文，少一点套话，多一点具体步骤。
- [助手] 好的，后续我会尽量用简体中文、分步骤说明。
...
```

---

### 6. `/remember` 处理流程（整合自动摘要）

下面是 `/remember` handler 的推荐逻辑（伪代码，仅设计，不对应具体实现）：

```ts
async function handleRemember(ctx: AiSlashCommandContext, args: string[]) {
  const docPath = ctx.docPath
  if (!docPath) {
    ctx.showModal?.('当前文档尚未保存，无法使用 /remember。请先保存文档后再试。')
    return
  }

  const userSummary = args.join(' ').trim() || null

  // 情况一：用户提供了手写摘要
  if (userSummary) {
    // 可选：在后台补一份自动摘要作为补充
    let autoSummary: string | null = null
    try {
      const messages = getRecentMessagesForDigest(/* limit */)
      autoSummary = await buildAutoDigestSummaryForCurrentChat({ docPath, messages })
    } catch (err) {
      console.warn('[remember] auto summary failed, fallback to user only', err)
    }

    const summaries = autoSummary ? [userSummary, autoSummary] : [userSummary]

    enqueueSessionDigestFromChat({
      docPath,
      summaries,
      periodFrom: estimatePeriodFromCurrentSession(),
      periodTo: Date.now(),
      source: 'chat-remember',
    })

    if (autoSummary) {
      ctx.showModal?.('已将你手写摘要及自动总结一起加入 Global Memory 队列。')
    } else {
      ctx.showModal?.('已将你手写的摘要加入 Global Memory 队列（自动总结失败，未加入）。')
    }

    return
  }

  // 情况二：无参数，纯自动摘要
  const messages = getRecentMessagesForDigest(/* limit */)
  if (!messages.length) {
    ctx.showModal?.('当前会话内容太少，无法生成摘要。')
    return
  }

  let autoSummary: string
  try {
    autoSummary = await buildAutoDigestSummaryForCurrentChat({ docPath, messages })
  } catch (err) {
    console.error('[remember] auto summary failed', err)
    ctx.showModal?.('自动总结当前会话失败，请稍后重试。')
    return
  }

  if (!autoSummary.trim()) {
    ctx.showModal?.('自动总结结果为空，未加入 Global Memory。')
    return
  }

  enqueueSessionDigestFromChat({
    docPath,
    summaries: [autoSummary],
    periodFrom: estimatePeriodFromCurrentSession(),
    periodTo: Date.now(),
    source: 'chat-remember-auto',
  })

  ctx.showModal?.('已根据当前会话生成摘要并加入 Global Memory 队列。')
}
```

> 注意：上述代码仅为“方案级伪代码”，具体实现需要结合现有 `AiSlashCommandContext`、`useAiChatSession`、`sessionDigestQueue` 的类型与函数名进行适配。

---

### 7. 与 Global Memory 更新链路的衔接

当前已经存在的链路大致为：

1. `pendingDigests` 中积累若干 `SessionDigest`；
2. 用户在 Global Memory 面板点击「Update now」或触发自动更新；
3. 服务侧从 `pendingDigests` 取出一批 Session Digest；
4. 调用 LLM 生成 `GlobalMemoryDelta`，用于更新用户 Persona；
5. 更新成功后，从 `pendingDigests` 中移除已消费的条目。

`/remember` 引入自动摘要后，在这条链路上的变化是：

- 新增了一种 Session Digest 来源：
  - `source = 'chat-remember' | 'chat-remember-auto'`；
- 每条 Digest 的 `summaries` 可能包含：
  - 只有自动摘要；
  - 只有用户摘要；
  - 用户摘要 + 自动摘要（用户在前，自动在后）。

在 Global Memory 更新 Prompt 中，需要：

- 针对含用户摘要的 Digest：

  ```text
  用户手写摘要（优先级最高，请优先相信）：
  - {summaries[0]}

  系统自动摘要（仅作辅助参考）：
  - {summaries[1]}
  - {summaries[2]}
  ...
  ```

- 针对仅自动摘要的 Digest：

  ```text
  系统自动摘要：
  - {summaries[0]}
  - {summaries[1]}
  ...
  ```

并在说明中明确：

> 当用户手写摘要与系统自动摘要存在冲突时，一律以用户手写摘要为准；系统自动摘要仅用于补充细节或填补空白。

---

### 8. 后续迭代方向（可选）

- **更细粒度的结构化 SessionDigest**
  - 将 `SessionDigest` 拆分为：
    - `userSummary`（单条字符串）
    - `autoSummaries[]`
    - 甚至：`tags`（例如 [写作风格] [代码风格] [工作流]）
  - 便于 Global Memory 更新时按类别做不同权重。

- **Dedup / 合并策略**
  - 对于多次 `/remember` 的重复信息，支持在 Global Memory 更新时做简单去重或合并；
  - 例如：同一偏好在多次摘要中被重复提到，可以增加其权重。

- **可视化 Global Memory 片段**
  - 在 Global Memory 面板中展示：
    - 最近几条 `/remember` 生成的摘要片段；
    - 标记哪些是“用户手写”，哪些是“自动生成”。

- **扩展更多 Slash 命令**
  - `/forget`：从 Global Memory 中弱化或移除某些偏好；
  - `/profile`：在 Chat 中快速查看当前用户画像的关键摘要；
  - `/remember!`：强制高权重记忆（例如关键信仰 / 不能违反的强约束）。

以上就是当前 `/remember` 命令 + 自动摘要 + 面向未来对话的 Prompt 的整体设计方案，可作为后续实现与演进的基础文档。