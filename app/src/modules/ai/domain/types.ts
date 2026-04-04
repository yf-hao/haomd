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
  /** 运行时标记：Dify 请求体中是否省略 model 输入。 */
  omitDifyModelInput?: boolean
}

export type AiSettingsState = {
  providers: UiProvider[]
  defaultProviderId?: string
}

export const emptySettings: AiSettingsState = {
  providers: [],
  defaultProviderId: undefined,
}

export type AgentPlatform = 'dify' | 'coze' | 'other'

export type AgentProvider = {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  platform: AgentPlatform
}

export type AgentSettingsState = {
  providers: AgentProvider[]
  defaultProviderId?: string
}

export const emptyAgentSettings: AgentSettingsState = {
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
    id: 'builtin_mcp_tool_calling',
    name: 'MCP 工具调用',
    description: '支持 MCP 工具调用的专用角色，启用后 AI 可使用已配置的 MCP 工具',
    prompt: "你是一名具备工具调用能力的智能助手。你可以通过调用外部工具来获取信息、执行操作，并基于工具返回的结果为用户提供准确的回答。\n\n工具调用规范：\n1. 当用户的请求需要借助外部工具时，你应主动选择合适的工具进行调用。\n2. 每次工具调用前，先简要说明你打算做什么以及为什么需要调用该工具。\n3. 收到工具返回结果后，对结果进行分析和整合，以结构化、易读的方式呈现给用户。\n4. 如果工具调用失败或返回错误，向用户说明情况并尝试替代方案。\n5. 不要捏造工具不存在的功能，只使用实际可用的工具及其参数。\n6. 当可以通过组合多个工具来完成复杂任务时，按逻辑顺序依次调用。\n\n回复规范：\n- 回复应当清晰、准确、结构化。\n- 涉及代码时使用对应语言的代码块标记。\n- 涉及数据时优先使用表格或列表呈现。",
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
  role: 'user' | 'assistant' | 'tool'
  content: string
  /** For role='assistant' with tool calls */
  tool_calls?: ToolCallRequest[]
  /** For role='tool': the tool call ID this result responds to */
  tool_call_id?: string
}

// 附件类型。Dify 侧当前使用 image / audio / document。
export type AttachmentKind = 'image' | 'audio' | 'document'

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
  /** OpenAI function calling: tool definitions */
  tools?: OpenAIToolDef[]
}

/** OpenAI function calling tool definition */
export type OpenAIToolDef = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: unknown
  }
}

/** A tool call requested by the model */
export type ToolCallRequest = {
  id: string
  function: {
    name: string
    arguments: string
  }
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
  /** Tool calls requested by the model (OpenAI FC) */
  toolCalls?: ToolCallRequest[]
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
