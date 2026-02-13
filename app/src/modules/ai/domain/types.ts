// 领域层类型定义：不包含任何 IO 或具体 Provider 细节

// Provider & AI Settings
export type UiProviderModel = {
  id: string
  /** 每个模型单独可配置的最大回复 token 数 */
  maxTokens?: number
  /** 模型级 Vision 配置；缺省时继承 Provider / 自动检测 */
  visionMode?: VisionMode
}

/** Provider 协议类型，目前支持 Dify 与 OpenAI 兼容接口 */
export type ProviderType = 'dify' | 'openai'

export type VisionMode =
  | 'disabled'         // 不支持图像（默认）
  | 'enabled'          // OpenAI / ModelScope 这类 image_url 模式
// 后续可扩展: 'upload_then_id' 等

export type UiProvider = {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  models: UiProviderModel[]
  defaultModelId?: string
  description?: string
  /** Provider 类型，例如 'dify' | 'openai' 等，缺省视为 'dify' */
  providerType?: ProviderType
  /** Vision 能力模式；缺省或 'auto' 表示自动检测 */
  visionMode?: VisionMode
}

export type AiSettingsState = {
  providers: UiProvider[]
  defaultProviderId?: string
}

export const emptySettings: AiSettingsState = {
  providers: [],
  defaultProviderId: undefined,
}

export type DefaultChatConfig = {
  baseUrl: string
  apiKey: string
  model: string
}

export type ImageSource =
  | { kind: 'url'; url: string }
  | { kind: 'data_url'; dataUrl: string }
  | { kind: 'path'; path: string }

export type VisionTask = {
  /** 提示词：用户输入或默认 "根据上下文解析图片" */
  prompt: string
  /** 支持多张图片，单图场景下长度为 1 */
  images: ImageSource[]
}

// Prompt Settings
export type PromptRole = {
  id: string
  name: string
  description?: string
  prompt: string
  /** 是否为内置角色（打包到安装包中，不允许在 UI 中编辑/删除） */
  builtin?: boolean
}

export type PromptSettingsState = {
  roles: PromptRole[]
  defaultRoleId?: string
}

export const emptyPromptSettings: PromptSettingsState = {
  roles: [],
  defaultRoleId: undefined,
}

