import { useCallback, useMemo, useState } from 'react'
import type { AiSettingsState, UiProvider, ProviderType } from '../modules/ai/settings'

export type ProviderDraft = {
  name: string
  baseUrl: string
  apiKey: string
  modelsInput: string
  description: string
  providerType: ProviderType | ''
}

const emptyDraft: ProviderDraft = {
  name: '',
  baseUrl: '',
  apiKey: '',
  modelsInput: '',
  description: '',
  providerType: '',
}

function normalizeProviderName(name: string): string {
  return name.trim().toLocaleLowerCase('en-US')
}

function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim()
  return trimmed.replace(/\/+$/, '')
}

function parseModelsInput(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[\s,，]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  )
}

export function useAiSettingsState(initial: AiSettingsState | null) {
  const [settings, setSettings] = useState<AiSettingsState>(initial ?? { providers: [], defaultProviderId: undefined })
  const [draft, setDraft] = useState<ProviderDraft>(emptyDraft)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [initialSnapshot, setInitialSnapshot] = useState<AiSettingsState | null>(initial)

  const defaultProvider = useMemo(
    () => settings.providers.find((p) => p.id === settings.defaultProviderId) ?? null,
    [settings],
  )

  const updateDraftField = useCallback((field: keyof ProviderDraft, value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value }))
  }, [])

  const resetDraft = useCallback(() => {
    setDraft(emptyDraft)
    setError(null)
  }, [])

  const addOrMergeProviderFromDraft = useCallback(() => {
    const models = parseModelsInput(draft.modelsInput)
    if (!draft.name.trim() || !draft.baseUrl.trim() || !draft.apiKey.trim()) {
      setError('请填写 Provider Name / Base URL / API Key')
      return false
    }
    if (models.length === 0) {
      setError('请至少填写一个 ModelID')
      return false
    }

    const targetName = normalizeProviderName(draft.name)
    const targetUrl = normalizeBaseUrl(draft.baseUrl)

    const existing = settings.providers.find(
      (p) => normalizeProviderName(p.name) === targetName && normalizeBaseUrl(p.baseUrl) === targetUrl,
    )

    if (existing) {
      const existingIds = new Set(existing.models.map((m) => m.id))
      const newIds = models.filter((id) => !existingIds.has(id))

      if (newIds.length === 0) {
        setError('该 Provider 已包含这些模型，无需重复添加')
        return false
      }

      setSettings((prev) => {
        const providers = prev.providers.map((p) => {
          if (p.id !== existing.id) return p

          const pExistingIds = new Set(p.models.map((m) => m.id))
          const reallyNewIds = models.filter((id) => !pExistingIds.has(id))
          if (reallyNewIds.length === 0) return p

          const newModels = reallyNewIds.map((id) => ({ id }))
          return {
            ...p,
            models: [...p.models, ...newModels],
            defaultModelId: p.defaultModelId ?? reallyNewIds[0],
          }
        })

        return { ...prev, providers }
      })

      setExpandedId(existing.id)
      setDraft(emptyDraft)
      setError(null)
      return true
    }

    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const provider: UiProvider = {
      id,
      name: draft.name.trim(),
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey.trim(),
      models: models.map((m) => ({ id: m })),
      defaultModelId: models[0],
      description: draft.description.trim() || undefined,
      providerType: (draft.providerType || 'dify') as ProviderType,
    }

    setSettings((prev) => {
      const next: AiSettingsState = {
        providers: [...prev.providers, provider],
        defaultProviderId: prev.defaultProviderId ?? id,
      }
      return next
    })

    setExpandedId(id)
    setDraft(emptyDraft)
    setError(null)
    return true
  }, [draft, settings])

  const deleteProvider = useCallback((id: string) => {
    setSettings((prev) => {
      const providers = prev.providers.filter((p) => p.id !== id)
      let defaultProviderId = prev.defaultProviderId
      if (defaultProviderId === id) {
        defaultProviderId = providers[0]?.id
      }
      if (!providers.length) {
        defaultProviderId = undefined
      }
      if (expandedId === id) {
        setExpandedId(null)
      }
      return { providers, defaultProviderId }
    })
  }, [expandedId])

  const removeModel = useCallback((providerId: string, modelId: string) => {
    setSettings((prev) => {
      const providers = prev.providers.map((p) => {
        if (p.id !== providerId) return p
        const models = p.models.filter((m) => m.id !== modelId)
        let defaultModelId = p.defaultModelId
        if (defaultModelId === modelId) {
          defaultModelId = models[0]?.id
        }
        return { ...p, models, defaultModelId }
      })
      return { ...prev, providers }
    })
  }, [])

  const updateModelMaxTokens = useCallback(
    (providerId: string, modelId: string, maxTokens: number | undefined) => {
      setSettings((prev) => ({
        ...prev,
        providers: prev.providers.map((p) =>
          p.id !== providerId
            ? p
            : {
                ...p,
                models: p.models.map((m) =>
                  m.id !== modelId ? m : { ...m, maxTokens },
                ),
              },
        ),
      }))
    },
    [],
  )

  const setDefaultModel = useCallback((providerId: string, modelId: string) => {
    setSettings((prev) => ({
      ...prev,
      providers: prev.providers.map((p) => (p.id === providerId ? { ...p, defaultModelId: modelId } : p)),
    }))
  }, [])

  const setDefaultProvider = useCallback((providerId: string) => {
    setSettings((prev) => ({ ...prev, defaultProviderId: providerId }))
  }, [])

  const editProviderIntoDraft = useCallback((provider: UiProvider) => {
    const modelsInput = provider.models.map((m) => m.id).join(', ')
    setDraft({
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      modelsInput,
      description: provider.description ?? '',
      providerType: provider.providerType ?? 'dify',
    })
    setExpandedId(provider.id)
  }, [])

  const applyInitialSnapshot = useCallback(() => {
    if (initialSnapshot) {
      setSettings(initialSnapshot)
    }
  }, [initialSnapshot])

  const updateInitialSnapshot = useCallback((next: AiSettingsState) => {
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
    defaultProvider,
    updateDraftField,
    resetDraft,
    addOrMergeProviderFromDraft,
    deleteProvider,
    removeModel,
    setDefaultModel,
    setDefaultProvider,
    editProviderIntoDraft,
    applyInitialSnapshot,
    updateInitialSnapshot,
    updateModelMaxTokens,
  }
}

export const emptyProviderDraft: ProviderDraft = emptyDraft
export { parseModelsInput }
