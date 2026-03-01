import { describe, it, expect, vi, beforeEach } from 'vitest'
import { emptySettings, type AiSettingsState } from '../domain/types'
import {
  fromCfg,
  toCfg,
  loadAiSettingsState,
  saveAiSettingsState,
  loadDefaultChatConfig,
  type AiSettingsCfg,
} from './aiSettingsRepo'
import { mockInvoke } from '../../../../vitest.setup'

describe('aiSettingsRepo fromCfg / toCfg', () => {
  it('fromCfg should return emptySettings when cfg is null/undefined', () => {
    expect(fromCfg(null as any)).toEqual(emptySettings)
    expect(fromCfg(undefined as any)).toEqual(emptySettings)
  })

  it('fromCfg should map providers, models, providerType and visionMode correctly', () => {
    const cfg: AiSettingsCfg = {
      providers: [
        {
          id: 'p1',
          name: 'OpenAI',
          base_url: 'https://api.openai.com',
          api_key: 'sk-test',
          provider_type: 'openai',
          vision_mode: 'enabled',
          description: null,
          default_model_id: 'gpt-4',
          models: [
            { id: 'gpt-4', max_tokens: 8192, vision_mode: 'enabled' },
            { id: 'gpt-3.5', max_tokens: null, vision_mode: 'disabled' },
            { id: 'legacy', max_tokens: 1024, vision_mode: undefined as any },
          ],
        },
        {
          // 另一家 Provider，用于覆盖 provider_type / vision_mode 的默认分支
          id: 'p2',
          name: 'Other',
          base_url: 'https://api.other.com',
          api_key: 'sk-other',
          provider_type: 'something-else',
          vision_mode: undefined,
          description: 'desc',
          default_model_id: undefined,
          models: [{ id: 'm', max_tokens: 1000, vision_mode: 'enabled' }],
        },
      ],
      default_provider_id: 'p1',
    }

    const state = fromCfg(cfg)

    // 顶层映射
    expect(state.defaultProviderId).toBe('p1')
    expect(state.providers).toHaveLength(2)

    const p1 = state.providers[0]
    expect(p1).toMatchObject({
      id: 'p1',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com',
      apiKey: 'sk-test',
      defaultModelId: 'gpt-4',
      description: undefined,
      providerType: 'openai',
      visionMode: 'enabled',
    })

    // 模型映射
    expect(p1.models).toEqual([
      { id: 'gpt-4', maxTokens: 8192, visionMode: 'enabled' },
      { id: 'gpt-3.5', maxTokens: undefined, visionMode: 'disabled' },
      { id: 'legacy', maxTokens: 1024, visionMode: 'disabled' },
    ])

    const p2 = state.providers[1]
    // provider_type 不在允许列表时，providerType 应为 undefined；visionMode 缺省则为 disabled
    expect(p2.providerType).toBeUndefined()
    expect(p2.visionMode).toBe('disabled')
    expect(p2.models[0].visionMode).toBe('enabled')
  })

  it('toCfg should map back to AiSettingsCfg with proper null/default handling', () => {
    const state: AiSettingsState = {
      providers: [
        {
          id: 'p1',
          name: 'P1',
          baseUrl: 'https://api',
          apiKey: 'sk',
          models: [
            { id: 'm1', maxTokens: 100, visionMode: 'enabled' },
            { id: 'm2', maxTokens: undefined, visionMode: 'disabled' },
          ],
          defaultModelId: 'm1',
          description: undefined,
          providerType: 'dify',
          visionMode: 'disabled',
        },
      ],
      defaultProviderId: undefined,
    }

    const cfg = toCfg(state)

    expect(cfg).toEqual({
      providers: [
        {
          id: 'p1',
          name: 'P1',
          base_url: 'https://api',
          api_key: 'sk',
          models: [
            { id: 'm1', max_tokens: 100, vision_mode: 'enabled' },
            { id: 'm2', max_tokens: null, vision_mode: 'disabled' },
          ],
          default_model_id: 'm1',
          description: null,
          provider_type: 'dify',
          vision_mode: 'disabled',
        },
      ],
      default_provider_id: null,
    })
  })
})

