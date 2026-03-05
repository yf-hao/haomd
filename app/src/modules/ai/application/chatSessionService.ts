import type { UiProvider } from '../settings'
import { loadAiSettingsState } from '../settings'
import type {
  IStreamingChatClient,
  ChatMessage,
  ProviderType,
  VisionTask,
  AttachmentKind,
  ChatAttachment,
  UploadedFileRef,
} from '../domain/types'
import { createVisionClientFromProvider } from '../vision/visionClientFactory'
import { buildGlobalMemorySystemPrompt, type RequestContext } from '../globalMemory/context'
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
import { createAttachmentUploadService } from './attachmentUploadService'
import { docConversationService } from './docConversationService'

export type StartChatOptions = {
  entryMode: ChatEntryMode
  initialContext?: EntryContext
  /**
   * 可选：用于从持久化快照中恢复会话时，直接注入完整的 ConversationState。
   * 若提供，则不会再次根据 entryMode/initialContext 构造初始状态。
   */
  initialState?: ConversationState
  onStateChange?: (state: ConversationState) => void
  /**
   * 可选：当前会话关联的文档路径。提供后，chatSessionService 会在每轮对话结束时
   * 将会话状态同步到文档会话持久化层。
   */
  docPath?: string
  /**
   * 可选：仅用于 Dify Provider，从文档会话记录恢复已有 conversationId，
   * 以便在应用重启后续接同一 Dify 云端会话。
   */
  initialDifyConversationId?: string
  /**
   * 可选：按 ProviderId 隔离的 Dify 会话 ID 映射。
   */
  initialDifyProviderConversations?: Record<string, string>
}

export type ChatSession = {
  getState(): ConversationState
  getSystemPromptInfo(): SystemPromptInfo
  getProviderType(): ProviderType
  getActiveModelId(): string
  setActiveRole(roleId: string): Promise<void>
  setActiveModel(modelId: string): Promise<void>
  sendUserMessage(
    content: string,
    options?: { hideInView?: boolean; attachments?: UploadedFileRef[]; viewContent?: string },
  ): Promise<void>
  /** 上传附件并返回引用，供 UI 预览及后续发送 */
  uploadAttachment(file: File, kind?: AttachmentKind): Promise<UploadedFileRef>
  /** 带附件发送消息（目前用于 Dify 图片），供未来 UI 按需调用 */
  sendUserMessageWithAttachments?(
    content: string,
    attachments: LocalAttachment[],
    options?: { hideInView?: boolean; viewContent?: string },
  ): Promise<void>
  /** 发送 VisionTask（图 + 文），由底层决定是否使用 Vision Provider 或退回文本流 */
  sendVisionTask(task: VisionTask, options?: { hideInView?: boolean }): Promise<void>
  stopRunningStream(): void
  stopAndTruncate(messageId: string, length: number): void
  dispose(): void
}

export type LocalAttachment = {
  kind: AttachmentKind
  file: File | Blob
  fileName: string
}

