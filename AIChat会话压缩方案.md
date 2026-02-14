## 背景与目标

当前项目中，`AI → Session → History` 已经支持按文档路径（`docPath`）记录和展示会话历史。
在菜单中还有 `AI → Session → Compress` 占位命令，期望实现：

- 对某个文档的会话历史进行「压缩」；
- 将较早的大量对话压缩为高质量摘要（Summary）；
- 保留最近若干轮完整对话作为 Tail，方便继续上下文；
- 当摘要本身变长时，可以继续进行多级摘要（Multi‑level Summary），避免再次膨胀。

本方案在满足 **高内聚、低耦合、可扩展** 的原则下，给出一个完整的实现步骤。

---

## 总体设计概览

### 目标

- **Summary + Tail**：保留最近 N 轮完整对话，将更早的对话压缩成摘要消息；
- **多级摘要**：当摘要内容再次变长时，能够对摘要本身进行二次、三次摘要；
- **保持现有 UI/命令不变**：`AI → Session → History` 和 `AI → Session → Compress` 的 UI 调用方式尽量不改或少改；
- **解耦 AI 调用细节**：压缩逻辑不直接依赖具体的 LLM API，而是通过抽象的 SummaryProvider 调用。

### 分层结构

从架构角度，将压缩能力拆成四层：

1. **领域层（Domain）**：
   - 扩展 `DocConversationMessageMeta` 描述摘要层级、覆盖范围等；
   - 定义压缩策略配置 `CompressionConfig`。

2. **AI 摘要提供层（Summary Provider）**：
   - 抽象出 `SummaryProvider` 接口；
   - 根据当前模型的上下文长度动态计算摘要阈值（多级摘要触发条件）。

3. **应用服务层（ConversationCompressor）**：
   - 纯函数式服务：给定一个 `DocConversationRecord` 和配置，返回压缩后的新 `DocConversationRecord`；
   - 内部实现 Summary + Tail + 多级摘要完整算法。

4. **集成层（docConversationService + 命令）**：
   - 在 `docConversationService.compressByDocPath` 中调用 `ConversationCompressor`；
   - `AI → Session → Compress` 菜单命令不需要关心具体细节。

---

## 一、领域模型扩展

### 1.1 扩展 DocConversationMessageMeta

**文件**：`app/src/modules/ai/domain/docConversations.ts`

在现有 `DocConversationMessageMeta` 基础上扩展摘要相关字段：

```ts
export type SummaryLevel = 0 | 1 | 2

export type DocConversationMessageMeta = {
  providerType?: 'dify' | 'openai' | 'local' | 'coze' | 'other'
  modelName?: string
  hasImage?: boolean
  tokensUsed?: number

  /**
   * 摘要层级：
   * - 0：原始消息（默认）
   * - 1：一级摘要（直接基于原始消息生成）
   * - 2：二级摘要（对多个一级摘要再压缩）
   */
  summaryLevel?: SummaryLevel

  /**
   * 被本摘要覆盖的消息 ID 列表：
   * - 对于 level 1：通常是若干原始 message 的 id；
   * - 对于 level 2：可以是一级摘要消息的 id。
   */
  coversMessageIds?: string[]

  /**
   * 被覆盖消息的时间范围（用于 UI 显示，例如“覆盖 2025-02-01 ~ 2025-02-14 的对话”）。
   */
  coveredTimeRange?: { from: number; to: number }
}
```

实现要点：

- 保持向后兼容：旧数据和未压缩的消息不设置上面三个字段，即保持原行为；
- 新生成的摘要消息通过 `meta.summaryLevel` 等字段区分出来，为后续 UI 和二次压缩提供信息；
- 不引入新的 Record 类型，一切仍基于 `DocConversationRecord`/`DocConversationMessage`。

### 1.2 压缩策略配置接口

定义压缩策略配置对象，提供给压缩服务使用：

