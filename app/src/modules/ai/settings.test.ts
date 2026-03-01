import { describe, it, expect } from 'vitest'

// 从入口聚合模块导入
import {
  emptySettings as settingsEmpty,
  fromCfg as settingsFromCfg,
  toCfg as settingsToCfg,
  loadAiSettingsState as settingsLoadAi,
  saveAiSettingsState as settingsSaveAi,
  loadDefaultChatConfig as settingsLoadDefaultChat,
} from './settings'

// 从实际实现模块导入，用于对比引用是否一致
import { emptySettings as domainEmptySettings } from './domain/types'
import {
  fromCfg as repoFromCfg,
  toCfg as repoToCfg,
  loadAiSettingsState as repoLoadAi,
  saveAiSettingsState as repoSaveAi,
  loadDefaultChatConfig as repoLoadDefaultChat,
} from './config/aiSettingsRepo'

describe('ai/settings aggregate exports', () => {
  it('should re-export emptySettings from domain/types', () => {
    // 引用相等，说明是同一个对象
    expect(settingsEmpty).toBe(domainEmptySettings)
    expect(settingsEmpty).toEqual({ providers: [], defaultProviderId: undefined })
  })

  it('should re-export aiSettingsRepo mapping functions and IO helpers', () => {
    // 直接比较函数引用是否完全一致
    expect(settingsFromCfg).toBe(repoFromCfg)
    expect(settingsToCfg).toBe(repoToCfg)
    expect(settingsLoadAi).toBe(repoLoadAi)
    expect(settingsSaveAi).toBe(repoSaveAi)
    expect(settingsLoadDefaultChat).toBe(repoLoadDefaultChat)
  })
})