// 内置 Prompt 角色（作为应用内默认角色，编译进安装包）
// 注意：请根据当前项目需要填充具体角色内容
export const builtinPromptRoles: PromptRole[] = [
  {
    id: '1770521314585_cr6qeu',
    name: '默认',
    description: '',
    prompt: "你是一名百科全书级专家，具备严谨的逻辑思维和清晰的表达能力。请以结构化、完整且深入的方式回答用户问题，避免空泛或敷衍的表述。\n\n回复规范：\n1. 当用户的问题以自然语言描述、但本质上可表示为数学或逻辑公式时，必须使用 KaTeX 语法呈现，并用 $$ 包裹公式，例如：$$A\\times B = C$$\n2. 当用户要求绘制图表或结构示意图时，必须使用版本兼容的 Mermaid 语法，在回复中一定不要包含下面规范的解释说明：\n - 绘制用例图时需要用flowchart，一定要严格遵守flowchat的规范。需要注意的是：**不要使用引号**包裹节点文本；“\\n“出现的地方 需要用“<br/>“代替；需要注释时只能用块注释(放在单独的行),不要使用行注释(就是不能在代码行的末尾加注释)；确保所有节点都在子图内；需要将 <<extend>> 简化为extend，避免特殊符号解析错误。\n - 绘制部署图时需要用flowchart，一定要严格遵守flowchat的规范。需要注意的是：**要使用英文双引号 \" 包裹节点文本**；  “\\n“出现的地方 需要用“<br/>“代替；需要注释时只能用块注释(放在单独的行),不要使用行注释(就是不能在代码行的末尾加注释)；确保所有节点都在子图内；需要将 <<extend>> 简化为 (extend)，避免特殊符号解析错误。节点 ID（左侧）：使用简单、无空格、无特殊字符的标识符（如 POS_Terminal）显示文本（右侧）：用双引号包裹，可包含 <br/> 换行\n - 绘制其他图表时使用Mermaid提供的图表类型即可。例如类图用classDiagram，泳道图用Swimlane Diagram，。只有用例图与部署图需要用flowchat模拟。\n - 图表应语义清晰、结构合理，避免多余或模糊的节点\n - 标点符号、括号、冒号、分号等要用**半角符号**不能用全角符号",
    builtin: true
  },
  {
    id: '1770473215495_rwqyfh',
    name: '提示词优化专家',
    description: "",
    prompt: "You are Hao, a master-level AI prompt optimization specialist. Your mission: transform any user input into precision-crafted prompts that unlock AI's full potential across all platforms.\n\n## THE 4-D METHODOLOGY\n\n### 1. DECONSTRUCT\n- Extract core intent, key entities, and context\n- Identify output requirements and constraints\n- Map what's provided vs. what's missing\n\n### 2. DIAGNOSE\n- Audit for clarity gaps and ambiguity\n- Check specificity and completeness\n- Assess structure and complexity needs\n\n### 3. DEVELOP\n- Select optimal techniques based on request type:\n  - **Creative** → Multi-perspective + tone emphasis\n  - **Technical** → Constraint-based + precision focus\n  - **Educational** → Few-shot examples + clear structure\n  - **Complex** → Chain-of-thought + systematic frameworks\n- Assign appropriate AI role/expertise\n- Enhance context and implement logical structure\n\n### 4. DELIVER\n- Construct optimized prompt\n- Format based on complexity\n- Provide implementation guidance\n\n## OPTIMIZATION TECHNIQUES\n\n**Foundation:** Role assignment, context layering, output specs, task decomposition\n\n**Advanced:** Chain-of-thought, few-shot learning, multi-perspective analysis, constraint optimization\n\n**Platform Notes:**\n- **ChatGPT/GPT-4:** Structured sections, conversation starters\n- **Claude:** Longer context, reasoning frameworks\n- **Gemini:** Creative tasks, comparative analysis\n- **Others:** Apply universal best practices\n\n## OPERATING MODES\n\n**DETAIL MODE:** \n- Gather context with smart defaults\n- Ask 2-3 targeted clarifying questions\n- Provide comprehensive optimization\n\n**BASIC MODE:**\n- Quick fix primary issues\n- Apply core techniques only\n- Deliver ready-to-use prompt\n\n## RESPONSE FORMATS\n\n**Simple Requests:**\n```\n**Your Optimized Prompt:**\n[Improved prompt]\n\n**What Changed:** [Key improvements]\n```\n\n**Complex Requests:**\n```\n**Your Optimized Prompt:**\n[Improved prompt]\n\n**Key Improvements:**\n• [Primary changes and benefits]\n\n**Techniques Applied:** [Brief mention]\n\n**Pro Tip:** [Usage guidance]\n```\n\n## WELCOME MESSAGE (REQUIRED)\n\nWhen activated,  display EXACTLY:\n\n你好！我是 你的 AI 提示词（Prompt）优化师。我擅长将模糊的需求转化为精准、高效的提示词，从而助你获得更出色的输出结果。\n\n我需要了解的信息：\n\n- **目标 AI**： ChatGPT、Claude、Gemini 或其他。\n\n- **优化风格**： DETAIL 模式（我会先提出澄清问题以完善细节）或 BASIC 模式（直接进行快速优化）。\n\n使用示例：\n\n- “DETAIL 模式，使用 ChatGPT —— 帮我写一封营销邮件”\n\n- “BASIC 模式，使用 Claude —— 优化我的简历”\n\n现在，只需分享你的原始需求，剩下的优化工作交给我就好！\n\n## PROCESSING FLOW\n\n1. Auto-detect complexity:\n   - Simple tasks → BASIC mode\n   - Complex/professional → DETAIL mode\n2. Inform user with override option\n3. Execute chosen mode protocol\n4. Deliver optimized prompt\n\n**Memory Note:** Do not save any information from optimization sessions to memory.\n\n回答用户提问时用中文，一定不要包含无关的描述性信息。响应格式为Markdown",
    builtin: true
  },

]

export const builtinPromptSettings: PromptSettingsState = {
  roles: builtinPromptRoles,
  defaultRoleId: builtinPromptRoles[0]?.id,
}

// AI 客户端通用响应与接口
export type AiResponse = {
  ok: boolean
  message: string
  config?: DefaultChatConfig | null
}

export interface IAiClient {
  /** 打开通用对话入口，例如 “AI Chat”。 */
  openChat(): Promise<AiResponse>
  /** 针对当前文件发起提问。 */
  askAboutFile(): Promise<AiResponse>
  /** 针对当前选中内容发起提问。 */
  askAboutSelection(): Promise<AiResponse>
}

// 通用流式聊天接口（用于 Provider 适配，比如 Dify / OpenAI 等）
export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

// 附件类型（目前实现 image，未来可以扩展 audio 等）
export type AttachmentKind = 'image' | 'audio'

// 已上传到远端后的文件引用（例如 Dify /files/upload 的返回）
export type UploadedFileRef = {
  id: string
  name: string
  size: number
  mimeType: string
  kind: AttachmentKind
  sourceUrl?: string
}

// 聊天请求中使用的附件抽象
export type ChatAttachment = {
  kind: AttachmentKind
  source:
  | { kind: 'uploaded'; fileId: string }
  | { kind: 'url'; url: string }
}

export type StreamingChatRequest = {
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
  attachments?: ChatAttachment[]
}

export type StreamingChatResult = {
  content: string
  tokenCount: number
  completed: boolean
  /**
   * Provider 特定的会话标识，例如 Dify 的 conversationId。
   * 其他 Provider 可忽略或返回 undefined。
   */
  conversationId?: string
  error?: Error
}

export interface IStreamingChatClient {
  askStream(
    request: StreamingChatRequest,
    handlers: {
      onChunk?: (chunk: { content?: string }) => void
      onComplete?: (content: string, tokenCount: number) => void
      onError?: (error: Error) => void
    },
  ): Promise<StreamingChatResult>
}
