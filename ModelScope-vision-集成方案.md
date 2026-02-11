## ModelScope 视觉模型可扩展集成方案实施步骤

> 目标：在现有 AI Chat 架构中，以高内聚低耦合的方式集成 ModelScope 视觉模型（如 `Qwen/QVQ-72B-Preview`），并为未来接入其他 Vision Provider 预留清晰扩展点。

---

## 一、整体架构与分层

### 1. 分层原则

- **领域层（Domain）**：描述“要做什么”，不包含任何具体 Provider 的 JSON / HTTP 细节。
- **图片来源与解析层（Images）**：统一处理本地路径、网络 URL、已有 data URL 等，向上只暴露“可用的图片 URL 字符串”。
- **Vision Provider 适配层（Vision Providers）**：将领域层的 Vision 任务翻译成各家视觉 API 的调用格式，并复用现有流式客户端。
- **AI Chat UI 层（AI Chat UI）**：负责用户交互（上传图片、输入提示词、点击发送），不关心具体模型协议。

### 2. 关键设计点

- 不在全局强行统一底层 JSON，而是统一领域语义：**VisionTask = 提示词 + 多张图片**。
- 用接口/工厂模式，为每个 Vision Provider 写独立适配器，隔离 API 差异。
- 图片处理单独一层，供所有 Vision Provider 复用。

---

## 二、领域层扩展：Vision 任务抽象

> 文件位置建议：`app/src/modules/ai/domain/types.ts`

### 1. 增加图片来源抽象

在领域层定义一个与具体 API 无关的图片来源类型 `ImageSource`：

```ts
export type ImageSource =
  | { kind: 'url'; url: string }
  | { kind: 'data_url'; dataUrl: string }
  | { kind: 'path'; path: string }
```

- **kind = 'url'**：远程 HTTP(S) 图片地址。
- **kind = 'data_url'**：前端通过 FileReader 等方式生成的 `data:image/...;base64,...`。
- **kind = 'path'**：本地文件路径（由 Tauri 后端读取并转为 data URL）。

### 2. 定义 Vision 任务模型

在同一个文件中新增 `VisionTask`：

```ts
export type VisionTask = {
  prompt: string      // 提示词：用户输入或默认的“根据上下文解析图片”
  images: ImageSource[]
}
```

> 注意：
> - 领域层只关心“有一个 prompt + 一组图片”，不关心 image_url、fileId 等具体协议字段。
> - 支持多图，单图场景即 `images.length === 1`。

---

## 三、图片解析层：ImageSource → 可用 URL

> 目标：把 `ImageSource` 统一解析为模型可接受的 URL 字符串（HTTP 或 data URL），为所有 Vision Provider 复用。

### 1. 定义解析接口

新增文件：`app/src/modules/images/imageUrlResolver.ts`：

```ts
import type { ImageSource } from '../ai/domain/types'

export interface IImageUrlResolver {
  resolve(source: ImageSource): Promise<string>
}
```

- **输入**：与 Provider 无关的 `ImageSource`。
- **输出**：可直接放进 Vision API 的 `url` 字段的字符串。

### 2. 默认解析实现

新增文件：`app/src/modules/images/defaultImageUrlResolver.ts`：

```ts
import { invoke } from '@tauri-apps/api/core'
import type { ImageSource } from '../ai/domain/types'
import type { IImageUrlResolver } from './imageUrlResolver'

async function imagePathToDataUrl(path: string): Promise<string> {
  // Rust 侧需提供 read_image_as_data_url 命令，返回 { data_url: string }
  const result = await invoke<{ data_url: string }>('read_image_as_data_url', { path })
  return result.data_url
}

export const defaultImageUrlResolver: IImageUrlResolver = {
  async resolve(source: ImageSource): Promise<string> {
    switch (source.kind) {
      case 'url':
        return source.url
      case 'data_url':
        return source.dataUrl
      case 'path':
        return await imagePathToDataUrl(source.path)
      default:
        throw new Error(`Unsupported ImageSource kind: ${(source as any).kind}`)
    }
  },
}
```

### 3. Rust/Tauri 后端命令（设计说明）

> 文件：`app/src-tauri/src/...`（仅设计，不在此详细书写）

- 新增命令 `read_image_as_data_url(path: String) -> { data_url: String }`：
  - 读取本地图片文件为字节数组。
  - 根据扩展名或内容推断 MIME 类型（默认 `image/png`）。
  - 对字节进行 base64 编码，拼成 `data:image/...;base64,xxx` 返回。

---

## 四、Vision Provider 抽象与 ModelScope 适配器

