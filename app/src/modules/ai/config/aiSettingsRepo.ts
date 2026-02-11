import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../../platform/backendTypes'
import { emptySettings, type AiSettingsState, type DefaultChatConfig, type ProviderType, type VisionMode } from '../domain/types'

// 后端配置类型（与 Rust 侧 AiSettingsCfg 对应）
export type AiProviderModelCfg = {
  id: string
  max_tokens?: number | null
  vision_mode?: string | null
}

export type AiProviderCfg = {
  id: string
  name: string
  base_url: string
  api_key: string
  models: AiProviderModelCfg[]
  default_model_id?: string | null
  description?: string | null
  provider_type?: string | null
  vision_mode?: string | null
}

export type AiSettingsCfg = {
  providers: AiProviderCfg[]
  default_provider_id?: string | null
}

export function fromCfg(cfg: AiSettingsCfg | null | undefined): AiSettingsState {
  if (!cfg) return emptySettings

  return {
    providers: (cfg.providers ?? []).map((p) => {
      let providerType: ProviderType | undefined
      if (p.provider_type === 'dify' || p.provider_type === 'openai') {
        providerType = p.provider_type
      }

      let visionMode: VisionMode | undefined
      if (p.vision_mode === 'none' || p.vision_mode === 'enabled') {
        visionMode = p.vision_mode
      }

      return {
        id: p.id,
        name: p.name,
        baseUrl: p.base_url,
        apiKey: p.api_key,
        models: (p.models ?? []).map((m) => {
          let modelVisionMode: VisionMode | undefined
          if (m.vision_mode === 'none' || m.vision_mode === 'enabled') {
            modelVisionMode = m.vision_mode
          }
          return {
            id: m.id,
            maxTokens: m.max_tokens ?? undefined,
            visionMode: modelVisionMode,
          }
        }),
        defaultModelId: p.default_model_id ?? undefined,
        description: p.description ?? undefined,
        providerType,
        visionMode,
      }
    }),
    defaultProviderId: cfg.default_provider_id ?? undefined,
  }
}

export function toCfg(state: AiSettingsState): AiSettingsCfg {
  return {
    providers: state.providers.map((p) => ({
      id: p.id,
      name: p.name,
      base_url: p.baseUrl,
      api_key: p.apiKey,
      models: p.models.map((m) => ({
        id: m.id,
        max_tokens: m.maxTokens ?? null,
        vision_mode: !m.visionMode || m.visionMode === 'auto' ? null : m.visionMode,
      })),
      default_model_id: p.defaultModelId ?? null,
      description: p.description ?? null,
      provider_type: p.providerType ?? null,
      vision_mode: !p.visionMode || p.visionMode === 'auto' ? null : p.visionMode,
    })),
    default_provider_id: state.defaultProviderId ?? null,
  }
}

/**
 * 从后端加载完整的 AI 配置，并转换为前端内部使用的状态结构。
 */
export async function loadAiSettingsState(): Promise<AiSettingsState> {
  const resp = await invoke<BackendResult<AiSettingsCfg>>('load_ai_settings')
  if ('Ok' in resp) {
    return fromCfg(resp.Ok.data)
  }
  console.warn('[ai/settings] load_ai_settings error', resp.Err.error)
  return emptySettings
}

/**
 * 将当前 AI 配置状态持久化到后端。
 */
export async function saveAiSettingsState(state: AiSettingsState): Promise<void> {
  const cfg = toCfg(state)
  await invoke('save_ai_settings', { cfg })
}

/**
 * 便于对话模块使用的精简配置：根据当前默认 Provider + 默认 Model 计算出请求所需参数。
 */
export async function loadDefaultChatConfig(): Promise<DefaultChatConfig | null> {
  const state = await loadAiSettingsState()
  const provider = state.providers.find((p) => p.id === state.defaultProviderId)
  if (!provider || !provider.defaultModelId) return null

  return {
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: provider.defaultModelId,
  }
}