function pickDefaultProvider(state: Awaited<ReturnType<typeof loadAiSettingsState>>): UiProvider {
  if (!state.providers.length) {
    throw new Error('AI Chat 未配置：请先在 AI Settings 中设置默认 Provider/Model')
  }
  const byDefaultId = state.providers.find((p) => p.id === state.defaultProviderId)
  return byDefaultId ?? state.providers[0]!
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
  const attachmentUploadService = createAttachmentUploadService()
  const docPath = options.docPath
  const entryMode = options.entryMode
  let provider = pickDefaultProvider(aiState)

  let currentModelId = provider.defaultModelId ?? provider.models[0]?.id
  let providerType: ProviderType = provider.providerType ?? 'dify'
  console.warn('[ChatSession] createChatSession', { providerName: provider.name, providerType, currentModelId })
  let defaultMaxTokens = provider.models.find((m) => m.id === currentModelId)?.maxTokens ?? 2048

  let systemPromptInfo: SystemPromptInfo = systemInfo
  const difyProviderConversations: Record<string, string> = options.initialDifyProviderConversations ?? {}
  // 查找当前 provider 下是否有已存的会话 ID
  let difyConversationId: string | undefined = difyProviderConversations[provider.id] ?? options.initialDifyConversationId
  let state: ConversationState =
    options.initialState ??
    createInitialConversationState(
      options.entryMode,
      systemPromptInfo.systemPrompt,
      options.initialContext,
      systemPromptInfo.activeRoleId,
    )

  const initialConversationIdForClient = providerType === 'dify' ? difyConversationId : undefined
  let client: IStreamingChatClient | null = createStreamingClientFromSettings(
    provider,
    systemPromptInfo.systemPrompt,
    currentModelId,
    initialConversationIdForClient,
  )
  let disposed = false
  let currentAbortController: AbortController | null = null

  async function uploadLocalAttachments(local: LocalAttachment[]): Promise<ChatAttachment[]> {
    if (!local.length) return []
    if (!provider) {
      throw new Error('AI Chat 未配置 Provider，无法上传附件')
    }

    const uploaded = await Promise.all(
      local.map((att) =>
        attachmentUploadService.uploadAttachment({
          provider,
          kind: att.kind,
          file: att.file,
          fileName: att.fileName,
          userId: 'ai-chat-user',
        }),
      ),
    )

    return uploaded.map((u) => ({
      kind: u.kind,
      source: { kind: 'uploaded', fileId: u.id },
    }))
  }

  const notifyStateChange = () => {
    if (disposed || !options.onStateChange) return
    options.onStateChange(state)
  }

  async function runStreamWithCurrentHistory(
    assistantId: string,
    attachments?: ChatAttachment[],
    clientOverride?: IStreamingChatClient | null,
  ): Promise<void> {
    const usedClient = clientOverride ?? client
    if (!usedClient) return
    const messages = engineHistoryToChatMessages(state.engineHistory)
    if (!messages.length) return

    currentAbortController = new AbortController()

    try {
      const result = await usedClient.askStream(
        {
          messages,
          temperature: 0,
          maxTokens: defaultMaxTokens,
          signal: currentAbortController.signal,
          attachments,
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
            // 将错误交由 askStream 的 Promise / 外层 catch 处理，不在回调中直接抛出
            notifyStateChange()
          },
        },
      )

      if (result.error) {
        state = appendAssistantChunk(
          state,
          assistantId,
          '当前模型连接失败，请检查 Base URL / 网关配置。',
        )
        notifyStateChange()
        return
      }

      if (providerType === 'dify' && result.conversationId) {
        const prev = difyConversationId
        difyConversationId = result.conversationId
        console.warn('[ChatSession] Dify conversationId updated after stream', {
          prevConversationId: prev || '(none)',
          newConversationId: difyConversationId,
        })
      }
    } catch (e) {
      if (disposed) return
      const error = e as Error

      if (error.name === 'AbortError') {
        return
      }

      // 其他异常同样视为“连接异常”，在助手气泡中给出统一提示
      state = appendAssistantChunk(
        state,
        assistantId,
        '当前模型连接失败，请检查 Base URL / 网关配置。',
      )
      notifyStateChange()
      return
    } finally {
      if (!disposed) {
        // 最终兜底：统一在这里将消息标记为完成并存入 history
        // 这样可以确保无论正常结束、打断还是出错，streaming 状态都能重置
        state = completeAssistantMessage(state, assistantId)
        notifyStateChange()

        if (docPath) {
          console.warn('[ChatSession] Persisting doc conversation', {
            docPath,
            providerType,
            modelName: currentModelId,
            difyConversationId: difyConversationId || '(none)',
          })
          void docConversationService
            .upsertFromState({
              docPath,
              state,
              providerType,
              modelName: currentModelId,
              providerId: provider.id,

              difyConversationId,
            })
            .catch((err) => {
              console.error('[ChatSession] failed to persist doc conversation', err)
            })
        }
      }
      currentAbortController = null
    }
  }

  async function runVisionStream(assistantId: string, task: VisionTask): Promise<void> {
    const visionClient = provider ? createVisionClientFromProvider(provider, currentModelId) : null
    if (!visionClient) {
      // 当前 Provider 未开启视觉模式：先给出明确提示，再退回到纯文本流（仅使用 prompt）
      state = appendAssistantChunk(
        state,
        assistantId,
        '当前模型未开启视觉模式，图片内容不会被解析，本次仅按文本问题进行回答。\n\n',
      )
      notifyStateChange()
      await runStreamWithCurrentHistory(assistantId)
      return
    }

    currentAbortController = new AbortController()

    try {
      await visionClient.ask(
        task,
        {
          onChunk: (chunk) => {
            if (disposed || !chunk.content) return
            state = appendAssistantChunk(state, assistantId, chunk.content)
            notifyStateChange()
          },
          onComplete: () => {
            if (disposed) return
            notifyStateChange()
          },
          onError: () => {
            if (disposed) return
            notifyStateChange()
          },
        },
        { signal: currentAbortController.signal },
      )
    } catch (e) {
      if (disposed) return
      console.error('[ChatSession] Vision stream exception:', e)
    } finally {
      if (!disposed) {
        state = completeAssistantMessage(state, assistantId)
        notifyStateChange()

        if (docPath) {
          void docConversationService
            .upsertFromState({
              docPath,
              state,
              providerType,
              modelName: currentModelId,
              providerId: provider.id,
              difyConversationId,
            })
            .catch((err) => {
              console.error('[ChatSession] failed to persist doc conversation (vision)', err)
            })
        }
      }
      currentAbortController = null
    }
  }

  // 不再在 file/selection 入口自动触发首轮请求，由 UI 控制发送时机
  // 这里统一将初始 state 通知给外部（viewMessages 可能为空）
  notifyStateChange()

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
        const initialConversationIdForClient = providerType === 'dify' ? difyConversationId : undefined
        client = createStreamingClientFromSettings(
          provider,
          systemPromptInfo.systemPrompt,
          currentModelId,
          initialConversationIdForClient,
        )
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

      const initialConversationIdForClient = providerType === 'dify' ? difyConversationId : undefined

      // 重新创建客户端以应用新的模型配置
      client = createStreamingClientFromSettings(
        provider,
        systemPromptInfo.systemPrompt,
        modelId,
        initialConversationIdForClient,
      )

      notifyStateChange()
    },
    async sendUserMessage(
      content: string,
      options?: { hideInView?: boolean; attachments?: UploadedFileRef[]; viewContent?: string },
    ): Promise<void> {
      if (disposed) return
      const userId = genId()
      const assistantId = genId()

      state = appendUserInput(state, userId, content, { hidden: options?.hideInView })
      state = appendAssistantPlaceholder(state, assistantId)
      notifyStateChange()

      const chatAttachments: ChatAttachment[] | undefined = options?.attachments?.map((u) => ({
        kind: u.kind,
        source: { kind: 'uploaded', fileId: u.id },
      }))

      let clientOverride: IStreamingChatClient | null = null
      if (provider) {
        const reqContext: RequestContext = {
          source: 'chat-pane',
          entryMode,
          userInput: content,
          docPath,
        }
        const systemPromptWithMemory = buildGlobalMemorySystemPrompt(
          systemPromptInfo.systemPrompt,
          reqContext,
        )
        const initialConversationIdForClient = providerType === 'dify' ? difyConversationId : undefined
        clientOverride = createStreamingClientFromSettings(
          provider,
          systemPromptWithMemory,
          currentModelId,
          initialConversationIdForClient,
        )
      }

      await runStreamWithCurrentHistory(assistantId, chatAttachments, clientOverride)
    },
    async uploadAttachment(file: File, kind: AttachmentKind = 'image'): Promise<UploadedFileRef> {
      if (disposed) throw new Error('Session disposed')
      if (!provider) throw new Error('AI Chat 未配置 Provider')

      return attachmentUploadService.uploadAttachment({
        provider,
        kind,
        file,
        fileName: file.name,
        userId: 'ai-chat-user',
      })
    },
    async sendUserMessageWithAttachments(
      content: string,
      attachments: LocalAttachment[],
      options?: { hideInView?: boolean; viewContent?: string },
    ): Promise<void> {
      if (disposed) return
      const userId = genId()
      const assistantId = genId()

      state = appendUserInput(state, userId, content, { hidden: options?.hideInView })
      state = appendAssistantPlaceholder(state, assistantId)
      notifyStateChange()

      const chatAttachments = await uploadLocalAttachments(attachments)

      let clientOverride: IStreamingChatClient | null = null
      if (provider) {
        const reqContext: RequestContext = {
          source: 'chat-pane',
          entryMode,
          userInput: content,
          docPath,
        }
        const systemPromptWithMemory = buildGlobalMemorySystemPrompt(
          systemPromptInfo.systemPrompt,
          reqContext,
        )
        const initialConversationIdForClient = providerType === 'dify' ? difyConversationId : undefined
        clientOverride = createStreamingClientFromSettings(
          provider,
          systemPromptWithMemory,
          currentModelId,
          initialConversationIdForClient,
        )
      }

      await runStreamWithCurrentHistory(assistantId, chatAttachments, clientOverride)
    },
    async sendVisionTask(task: VisionTask, options?: { hideInView?: boolean; viewContent?: string }): Promise<void> {
      if (disposed) return
      const userId = genId()
      const assistantId = genId()

      // 在 engineHistory/view 中仍然记录文本 prompt，以保持对话上下文
      state = appendUserInput(state, userId, task.prompt, { hidden: options?.hideInView, viewContent: options?.viewContent })
      state = appendAssistantPlaceholder(state, assistantId)
      notifyStateChange()

      await runVisionStream(assistantId, task)
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
