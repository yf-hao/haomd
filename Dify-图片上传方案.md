## Dify 图片上传 + ModelScope base64 集成方案（实现步骤）

> 目标：  
> - 如果当前 `ai-chat-input-badge` / `ai-chat-role-badge` 选择的是 **Dify 提供的模型**：  
>   - 点击上传图片时，最终将图片发给 Dify（先 `/files/upload` 再 `/chat-messages` 携带 `files`）；  
>   - 当用户点击「发送」时：  
>     - 若输入为空，则使用固定文案：**「根据我们对话的上下文解析图片」**  
>     - 若输入非空，则使用用户输入。  
> - 如果当前选择的是 **ModelScope**：继续使用原来的 **base64 Vision 方案**。

---

### 一、识别当前 Provider：Dify vs ModelScope

**目的**：AI Chat 能够根据当前选中的模型判断走哪套图片处理逻辑。

1. **复用 `ChatSession` 中的 Provider 类型**

   - 在 `modules/ai/application/chatSessionService.ts` 中，`ChatSession` 已包含：
     ```ts
     getProviderType(): ProviderType
     ```
   - UI 可以通过 `useAiChat` 调用 `session.getProviderType()` 得到：
     - `dify`：走 Dify 附件上传路径；
     - `modelscope`：走 ModelScope base64 Vision 路径。

2. **在 `useAiChat` 中暴露当前 Provider 类型**

   - 在 `useAiChat` 内部维护一个状态：
     ```ts
     const [currentProviderType, setCurrentProviderType] = useState<ProviderType>('dify')
     ```
   - 在初始化和每次 Provider 变更时，从 `session.getProviderType()` 同步到 `currentProviderType`。
   - 在 `useAiChat` 的返回值中新增：
     ```ts
     return {
       // ...
       currentProviderType,
     }
     ```
   - `AiChatDialog` / `AiChatBody` / 输入区组件通过 `currentProviderType` 决定点击上传时的分支逻辑。

---

### 二、AI Chat 中“待发送图片”状态设计

**目的**：上传按钮只负责“选择图片并在前端暂存”，真正的上传/调用在点击发送时完成。

1. **在 `useAiChat` 中增加 Pending 状态**

   - Dify 模式下的待发送图片：
     ```ts
     type PendingDifyImage = {
       file: File
       fileName: string
       previewUrl: string  // URL.createObjectURL(file)
     }
     const [pendingDifyImage, setPendingDifyImage] = useState<PendingDifyImage | null>(null)
     ```
   - ModelScope 模式下的待发送图片（base64）：
     ```ts
     type PendingModelScopeImage = {
       dataUrl: string     // FileReader.readAsDataURL 结果
       mimeType: string    // file.type
     }
     const [pendingModelScopeImage, setPendingModelScopeImage] =
       useState<PendingModelScopeImage | null>(null)
     ```
   - 约束：
     - 任意时刻最多保留一张待发送图片；
     - 发送成功或用户主动取消时，清空对应 pending 状态。

2. **上传按钮点击逻辑（统一入口，内部分流）**

   - 在输入区组件的「上传图片」按钮中，通过 file input 得到 `File` 对象：
     ```ts
     const handleSelectImage = (file: File) => {
       attachImage(file)
     }
     ```
   - 在 `useAiChat` 中提供：
     ```ts
     const attachImage = async (file: File) => {
       if (currentProviderType === 'dify') {
         // Dify：只存 File + 预览地址
         const previewUrl = URL.createObjectURL(file)
         setPendingDifyImage({ file, fileName: file.name, previewUrl })
         setPendingModelScopeImage(null)
       } else if (currentProviderType === 'modelscope') {
         // ModelScope：转成 base64 / dataURL
         const dataUrl = await readFileAsDataURL(file)
         setPendingModelScopeImage({ dataUrl, mimeType: file.type })
         setPendingDifyImage(null)
       } else {
         // 其他 Provider：可以提示“当前 Provider 不支持图片”，或忽略
       }
     }
     ```
   - `readFileAsDataURL` 为简单 util：用 `FileReader.readAsDataURL` 异步返回 string。

---

### 三、发送按钮逻辑（Dify 路径）

**目的**：当 Provider 为 Dify 且存在待发送图片时，走 `/files/upload` + `/chat-messages` 附件路径，并按规则生成文本。

1. **扩展 `useAiChat.send`，加上 Dify 分支**

   - 假设当前输入框内容为 `inputValue`，发送方法为 `send()`：
     ```ts
     const send = async () => {
       const text = inputValue.trim()

       if (currentProviderType === 'dify' && pendingDifyImage) {
         await sendDifyImageMessage(text)
         return
       }

       if (currentProviderType === 'modelscope' && pendingModelScopeImage) {
         await sendModelScopeImageMessage(text)
         return
       }

       // 普通文本消息（无图片）
       if (!text) return
       await session.sendUserMessage(text, { hideInView: false })
       clearInput()
     }
     ```

