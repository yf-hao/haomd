import { useEffect, useState } from 'react'
import type { WebLiteSyncSettings } from '../domain/models'

function validateSyncInput(input: {
  endpoint: string
  username: string
  password: string
  remoteRoot: string
}): string | null {
  const hasAnyValue = [input.endpoint, input.username, input.password, input.remoteRoot].some((value) => value.trim())
  if (!hasAnyValue) return null
  if (!input.endpoint.trim()) return '同步地址不能为空'
  if (!/^https?:\/\//i.test(input.endpoint.trim())) return '同步地址需要以 http:// 或 https:// 开头'
  if (!input.username.trim()) return '同步用户名不能为空'
  if (!input.password.trim()) return '同步密码不能为空'
  if (!input.remoteRoot.trim()) return '远端目录不能为空'
  return null
}

export function SyncSettingsSection({
  settings,
  onSave,
  onExportSnapshot,
  onPush,
  onPull,
  onSync,
}: {
  settings: WebLiteSyncSettings | null | undefined
  onSave: (settings: WebLiteSyncSettings | null) => Promise<void> | void
  onExportSnapshot?: () => void
  onPush?: () => Promise<void> | void
  onPull?: () => Promise<void> | void
  onSync?: () => Promise<void> | void
}) {
  const [endpoint, setEndpoint] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remoteRoot, setRemoteRoot] = useState('')

  useEffect(() => {
    setEndpoint(settings?.endpoint ?? '')
    setUsername(settings?.username ?? '')
    setPassword(settings?.password ?? '')
    setRemoteRoot(settings?.remoteRoot ?? '')
  }, [settings])

  const validationError = validateSyncInput({ endpoint, username, password, remoteRoot })
  const hasAnyValue = [endpoint, username, password, remoteRoot].some((value) => value.trim())

  return (
    <section className="web-settings-section">
      <div className="web-settings-section-header">
        <h2>同步设置</h2>
      </div>
      <label>
        Provider
        <input value="WebDAV" readOnly />
      </label>
      <label>
        Endpoint
        <input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://webdav.example.com/remote.php/dav/files/user" />
      </label>
      <label>
        用户名
        <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="user" />
      </label>
      <label>
        密码
        <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="password" type="password" />
      </label>
      <label>
        远端目录
        <input value={remoteRoot} onChange={(event) => setRemoteRoot(event.target.value)} placeholder="/haomd-lite" />
      </label>
      <div className="web-settings-hint">
        当前支持手动上传、下载和双向同步。同步快照导出仍保留，用于调试或迁移同步数据结构。
      </div>
      {settings?.lastSyncedAt ? (
        <div className="web-settings-hint">上次同步：{new Date(settings.lastSyncedAt).toLocaleString()}</div>
      ) : null}
      {validationError ? <div className="web-settings-error">{validationError}</div> : null}
      <div className="web-settings-actions">
        <button
          disabled={!!validationError}
          onClick={() =>
            void onSave(
              hasAnyValue
                ? {
                    provider: 'webdav',
                    endpoint: endpoint.trim(),
                    username: username.trim(),
                    password,
                    remoteRoot: remoteRoot.trim(),
                    lastSyncedAt: settings?.lastSyncedAt,
                  }
                : null,
            )
          }
        >
          保存同步配置
        </button>
        <button disabled={!!validationError} onClick={() => void onSave(null)}>
          清空同步配置
        </button>
        {onExportSnapshot ? <button onClick={onExportSnapshot}>导出同步快照</button> : null}
        {onPush ? <button disabled={!!validationError || !hasAnyValue} onClick={() => void onPush()}>上传到 WebDAV</button> : null}
        {onPull ? <button disabled={!!validationError || !hasAnyValue} onClick={() => void onPull()}>从 WebDAV 下载</button> : null}
        {onSync ? <button disabled={!!validationError || !hasAnyValue} onClick={() => void onSync()}>双向同步</button> : null}
      </div>
    </section>
  )
}
