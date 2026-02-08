// 聚合导出：对外保持原有 API，不改变调用路径
// 领域类型：类型和默认值
import {
  emptyPromptSettings,
  builtinPromptSettings,
  builtinPromptRoles,
  type PromptRole,
  type PromptSettingsState,
} from './domain/types'

// 持久化与后端配置映射：类型与值分开导出
import {
  fromCfg,
  toCfg,
  loadPromptSettingsState,
  savePromptSettingsState,
  type PromptRoleCfg,
  type PromptSettingsCfg,
} from './config/promptSettingsRepo'

export type { PromptRole, PromptSettingsState, PromptRoleCfg, PromptSettingsCfg }
export { emptyPromptSettings, builtinPromptSettings, builtinPromptRoles, fromCfg, toCfg, savePromptSettingsState }

/**
 * 加载 PromptSettingsState，并自动合并内置角色。
 * - 内置角色始终存在于结果中；
 * - 用户角色来自配置文件；
 * - 默认角色优先使用用户保存的 defaultRoleId，否则退回到内置默认。
 */
export async function loadPromptSettingsStateWithBuiltin(): Promise<PromptSettingsState> {
  const persisted = await loadPromptSettingsState()
  const userRoles = persisted.roles ?? []

  // 合并：内置在前，后面接用户角色（去重）
  const mergedRoles: PromptRole[] = [
    ...builtinPromptRoles,
    ...userRoles.filter((r) => !builtinPromptRoles.some((b) => b.id === r.id)),
  ]

  const persistedDefaultId = persisted.defaultRoleId
  const hasPersistedDefault =
    !!persistedDefaultId && mergedRoles.some((r) => r.id === persistedDefaultId)

  const defaultRoleId = hasPersistedDefault
    ? persistedDefaultId
    : builtinPromptSettings.defaultRoleId

  return {
    roles: mergedRoles,
    defaultRoleId,
  }
}
