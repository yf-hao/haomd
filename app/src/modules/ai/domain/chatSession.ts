// Chat session domain model and pure helpers
// 只负责对话状态与入口模式的抽象，不包含任何 IO / Provider / UI 细节

export type ChatEntryMode = 'chat' | 'file' | 'selection'

export type EngineMessageRole = 'system' | 'user' | 'assistant'

export type EngineMessage = {
  role: EngineMessageRole
  content: string
}

export type ChatRole = 'user' | 'assistant'

export type ChatMessageView = {
  id: string
  role: ChatRole
  content: string
  /** 是否仍在流式输出中 */
  streaming?: boolean
}

export type EntryContext =
  | { type: 'file'; content: string; fileName?: string }
  | { type: 'selection'; content: string }

export type ConversationState = {
  engineHistory: EngineMessage[]
  viewMessages: ChatMessageView[]
  entryMode: ChatEntryMode
  activeRoleId?: string
}

/**
 * 根据入口模式与上下文构造首轮 EngineMessage 列表。
 * 仅用于 Engine 视角，不涉及 UI 展示。
 */
export function applyEntryContext(
  entryMode: ChatEntryMode,
  systemPrompt?: string,
  context?: EntryContext,
): EngineMessage[] {
  const messages: EngineMessage[] = []

  if (systemPrompt && systemPrompt.trim()) {
    messages.push({ role: 'system', content: systemPrompt.trim() })
  }

  if (!context) {
    // chat 模式由后续用户输入补充，这里只保留 system
    return messages
  }

  if (entryMode === 'file' && context.type === 'file') {
    const fileNamePart = context.fileName ? `（文件名：${context.fileName}）` : ''
    const content = `下面是一份文档${fileNamePart}的完整内容，请先理解其意图和结构，然后根据后续我的提问给出分析与建议：\n\n${context.content}`
    messages.push({ role: 'user', content })
    return messages
  }

  if (entryMode === 'selection' && context.type === 'selection') {
    const content = `下面是我在文档中选中的一段内容，请先理解其语义，然后根据后续我的提问给出回答：\n\n${context.content}`
    messages.push({ role: 'user', content })
    return messages
  }

  // 兜底：未知组合时仅返回 system 消息
  return messages
}

/**
 * 创建会话初始状态。
 * - chat 模式：仅包含 system（如果有），viewMessages 为空
 * - file/selection 模式：engineHistory 包含上下文，viewMessages 也初始为空
 */
export function createInitialConversationState(
  entryMode: ChatEntryMode,
  systemPrompt?: string,
  context?: EntryContext,
  activeRoleId?: string,
): ConversationState {
  const engineHistory = applyEntryContext(entryMode, systemPrompt, context)
  return {
    engineHistory,
    viewMessages: [],
    entryMode,
    activeRoleId,
  }
}

/**
 * 在会话状态中追加一条用户输入（Engine + View 双线更新）。
 */
export function appendUserInput(
  state: ConversationState,
  id: string,
  content: string,
): ConversationState {
  const trimmed = content.trim()
  if (!trimmed) return state

  return {
    ...state,
    engineHistory: [...state.engineHistory, { role: 'user', content: trimmed }],
    viewMessages: [
      ...state.viewMessages,
      {
        id,
        role: 'user',
        content: trimmed,
      },
    ],
  }
}

/**
 * 在 View 中追加一个空的 AI 消息气泡并标记为 streaming。
 * 返回更新后的 state 与该消息的 id（由调用方传入）。
 */
export function appendAssistantPlaceholder(
  state: ConversationState,
  id: string,
): ConversationState {
  return {
    ...state,
    viewMessages: [
      ...state.viewMessages,
      {
        id,
        role: 'assistant',
        content: '',
        streaming: true,
      },
    ],
  }
}

/**
 * 追加 AI 流式片段到指定消息。
 */
export function appendAssistantChunk(
  state: ConversationState,
  id: string,
  chunk: string,
): ConversationState {
  if (!chunk) return state
  return {
    ...state,
    viewMessages: state.viewMessages.map((m) =>
      m.id === id
        ? {
            ...m,
            content: m.content + chunk,
          }
        : m,
    ),
  }
}

/**
 * 标记 AI 消息完成，并在 Engine 侧追加一条 assistant 消息。
 */
export function completeAssistantMessage(
  state: ConversationState,
  id: string,
): ConversationState {
  const msg = state.viewMessages.find((m) => m.id === id && m.role === 'assistant')
  const content = msg?.content ?? ''

  return {
    ...state,
    engineHistory:
      content.trim()
        ? [...state.engineHistory, { role: 'assistant', content }]
        : state.engineHistory,
    viewMessages: state.viewMessages.map((m) =>
      m.id === id
        ? {
            ...m,
            streaming: false,
          }
        : m,
    ),
  }
}