```ts
export type CompressionConfig = {
  /** 会话总消息数超过多少才会考虑压缩 */
  minMessagesToCompress: number
  /** 保留最近多少“对话轮次”作为 Tail，不参与摘要 */
  keepRecentRounds: number
  /** 压缩后允许的最大消息数（软上限，可用于控制是否再次触发压缩） */
  maxMessagesAfterCompress: number
  /** 单次汇总时，参与摘要的最大消息数（避免一次性喂给模型太多） */
  maxMessagesPerSummaryBatch: number
  /**
   * 按摘要层级计算本层允许的最大摘要总长度（字符数），
   * 一般由 SummaryProvider 基于模型上下文动态计算。
   */
  maxSummaryCharsPerLevel: (level: SummaryLevel) => number
}
```

> 注：`CompressionConfig` 是纯类型/纯数据，不依赖 React、Tauri 等任何实现细节，利于测试和日后扩展。

---

## 二、SummaryProvider：AI 摘要提供层设计

### 2.1 接口定义

**文件建议**：`app/src/modules/ai/application/summaryProvider.ts`

```ts
import type { DocConversationMessage, SummaryLevel } from '../domain/docConversations'

export interface SummaryProvider {
  /**
   * 对一批消息进行摘要，返回 Markdown 格式的摘要文本。
   */
  summarizeBatch(input: {
    docPath: string
    level: SummaryLevel
    messages: DocConversationMessage[]
  }): Promise<string>

  /**
   * 给定摘要层级，返回本层允许的最大摘要字符数阈值。
   * 实现内部可以基于当前模型的上下文长度动态计算。
   */
  getMaxSummaryChars(level: SummaryLevel): number
}
```

这样设计的好处：

- `ConversationCompressor` 不需要关心模型名称、上下文窗口大小等细节；
- 阈值计算逻辑（`getMaxSummaryChars`）与模型配置高内聚；
- 将来可以有多种实现：Tauri 调用版、HTTP 服务版、Mock 版等。

### 2.2 基于模型上下文的阈值计算思路

**伪代码示例**（实现放在具体的 `SummaryProvider` 中）：

```ts
function getMaxSummaryChars(level: SummaryLevel): number {
  const modelContextTokens = getContextWindowFromAiSettings() // 比如 8k / 16k / 32k

  // 预留 40% 给系统提示词 + 模型输出
  const maxInputTokens = Math.floor(modelContextTokens * 0.6)

  // 粗略估算：中文场景 1 token ≈ 3 字符
  const baseChars = maxInputTokens * 3

  // 不同层级可做缩放：更高层级摘要往往更精炼
  const scale = level === 1 ? 1 : 0.8

  const estimated = Math.floor(baseChars * scale)

  // 设置一个下限和上限，避免过小/过大
  return clamp(2000, 30000, estimated)
}
```

- `getContextWindowFromAiSettings()` 可以从现有 `aiSettingsRepo` 或模型配置中读取当前使用模型的 `max_tokens`/`context_window`；
- `clamp(min, max, value)` 是一个简单的工具函数；
- 这样就实现了**按模型能力动态调整**阈值，而不是写死一个常量。

---

## 三、ConversationCompressor：应用服务层设计

### 3.1 文件与接口

**文件建议**：`app/src/modules/ai/application/conversationCompressor.ts`

```ts
import type { DocConversationRecord, DocConversationMessage, SummaryLevel } from '../domain/docConversations'
import type { CompressionConfig } from '../domain/docConversations'
import type { SummaryProvider } from './summaryProvider'

export interface ConversationCompressor {
  compress(record: DocConversationRecord, config: CompressionConfig): Promise<DocConversationRecord>
}

export function createConversationCompressor(summaryProvider: SummaryProvider): ConversationCompressor {
  return {
    async compress(record, config) {
      // 具体算法实现见下文
    },
  }
}
```

### 3.2 压缩算法步骤（Summary + Tail + 多级摘要）

下面是 `compress(record, config)` 内部建议的完整流程。

#### 步骤 1：
是否需要压缩

```ts
if (record.messages.length < config.minMessagesToCompress) {
  return record
}
```

- 避免对小规模历史做无意义压缩。

#### 步骤 2：
按轮次分组对话（重用 History 的分组思路）

可以把 `DocConversationHistoryDialog.tsx` 里的 `buildConversationGroups` 抽成 utilities：

**文件建议**：`app/src/modules/ai/domain/docConversationUtils.ts`

