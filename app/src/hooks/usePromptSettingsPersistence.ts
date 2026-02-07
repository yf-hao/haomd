import { useCallback, useState } from 'react'
import { emptyPromptSettings, loadPromptSettingsState, savePromptSettingsState, type PromptSettingsState } from '../modules/ai/promptSettings'

export function usePromptSettingsPersistence() {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<PromptSettingsState> => {
    setLoading(true)
    setError(null)
    try {
      const state = await loadPromptSettingsState()
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
      await savePromptSettingsState(state)
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
