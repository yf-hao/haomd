import { useRef } from 'react'
import type { AiSettingsState, ProviderType } from '../../modules/ai/settings'
import type { WebLiteSettings, WebLiteSyncSettings } from '../domain/models'
import { AiSettingsSection } from '../components/AiSettingsSection'
import { SyncSettingsSection } from '../components/SyncSettingsSection'

export function SettingsPage({
  settings,
  onSaveAiSettings,
  onSaveSyncSettings,
  onTestConnection,
  onExportData,
  onImportData,
  onExportSyncSnapshot,
  onPushSync,
  onPullSync,
  onRunSync,
}: {
  settings: WebLiteSettings | null
  onSaveAiSettings: (state: AiSettingsState) => Promise<void> | void
  onSaveSyncSettings: (state: WebLiteSyncSettings | null) => Promise<void> | void
  onTestConnection?: (state: {
    providerType: ProviderType
    baseUrl: string
    apiKey: string
    modelId: string
  }) => Promise<void> | void
  onExportData?: () => void
  onImportData?: (file: File) => Promise<void> | void
  onExportSyncSnapshot?: () => void
  onPushSync?: () => Promise<void> | void
  onPullSync?: () => Promise<void> | void
  onRunSync?: () => Promise<void> | void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <section className="web-settings">
      <h1>设置</h1>
      <AiSettingsSection
        settings={settings?.ai ?? null}
        onSave={onSaveAiSettings}
        onTestConnection={onTestConnection}
      />
      <SyncSettingsSection
        settings={settings?.sync ?? null}
        onSave={onSaveSyncSettings}
        onExportSnapshot={onExportSyncSnapshot}
        onPush={onPushSync}
        onPull={onPullSync}
        onSync={onRunSync}
      />
      <section className="web-settings-section">
        <div className="web-settings-section-header">
          <h2>数据管理</h2>
        </div>
        <div className="web-settings-hint">
          导入导出的是当前 Web Lite 本地数据，用于备份或迁移。同步快照则是后续 WebDAV 同步协议的本地预览格式。
        </div>
        <div className="web-settings-actions">
          {onImportData ? (
            <>
              <input
                ref={fileInputRef}
                className="web-hidden-file-input"
                type="file"
                accept="application/json"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void onImportData(file)
                  event.currentTarget.value = ''
                }}
              />
              <button onClick={() => fileInputRef.current?.click()}>导入数据</button>
            </>
          ) : null}
          {onExportData ? <button onClick={onExportData}>导出数据</button> : null}
        </div>
      </section>
    </section>
  )
}
