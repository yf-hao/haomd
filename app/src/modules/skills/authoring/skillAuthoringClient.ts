import { loadAiSettingsState } from '../../ai/config/aiSettingsRepo'
import type { IStreamingChatClient, StreamingChatRequest } from '../../ai/domain/types'
import type { UiProvider } from '../../ai/settings'
import { createStreamingClientFromSettings } from '../../ai/streamingClientFactory'
import { buildCreateSkillAuthoringPrompt, buildRepairSkillAuthoringPrompt, buildReviseSkillAuthoringPrompt } from './skillAuthoringPrompt'
import type { SkillArtifact, SkillBuildSession, ValidationError } from './types'

const AUTHORING_TEMPERATURE = 0.2

export type SkillAuthoringProviderContext = {
  providerId?: string
  modelId?: string
}

type SkillAuthoringPrompt = {
  system: string
  user: string
}

function pickProvider(
  state: Awaited<ReturnType<typeof loadAiSettingsState>>,
  context?: SkillAuthoringProviderContext,
): UiProvider {
  const provider =
    (context?.providerId && state.providers.find((item) => item.id === context.providerId)) ||
    (state.defaultProviderId && state.providers.find((item) => item.id === state.defaultProviderId)) ||
    state.providers[0]

  if (!provider) {
    throw new Error('未配置可用的 AI Provider')
  }

  return provider
}

function createAuthoringClient(
  provider: UiProvider,
  systemPrompt: string,
  context?: SkillAuthoringProviderContext,
): IStreamingChatClient {
  const modelId = context?.modelId ?? provider.defaultModelId ?? provider.models[0]?.id
  if (!modelId) {
    throw new Error('Provider 未配置默认模型')
  }

  return createStreamingClientFromSettings(provider, systemPrompt, modelId)
}

async function requestSkillAuthoring(
  prompt: SkillAuthoringPrompt,
  context?: SkillAuthoringProviderContext,
  client?: IStreamingChatClient,
): Promise<string> {
  const usedClient =
    client ??
    createAuthoringClient(
      pickProvider(await loadAiSettingsState(), context),
      prompt.system,
      context,
    )

  let buffer = ''
  const request: StreamingChatRequest = {
    messages: [{ role: 'user', content: prompt.user }],
    temperature: AUTHORING_TEMPERATURE,
  }

  const result = await usedClient.askStream(request, {
    onChunk: (chunk) => {
      if (chunk.content) {
        buffer += chunk.content
      }
    },
    onComplete: (content) => {
      if (!buffer && content) {
        buffer = content
      }
    },
  })

  if (result.error) {
    throw result.error
  }

  const content = (buffer || result.content || '').trim()
  if (!content) {
    throw new Error('Skill Authoring 未收到模型输出')
  }

  return content
}

export async function generateSkillArtifactDraft(
  userRequest: string,
  context?: SkillAuthoringProviderContext,
  client?: IStreamingChatClient,
): Promise<string> {
  const prompt = buildCreateSkillAuthoringPrompt({ userRequest })
  return requestSkillAuthoring(prompt, context, wrapClientWithSystemPrompt(prompt.system, client))
}

export async function reviseSkillArtifactDraft(
  userRequest: string,
  currentArtifact: SkillArtifact,
  context?: SkillAuthoringProviderContext,
  client?: IStreamingChatClient,
): Promise<string> {
  const prompt = buildReviseSkillAuthoringPrompt({ userRequest, currentArtifact })
  return requestSkillAuthoring(prompt, context, wrapClientWithSystemPrompt(prompt.system, client))
}

export async function repairSkillArtifactDraft(
  userRequest: string,
  currentArtifact: SkillArtifact,
  validationErrors: ValidationError[],
  context?: SkillAuthoringProviderContext,
  client?: IStreamingChatClient,
): Promise<string> {
  const prompt = buildRepairSkillAuthoringPrompt({
    userRequest,
    currentArtifact,
    validationErrors,
  })
  return requestSkillAuthoring(prompt, context, wrapClientWithSystemPrompt(prompt.system, client))
}

function wrapClientWithSystemPrompt(
  systemPrompt: string,
  client: IStreamingChatClient | undefined,
): IStreamingChatClient | undefined {
  if (client) {
    return {
      askStream(request, handlers) {
        return client.askStream(
          {
            ...request,
            messages: [{ role: 'user', content: systemPrompt }, ...request.messages],
          },
          handlers,
        )
      },
    }
  }

  return undefined
}

export function createSkillAuthoringHandlers(
  input: {
    mode: 'create' | 'revise'
    userRequest: string
    currentArtifact?: SkillArtifact
    context?: SkillAuthoringProviderContext
    client?: IStreamingChatClient
  },
): {
  generate: (context: { session: SkillBuildSession }) => Promise<string>
  repair: (context: { session: SkillBuildSession }) => Promise<string>
} {
  return {
    generate: () =>
      input.mode === 'revise' && input.currentArtifact
        ? reviseSkillArtifactDraft(input.userRequest, input.currentArtifact, input.context, input.client)
        : generateSkillArtifactDraft(input.userRequest, input.context, input.client),
    repair: ({ session }) => {
      if (!session.currentDraft) {
        throw new Error('Repair 阶段缺少 currentDraft')
      }
      return repairSkillArtifactDraft(
        input.userRequest,
        session.currentDraft,
        session.validationErrors,
        input.context,
        input.client,
      )
    },
  }
}