```ts
export type ConversationGroup = {
  id: string
  userMessages: DocConversationMessage[]
  assistantMessages: DocConversationMessage[]
  systemMessages: DocConversationMessage[]
  startedAt: number
}

export function buildConversationGroups(messages: DocConversationMessage[]): ConversationGroup[] {
  // 基本逻辑可直接沿用现有 UI 中的实现：
  // - 按 timestamp 排序
  // - system 直接挂在当前组
  // - user 在已有 user/assistant 后开启新组
  // - assistant 追加到当前组
}
```

在 `ConversationCompressor` 中使用：

```ts
const groups = buildConversationGroups(record.messages)
if (groups.length === 0) return record
```

#### 步骤 3：
Tail：保留最近 N 轮完整对话

```ts
const keepN = config.keepRecentRounds
const recentGroups = groups.slice(-keepN)
const oldGroups = groups.slice(0, Math.max(0, groups.length - keepN))

if (oldGroups.length === 0) {
  // 没有“旧对话”，直接返回原始记录
  return record
}
```

- `recentGroups` 中的所有消息将原样保留，不参与摘要；
- `oldGroups` 是本次压缩的「输入内容」。

#### 步骤 4：
选取参与摘要的旧消息（批量控制）

将 `oldGroups` 展平成消息列表，并按 `maxMessagesPerSummaryBatch` 裁剪：

```ts
const oldMessagesFlat: DocConversationMessage[] = flattenGroups(oldGroups)

const maxBatch = config.maxMessagesPerSummaryBatch
const batch = oldMessagesFlat.slice(0, maxBatch)
```

> `flattenGroups` 可以简单地按 `system → user → assistant` 的顺序展开每个 group 中的消息。

#### 步骤 5：
调用 SummaryProvider 生成一级摘要

```ts
const level: SummaryLevel = 1
const summaryMarkdown = await summaryProvider.summarizeBatch({
  docPath: record.docPath,
  level,
  messages: batch,
})
```

如果生成结果为空或出错，可选择：

- 直接返回原记录；
- 或仅进行 Tail 截断（不做摘要）。

#### 步骤 6：
构造一级摘要消息

```ts
const allOldMessageIds = oldMessagesFlat.map(m => m.id)
const timestamps = oldMessagesFlat.map(m => m.timestamp)
const from = Math.min(...timestamps)
const to = Math.max(...timestamps)

const summaryMessage: DocConversationMessage = {
  id: generateSummaryId(),            // 可复用现有 genSessionId 或类似方法
  docPath: record.docPath,
  timestamp: Date.now(),
  role: 'system',
  content: summaryMarkdown,
  meta: {
    providerType: /* 当前 providerType，可选 */ 'other',
    modelName: 'summary-v1',
    summaryLevel: 1,
    coversMessageIds: allOldMessageIds,
    coveredTimeRange: { from, to },
  },
}
```

> `generateSummaryId()` 可以简单调用现有 `genSessionId` 风格逻辑，或复用某个 uuid 工具。

#### 步骤 7：
多级摘要触发判定

在合并现有摘要（若有）+ 新摘要之前，先看当前摘要区块是否已经超出阈值：

1. 先把现有 `messages` 中 `meta.summaryLevel >= 1` 的摘要消息找出来：

   ```ts
   const existingSummaries = record.messages.filter(
     m => m.meta?.summaryLevel && m.meta.summaryLevel >= 1,
   )
   ```

2. 计算这些摘要 + 新的 `summaryMessage` 的总字符数：

   ```ts
   const allSummaries = [...existingSummaries, summaryMessage]
   const totalSummaryChars = allSummaries.reduce((sum, m) => sum + m.content.length, 0)

   const maxCharsForLevel1 = config.maxSummaryCharsPerLevel(1)
   ```

3. 如果 `totalSummaryChars <= maxCharsForLevel1`：

   - 暂时只保留一级摘要，不触发二级摘要；
   - 直接进入“最终合并”步骤。

