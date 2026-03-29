import { useCallback, useState } from 'react'
import { emptyAgentSettings, type AgentSettingsState } from '../modules/ai/domain/types'
import { loadAgentSettingsState, saveAgentSettingsState } from '../modules/ai/config/agentSettingsRepo'

export function useAgentSettingsPersistence() {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<AgentSettingsState> => {
    setLoading(true)
    setError(null)
    try {
      return await loadAgentSettingsState()
    } catch (err) {
      console.error('Failed to load agent_settings:', err)
      setError('加载失败：请稍后重试')
      return emptyAgentSettings
    } finally {
      setLoading(false)
    }
  }, [])

  const save = useCallback(async (state: AgentSettingsState): Promise<boolean> => {
    setSaving(true)
    setError(null)
    try {
      await saveAgentSettingsState(state)
      return true
    } catch (err) {
      console.error('Failed to save agent_settings:', err)
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
