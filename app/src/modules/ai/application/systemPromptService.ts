import type { PromptRole } from '../promptSettings'
import { loadPromptSettingsState } from '../promptSettings'

export type SystemPromptInfo = {
  roles: PromptRole[]
  activeRoleId?: string
  systemPrompt?: string
}

/**
 * 从 Prompt Settings 加载角色列表与当前系统提示词。
 * - 若存在 defaultRoleId，则以其为当前角色；
 * - 否则在有角色时使用第一条；
 * - 若没有任何角色，则返回空列表与 undefined 的 systemPrompt。
 */
export async function loadSystemPromptInfo(): Promise<SystemPromptInfo> {
  const state = await loadPromptSettingsState()
  const roles = state.roles ?? []

  if (!roles.length) {
    return { roles }
  }

  const activeRoleId = state.defaultRoleId ?? roles[0]?.id
  const activeRole = roles.find((r) => r.id === activeRoleId)
  const systemPrompt = activeRole?.prompt.trim() || undefined

  return { roles, activeRoleId, systemPrompt }
}

/**
 * 根据角色 id 从已有角色列表中计算新的 activeRoleId 与 systemPrompt。
 * - 若 roleId 为空，则回退到第一条角色（若存在）。
 * - 若找不到对应角色，则返回 undefined 的 systemPrompt。
 */
export function getSystemPromptByRoleId(
  roles: PromptRole[],
  roleId?: string,
): { activeRoleId?: string; systemPrompt?: string } {
  if (!roles.length) return { activeRoleId: undefined, systemPrompt: undefined }

  const id = roleId ?? roles[0]?.id
  const activeRole = roles.find((r) => r.id === id)

  return {
    activeRoleId: activeRole ? id : undefined,
    systemPrompt: activeRole?.prompt.trim() || undefined,
  }
}