### 1. 通用 Vision 客户端接口

> 文件建议：`app/src/modules/ai/vision/visionClient.ts`

```ts
import type { VisionTask } from '../domain/types'
import type { StreamingChatResult } from '../domain/types'

export type StreamingHandlers = {
  onChunk?: (chunk: { content?: string }) => void
  onComplete?: (content: string, tokenCount: number) => void
  onError?: (error: Error) => void
}

export interface IVisionClient {
  ask(task: VisionTask, handlers: StreamingHandlers): Promise<StreamingChatResult>
}
```

- 与现有 `IStreamingChatClient` 保持类似的回调结构，方便在 UI 层统一处理流式结果。

### 2. ModelScope Vision 适配器实现

> 文件建议：`app/src/modules/ai/modelscope/ModelScopeVisionClient.ts`

#### 2.2 构造 messages 的辅助函数

```ts
import type { VisionTask } from '../domain/types'
import type { ChatMessage } from '../domain/types'

function buildModelScopeMessages(task: VisionTask, imageUrls: string[]): ChatMessage[] {
  // 当前先支持单图，多图可以根据 ModelScope 文档扩展
  const [firstUrl] = imageUrls

  return [
    {
      role: 'user',
      // 这里才引入 ModelScope/OpenAI image_url 协议细节
      content: [
        { type: 'image_url', image_url: { url: firstUrl } },
        { type: 'text', text: task.prompt },
      ],
    } as any,
  ]
}
```

#### 2.3 ModelScopeVisionClient 类

```ts
import type { IVisionClient, StreamingHandlers } from '../vision/visionClient'
import type { VisionTask } from '../domain/types'
import type { IStreamingChatClient, StreamingChatRequest } from '../domain/types'
import type { IImageUrlResolver } from '../../images/imageUrlResolver'

export class ModelScopeVisionClient implements IVisionClient {
  constructor(
    private readonly chatClient: IStreamingChatClient,
    private readonly imageUrlResolver: IImageUrlResolver,
  ) {}

  async ask(task: VisionTask, handlers: StreamingHandlers) {
    const imageUrls = await Promise.all(
      task.images.map((img) => this.imageUrlResolver.resolve(img)),
    )

    const messages = buildModelScopeMessages(task, imageUrls)
    const request: StreamingChatRequest = {
      messages,
      temperature: 0,
      maxTokens: 512,
    }

    return this.chatClient.askStream(request, handlers)
  }
}
```

### 3. 从 Provider 配置创建 ModelScope Vision Client

> 文件建议：`app/src/modules/ai/modelscope/createModelScopeVisionClient.ts`

```ts
import { createOpenAIStreamingClient } from '../openai/createOpenAIStreamingClient'
import type { UiProvider } from '../domain/types'
import type { IImageUrlResolver } from '../../images/imageUrlResolver'
import { ModelScopeVisionClient } from './ModelScopeVisionClient'

export function createModelScopeVisionClient(
  provider: UiProvider,
  imageUrlResolver: IImageUrlResolver,
) {
  const baseUrl = provider.baseUrl.trim()
  const apiKey = provider.apiKey.trim()
  const modelId = provider.defaultModelId || provider.models[0]?.id || ''

  const streamingClient = createOpenAIStreamingClient({
    apiKey,
    baseUrl,
    modelId,
    temperature: 0,
    maxTokens: 512,
  })

  return new ModelScopeVisionClient(streamingClient, imageUrlResolver)
}
```

> 说明：
> - 直接复用现有的 OpenAI 兼容流式客户端（SSE 解析、错误处理等逻辑），减少重复代码。
> - ModelScope 的 Base URL / ModelId 完全由 `UiProvider` 配置控制。

---

## 五、Provider 配置扩展：标记 Vision 能力

### 1. UiProvider 增加 Vision 模式

> 文件：`app/src/modules/ai/domain/types.ts`

```ts
export type VisionMode =
  | 'none'             // 不支持图像
  | 'enabled' // OpenAI/ModelScope 这类 image_url 模式
  // 后续可扩展: 'upload_then_id' 等

export type UiProvider = {
  // ...原有字段
  visionMode?: VisionMode
}
```

### 2. AiSettings 后端配置映射

> 文件：`app/src/modules/ai/config/aiSettingsRepo.ts`

- 在 `AiProviderCfg` / `AiSettingsCfg` 中增加对应字段（例如 `vision_mode?: string | null`）。
- 在 `fromCfg` 中把 `vision_mode` 映射到 `UiProvider.visionMode`。
- 在 `toCfg` 中把 `UiProvider.visionMode` 映射回后端配置。