2. **实现 Dify 图片消息发送 `sendDifyImageMessage`**

   - 规则：
     - 若文本为空，用默认文案 `"根据我们对话的上下文解析图片"`；
     - 否则使用用户输入文本；
     - 图片走 `sendUserMessageWithAttachments`，由 `chatSessionService` 内部完成 `/files/upload` + `/chat-messages`。

   - 伪代码：
     ```ts
     const sendDifyImageMessage = async (rawText: string) => {
       if (!pendingDifyImage) return

       const finalText =
         rawText.trim() || '根据我们对话的上下文解析图片'

       const attachments: LocalAttachment[] = [
         {
           kind: 'image',
           file: pendingDifyImage.file,
           fileName: pendingDifyImage.fileName,
         },
       ]

       await session.sendUserMessageWithAttachments?.(finalText, attachments, {
         hideInView: false,
       })

       // 成功后清理状态
       setPendingDifyImage(null)
       clearInput()
       // 预览 URL 也可以同时 revoke
       URL.revokeObjectURL(pendingDifyImage.previewUrl)
     }
     ```

   - 效果：
     - `chatSessionService` 会调用 `attachmentUploadService`；
     - 后者调用 Dify `/v1/files/upload`；
     - 拿到 `upload_file_id` 后，构造 `attachments`，由 `SimpleChat` 映射到 `files` 字段，最终请求体类似：
       ```jsonc
       "files": [
         {
           "type": "image",
           "transfer_method": "local_file",
           "upload_file_id": "72fa9618-8f89-4a37-9b33-7e1178a24a67"
         }
       ]
       ```

---

### 四、发送按钮逻辑（ModelScope base64 路径）

**目的**：当 Provider 为 ModelScope 且存在待发送图片时，继续使用原有的 base64 Vision 方案，不走 Dify 的 `files` 机制。

1. **实现 ModelScope 图片消息发送 `sendModelScopeImageMessage`**

   - 若你也希望在 ModelScope 下沿用同样的默认文案，可以使用同一套规则：
     ```ts
     const sendModelScopeImageMessage = async (rawText: string) => {
       if (!pendingModelScopeImage) return

       const finalText =
         rawText.trim() || '根据我们对话的上下文解析图片'

       const task: VisionTask = {
         kind: 'image',
         imageBase64: pendingModelScopeImage.dataUrl, // 按你之前实现需要的格式截取
         prompt: finalText,
         mimeType: pendingModelScopeImage.mimeType,
       }

       await session.sendVisionTask(task, { hideInView: false })

       // 成功后清理状态
       setPendingModelScopeImage(null)
       clearInput()
     }
     ```

2. **无图片时的 ModelScope 文本逻辑**

   - 如果当前 Provider 是 ModelScope，但 `pendingModelScopeImage` 为空：
     - 保持现有的纯文本发送逻辑：
       ```ts
       if (!text) return
       await session.sendUserMessage(text, { hideInView: false })
       clearInput()
       ```

---

### 五、输入区 UI 展示与交互

**目的**：让用户清晰感知当前有“待发送图片”，且能随时取消。

1. **统一显示“待发送图片”预览**

   - 在 AI Chat 输入区上方或下方，增加一个轻量区域：
     - 若 `pendingDifyImage` 存在：
       - 显示一张缩略图（`previewUrl`）+ 文件名；
       - 提示 “图片将在下一条消息中发给 Dify”。
     - 若 `pendingModelScopeImage` 存在：
       - 显示一张由 `dataUrl` 渲染的缩略图；
       - 提示 “图片将在下一条消息中用于模型视觉分析”。

2. **提供取消入口**

   - 在预览旁加一个 “X” 图标：
     - Dify 模式：点击后 `setPendingDifyImage(null)`，并 `URL.revokeObjectURL`；
     - ModelScope 模式：点击后 `setPendingModelScopeImage(null)`。

3. **处理 Provider 切换**

   - 当用户在有 pending 图片时切换 Provider（例如从 Dify 切到 ModelScope）：
     - 简化处理：直接清空两种 pending 状态，并提示一次 “已清除待发送图片（切换 Provider）”；
     - 避免 Dify 的状态错误地在 ModelScope 模式下被使用，反之亦然。

---

### 六、错误处理与测试建议

1. **错误处理**

   - Dify 路径（`sendUserMessageWithAttachments`）：
     - 若 `/files/upload` 或 `/chat-messages` 失败：
       - UI 显示错误消息；
       - 不自动清除 `pendingDifyImage`，让用户可以重试发送。
   - ModelScope 路径（`sendVisionTask`）：
     - 复用现有错误逻辑；
     - 同样保留 `pendingModelScopeImage` 以便重试。

2. **测试场景**

   - **Dify 模式**：
     - 选择 Dify Provider + 模型；
     - 点击上传图片，看见预览；
     - 输入框留空 → 点击发送：
       - 观察网络：先 `/v1/files/upload` 再 `/v1/chat-messages`；
       - `chat-messages` 请求体中的 `query` 为 `"根据我们对话的上下文解析图片"`，并带有符合规范的 `files` 数组。
     - 输入框填写 “这张图里是什么？” → 点击发送：
       - `query` 为用户的自定义文本。
   - **ModelScope 模式**：
     - 选择 ModelScope Provider + 模型；
     - 上传图片，看到 base64 预览；
     - 发送时应触发 `sendVisionTask`，并且服务端收到的请求体与之前的 Vision 实现一致。

---

按上述步骤实现后，就能满足需求：
- **Dify**：点击上传图片 → 在发送时自动先上传，再附带到 `/chat-messages` 的 `files` 字段里，文本为空时自动使用“根据我们对话的上下文解析图片”。  
- **ModelScope**：继续沿用 base64 Vision 方案，只在发送时走 `sendVisionTask`，两套逻辑通过 `currentProviderType` 完全解耦。
