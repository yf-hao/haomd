import { useCallback, useMemo, useState } from 'react'
import type { PromptRole, PromptSettingsState } from '../modules/ai/promptSettings'

export type PromptRoleDraft = {
  id?: string
  name: string
  description: string
  prompt: string
}

const emptyDraft: PromptRoleDraft = {
  id: undefined,
  name: '',
  description: '',
  prompt: '',
}

export function usePromptSettingsState(initial: PromptSettingsState | null) {
  const [settings, setSettings] = useState<PromptSettingsState>(initial ?? { roles: [], defaultRoleId: undefined })
  const [draft, setDraft] = useState<PromptRoleDraft>(emptyDraft)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [initialSnapshot, setInitialSnapshot] = useState<PromptSettingsState | null>(initial)

  const defaultRole = useMemo(
    () => settings.roles.find((r) => r.id === settings.defaultRoleId) ?? null,
    [settings],
  )

  const updateDraftField = useCallback((field: keyof PromptRoleDraft, value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value }))
  }, [])

  const resetDraft = useCallback(() => {
    setDraft(emptyDraft)
    setError(null)
  }, [])

  const addOrUpdateRoleFromDraft = useCallback(() => {
    if (!draft.name.trim()) {
      setError('Role Name is required.')
      return false
    }
    if (!draft.prompt.trim()) {
      setError('Prompt cannot be empty.')
      return false
    }

    const id = draft.id ?? `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const role: PromptRole = {
      id,
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      prompt: draft.prompt,
    }

    setSettings((prev) => {
      const exists = prev.roles.some((r) => r.id === id)
      const roles = exists
        ? prev.roles.map((r) => (r.id === id ? role : r))
        : [...prev.roles, role]

      return {
        roles,
        defaultRoleId: prev.defaultRoleId ?? id,
      }
    })

    setExpandedId(id)
    setDraft(emptyDraft)
    setError(null)
    return true
  }, [draft])

  const deleteRole = useCallback((id: string) => {
    setSettings((prev) => {
      const roles = prev.roles.filter((r) => r.id !== id)
      let defaultRoleId = prev.defaultRoleId
      if (defaultRoleId === id) {
        defaultRoleId = roles[0]?.id
      }
      if (!roles.length) {
        defaultRoleId = undefined
      }
      if (expandedId === id) {
        setExpandedId(null)
      }
      return { roles, defaultRoleId }
    })
  }, [expandedId])

  const setDefaultRole = useCallback((id: string) => {
    setSettings((prev) => ({ ...prev, defaultRoleId: id }))
  }, [])

  const editRoleIntoDraft = useCallback((role: PromptRole) => {
    setDraft({
      id: role.id,
      name: role.name,
      description: role.description ?? '',
      prompt: role.prompt,
    })
    setExpandedId(role.id)
  }, [])

  const applyInitialSnapshot = useCallback(() => {
    if (initialSnapshot) {
      setSettings(initialSnapshot)
    }
  }, [initialSnapshot])

  const updateInitialSnapshot = useCallback((next: PromptSettingsState) => {
    setInitialSnapshot(next)
  }, [])

  return {
    settings,
    setSettings,
    draft,
    setDraft,
    expandedId,
    setExpandedId,
    error,
    setError,
    initialSnapshot,
    setInitialSnapshot,
    defaultRole,
    updateDraftField,
    resetDraft,
    addOrUpdateRoleFromDraft,
    deleteRole,
    setDefaultRole,
    editRoleIntoDraft,
    applyInitialSnapshot,
    updateInitialSnapshot,
  }
}

export const emptyPromptRoleDraft: PromptRoleDraft = emptyDraft
