import type { UiProvider } from '../settings'
import { loadAiSettingsState } from '../settings'
import type { IStreamingChatClient, ChatMessage, ProviderType } from '../domain/types'
import {
  type ChatEntryMode,
  type ConversationState,
  type EntryContext,
  type EngineMessage,
  createInitialConversationState,
  appendUserInput,
  appendAssistantPlaceholder,
  appendAssistantChunk,
  completeAssistantMessage,
  truncateAssistantMessage,
} from '../domain/chatSession'
import type { SystemPromptInfo } from './systemPromptService'
import { loadSystemPromptInfo, getSystemPromptByRoleId } from './systemPromptService'
import { createStreamingClientFromSettings } from '../streamingClientFactory'

export type StartChatOptions = {
  entryMode: ChatEntryMode
  initialContext?: EntryContext
  onStateChange?: (state: ConversationState) => void
}

export type ChatSession = {
  getState(): ConversationState
  getSystemPromptInfo(): SystemPromptInfo
  getProviderType(): ProviderType
  getActiveModelId(): string
  setActiveRole(roleId: string): Promise<void>
  setActiveModel(modelId: string): Promise<void>
  sendUserMessage(content: string, options?: { hideInView?: boolean }): Promise<void>
  stopRunningStream(): void
  stopAndTruncate(messageId: string, length: number): void
  dispose(): void
}

function pickDefaultProvider(state: Awaited<ReturnType<typeof loadAiSettingsState>>): UiProvider | null {
  if (!state.providers.length) return null
  const byDefaultId = state.providers.find((p) => p.id === state.defaultProviderId)
  return byDefaultId ?? state.providers[0] ?? null
}

function genId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function engineHistoryToChatMessages(history: EngineMessage[]): ChatMessage[] {
  return history
    .filter((m): m is EngineMessage & { role: 'user' | 'assistant' } => m.role === 'user' || m.role === 'assistant')
    .map((m): ChatMessage => ({ role: m.role, content: m.content }))
}

export async function createChatSession(options: StartChatOptions): Promise<ChatSession> {
  const [aiState, systemInfo] = await Promise.all([loadAiSettingsState(), loadSystemPromptInfo()])
  let provider = pickDefaultProvider(aiState)
  if (!provider) {
    throw new Error('AI Chat 未配置：请先在 AI Settings 中设置默认 Provider/Model')
  }

  let currentModelId = provider.defaultModelId ?? provider.models[0]?.id
  let providerType: ProviderType = provider.providerType ?? 'dify'
  let defaultMaxTokens = provider.models.find((m) => m.id === currentModelId)?.maxTokens ?? 2048

  let systemPromptInfo: SystemPromptInfo = systemInfo
  let state: ConversationState = createInitialConversationState(
    options.entryMode,
    systemPromptInfo.systemPrompt,
    options.initialContext,
    systemPromptInfo.activeRoleId,
  )

  let client: IStreamingChatClient | null = createStreamingClientFromSettings(
    provider,
    systemPromptInfo.systemPrompt,
    currentModelId,
  )
  let disposed = false
  let currentAbortController: AbortController | null = null

  const notifyStateChange = () => {
    if (disposed || !options.onStateChange) return
    options.onStateChange(state)
  }

  async function runStreamWithCurrentHistory(assistantId: string): Promise<void> {
    if (!client) return
    const messages = engineHistoryToChatMessages(state.engineHistory)
    if (!messages.length) return

    currentAbortController = new AbortController()

    try {
      await client.askStream(
        {
          messages,
          temperature: 0,
          maxTokens: defaultMaxTokens,
          signal: currentAbortController.signal,
        },
        {
          onChunk: (chunk) => {
            if (disposed || !chunk.content) return
            state = appendAssistantChunk(state, assistantId, chunk.content)
            notifyStateChange()
          },
          onComplete: () => {
            // 只在 finally 中进行统一的完成处理，避免重复记录
            if (disposed) return
            notifyStateChange()
          },
          onError: () => {
            if (disposed) return
            notifyStateChange()
          },
        },
      )
    } catch (e) {
      if (disposed) return
      const error = e as Error
      if (error.name !== 'AbortError') {
        console.error('[ChatSession] Stream exception:', e)
      }
    } finally {
      if (!disposed) {
        // 最终兜底：统一在这里将消息标记为完成并存入 history
        // 这样可以确保无论正常结束、打断还是出错，streaming 状态都能重置
        state = completeAssistantMessage(state, assistantId)
        notifyStateChange()
      }
      currentAbortController = null
    }
  }

  // 对于 file/selection 入口，若 engineHistory 中已经包含首轮 user 上下文，则立即发起首轮请求
  if (options.entryMode !== 'chat' && state.engineHistory.some((m) => m.role === 'user')) {
    const assistantId = genId()
    state = appendAssistantPlaceholder(state, assistantId)
    notifyStateChange()
    void runStreamWithCurrentHistory(assistantId)
  } else {
    // chat 模式或无上下文时，同样把初始 state 通知给外部（viewMessages 为空）
    notifyStateChange()
  }

  const session: ChatSession = {
    getState() {
      return state
    },
    getSystemPromptInfo() {
      return systemPromptInfo
    },
    getProviderType() {
      return providerType
    },
    getActiveModelId() {
      return currentModelId || ''
    },
    async setActiveRole(roleId: string): Promise<void> {
      if (disposed) return
      const { activeRoleId, systemPrompt } = getSystemPromptByRoleId(systemPromptInfo.roles, roleId)
      systemPromptInfo = {
        ...systemPromptInfo,
        activeRoleId,
        systemPrompt,
      }
      // 重新创建客户端以应用新的 system prompt
      if (provider) {
        client = createStreamingClientFromSettings(provider, systemPromptInfo.systemPrompt, currentModelId)
      }
      state = {
        ...state,
        activeRoleId,
      }
      notifyStateChange()
    },
    async setActiveModel(modelId: string): Promise<void> {
      if (disposed) return
      const nextSettings = await loadAiSettingsState()
      const nextProvider = nextSettings.providers.find((p) => p.models.some((m) => m.id === modelId))
      if (!nextProvider) {
        throw new Error(`找不到模型 ID 为 ${modelId} 的 Provider`)
      }

      provider = nextProvider
      currentModelId = modelId
      providerType = provider.providerType ?? 'dify'
      defaultMaxTokens = provider.models.find((m) => m.id === modelId)?.maxTokens ?? 2048

      // 重新创建客户端以应用新的模型配置
      client = createStreamingClientFromSettings(provider, systemPromptInfo.systemPrompt, modelId)

      notifyStateChange()
    },
    async sendUserMessage(content: string, options?: { hideInView?: boolean }): Promise<void> {
      if (disposed) return
      const userId = genId()
      const assistantId = genId()

      state = appendUserInput(state, userId, content, { hidden: options?.hideInView })
      state = appendAssistantPlaceholder(state, assistantId)
      notifyStateChange()

      await runStreamWithCurrentHistory(assistantId)
    },
    stopRunningStream() {
      if (currentAbortController) {
        currentAbortController.abort()
      }
    },
    stopAndTruncate(messageId: string, length: number) {
      if (currentAbortController) {
        currentAbortController.abort()
      }
      // 直接按 ID 截断，无论是否在 streaming 状态
      state = truncateAssistantMessage(state, messageId, length)
      notifyStateChange()
    },
    dispose() {
      disposed = true
      if (currentAbortController) {
        currentAbortController.abort()
      }
      client = null
    },
  }

  return session
}