describe('aiSettingsRepo load/save', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loadAiSettingsState should return mapped state when backend succeeds', async () => {
    const cfg: AiSettingsCfg = {
      providers: [
        {
          id: 'p1',
          name: 'P1',
          base_url: 'https://api',
          api_key: 'sk',
          models: [{ id: 'm1', max_tokens: 100, vision_mode: 'enabled' }],
          default_model_id: 'm1',
          description: null,
          provider_type: 'openai',
          vision_mode: 'enabled',
        },
      ],
      default_provider_id: 'p1',
    }

    ;(mockInvoke as any).mockResolvedValueOnce({
      Ok: { data: cfg, trace_id: 't1' },
    })

    const state = await loadAiSettingsState()

    expect(mockInvoke).toHaveBeenCalledWith('load_ai_settings')
    expect(state.defaultProviderId).toBe('p1')
    expect(state.providers[0].name).toBe('P1')
    expect(state.providers[0].models[0].id).toBe('m1')
  })

  it('loadAiSettingsState should fallback to emptySettings when backend fails', async () => {
    ;(mockInvoke as any).mockResolvedValueOnce({
      Err: { error: { code: 'UNKNOWN', message: 'bad', trace_id: 't2' } },
    })

    const state = await loadAiSettingsState()
    expect(state).toEqual(emptySettings)
  })

  it('saveAiSettingsState should invoke backend with converted cfg', async () => {
    const state: AiSettingsState = {
      providers: [
        {
          id: 'p1',
          name: 'P1',
          baseUrl: 'https://api',
          apiKey: 'sk',
          models: [{ id: 'm1', maxTokens: 100, visionMode: 'enabled' }],
          defaultModelId: 'm1',
          description: undefined,
          providerType: 'openai',
          visionMode: 'enabled',
        },
      ],
      defaultProviderId: 'p1',
    }

    ;(mockInvoke as any).mockResolvedValueOnce({ Ok: { data: null, trace_id: 't3' } })

    await saveAiSettingsState(state)

    expect(mockInvoke).toHaveBeenCalledWith('save_ai_settings', {
      cfg: {
        providers: [
          {
            id: 'p1',
            name: 'P1',
            base_url: 'https://api',
            api_key: 'sk',
            models: [{ id: 'm1', max_tokens: 100, vision_mode: 'enabled' }],
            default_model_id: 'm1',
            description: null,
            provider_type: 'openai',
            vision_mode: 'enabled',
          },
        ],
        default_provider_id: 'p1',
      },
    })
  })
})

describe('aiSettingsRepo loadDefaultChatConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return null when no default provider or default model', async () => {
    // 后端返回空配置
    ;(mockInvoke as any).mockResolvedValueOnce({
      Ok: { data: { providers: [], default_provider_id: null }, trace_id: 't1' },
    })

    const cfg = await loadDefaultChatConfig()
    expect(cfg).toBeNull()
  })

  it('should build DefaultChatConfig from default provider and model', async () => {
    const cfg: AiSettingsCfg = {
      providers: [
        {
          id: 'p1',
          name: 'P1',
          base_url: 'https://api',
          api_key: 'sk',
          models: [{ id: 'm1', max_tokens: 100, vision_mode: 'disabled' }],
          default_model_id: 'm1',
          description: null,
          provider_type: 'openai',
          vision_mode: 'disabled',
        },
      ],
      default_provider_id: 'p1',
    }

    ;(mockInvoke as any).mockResolvedValueOnce({
      Ok: { data: cfg, trace_id: 't1' },
    })

    const chatCfg = await loadDefaultChatConfig()

    expect(chatCfg).toEqual({
      baseUrl: 'https://api',
      apiKey: 'sk',
      model: 'm1',
    })
  })
})
