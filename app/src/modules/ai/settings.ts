// 聚合导出：对外保持原有 API，不改变调用路径
// 领域类型：类型和数值分开导出，避免运行时缺失绑定
export type {
  UiProviderModel,
  UiProvider,
  AiSettingsState,
  DefaultChatConfig,
  ProviderType,
} from './domain/types'
export { emptySettings } from './domain/types'

// 持久化与后端配置映射：类型与值分开导出
export type { AiProviderModelCfg, AiProviderCfg, AiSettingsCfg } from './config/aiSettingsRepo'
export { fromCfg, toCfg, loadAiSettingsState, saveAiSettingsState, loadDefaultChatConfig } from './config/aiSettingsRepo'