### 3. AiSettingsDialog UI（可选）

> 文件：`app/src/components/AiSettingsDialog.tsx`

- 在 Provider 表单中新增一个下拉选择或文本输入，用于设置 `VisionMode`：
  - `none`
  - `enabled`（ModelScope、OpenAI Vision 兼容）
- 当前阶段如仅支持 ModelScope，可先在代码中写死，后续再开放 UI 编辑。

### 4. Vision Client 工厂函数

> 文件建议：`app/src/modules/ai/vision/visionClientFactory.ts`

```ts
import type { UiProvider, VisionTask } from '../domain/types'
import type { IVisionClient } from './visionClient'
import { defaultImageUrlResolver } from '../../images/defaultImageUrlResolver'
import { createModelScopeVisionClient } from '../modelscope/createModelScopeVisionClient'

export function createVisionClientFromProvider(provider: UiProvider): IVisionClient | null {
  switch (provider.visionMode) {
    case 'enabled':
      return createModelScopeVisionClient(provider, defaultImageUrlResolver)
    case 'none':
    default:
      return null
  }
}
```

---

## 六、AI Chat UI 改造：上传图片 + 默认提示词

> 目标：
> 1. 在 AI Chat 输入区点击 `ai-chat-tool-btn` 上传图片并转 base64（data URL）。
> 2. 点击发送时：
>    - 若无文字但有图片 → 自动使用提示词“根据上下文解析图片”。
>    - 若有文字 → 使用用户输入作为提示词。
> 3. 根据是否有图片，选择走文本聊天或 Vision 聊天。

### 1. AiChatBody：注入图片状态与上传逻辑

> 文件：`app/src/modules/ai/ui/AiChatBody.tsx`

#### 1.1 扩展 Props

```ts
export interface AiChatBodyProps {
  // ...原有 props
  attachedImageDataUrl?: string | null
  onAttachImage?: (dataUrl: string) => void
  onClearImage?: () => void
}
```

#### 1.2 增加隐藏文件输入 & 按钮事件

- 在组件内部添加：

```ts
const fileInputRef = useRef<HTMLInputElement | null>(null)

const handleToolClick = () => {
  fileInputRef.current?.click()
}

const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
  const file = e.target.files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) return

  const reader = new FileReader()
  reader.onload = () => {
    const result = reader.result
    if (typeof result === 'string') {
      onAttachImage?.(result)
    }
  }
  reader.readAsDataURL(file)
}
```

- 在 JSX 中，将 `ai-chat-tool-btn` 改造为：

```tsx
<input
  type="file"
  accept="image/*"
  style={{ display: 'none' }}
  ref={fileInputRef}
  onChange={handleFileChange}
/>

<button
  type="button"
  className="ai-chat-tool-btn"
  title="上传图片"
  onClick={handleToolClick}
>
  <span className="ai-chat-icon-plus" aria-hidden="true" />
</button>

{attachedImageDataUrl && (
  <span className="ai-chat-input-badge small">
    已附加图片
    <button type="button" onClick={() => onClearImage?.()}>清除</button>
  </span>
)}
```

#### 1.3 调整发送按钮禁用逻辑

- 原逻辑：`disabled={!loading && !input.trim()}`
- 调整为：

```tsx
disabled={!loading && !input.trim() && !attachedImageDataUrl}
```

### 2. AiChatDialog / AiChatPane：维护图片状态 + 构造 VisionTask

> 文件：
> - `app/src/modules/ai/ui/AiChatDialog.tsx`
> - `app/src/modules/ai/ui/AiChatPane.tsx`

#### 2.1 新增图片状态

在组件中增加：

```ts
const [attachedImageDataUrl, setAttachedImageDataUrl] = useState<string | null>(null)
```

并在传 `AiChatBody` 时注入：

```tsx
<AiChatBody
  // ...原有 props
  attachedImageDataUrl={attachedImageDataUrl}
  onAttachImage={(dataUrl) => setAttachedImageDataUrl(dataUrl)}
  onClearImage={() => setAttachedImageDataUrl(null)}
/>
```

#### 2.2 发送逻辑中区分文本 / Vision

在 `doSend` 中加入：

