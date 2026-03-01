import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createStreamingClientFromSettings } from './streamingClientFactory'
import { createDifyStreamingClient } from './dify/createDifyStreamingClient'
import { createOpenAIStreamingClient } from './openai/createOpenAIStreamingClient'

vi.mock('./dify/createDifyStreamingClient', () => ({
  createDifyStreamingClient: vi.fn(() => ({ kind: 'dify-client' })),
}))

vi.mock('./openai/createOpenAIStreamingClient', () => ({
  createOpenAIStreamingClient: vi.fn(() => ({ kind: 'openai-client' })),
}))

const mockedDify = vi.mocked(createDifyStreamingClient)
const mockedOpenAI = vi.mocked(createOpenAIStreamingClient)

describe('createStreamingClientFromSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const baseProvider = {
    id: 'p1',
    name: 'Test Provider',
    baseUrl: ' https://api.test ',
    apiKey: ' sk-123 ',
    models: [{ id: 'm1' }, { id: 'm2' }],
    defaultModelId: 'm2',
    description: 'desc',
    providerType: 'dify' as const,
    visionMode: 'disabled' as const,
  }

  it('should create Dify client when providerType is dify and trim fields', () => {
    const provider = { ...baseProvider, providerType: 'dify' as const }

    const client = createStreamingClientFromSettings(provider as any, 'sys-prompt', 'override-model', 'conv-123')

    expect(client).toEqual({ kind: 'dify-client' })
    expect(mockedDify).toHaveBeenCalledTimes(1)
    expect(mockedDify).toHaveBeenCalledWith({
      apiKey: 'sk-123',
      baseUrl: 'https://api.test',
      modelId: 'override-model',
      systemPrompt: 'sys-prompt',
      temperature: 0,
      maxTokens: 256,
      initialConversationId: 'conv-123',
    })
  })

  it('should default providerType to dify when undefined', () => {
    const provider = { ...baseProvider, providerType: undefined as any }

    createStreamingClientFromSettings(provider as any)

    expect(mockedDify).toHaveBeenCalledTimes(1)
  })

  it('should select modelId from override > defaultModelId > first model', () => {
    // 1) 有 overrideModelId 时优先使用
    let provider: any = { ...baseProvider, defaultModelId: 'm2' }
    createStreamingClientFromSettings(provider, undefined, 'override', undefined)
    expect(mockedDify.mock.calls[0][0].modelId).toBe('override')

    vi.clearAllMocks()

    // 2) 无 override，使用 defaultModelId
    provider = { ...baseProvider, defaultModelId: 'm2' }
    createStreamingClientFromSettings(provider, undefined, undefined, undefined)
    expect(mockedDify.mock.calls[0][0].modelId).toBe('m2')

    vi.clearAllMocks()

    // 3) 无 override、无 defaultModelId，使用 models[0].id
    provider = { ...baseProvider, defaultModelId: undefined, models: [{ id: 'first' }, { id: 'second' }] }
    createStreamingClientFromSettings(provider, undefined, undefined, undefined)
    expect(mockedDify.mock.calls[0][0].modelId).toBe('first')
  })

  it('should create OpenAI client when providerType is openai', () => {
    const provider = { ...baseProvider, providerType: 'openai' as const }

    const client = createStreamingClientFromSettings(provider as any, 'sys-openai', 'openai-model', undefined)

    expect(client).toEqual({ kind: 'openai-client' })
    expect(mockedOpenAI).toHaveBeenCalledTimes(1)
    expect(mockedOpenAI).toHaveBeenCalledWith({
      apiKey: 'sk-123',
      baseUrl: 'https://api.test',
      modelId: 'openai-model',
      systemPrompt: 'sys-openai',
      temperature: 0,
      maxTokens: 256,
    })
    expect(mockedDify).not.toHaveBeenCalled()
  })

  it('should throw error when baseUrl, apiKey or modelId is missing', () => {
    const providerMissingBase = { ...baseProvider, baseUrl: '   ' }
    expect(() => createStreamingClientFromSettings(providerMissingBase as any)).toThrow(
      'Provider 配置不完整：缺少 Base URL / API Key / Model',
    )

    const providerMissingKey = { ...baseProvider, apiKey: '   ' }
    expect(() => createStreamingClientFromSettings(providerMissingKey as any)).toThrow(
      'Provider 配置不完整：缺少 Base URL / API Key / Model',
    )

    const providerMissingModel = { ...baseProvider, defaultModelId: undefined, models: [] as any[] }
    expect(() => createStreamingClientFromSettings(providerMissingModel as any)).toThrow(
      'Provider 配置不完整：缺少 Base URL / API Key / Model',
    )
  })
})