4. 如果 `totalSummaryChars > maxCharsForLevel1`：

   - 触发二级摘要（多级摘要的一种），对 `allSummaries` 再做一次 `summarizeBatch`：

     ```ts
     const level2: SummaryLevel = 2
     const level2SummaryMarkdown = await summaryProvider.summarizeBatch({
       docPath: record.docPath,
       level: level2,
       messages: allSummaries,
     })

     const level2Message: DocConversationMessage = {
       id: generateSummaryId(),
       docPath: record.docPath,
       timestamp: Date.now(),
       role: 'system',
       content: level2SummaryMarkdown,
       meta: {
         providerType: 'other',
         modelName: 'summary-v1',
         summaryLevel: 2,
         coversMessageIds: allSummaries.map(m => m.id),
         coveredTimeRange: {
           from: Math.min(...allSummaries.map(m => m.meta?.coveredTimeRange?.from ?? m.timestamp)),
           to: Math.max(...allSummaries.map(m => m.meta?.coveredTimeRange?.to ?? m.timestamp)),
         },
       },
     }
     ```

   - 关于一级摘要是否保留，有两种策略（可配）：
     - **保留策略**：保留所有 Level1 摘要 + 新的 Level2 摘要；
     - **清理策略**：只保留 Level2 摘要，Level1 摘要不再出现在 `messages` 中（但 Level2 的 `coversMessageIds` 仍然记录它们）。

   - 为了控制历史体积，可以在配置中增加：

     ```ts
     type MultiLevelMode = 'keep-all' | 'prune-lower'
     ```

     然后根据 `config.multiLevelMode` 决定是否移除 Level1 摘要。

#### 步骤 8：
合并成最终消息列表

假设采用简单的策略：

- Level2 摘要存在时：
  - 保留 Level2 摘要（可选择是否保留 Level1）；
- 否则：
  - 只保留 Level1 摘要；

最终 `messages` 的构造方式可以是：

```ts
// 1. 选择要保留的摘要消息（根据 multiLevelMode 策略）
const summaryMessagesToKeep: DocConversationMessage[] = /* 计算后的摘要数组 */

// 2. 保留 recentGroups 中的所有消息（Tail）
const tailMessages = flattenGroups(recentGroups)

// 3. 组合并按 timestamp 排序
const mergedMessages = [...summaryMessagesToKeep, ...tailMessages]
  .sort((a, b) => a.timestamp - b.timestamp)

const compressedRecord: DocConversationRecord = {
  ...record,
  messages: mergedMessages,
  lastActiveAt: Date.now(),
}

return compressedRecord
```

> 注意：如果希望摘要消息总是显示在 History 的顶部，可以在排序规则中对 `summaryLevel` 做一点偏移，例如 `summaryLevel` 高的排在前面。

---

## 四、docConversationService 集成步骤

**文件**：`app/src/modules/ai/application/docConversationService.ts`

### 4.1 引入 ConversationCompressor 与 SummaryProvider

在文件顶部增加：

```ts
import { createConversationCompressor } from './conversationCompressor'
import { createSummaryProvider } from './summaryProviderImpl' // 具体实现文件
import type { CompressionConfig } from '../domain/docConversations'
```

然后在模块作用域初始化：

```ts
const summaryProvider = createSummaryProvider()
const conversationCompressor = createConversationCompressor(summaryProvider)

const defaultCompressionConfig: CompressionConfig = {
  minMessagesToCompress: 80,
  keepRecentRounds: 5,
  maxMessagesAfterCompress: 60,
  maxMessagesPerSummaryBatch: 200,
  maxSummaryCharsPerLevel: (level) => summaryProvider.getMaxSummaryChars(level),
}
```

> 以上数字可以根据实际使用体验再调整，也可以后来做成 AI Settings 里的可配置项。

### 4.2 实现 compressByDocPath

将当前占位实现：

```ts
async compressByDocPath(_docPath: string): Promise<void> {
  console.warn('[docConversationService] compressByDocPath is not implemented yet')
}
```

改为真实实现：

```ts
async compressByDocPath(docPath: string): Promise<void> {
  await ensureLoaded()
  const records = getCache()
  const idx = records.findIndex((r) => r.docPath === docPath)
  if (idx < 0) {
    // 当前文档没有会话记录，直接返回
    return
  }

  const record = records[idx]

  // 调用压缩服务
  const compressed = await conversationCompressor.compress(record, defaultCompressionConfig)

  // 如果压缩前后消息数没变化，可以认为本次压缩无效果，仍然覆盖即可
  records[idx] = compressed

  await persist(records)
}
```