```ts
const DEFAULT_VISION_PROMPT = '根据上下文解析图片'

const doSend = async () => {
  const raw = input
  const trimmed = raw.trim()

  if (!trimmed && !contextPrefix && !attachedImageDataUrl) return

  const basePrompt =
    trimmed || (!trimmed && attachedImageDataUrl ? DEFAULT_VISION_PROMPT : '')

  let finalContent = basePrompt
  let hideUserInView = false

  if ((entryMode === 'file' || entryMode === 'selection') && contextPrefix && !contextPrefixUsed) {
    finalContent = basePrompt ? `${contextPrefix}\n\n${basePrompt}` : contextPrefix
    setContextPrefixUsed(true)
    setContextPrefix(null)
    hideUserInView = true
  }

  setInput('')
  autoResizeInput()

  // 无图片：保持原有文本聊天路径
  if (!attachedImageDataUrl) {
    await send(finalContent, hideUserInView ? { hideUserInView: true } : undefined)
    return
  }

  // 有图片：构造 VisionTask 并走 Vision 客户端
  const visionTask: VisionTask = {
    prompt: finalContent,
    images: [
      { kind: 'data_url', dataUrl: attachedImageDataUrl },
    ],
  }

  await sendVisionTask(visionTask, { hideUserInView })
  setAttachedImageDataUrl(null)
}
```

> 其中 `sendVisionTask` 是你在 `useAiChat` 或上层 service 中封装的一个函数，用于：
> - 根据当前 Provider 创建 `IVisionClient`（使用 `createVisionClientFromProvider`）。
> - 调用 `visionClient.ask(visionTask, handlers)`，并将流式结果写入现有 Chat 状态。

### 3. useAiChat 中对 Vision 的支持（设计说明）

> 文件：`app/src/modules/ai/ui/hooks/useAiChat.ts`（假定存在）

在现有文本聊天发送逻辑旁，增加一个处理 Vision 的方法，例如：

```ts
async function sendVisionTask(task: VisionTask, options?: { hideUserInView?: boolean }) {
  // 1. 从当前 settings 取出默认 Provider
  // 2. 使用 createVisionClientFromProvider 创建 IVisionClient
  // 3. 按现有模式，将用户请求写入 viewMessages（可选择是否隐藏用户消息）
  // 4. 调用 visionClient.ask(task, handlers)，在 onChunk/onComplete 中更新助手消息内容
}
```

> 这样，AI Chat 容器组件只需要调用 `sendVisionTask`，不需要关心具体 Provider 或底层协议。

---

## 七、ModelScope Provider 配置与使用

### 1. 在 AI Settings 中新增 ModelScope Provider

在 `AiSettingsDialog` 中手动添加一个 Provider：

- **Provider Name**：`ModelScope Qwen Vision`
- **Base URL**：`https://api-inference.modelscope.cn/v1`
- **API Key**：`MODELSCOPE_ACCESS_TOKEN`
- **Models**：`Qwen/QVQ-72B-Preview`
- **Type**：`OpenAI Compatible`
- **Vision Mode**：`enabled`

保存后，该 Provider 会作为可选模型出现在 AI Chat 的模型列表中。

### 2. 使用流程

1. 在 AI Settings 中将 `ModelScope Qwen Vision` 设为默认 Provider 或在 AI Chat 中切换到对应模型。
2. 在 AI Chat 窗口中：
   - 点击 `ai-chat-tool-btn` 上传图片 → 图片会被转换为 data URL 并附加到当前输入。
   - 如不输入任何文字，直接点击发送 → 自动使用提示词“根据上下文解析图片”。
   - 如输入文字，则以用户文字作为 Vision 提示词。
3. 后端通过 `ModelScopeVisionClient` 将 `VisionTask` 翻译为 ModelScope API 请求，并使用现有流式机制展示结果。

---

## 八、未来扩展其他 Vision Provider 的步骤

当需要接入新的视觉模型（例如其他云厂商的 Vision API）时，只需：

1. **在领域层**：
   - 一般不需要修改 `VisionTask`，除非新能力需要额外语义（可通过可选字段扩展）。

2. **在图片层**：
   - 若出现新的图片来源方式（如剪贴板 ID），在 `ImageSource` 中增加新的 `kind`，并在 `IImageUrlResolver` 实现中处理。

3. **在 Vision Provider 层**：
   - 新建一个 `YYYVisionClient`，实现 `IVisionClient`：
     - 按该 Provider 的要求翻译 `VisionTask`。
     - 如需先上传图片，再 analyze，则在 `ask` 内部完成上传 + 调用分析接口。
   - 在 `createVisionClientFromProvider` 中增加对应的 `visionMode` 分支。

4. **在 Provider 配置中**：
   - 为新 Provider 设置合适的 `visionMode`。

> 全流程中，AI Chat UI 与领域层保持稳定，扩展成本集中在新的适配器与配置上，符合高内聚、低耦合与可扩展性的设计目标。