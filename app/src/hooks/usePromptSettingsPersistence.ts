import { useCallback, useState } from 'react'
import {
  emptyPromptSettings,
  loadPromptSettingsStateWithBuiltin,
  savePromptSettingsState,
  type PromptSettingsState,
} from '../modules/ai/promptSettings'

export function usePromptSettingsPersistence() {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<PromptSettingsState> => {
    setLoading(true)
    setError(null)
    try {
      // 加载时自动合并内置角色和用户角色
      const state = await loadPromptSettingsStateWithBuiltin()
      return state
    } catch (err) {
      console.error('Failed to load prompt_settings:', err)
      setError('Failed to load prompt settings. Please try again.')
      return emptyPromptSettings
    } finally {
      setLoading(false)
    }
  }, [])

  const save = useCallback(async (state: PromptSettingsState): Promise<boolean> => {
    setSaving(true)
    setError(null)
    try {
      // 只保存用户自定义角色，忽略内置角色
      const userRolesState = {
        roles: state.roles.filter((r) => !r.builtin),
        defaultRoleId: state.defaultRoleId,
      }
      await savePromptSettingsState(userRolesState)
      return true
    } catch (err) {
      console.error('Failed to save prompt_settings:', err)
      setError('Failed to save prompt settings. Please try again.')
      return false
    } finally {
      setSaving(false)
    }
  }, [])

  return {
    loading,
    saving,
    error,
    setError,
    load,
    save,
  }
}
