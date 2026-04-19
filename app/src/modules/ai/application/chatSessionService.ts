import type { UiProvider } from '../settings'
import { loadAiSettingsState } from '../settings'
import { loadAgentSettingsState } from '../config/agentSettingsRepo'
import type {
  IStreamingChatClient,
  ChatMessage,
  ProviderType,
  VisionTask,
  AttachmentKind,
  ChatAttachment,
  UploadedFileRef,
  AgentProvider,
  OpenAIToolDef,
  ToolCallRequest,
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
  upsertAssistantToolExecution,
  completeAssistantMessage,
  truncateAssistantMessage,
} from '../domain/chatSession'
import type { SystemPromptInfo } from './systemPromptService'
import { loadSystemPromptInfo, getSystemPromptByRoleId } from './systemPromptService'
import { createStreamingClientFromSettings } from '../streamingClientFactory'
import { createAttachmentUploadService } from './attachmentUploadService'
import { docConversationService } from './docConversationService'
import { inferAttachmentKind } from './attachmentKind'
import { resolveDifyConversationId } from './difyConversationResolvers'
import { getEnabledTools, toOpenAITools, executeTool, buildToolCatalog, filterToolsByRelevance, type AggregatedTool } from './mcpToolService'
import {
  WRITE_TO_NOTES_TOOL_NAME,
  writeToNotesToolSchema,
  executeWriteToNotes,
} from '../../notes/notesBuiltinTool'
import {
  RESOLVE_WORKSPACE_DIRECTORY_TOOL_NAME,
  resolveWorkspaceDirectoryToolSchema,
  executeResolveWorkspaceDirectory,
  CREATE_WORKSPACE_DIRECTORY_TOOL_NAME,
  createWorkspaceDirectoryToolSchema,
  executeCreateWorkspaceDirectory,
  WRITE_TO_WORKSPACE_TOOL_NAME,
  buildWorkspaceMountedRootsPrompt,
  writeToWorkspaceToolSchema,
  executeWriteToWorkspace,
} from '../../workspace/workspaceBuiltinTool'
import {
  SKILLS_SEARCH_TOOL_NAME,
  SKILLS_READ_TOOL_NAME,
  SKILLS_RUN_TOOL_NAME,
  buildDynamicSkillScriptTools,
  skillsSearchToolSchema,
  skillsReadToolSchema,
  executeSkillsSearch,
  executeSkillsRead,
  executeSkillsRun,
} from '../../skills/skillsBuiltinTool'
import { buildSkillsToolCatalogPrompt } from './skillsToolCatalog'
import {
  WORKFLOW_SEARCH_TOOL_NAME,
  WORKFLOW_READ_TOOL_NAME,
  WORKFLOW_RUN_TOOL_NAME,
  workflowSearchToolSchema,
  workflowReadToolSchema,
  workflowRunToolSchema,
  executeWorkflowSearch,
  executeWorkflowRead,
  executeWorkflowRun,
} from '../../workflows/workflowBuiltinTool'
import { buildWorkflowToolCatalogPrompt } from './workflowToolCatalog'