> 这里不直接与 UI 交互，命令层只通过状态栏消息告知「压缩已触发」。

---

## 五、命令与 UI 层：保证低耦合

### 5.1 `AI → Session → Compress` 命令

**文件**：`app/src/modules/commands/registry.ts`

现有实现已经通过 `docConversationService.compressByDocPath(docPath)` 触发压缩，只需保留：

```ts
ai_conversation_compress: async () => {
  try {
    if (!ctx.getCurrentFilePath) {
      ctx.setStatusMessage('当前编辑器状态不可用，无法压缩文档会话历史')
      return
    }
    const docPath = ctx.getCurrentFilePath()
    if (!docPath) {
      ctx.setStatusMessage('请先打开一个已保存的文档，再使用 Compress')
      return
    }
    await docConversationService.compressByDocPath(docPath)
    ctx.setStatusMessage('已触发文档会话压缩')
  } catch (err) {
    console.error('[commands] ai_conversation_compress error', err)
    ctx.setStatusMessage('压缩文档会话历史失败，请检查控制台日志')
  }
},
```

> 命令层不参与任何算法逻辑，符合低耦合要求。

### 5.2 History UI（DocConversationHistoryDialog）

当前 `DocConversationHistoryDialog` 已经能展示：

- `system` / `user` / `assistant` 三种角色的消息；
- 对摘要消息来说，我们只是把其 `role` 保持为 `system`，只是在 `meta` 中额外标注 `summaryLevel` 等信息。

**可选增强**（不影响主流程）：

- 若 `message.meta?.summaryLevel === 1`，在 UI 中标注为：
  - `System (Summary L1)`；
- 若 `summaryLevel === 2`，标注为：
  - `System (Summary L2)` 或 `Global Summary`；
- 使用 `coveredTimeRange` 在界面上显示：
  - `覆盖 2025-02-01 ~ 2025-02-14 的历史对话`。

这些增强都只依赖 meta 信息，不需要了解压缩算法的实现细节，保持低耦合。

---

## 六、测试与验证步骤

1. **单元测试 ConversationCompressor**：
   - 构造一个包含多轮对话的 `DocConversationRecord`：
     - 前面 10 轮假装是旧对话，后面 3 轮是最近对话；
   - 使用 MockSummaryProvider（不调用真实 LLM，只返回固定文本）
     - `summaryLevel=1` 时返回 `"[L1 summary] ..."`；
     - `summaryLevel=2` 时返回 `"[L2 summary] ..."`；
   - 验证：
     - Tail 中的最近 N 轮原始消息仍然存在；
     - 旧对话被替换为 1 条或少量摘要消息；
     - meta.summaryLevel / coversMessageIds / coveredTimeRange 正确。

2. **集成测试 docConversationService.compressByDocPath**：
   - 构造包含该 docPath 的 `recordsCache`；
   - 调用 `compressByDocPath(docPath)`；
   - 验证：
     - 对应记录被替换为压缩后的版本；
     - `persist` 被调用一次。

3. **手工测试 UI 行为**：
   - 在编辑器中打开一个文档，使用 AI 多轮对话生成足够多的历史；
   - 打开 `AI → Session → History`，确认历史数量较多；
   - 点击 `AI → Session → Compress`：
     - 查看 History 浮窗，前面的旧对话是否变成摘要消息；
     - 最近几轮对话是否保持完整；
     - 多次 Compress 后摘要是否进一步被精简（视多级策略而定）。

4. **回退策略（可选）**：
   - 在压缩前先做备份：
     - 将旧的 `records` 写入一个本地备份文件（Tauri 侧，可选功能）；
   - 或增加一条命令 `AI → Session → Restore Last Compress`，从备份中恢复上一版本的 `DocConversationRecord`。

---

## 七、小结

- 通过扩展领域模型（`summaryLevel` 等）、抽象 SummaryProvider、集中实现 ConversationCompressor，并在 docConversationService 中做统一接入，可以实现一个高内聚、低耦合、可扩展的会话压缩体系。
- Summary + Tail 的基本策略保证「最近对话上下文」的可用性，多级摘要则保证摘要本身不会无限膨胀。
- 所有 UI 和命令层只依赖公共服务和领域结构，不关心算法细节，为后续更换模型/策略提供了足够空间。