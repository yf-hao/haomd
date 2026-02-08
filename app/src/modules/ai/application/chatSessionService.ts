import type { UiProvider } from '../settings'
import { loadAiSettingsState } from '../settings'
import type { IStreamingChatClient, ChatMessage } from '../domain/types'
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
  setActiveRole(roleId: string): Promise<void>
  sendUserMessage(content: string): Promise<void>
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

function pickDefaultModel(provider: UiProvider) {
  const id = provider.defaultModelId ?? provider.models[0]?.id
  if (!id) return null
  return provider.models.find((m) => m.id === id) ?? null
}

function engineHistoryToChatMessages(history: EngineMessage[]): ChatMessage[] {
  return history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }))
}

export async function createChatSession(options: StartChatOptions): Promise<ChatSession> {
  const [aiState, systemInfo] = await Promise.all([loadAiSettingsState(), loadSystemPromptInfo()])
  const provider = pickDefaultProvider(aiState)

  if (!provider) {
    throw new Error('AI Chat 未配置：请先在 AI Settings 中设置默认 Provider/Model')
  }

  const defaultModel = pickDefaultModel(provider)
  const defaultMaxTokens = defaultModel?.maxTokens ?? 2048

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
  )
  let disposed = false

  const notifyStateChange = () => {
    if (disposed || !options.onStateChange) return
    options.onStateChange(state)
  }

  async function runStreamWithCurrentHistory(assistantId: string): Promise<void> {
    if (!client) return
    const messages = engineHistoryToChatMessages(state.engineHistory)
    if (!messages.length) return

    try {
      const result = await client.askStream(
        {
          messages,
          temperature: 0,
          maxTokens: defaultMaxTokens,
        },
        {
          onChunk: (chunk) => {
            if (disposed || !chunk.content) return
            state = appendAssistantChunk(state, assistantId, chunk.content)
            notifyStateChange()
          },
          onComplete: () => {
            if (disposed) return
            state = completeAssistantMessage(state, assistantId)
            notifyStateChange()
          },
          onError: () => {
            if (disposed) return
            // 出错时仍然标记为完成，但不追加 Engine 侧 assistant
            state = {
              ...state,
              viewMessages: state.viewMessages.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      streaming: false,
                    }
                  : m,
              ),
            }
            notifyStateChange()
          },
        },
      )

      if (result.error && !disposed) {
        // 若 askStream 返回整体错误，同样视为出错完成
        state = {
          ...state,
          viewMessages: state.viewMessages.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  streaming: false,
                }
              : m,
          ),
        }
        notifyStateChange()
      }
    } catch {
      if (disposed) return
      state = {
        ...state,
        viewMessages: state.viewMessages.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                streaming: false,
              }
            : m,
        ),
      }
      notifyStateChange()
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
    async setActiveRole(roleId: string): Promise<void> {
      if (disposed) return
      const { activeRoleId, systemPrompt } = getSystemPromptByRoleId(systemPromptInfo.roles, roleId)
      systemPromptInfo = {
        ...systemPromptInfo,
        activeRoleId,
        systemPrompt,
      }
      // 重新创建客户端以应用新的 system prompt
      client = createStreamingClientFromSettings(provider, systemPromptInfo.systemPrompt)
      state = {
        ...state,
        activeRoleId,
      }
      notifyStateChange()
    },
    async sendUserMessage(content: string): Promise<void> {
      if (disposed) return
      const userId = genId()
      const assistantId = genId()

      state = appendUserInput(state, userId, content)
      state = appendAssistantPlaceholder(state, assistantId)
      notifyStateChange()

      await runStreamWithCurrentHistory(assistantId)
    },
    dispose() {
      disposed = true
      client = null
    },
  }

  return session
}
