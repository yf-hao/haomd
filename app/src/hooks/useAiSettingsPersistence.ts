import { useCallback, useState } from 'react'
import { emptySettings, loadAiSettingsState, saveAiSettingsState, type AiSettingsState } from '../modules/ai/settings'

export function useAiSettingsPersistence() {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<AiSettingsState> => {
    setLoading(true)
    setError(null)
    try {
      const state = await loadAiSettingsState()
      return state
    } catch (err) {
      console.error('Failed to load ai_settings:', err)
      setError('加载失败：请稍后重试')
      return emptySettings
    } finally {
      setLoading(false)
    }
  }, [])

  const save = useCallback(async (state: AiSettingsState): Promise<boolean> => {
    setSaving(true)
    setError(null)
    try {
      await saveAiSettingsState(state)
      return true
    } catch (err) {
      console.error('Failed to save ai_settings:', err)
      setError('保存失败：请稍后重试')
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
