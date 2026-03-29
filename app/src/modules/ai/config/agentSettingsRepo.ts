import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../../platform/backendTypes'
import { emptyAgentSettings, type AgentPlatform, type AgentSettingsState } from '../domain/types'

export type AgentProviderCfg = {
  id: string
  name: string
  base_url: string
  api_key: string
  platform?: string | null
}

export type AgentSettingsCfg = {
  providers: AgentProviderCfg[]
  default_provider_id?: string | null
}

export function fromCfg(cfg: AgentSettingsCfg | null | undefined): AgentSettingsState {
  if (!cfg) return emptyAgentSettings

  const toPlatform = (value?: string | null): AgentPlatform => {
    if (value === 'coze' || value === 'other' || value === 'dify') {
      return value
    }
    return 'dify'
  }

  return {
    providers: (cfg.providers ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      baseUrl: p.base_url,
      apiKey: p.api_key,
      platform: toPlatform(p.platform),
    })),
    defaultProviderId: cfg.default_provider_id ?? undefined,
  }
}

export function toCfg(state: AgentSettingsState): AgentSettingsCfg {
  return {
    providers: state.providers.map((p) => ({
      id: p.id,
      name: p.name,
      base_url: p.baseUrl,
      api_key: p.apiKey,
      platform: p.platform,
    })),
    default_provider_id: state.defaultProviderId ?? null,
  }
}

export async function loadAgentSettingsState(): Promise<AgentSettingsState> {
  const resp = await invoke<BackendResult<AgentSettingsCfg>>('load_agent_settings')
  if ('Ok' in resp) {
    return fromCfg(resp.Ok.data)
  }
  console.warn('[agent/settings] load_agent_settings error', resp.Err.error)
  return emptyAgentSettings
}

export async function saveAgentSettingsState(state: AgentSettingsState): Promise<void> {
  const cfg = toCfg(state)
  await invoke('save_agent_settings', { cfg })
}
