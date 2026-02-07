import { describe, it, expect } from 'vitest'
import { emptySettings, fromCfg, toCfg, type AiSettingsCfg, type AiSettingsState } from './settings'

describe('ai/settings mapping', () => {
  it('fromCfg should map backend cfg to state and handle null/undefined', () => {
    const cfg: AiSettingsCfg = {
      providers: [
        {
          id: 'p1',
          name: 'Test',
          base_url: 'https://api.example.com',
          api_key: 'key',
          models: [{ id: 'gpt-4' }],
          default_model_id: 'gpt-4',
          description: null,
        },
      ],
      default_provider_id: 'p1',
    }

    const state = fromCfg(cfg)
    expect(state.providers).toHaveLength(1)
    const p = state.providers[0]
    expect(p.id).toBe('p1')
    expect(p.baseUrl).toBe('https://api.example.com')
    expect(p.models[0].id).toBe('gpt-4')
    expect(state.defaultProviderId).toBe('p1')

    // null / undefined 应映射为 emptySettings
    expect(fromCfg(null)).toEqual(emptySettings)
    expect(fromCfg(undefined)).toEqual(emptySettings)
  })

  it('toCfg should map state to backend cfg with nulls for optional fields', () => {
    const state: AiSettingsState = {
      providers: [
        {
          id: 'p1',
          name: 'Test',
          baseUrl: 'https://api.example.com',
          apiKey: 'key',
          models: [{ id: 'gpt-4' }],
          defaultModelId: undefined,
          description: undefined,
        },
      ],
      defaultProviderId: undefined,
    }

    const cfg = toCfg(state)
    expect(cfg.providers[0].base_url).toBe('https://api.example.com')
    expect(cfg.providers[0].models[0].id).toBe('gpt-4')
    expect(cfg.providers[0].default_model_id).toBeNull()
    expect(cfg.providers[0].description).toBeNull()
    expect(cfg.default_provider_id).toBeNull()
  })
})
