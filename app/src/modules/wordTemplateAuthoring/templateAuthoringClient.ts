import { loadAiSettingsState } from '../ai/config/aiSettingsRepo'
import type { IStreamingChatClient, StreamingChatRequest } from '../ai/domain/types'
import type { UiProvider } from '../ai/settings'
import { createStreamingClientFromSettings } from '../ai/streamingClientFactory'
import {
  buildCreateTemplateAuthoringPrompt,
  buildRepairTemplateAuthoringPrompt,
  buildReviseTemplateAuthoringPrompt,
} from './templateAuthoringPrompt'
import type {
  TemplateValidationError,
  WordTemplateBuildSession,
  WordTemplateDraft,
} from './types'

const AUTHORING_TEMPERATURE = 0.2

export type WordTemplateAuthoringProviderContext = {
  providerId?: string
  modelId?: string
}

type TemplateAuthoringPrompt = {
  system: string
  user: string
}

function pickProvider(
  state: Awaited<ReturnType<typeof loadAiSettingsState>>,
  context?: WordTemplateAuthoringProviderContext,
): UiProvider {
  const provider =
    (context?.providerId && state.providers.find((item) => item.id === context.providerId)) ||
    (state.defaultProviderId &&
      state.providers.find((item) => item.id === state.defaultProviderId)) ||
    state.providers[0]

  if (!provider) {
    throw new Error('未配置可用的 AI Provider')
  }

  return provider
}

function createAuthoringClient(
  provider: UiProvider,
  systemPrompt: string,
  context?: WordTemplateAuthoringProviderContext,
): IStreamingChatClient {
  const modelId = context?.modelId ?? provider.defaultModelId ?? provider.models[0]?.id
  if (!modelId) {
    throw new Error('Provider 未配置默认模型')
  }

  return createStreamingClientFromSettings(provider, systemPrompt, modelId)
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

async function requestTemplateAuthoring(
  prompt: TemplateAuthoringPrompt,
  context?: WordTemplateAuthoringProviderContext,
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
    throw new Error('Word Template Authoring 未收到模型输出')
  }

  return content
}

export async function generateWordTemplateDraft(
  userRequest: string,
  context?: WordTemplateAuthoringProviderContext,
  client?: IStreamingChatClient,
): Promise<string> {
  const prompt = buildCreateTemplateAuthoringPrompt({ userRequest })
  return requestTemplateAuthoring(prompt, context, wrapClientWithSystemPrompt(prompt.system, client))
}

export async function reviseWordTemplateDraft(
  userRequest: string,
  currentDraft: WordTemplateDraft,
  context?: WordTemplateAuthoringProviderContext,
  client?: IStreamingChatClient,
): Promise<string> {
  const prompt = buildReviseTemplateAuthoringPrompt({ userRequest, currentDraft })
  return requestTemplateAuthoring(prompt, context, wrapClientWithSystemPrompt(prompt.system, client))
}

export async function repairWordTemplateDraft(
  userRequest: string,
  currentDraft: WordTemplateDraft,
  validationErrors: TemplateValidationError[],
  context?: WordTemplateAuthoringProviderContext,
  client?: IStreamingChatClient,
): Promise<string> {
  const prompt = buildRepairTemplateAuthoringPrompt({
    userRequest,
    currentDraft,
    validationErrors,
  })
  return requestTemplateAuthoring(prompt, context, wrapClientWithSystemPrompt(prompt.system, client))
}

export function createWordTemplateAuthoringHandlers(input: {
  mode: 'create' | 'revise'
  userRequest: string
  currentDraft?: WordTemplateDraft
  context?: WordTemplateAuthoringProviderContext
  client?: IStreamingChatClient
}): {
  generate: (context: { session: WordTemplateBuildSession }) => Promise<string>
  repair: (context: { session: WordTemplateBuildSession }) => Promise<string>
} {
  return {
    generate: () =>
      input.mode === 'revise' && input.currentDraft
        ? reviseWordTemplateDraft(input.userRequest, input.currentDraft, input.context, input.client)
        : generateWordTemplateDraft(input.userRequest, input.context, input.client),
    repair: ({ session }) => {
      if (!session.currentDraft) {
        throw new Error('Repair 阶段缺少 currentDraft')
      }
      return repairWordTemplateDraft(
        input.userRequest,
        session.currentDraft,
        session.validationErrors,
        input.context,
        input.client,
      )
    },
  }
}
