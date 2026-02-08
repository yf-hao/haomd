import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../../platform/backendTypes'
import { emptyPromptSettings, type PromptRole, type PromptSettingsState } from '../domain/types'

// 后端 JSON 配置结构
export type PromptRoleCfg = {
  id: string
  name: string
  description?: string | null
  prompt: string
  is_default?: boolean | null
}

export type PromptSettingsCfg = {
  roles: PromptRoleCfg[]
  default_role_id?: string | null
}

export function fromCfg(cfg: PromptSettingsCfg | null | undefined): PromptSettingsState {
  if (!cfg) return emptyPromptSettings

  return {
    roles: (cfg.roles ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? undefined,
      prompt: r.prompt,
    } as PromptRole)),
    defaultRoleId: cfg.default_role_id ?? undefined,
  }
}

export function toCfg(state: PromptSettingsState): PromptSettingsCfg {
  return {
    roles: state.roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? null,
      prompt: r.prompt,
      is_default: (state.defaultRoleId ?? null) === r.id,
    })),
    default_role_id: state.defaultRoleId ?? null,
  }
}

export async function loadPromptSettingsState(): Promise<PromptSettingsState> {
  const resp = await invoke<BackendResult<PromptSettingsCfg>>('load_prompt_settings')
  if ('Ok' in resp) {
    return fromCfg(resp.Ok.data)
  }
  console.warn('[ai/promptSettings] load_prompt_settings error', resp.Err.error)
  return emptyPromptSettings
}

export async function savePromptSettingsState(state: PromptSettingsState): Promise<void> {
  const cfg = toCfg(state)
  await invoke('save_prompt_settings', { cfg })
}
