import { useCallback, useMemo, useState } from 'react'
import type { AiSettingsState, UiProvider, ProviderType } from '../modules/ai/settings'

export type ProviderDraft = {
  name: string
  baseUrl: string
  apiKey: string
  modelsInput: string
  description: string
  providerType: ProviderType | ''
  /** Vision 模式选择："" 表示自动检测（不写入配置） */
  visionMode: '' | 'none' | 'enabled'
}

const emptyDraft: ProviderDraft = {
  name: '',
  baseUrl: '',
  apiKey: '',
  modelsInput: '',
  description: '',
  providerType: '',
  visionMode: '',
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
  // 当前正在编辑（左侧表单绑定）的 Provider，如果为 null 表示在创建新 Provider
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null)
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
    setEditingProviderId(null)
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

      // 预先计算 API Key 是否发生变化
      const newApiKeyCandidate = draft.apiKey.trim()
      const shouldUpdateApiKey = !!newApiKeyCandidate && newApiKeyCandidate !== existing.apiKey

      // 情况 1：模型完全重复且 API Key 也未变化 -> 视为重复添加，给出错误提示
      if (newIds.length === 0 && !shouldUpdateApiKey) {
        setError('该 Provider 已包含这些模型，无需重复添加')
        return false
      }

      // 情况 2：没有任何新模型，但 API Key 发生变化 -> 仅 Key 变化
      // 这种情况不直接修改配置，由对话框弹出子模态提示用户使用 Save 更新 Key
      if (newIds.length === 0 && shouldUpdateApiKey) {
        return 'key-only'
      }

      // 情况 3：存在新增模型（无论是否顺便更新 API Key），执行合并
      setSettings((prev) => {
        const providers = prev.providers.map((p) => {
          if (p.id !== existing.id) return p

          const pExistingIds = new Set(p.models.map((m) => m.id))
          const reallyNewIds = models.filter((id) => !pExistingIds.has(id))

          // 计算是否需要更新 API Key：只有当草稿中提供了非空且与旧值不同的 key 时才覆盖
          const shouldUpdateApiKeyForThis = !!newApiKeyCandidate && newApiKeyCandidate !== p.apiKey

          if (reallyNewIds.length === 0 && !shouldUpdateApiKeyForThis) return p

          const newModels = reallyNewIds.map((id) => ({
            id,
            visionMode: draft.visionMode || undefined,
          }))
          return {
            ...p,
            apiKey: shouldUpdateApiKeyForThis ? newApiKeyCandidate : p.apiKey,
            models: reallyNewIds.length > 0 ? [...p.models, ...newModels] : p.models,
            defaultModelId:
              p.defaultModelId ?? (reallyNewIds.length > 0 ? reallyNewIds[0] : p.defaultModelId),
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
      models: models.map((m) => ({ id: m, visionMode: draft.visionMode || undefined })),
      defaultModelId: models[0],
      description: draft.description.trim() || undefined,
      providerType: (draft.providerType || 'dify') as ProviderType,
      visionMode: draft.visionMode || undefined,
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
      if (editingProviderId === id) {
        setEditingProviderId(null)
      }
      return { providers, defaultProviderId }
    })
  }, [expandedId, editingProviderId])

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

  const updateModelVisionMode = useCallback(
    (providerId: string, modelId: string, visionMode: '' | 'none' | 'enabled') => {
      setSettings((prev) => ({
        ...prev,
        providers: prev.providers.map((p) =>
          p.id !== providerId
            ? p
            : {
                ...p,
                models: p.models.map((m) =>
                  m.id !== modelId ? m : { ...m, visionMode: visionMode || undefined },
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
      visionMode: provider.visionMode && provider.visionMode !== 'auto' ? provider.visionMode : '',
    })
    setExpandedId(provider.id)
    setEditingProviderId(provider.id)
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
    editingProviderId,
    setEditingProviderId,
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
    updateModelVisionMode,
  }
}

export const emptyProviderDraft: ProviderDraft = emptyDraft
export { parseModelsInput }