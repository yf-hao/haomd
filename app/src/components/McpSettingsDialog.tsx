import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react'
import { useI18n } from '../modules/i18n/I18nContext'
import { Button } from './Button'
import { FieldGroup } from './FieldGroup'
import {
  loadMcpSettings,
  saveMcpSettings,
  mcpStartServer,
  mcpStopServer,
  mcpListRunningServers,
  type McpGroupCfg,
  type McpServerCfg,
  type McpSettingsCfg,
  type McpRunningServerInfo,
} from '../modules/ai/config/mcpSettingsRepo'

export type McpSettingsDialogProps = {
  open: boolean
  onClose: () => void
}

function uuid(): string {
  return crypto.randomUUID()
}

const EMPTY_SERVER_DRAFT: Omit<McpServerCfg, 'id' | 'order'> = {
  name: '',
  groupId: null,
  enabled: true,
  transport: 'stdio',
  command: null,
  args: null,
  env: null,
  url: null,
  headers: null,
}

export const McpSettingsDialog: FC<McpSettingsDialogProps> = ({ open, onClose }) => {
  const { t } = useI18n()
  const [settings, setSettings] = useState<McpSettingsCfg>({ groups: [], servers: [] })
  const [runningServers, setRunningServers] = useState<McpRunningServerInfo[]>([])
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null)
  const [draft, setDraft] = useState<McpServerCfg>({ ...EMPTY_SERVER_DRAFT, id: '', order: 0 })
  const [isEditing, setIsEditing] = useState(false)
  const [error, setError] = useState('')
  const [testResult, setTestResult] = useState('')
  const [groupDraft, setGroupDraft] = useState('')
  const [showGroupInput, setShowGroupInput] = useState(false)
  const loadedRef = useRef(false)

  // Load settings when opened
  useEffect(() => {
    if (!open) {
      loadedRef.current = false
      return
    }
    void (async () => {
      const cfg = await loadMcpSettings()
      setSettings(cfg)
      const running = await mcpListRunningServers()
      setRunningServers(running)
      loadedRef.current = true
    })()
  }, [open])

  // Escape key
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  const isServerRunning = useCallback(
    (id: string) => runningServers.some((s) => s.id === id),
    [runningServers],
  )

  const handleSelectServer = useCallback(
    (srv: McpServerCfg) => {
      setSelectedServerId(srv.id)
      setDraft({ ...srv })
      setIsEditing(true)
      setError('')
      setTestResult('')
    },
    [],
  )

  const handleNewServer = useCallback(() => {
    const id = `srv-${uuid()}`
    setDraft({ ...EMPTY_SERVER_DRAFT, id, order: settings.servers.length })
    setSelectedServerId(null)
    setIsEditing(false)
    setError('')
    setTestResult('')
  }, [settings.servers.length])

  const handleSaveDraft = useCallback(() => {
    if (!draft.name.trim()) {
      setError(t('mcp.nameRequired'))
      return
    }
    if (draft.transport === 'stdio' && !draft.command?.trim()) {
      setError(t('mcp.commandRequired'))
      return
    }
    if (draft.transport === 'sse' && !draft.url?.trim()) {
      setError(t('mcp.urlRequired'))
      return
    }
    if (draft.transport === 'streamable-http' && !draft.url?.trim()) {
      setError(t('mcp.urlRequired'))
      return
    }

    setSettings((prev) => {
      const existing = prev.servers.findIndex((s) => s.id === draft.id)
      const servers =
        existing >= 0
          ? prev.servers.map((s) => (s.id === draft.id ? draft : s))
          : [...prev.servers, draft]
      return { ...prev, servers }
    })
    setSelectedServerId(draft.id)
    setIsEditing(true)
    setError('')
  }, [draft, t])

  const handleDeleteServer = useCallback(
    (id: string) => {
      setSettings((prev) => ({
        ...prev,
        servers: prev.servers.filter((s) => s.id !== id),
      }))
      if (selectedServerId === id) {
        setSelectedServerId(null)
        setIsEditing(false)
        setDraft({ ...EMPTY_SERVER_DRAFT, id: '', order: 0 })
      }
    },
    [selectedServerId],
  )

  const handleToggleEnabled = useCallback((id: string) => {
    setSettings((prev) => ({
      ...prev,
      servers: prev.servers.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)),
    }))
  }, [])

  const handleTestConnection = useCallback(async () => {
    setError('')
    setTestResult('')
    try {
      const tools = await mcpStartServer(draft.id)
      setTestResult(t('mcp.testSuccess', { count: String(tools.length) }))
      await mcpStopServer(draft.id)
    } catch (e) {
      setError(String(e))
    }
  }, [draft.id, t])

  const handleStartServer = useCallback(
    async (id: string) => {
      try {
        await mcpStartServer(id)
        const running = await mcpListRunningServers()
        setRunningServers(running)
      } catch (e) {
        setError(String(e))
      }
    },
    [],
  )

  const handleStopServer = useCallback(
    async (id: string) => {
      try {
        await mcpStopServer(id)
        const running = await mcpListRunningServers()
        setRunningServers(running)
      } catch (e) {
        setError(String(e))
      }
    },
    [],
  )

  const handleAddGroup = useCallback(() => {
    if (!groupDraft.trim()) return
    const group: McpGroupCfg = {
      id: `grp-${uuid()}`,
      name: groupDraft.trim(),
      order: settings.groups.length,
    }
    setSettings((prev) => ({ ...prev, groups: [...prev.groups, group] }))
    setGroupDraft('')
    setShowGroupInput(false)
  }, [groupDraft, settings.groups.length])

  const handleDeleteGroup = useCallback((id: string) => {
    setSettings((prev) => ({
      ...prev,
      groups: prev.groups.filter((g) => g.id !== id),
      servers: prev.servers.map((s) => (s.groupId === id ? { ...s, groupId: null } : s)),
    }))
  }, [])

  const handleSaveAll = useCallback(async () => {
    await saveMcpSettings(settings)
    onClose()
  }, [settings, onClose])

  const handleCancel = useCallback(() => {
    onClose()
  }, [onClose])

  // Group servers by group
  const groupedServers = useMemo(() => {
    const map = new Map<string | null, McpServerCfg[]>()
    map.set(null, [])
    for (const g of settings.groups) {
      map.set(g.id, [])
    }
    for (const s of settings.servers) {
      const key = s.groupId ?? null
      if (!map.has(key)) map.set(null, [])
      map.get(key)!.push(s)
    }
    return map
  }, [settings])

  const updateDraft = useCallback(
    (field: keyof McpServerCfg, value: unknown) => {
      setDraft((prev) => ({ ...prev, [field]: value }))
    },
    [],
  )

  const argsString = useMemo(() => (draft.args ?? []).join(' '), [draft.args])
  const envString = useMemo(() => {
    if (!draft.env) return ''
    return Object.entries(draft.env)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')
  }, [draft.env])

  const headersString = useMemo(() => {
    if (!draft.headers) return ''
    return Object.entries(draft.headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')
  }, [draft.headers])

  if (!open) return null

  return (
    <div className="modal-backdrop">
      <div className="modal modal-mcp-settings">
        <div className="modal-title">{t('mcp.title')}</div>

        <div className="modal-content mcp-settings-body">
          {/* Left: Server form */}
          <div className="mcp-settings-column-left">
            <div className="providers-header">
              {isEditing ? t('mcp.editServer') : t('mcp.newServer')}
            </div>

            <div className="mcp-form-scroll">
              <FieldGroup label={t('mcp.serverName')}>
                <input
                  className="field-input"
                  value={draft.name}
                  onChange={(e) => updateDraft('name', e.target.value)}
                  placeholder="e.g. Filesystem"
                />
              </FieldGroup>

              <FieldGroup label={t('mcp.group')}>
                <select
                  className="field-select"
                  value={draft.groupId ?? ''}
                  onChange={(e) => updateDraft('groupId', e.target.value || null)}
                >
                  <option value="">{t('mcp.noGroup')}</option>
                  {settings.groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </FieldGroup>

              <FieldGroup label={t('mcp.transport')}>
                <select
                  className="field-select"
                  value={draft.transport}
                  onChange={(e) => updateDraft('transport', e.target.value)}
                >
                  <option value="stdio">stdio</option>
                  <option value="streamable-http">Streamable HTTP</option>
                  <option value="sse">SSE</option>
                </select>
              </FieldGroup>

              {draft.transport === 'stdio' && (
                <>
                  <FieldGroup label={t('mcp.command')}>
                    <input
                      className="field-input"
                      value={draft.command ?? ''}
                      onChange={(e) => updateDraft('command', e.target.value)}
                      placeholder="e.g. npx"
                    />
                  </FieldGroup>
                  <FieldGroup label={t('mcp.args')}>
                    <input
                      className="field-input"
                      value={argsString}
                      onChange={(e) =>
                        updateDraft(
                          'args',
                          e.target.value
                            .split(/\s+/)
                            .filter(Boolean),
                        )
                      }
                      placeholder="-y @modelcontextprotocol/server-filesystem /path"
                    />
                  </FieldGroup>
                  <FieldGroup label={t('mcp.env')}>
                    <textarea
                      className="field-textarea"
                      rows={2}
                      value={envString}
                      onChange={(e) => {
                        const env: Record<string, string> = {}
                        for (const line of e.target.value.split('\n')) {
                          const idx = line.indexOf('=')
                          if (idx > 0) env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
                        }
                        updateDraft('env', Object.keys(env).length > 0 ? env : null)
                      }}
                      placeholder="KEY=value"
                    />
                  </FieldGroup>
                </>
              )}

              {draft.transport === 'sse' && (
                <>
                  <FieldGroup label="URL">
                    <input
                      className="field-input"
                      value={draft.url ?? ''}
                      onChange={(e) => updateDraft('url', e.target.value)}
                      placeholder="http://localhost:3001/sse"
                    />
                  </FieldGroup>
                  <FieldGroup label="Headers">
                    <textarea
                      className="field-textarea"
                      rows={2}
                      value={headersString}
                      onChange={(e) => {
                        const headers: Record<string, string> = {}
                        for (const line of e.target.value.split('\n')) {
                          const idx = line.indexOf(':')
                          if (idx > 0) headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
                        }
                        updateDraft('headers', Object.keys(headers).length > 0 ? headers : null)
                      }}
                      placeholder="Authorization: Bearer xxx"
                    />
                  </FieldGroup>
                </>
              )}

              {draft.transport === 'streamable-http' && (
                <>
                  <FieldGroup label="URL">
                    <input
                      className="field-input"
                      value={draft.url ?? ''}
                      onChange={(e) => updateDraft('url', e.target.value)}
                      placeholder="http://localhost:3001/mcp"
                    />
                  </FieldGroup>
                  <FieldGroup label="Headers">
                    <textarea
                      className="field-textarea"
                      rows={2}
                      value={headersString}
                      onChange={(e) => {
                        const headers: Record<string, string> = {}
                        for (const line of e.target.value.split('\n')) {
                          const idx = line.indexOf(':')
                          if (idx > 0) headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
                        }
                        updateDraft('headers', Object.keys(headers).length > 0 ? headers : null)
                      }}
                      placeholder="Authorization: Bearer xxx"
                    />
                  </FieldGroup>
                </>
              )}

              <FieldGroup label={t('mcp.enabled')} inline>
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => updateDraft('enabled', e.target.checked)}
                />
              </FieldGroup>

              {error && <div className="form-error">{error}</div>}
              {testResult && !error && <div className="form-success">{testResult}</div>}

              <div className="ai-settings-form-actions">
                <Button type="button" variant="tertiary" onClick={handleNewServer}>
                  {t('mcp.resetForm')}
                </Button>
                <Button type="button" variant="secondary" onClick={handleTestConnection}>
                  {t('mcp.testConnection')}
                </Button>
                <Button type="button" variant="primary" onClick={handleSaveDraft}>
                  {isEditing ? t('mcp.updateServer') : t('mcp.addServer')}
                </Button>
              </div>
            </div>
          </div>

          {/* Right: Server list + Groups */}
          <div className="mcp-settings-column-right">
            {/* Groups management */}
            <div className="mcp-groups-section">
              <div className="providers-header">
                {t('mcp.groups')}
                <button
                  className="mcp-add-group-btn"
                  title={t('mcp.addGroup')}
                  onClick={() => setShowGroupInput(true)}
                >
                  +
                </button>
              </div>
              {showGroupInput && (
                <div className="mcp-group-input-row">
                  <input
                    className="field-input"
                    value={groupDraft}
                    onChange={(e) => setGroupDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddGroup()
                      if (e.key === 'Escape') setShowGroupInput(false)
                    }}
                    placeholder={t('mcp.groupName')}
                    autoFocus
                  />
                  <Button variant="primary" onClick={handleAddGroup}>
                    {t('common.save')}
                  </Button>
                </div>
              )}
              <div className="mcp-group-tags">
                {settings.groups.map((g) => (
                  <span key={g.id} className="mcp-group-tag">
                    {g.name}
                    <button
                      className="mcp-group-tag-delete"
                      onClick={() => handleDeleteGroup(g.id)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {/* Server list */}
            <div className="providers-header">{t('mcp.serverList')}</div>
            <div className="mcp-server-list">
              {settings.servers.length === 0 ? (
                <div className="providers-empty">{t('mcp.noServers')}</div>
              ) : (
                <>
                  {/* Ungrouped first */}
                  {(groupedServers.get(null) ?? []).length > 0 && (
                    <div className="mcp-server-group">
                      {(groupedServers.get(null) ?? []).map((srv) => (
                        <ServerItem
                          key={srv.id}
                          server={srv}
                          selected={selectedServerId === srv.id}
                          running={isServerRunning(srv.id)}
                          onSelect={handleSelectServer}
                          onDelete={handleDeleteServer}
                          onToggleEnabled={handleToggleEnabled}
                          onStart={handleStartServer}
                          onStop={handleStopServer}
                        />
                      ))}
                    </div>
                  )}
                  {/* Grouped */}
                  {settings.groups.map((g) => {
                    const servers = groupedServers.get(g.id) ?? []
                    if (servers.length === 0) return null
                    return (
                      <div key={g.id} className="mcp-server-group">
                        <div className="mcp-group-label">{g.name}</div>
                        {servers.map((srv) => (
                          <ServerItem
                            key={srv.id}
                            server={srv}
                            selected={selectedServerId === srv.id}
                            running={isServerRunning(srv.id)}
                            onSelect={handleSelectServer}
                            onDelete={handleDeleteServer}
                            onToggleEnabled={handleToggleEnabled}
                            onStart={handleStartServer}
                            onStop={handleStopServer}
                          />
                        ))}
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <Button variant="tertiary" onClick={handleCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={handleSaveAll}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Server list item ───────────────────────────────────────────────

type ServerItemProps = {
  server: McpServerCfg
  selected: boolean
  running: boolean
  onSelect: (srv: McpServerCfg) => void
  onDelete: (id: string) => void
  onToggleEnabled: (id: string) => void
  onStart: (id: string) => void
  onStop: (id: string) => void
}

const ServerItem: FC<ServerItemProps> = ({
  server,
  selected,
  running,
  onSelect,
  onDelete,
  onToggleEnabled,
  onStart,
  onStop,
}) => {
  return (
    <div
      className={`mcp-server-item ${selected ? 'selected' : ''} ${!server.enabled ? 'disabled' : ''}`}
      onClick={() => onSelect(server)}
    >
      <div className="mcp-server-item-header">
        <span className="mcp-server-name">{server.name || 'Unnamed'}</span>
        <span className={`mcp-server-transport-badge ${server.transport}`}>{server.transport}</span>
        {running && <span className="mcp-server-running-badge">●</span>}
      </div>
      <div className="mcp-server-item-meta">
        {server.transport === 'stdio' ? server.command ?? '' : server.url ?? ''}
      </div>
      <div className="mcp-server-item-actions" onClick={(e) => e.stopPropagation()}>
        <label className="mcp-toggle-label">
          <input
            type="checkbox"
            checked={server.enabled}
            onChange={() => onToggleEnabled(server.id)}
          />
        </label>
        {server.enabled && !running && (
          <button className="mcp-action-btn start" onClick={() => onStart(server.id)} title="Start">
            ▶
          </button>
        )}
        {running && (
          <button className="mcp-action-btn stop" onClick={() => onStop(server.id)} title="Stop">
            ■
          </button>
        )}
        <button
          className="mcp-action-btn delete"
          onClick={() => onDelete(server.id)}
          title="Delete"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
