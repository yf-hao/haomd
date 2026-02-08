// 聚合导出：对外保持原有 API，不改变调用路径
// 领域类型：类型和数值分开导出
export type { PromptRole, PromptSettingsState } from './domain/types'
export { emptyPromptSettings } from './domain/types'

// 持久化与后端配置映射：类型与值分开导出
export type { PromptRoleCfg, PromptSettingsCfg } from './config/promptSettingsRepo'
export { fromCfg, toCfg, loadPromptSettingsState, savePromptSettingsState } from './config/promptSettingsRepo'