export type StartChatOptions = {
  entryMode: ChatEntryMode
  initialContext?: EntryContext
  selectedAgentId?: string | null
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
  getProviderContext(): ChatSessionProviderContext | null
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

export type ChatSessionProviderContext = {
  providerId: string
  providerType: ProviderType
  baseUrl: string
  apiKey: string
  modelId: string
}

export type LocalAttachment = {
  kind: AttachmentKind
  file: File | Blob
  fileName: string
}

type StreamRunOptions = {
  attachments?: ChatAttachment[]
  clientOverride?: IStreamingChatClient | null
  messageOverride?: ChatMessage[]
  persistConversation?: boolean
  useConversationId?: boolean
  /** OpenAI function calling tools */
  tools?: OpenAIToolDef[]
}

type StreamRunResult = {
  toolCalls?: ToolCallRequest[]
  error?: boolean
}

function pickDefaultProvider(state: Awaited<ReturnType<typeof loadAiSettingsState>>): UiProvider {
  if (!state.providers.length) {
    throw new Error('AI Chat 未配置：请先在 AI Settings 中设置默认 Provider/Model')
  }
  const byDefaultId = state.providers.find((p) => p.id === state.defaultProviderId)
  return byDefaultId ?? state.providers[0]!
}

function agentToUiProvider(agent: AgentProvider): UiProvider {
  if (agent.kind !== 'chat') {
    throw new Error(`当前 ${agent.kind} Agent 不支持接入 AI Chat`)
  }
  if (agent.platform !== 'dify') {
    throw new Error(`当前暂不支持 ${agent.platform} Agent 接入 AI Chat`)
  }

  return {
    id: `agent:${agent.id}`,
    name: agent.name,
    baseUrl: agent.baseUrl,
    apiKey: agent.apiKey,
    providerType: 'dify',
    models: [{ id: `agent:${agent.id}:default` }],
    defaultModelId: `agent:${agent.id}:default`,
    omitDifyModelInput: true,
  }
}

function genId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function engineHistoryToChatMessages(history: EngineMessage[]): ChatMessage[] {
  return history
    .filter((m): m is EngineMessage & { role: 'user' | 'assistant' } => m.role === 'user' || m.role === 'assistant')
    .map((m): ChatMessage => ({ role: m.role, content: m.content }))
}

function isMcpToolCallingRoleActive(
  roles: SystemPromptInfo['roles'],
  activeRoleId?: string,
): boolean {
  const activeRole = roles.find((role) => role.id === activeRoleId)
  if (!activeRole) return false
  return !!activeRole.enableMcpTools
}

export async function createChatSession(options: StartChatOptions): Promise<ChatSession> {
  const [aiState, agentState, systemInfo] = await Promise.all([
    loadAiSettingsState(),
    loadAgentSettingsState(),
    loadSystemPromptInfo(),
  ])
  const attachmentUploadService = createAttachmentUploadService()
  const docPath = options.docPath
  const entryMode = options.entryMode
  const selectedAgent = options.selectedAgentId
    ? agentState.providers.find((item) => item.id === options.selectedAgentId) ?? null
    : null
  const shouldPersistDocConversation = !selectedAgent
  let provider = selectedAgent ? agentToUiProvider(selectedAgent) : pickDefaultProvider(aiState)

  let currentModelId = provider.defaultModelId ?? provider.models[0]?.id
  let providerType: ProviderType = provider.providerType ?? 'dify'
  console.warn('[ChatSession] createChatSession', { providerName: provider.name, providerType, currentModelId })
  let defaultMaxTokens = provider.models.find((m) => m.id === currentModelId)?.maxTokens

  let systemPromptInfo: SystemPromptInfo = systemInfo
  const difyProviderConversations: Record<string, string> = options.initialDifyProviderConversations ?? {}
  let difyConversationId: string | undefined = resolveDifyConversationId({
    provider,
    initialDifyConversationId: options.initialDifyConversationId,
    difyProviderConversations,
  })
  let state: ConversationState =
    options.initialState ??
    createInitialConversationState(
      options.entryMode,
      systemPromptInfo.systemPrompt,
      options.initialContext,
      systemPromptInfo.activeRoleId,
    )
  if (!state.activeRoleId && systemPromptInfo.activeRoleId) {
    state = {
      ...state,
      activeRoleId: systemPromptInfo.activeRoleId,
    }
  }
  if (state.activeRoleId) {
    const { activeRoleId, systemPrompt } = getSystemPromptByRoleId(systemPromptInfo.roles, state.activeRoleId)
    systemPromptInfo = {
      ...systemPromptInfo,
      activeRoleId,
      systemPrompt,
    }
  }
  if (
    systemPromptInfo.systemPrompt?.trim()
    && !state.engineHistory.some((message) => message.role === 'system')
  ) {
    state = {
      ...state,
      engineHistory: [
        { role: 'system', content: systemPromptInfo.systemPrompt.trim() },
        ...state.engineHistory,
      ],
    }
  }

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

  const persistDocConversationSnapshot = () => {
    if (disposed || !docPath || !shouldPersistDocConversation || !provider) return
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

  async function runStream(
    assistantId: string,
    options: StreamRunOptions = {},
  ): Promise<StreamRunResult> {
    const usedClient = options.clientOverride ?? client
    if (!usedClient) return {}
    const messages =
      options.messageOverride ?? engineHistoryToChatMessages(state.engineHistory)
    if (!messages.length) return {}

    currentAbortController = new AbortController()

    try {
      const result = await usedClient.askStream(
        {
          messages,
          temperature: 0,
          maxTokens: defaultMaxTokens,
          signal: currentAbortController.signal,
          attachments: options.attachments,
          tools: options.tools,
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
        return { error: true }
      }

      if ((options.useConversationId ?? true) && providerType === 'dify' && result.conversationId) {
        const prev = difyConversationId
        difyConversationId = result.conversationId
        // 【关键修复】：不仅更新当前变量，还要同步更新映射表，确保切换回来时能找回
        difyProviderConversations[provider.id] = result.conversationId

        console.warn('[ChatSession] Dify conversationId updated after stream', {
          prevConversationId: prev || '(none)',
          newConversationId: difyConversationId,
        })
      }

      return { toolCalls: result.toolCalls }
    } catch (e) {
      if (disposed) return {}
      const error = e as Error

      if (error.name === 'AbortError') {
        return {}
      }

      // 其他异常同样视为“连接异常”，在助手气泡中给出统一提示
      state = appendAssistantChunk(
        state,
        assistantId,
        '当前模型连接失败，请检查 Base URL / 网关配置。',
      )
      notifyStateChange()
      return { error: true }
    } finally {
      if (!disposed) {
        // 最终兜底：统一在这里将消息标记为完成并存入 history
        // 这样可以确保无论正常结束、打断还是出错，streaming 状态都能重置
        state = completeAssistantMessage(state, assistantId)
        notifyStateChange()

        if ((options.persistConversation ?? true) && docPath && shouldPersistDocConversation) {
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

  const MAX_TOOL_ROUNDS = 10

  /**
   * Multi-round tool calling loop for OpenAI providers with MCP role active.
   * 1. Call model with tools
   * 2. If model returns tool_calls, execute them, add results as tool messages
   * 3. Re-call model with updated messages (up to MAX_TOOL_ROUNDS)
   * 4. When model responds with content only (no tool_calls), done
   */
  async function runStreamWithToolLoop(
    assistantId: string,
    clientOverride: IStreamingChatClient | null,
    schemaTools: AggregatedTool[],
    attachments?: ChatAttachment[],
    allTools?: AggregatedTool[],
    builtinToolSchemas: OpenAIToolDef[] = [],
  ): Promise<void> {
    // schemaTools: only tools whose full schemas are sent to the model
    // allTools: full list for execution routing (includes tools not in schemas)
    const routingTools = allTools ?? schemaTools
    const readSkillIds = new Set<string>()
    const readWorkflowIds = new Set<string>()
    const conversationMessages = engineHistoryToChatMessages(state.engineHistory)

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const dynamicSkillTools = await buildDynamicSkillScriptTools(readSkillIds)
        const dynamicSkillToolMap = new Map(
          dynamicSkillTools.map((item) => [
            item.toolName,
            { skillId: item.skillId, scriptId: item.scriptId },
          ]),
        )
        const openaiTools = [
          ...toOpenAITools(schemaTools),
          ...builtinToolSchemas,
          ...dynamicSkillTools.map((item) => item.tool),
        ]

        const result = await runStream(assistantId, {
          clientOverride,
          messageOverride: conversationMessages,
          attachments: round === 0 ? attachments : undefined,
          tools: openaiTools,
          persistConversation: false,
        })

        if (result.error || !result.toolCalls?.length) {
          // No tool calls — final answer or error, done
          break
        }

        // Model wants to call tools: complete current message, then execute tools
        state = completeAssistantMessage(state, assistantId)
        notifyStateChange()

        // Add assistant message with tool_calls to conversation
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: '',
          tool_calls: result.toolCalls,
        }
        conversationMessages.push(assistantMsg)

        // Show tool execution status in the chat
        for (const tc of result.toolCalls) {
          const toolLabel = tc.function.name.replace(/^mcp__/, '').replace(/__/g, '/')
          state = upsertAssistantToolExecution(state, assistantId, {
            id: tc.id,
            label: toolLabel,
            status: 'running',
          })
          notifyStateChange()

          try {
            let parsedArgs = {}
            try {
              parsedArgs = JSON.parse(tc.function.arguments)
            } catch { /* empty args */ }

            // Built-in tools are handled locally; MCP tools are routed to servers
            let toolResult: unknown
            if (tc.function.name === WRITE_TO_NOTES_TOOL_NAME) {
              toolResult = await executeWriteToNotes(parsedArgs as { content?: string })
            } else if (tc.function.name === WORKFLOW_SEARCH_TOOL_NAME) {
              toolResult = await executeWorkflowSearch(parsedArgs as { query?: string })
            } else if (tc.function.name === WORKFLOW_READ_TOOL_NAME) {
              toolResult = await executeWorkflowRead(
                parsedArgs as { workflowId?: string },
                readWorkflowIds,
              )
            } else if (tc.function.name === WORKFLOW_RUN_TOOL_NAME) {
              toolResult = await executeWorkflowRun(
                parsedArgs as { workflowId?: string; input?: unknown },
                readWorkflowIds,
              )
            } else if (tc.function.name === SKILLS_SEARCH_TOOL_NAME) {
              toolResult = await executeSkillsSearch(parsedArgs as { query?: string })
            } else if (tc.function.name === SKILLS_READ_TOOL_NAME) {
              toolResult = await executeSkillsRead(
                parsedArgs as { skillId?: string },
                readSkillIds,
              )
            } else if (tc.function.name === SKILLS_RUN_TOOL_NAME) {
              toolResult = await executeSkillsRun(
                parsedArgs as { skillId?: string; scriptId?: string; args?: unknown },
                readSkillIds,
              )
            } else if (dynamicSkillToolMap.has(tc.function.name)) {
              const dynamicTool = dynamicSkillToolMap.get(tc.function.name)!
              toolResult = await executeSkillsRun(
                {
                  skillId: dynamicTool.skillId,
                  scriptId: dynamicTool.scriptId,
                  args: parsedArgs,
                },
                readSkillIds,
              )
            } else if (tc.function.name === RESOLVE_WORKSPACE_DIRECTORY_TOOL_NAME) {
              toolResult = await executeResolveWorkspaceDirectory(
                parsedArgs as { targetDirectory?: string },
              )
            } else if (tc.function.name === CREATE_WORKSPACE_DIRECTORY_TOOL_NAME) {
              toolResult = await executeCreateWorkspaceDirectory(
                parsedArgs as { parentDirectory?: string; directoryName?: string },
              )
            } else if (tc.function.name === WRITE_TO_WORKSPACE_TOOL_NAME) {
              toolResult = await executeWriteToWorkspace(
                parsedArgs as { targetDirectory?: string; fileName?: string; content?: string },
              )
            } else {
              toolResult = await executeTool(tc.function.name, parsedArgs, routingTools)
            }
            const resultStr = typeof toolResult === 'string'
              ? toolResult
              : JSON.stringify(toolResult, null, 2)

            conversationMessages.push({
              role: 'tool',
              content: resultStr,
              tool_call_id: tc.id,
            })

            state = upsertAssistantToolExecution(state, assistantId, {
              id: tc.id,
              label: toolLabel,
              status: 'success',
              detail: resultStr,
            })
            notifyStateChange()
          } catch (err) {
            const errMsg = String(err)
            conversationMessages.push({
              role: 'tool',
              content: `Error: ${errMsg}`,
              tool_call_id: tc.id,
            })
            state = upsertAssistantToolExecution(state, assistantId, {
              id: tc.id,
              label: toolLabel,
              status: 'error',
              detail: errMsg,
            })
            notifyStateChange()
          }
        }

        // Prepare for next round — new assistant placeholder
        const nextAssistantId = genId()
        assistantId = nextAssistantId
        state = appendAssistantPlaceholder(state, assistantId)
        notifyStateChange()
      }
    } finally {
      persistDocConversationSnapshot()
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
      await runStream(assistantId)
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

        if (docPath && shouldPersistDocConversation) {
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
    getProviderContext() {
      if (!provider || !currentModelId) return null
      return {
        providerId: provider.id,
        providerType,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        modelId: currentModelId,
      }
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
        if (providerType === 'dify') {
          difyConversationId = resolveDifyConversationId({
            provider,
            initialDifyConversationId: options.initialDifyConversationId,
            difyProviderConversations,
          })
        }
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
      defaultMaxTokens = provider.models.find((m) => m.id === modelId)?.maxTokens

      if (providerType === 'dify') {
        difyConversationId = resolveDifyConversationId({
          provider,
          initialDifyConversationId: options.initialDifyConversationId,
          difyProviderConversations,
        })
      } else {
        difyConversationId = undefined
      }

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
      persistDocConversationSnapshot()

      const chatAttachments: ChatAttachment[] | undefined = options?.attachments?.map((u) => ({
        kind: u.kind,
        source: { kind: 'uploaded', fileId: u.id },
      }))

      // Check if MCP tool calling is active early — tools must be loaded before
      // building the system prompt so the catalog can be injected.
      const effectiveActiveRoleId = state.activeRoleId ?? systemPromptInfo.activeRoleId
      const isMcpRoleActive = isMcpToolCallingRoleActive(systemPromptInfo.roles, effectiveActiveRoleId)

      let allMcpTools: AggregatedTool[] = []
      if (isMcpRoleActive && (providerType === 'openai' || provider?.providerType === 'openai')) {
        try {
          allMcpTools = await getEnabledTools()
        } catch (err) {
          console.warn('[ChatSession] Failed to pre-load MCP tools for catalog', err)
        }
      }

      let clientOverride: IStreamingChatClient | null = null
      let systemPromptForRequest = systemPromptInfo.systemPrompt
      if (provider) {
        const reqContext: RequestContext = {
          source: 'chat-pane',
          entryMode,
          userInput: content,
          docPath,
        }
        systemPromptForRequest = buildGlobalMemorySystemPrompt(
          systemPromptInfo.systemPrompt,
          reqContext,
        )
        // Append compact catalog so the model knows ALL available tools without
        // the token cost of full schemas (progressive disclosure).
        if (allMcpTools.length > 0) {
          systemPromptForRequest += buildToolCatalog(allMcpTools)
        }
        if (providerType === 'openai') {
          systemPromptForRequest += await buildWorkflowToolCatalogPrompt()
          systemPromptForRequest += await buildSkillsToolCatalogPrompt()
          systemPromptForRequest += buildWorkspaceMountedRootsPrompt()
        }
        const initialConversationIdForClient =
          providerType === 'dify' ? difyConversationId : undefined
        console.warn('[ChatSession] sendUserMessage creating client', {
          providerId: provider.id,
          providerName: provider.name,
          providerType,
          currentModelId,
          selectedAgentId: selectedAgent?.id ?? '(none)',
          initialConversationIdForClient: initialConversationIdForClient || '(none)',
          engineHistoryLength: state.engineHistory.length,
          omitDifyModelInput: provider.omitDifyModelInput ?? false,
          baseUrl: provider.baseUrl,
        })
        clientOverride = createStreamingClientFromSettings(
          provider,
          systemPromptForRequest,
          currentModelId,
          initialConversationIdForClient,
        )
      }

      // Built-in tools (write_to_notes etc.) are available for all OpenAI-compatible providers.
      // They are always injected regardless of MCP role.
      const isOpenAIProvider = providerType === 'openai'
      const builtinTools: OpenAIToolDef[] = isOpenAIProvider
        ? [
          writeToNotesToolSchema,
          workflowSearchToolSchema,
          workflowReadToolSchema,
          workflowRunToolSchema,
          skillsSearchToolSchema,
          skillsReadToolSchema,
          resolveWorkspaceDirectoryToolSchema,
          createWorkspaceDirectoryToolSchema,
          writeToWorkspaceToolSchema,
        ]
        : []

      if (isMcpRoleActive) {
        if (providerType !== 'openai') {
          state = appendAssistantChunk(
            state,
            assistantId,
            'Dify 当前不支持 MCP 工具调用，请切换到 OpenAI 兼容模型后再使用该角色。',
          )
          notifyStateChange()
          return
        }

        if (allMcpTools.length === 0) {
          // May have failed to load — try once more
          try {
            allMcpTools = await getEnabledTools()
          } catch { /* ignore */ }
        }

        if (allMcpTools.length > 0) {
          // Progressive disclosure: only send schemas for tools relevant to this message.
          // The model already sees the full catalog in the system prompt.
          const relevantTools = filterToolsByRelevance(content, allMcpTools)
          await runStreamWithToolLoop(
            assistantId,
            clientOverride,
            relevantTools,   // schemas injected into OpenAI tools array
            chatAttachments,
            allMcpTools,     // full list for execution routing
            builtinTools,    // built-in tools always included
          )
          return
        } else {
          state = appendAssistantChunk(
            state,
            assistantId,
            '当前未检测到可用的 MCP 工具，请检查 MCP Server 是否已启用，并确认该服务成功返回 tools/list。',
          )
          notifyStateChange()
          return
        }
      }

      // Non-MCP path: still run tool loop if built-in tools are available (OpenAI only)
      if (builtinTools.length > 0) {
        await runStreamWithToolLoop(
          assistantId,
          clientOverride,
          [],             // no MCP schema tools
          chatAttachments,
          [],             // no MCP routing tools
          builtinTools,   // only built-in tools
        )
        return
      }

      await runStream(assistantId, {
        attachments: chatAttachments,
        clientOverride,
      })
    },
    async uploadAttachment(file: File, kind?: AttachmentKind): Promise<UploadedFileRef> {
      if (disposed) throw new Error('Session disposed')
      if (!provider) throw new Error('AI Chat 未配置 Provider')
      const resolvedKind = kind ?? inferAttachmentKind(file)
      if (!resolvedKind) {
        throw new Error(`Unsupported attachment type: ${file.type || file.name}`)
      }

      return attachmentUploadService.uploadAttachment({
        provider,
        kind: resolvedKind,
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
      persistDocConversationSnapshot()

      const chatAttachments = await uploadLocalAttachments(attachments)

      let clientOverride: IStreamingChatClient | null = null
      if (provider) {
        const reqContext: RequestContext = {
          source: 'chat-pane',
          entryMode,
          userInput: content,
          docPath,
        }
        const systemPromptForRequest = buildGlobalMemorySystemPrompt(
          systemPromptInfo.systemPrompt,
          reqContext,
        )
        const initialConversationIdForClient =
          providerType === 'dify' ? difyConversationId : undefined
        console.warn('[ChatSession] sendUserMessageWithAttachments creating client', {
          providerId: provider.id,
          providerName: provider.name,
          providerType,
          currentModelId,
          selectedAgentId: selectedAgent?.id ?? '(none)',
          initialConversationIdForClient: initialConversationIdForClient || '(none)',
          engineHistoryLength: state.engineHistory.length,
          omitDifyModelInput: provider.omitDifyModelInput ?? false,
          baseUrl: provider.baseUrl,
          attachmentCount: chatAttachments.length,
        })
        clientOverride = createStreamingClientFromSettings(
          provider,
          systemPromptForRequest,
          currentModelId,
          initialConversationIdForClient,
        )
      }

      await runStream(assistantId, {
        attachments: chatAttachments,
        clientOverride,
      })
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
