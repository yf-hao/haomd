import { useEffect, useState } from 'react'
import type { AiSettingsState, ProviderType } from '../../modules/ai/settings'
import { buildSingleWebProvider } from '../application/webProviderTestService'

function buildSingleProviderSettings(input: {
  providerType: ProviderType
  baseUrl: string
  apiKey: string
  modelId: string
}): AiSettingsState {
  return {
    defaultProviderId: 'default-web-provider',
    providers: [buildSingleWebProvider(input)],
  }
}

function validateSettingsInput(input: {
  baseUrl: string
  apiKey: string
  modelId: string
}): string | null {
  if (!input.baseUrl.trim()) return 'Base URL 不能为空'
  if (!/^https?:\/\//i.test(input.baseUrl.trim())) return 'Base URL 需要以 http:// 或 https:// 开头'
  if (!input.apiKey.trim()) return 'API Key 不能为空'
  if (!input.modelId.trim()) return 'Model ID 不能为空'
  return null
}

export function AiSettingsSection({
  settings,
  onSave,
  onTestConnection,
}: {
  settings: AiSettingsState | null
  onSave: (state: AiSettingsState) => Promise<void> | void
  onTestConnection?: (state: {
    providerType: ProviderType
    baseUrl: string
    apiKey: string
    modelId: string
  }) => Promise<void> | void
}) {
  const [providerType, setProviderType] = useState<ProviderType>('openai')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [modelId, setModelId] = useState('')
  const validationError = validateSettingsInput({ baseUrl, apiKey, modelId })

  useEffect(() => {
    const provider = settings?.providers.find((item) => item.id === settings.defaultProviderId) ?? settings?.providers[0]
    if (!provider) return
    setProviderType(provider.providerType ?? 'openai')
    setBaseUrl(provider.baseUrl)
    setApiKey(provider.apiKey)
    setModelId(provider.defaultModelId ?? provider.models[0]?.id ?? '')
  }, [settings])

  return (
    <section className="web-settings-section">
      <div className="web-settings-section-header">
        <h2>AI 设置</h2>
      </div>
      <label>
        Provider 类型
        <select value={providerType} onChange={(event) => setProviderType(event.target.value as ProviderType)}>
          <option value="openai">OpenAI Compatible</option>
          <option value="dify">Dify</option>
        </select>
      </label>
      <label>
        Base URL
        <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://..." />
      </label>
      <label>
        API Key
        <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-..." />
      </label>
      <label>
        Model ID
        <input value={modelId} onChange={(event) => setModelId(event.target.value)} placeholder="gpt-5.4-mini" />
      </label>
      <div className="web-settings-hint">
        Web 轻应用当前只保存一个默认 Provider。后续扩展多 Provider 时，页面结构不需要重做，只需要替换设置 service。
      </div>
      {validationError ? <div className="web-settings-error">{validationError}</div> : null}
      <div className="web-settings-actions">
        <button
          disabled={!!validationError}
          onClick={() =>
            void onSave(
              buildSingleProviderSettings({
                providerType,
                baseUrl,
                apiKey,
                modelId,
              }),
            )
          }
        >
          保存 AI 设置
        </button>
        {onTestConnection ? (
          <button
            disabled={!!validationError}
            onClick={() =>
              void onTestConnection({
                providerType,
                baseUrl,
                apiKey,
                modelId,
              })
            }
          >
            测试连接
          </button>
        ) : null}
      </div>
    </section>
  )
}
