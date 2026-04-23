import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react'
import { useI18n } from '../modules/i18n/I18nContext'
import { Button } from './Button'
import { FieldGroup } from './FieldGroup'
import { useDesktopTextEditingBridge } from '../hooks/useDesktopTextEditingBridge'
import {
  loadMcpSettings,
  saveMcpSettings,
  mcpStartServer,
  mcpTestServer,
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

type McpServerDraftForm = {
  id: string
  order: number
  name: string
  groupId: string
  enabled: boolean
  transport: McpServerCfg['transport']
  command: string
  args: string
  env: string
  url: string
  headers: string
}

function serverToForm(srv: McpServerCfg): McpServerDraftForm {
  return {
    id: srv.id,
    order: srv.order,
    name: srv.name ?? '',
    groupId: srv.groupId ?? '',
    enabled: srv.enabled,
    transport: srv.transport,
    command: srv.command ?? '',
    args: (srv.args ?? []).join(' '),
    env: srv.env ? Object.entries(srv.env).map(([k, v]) => `${k}=${v}`).join('\n') : '',
    url: srv.url ?? '',
    headers: srv.headers
      ? Object.entries(srv.headers).map(([k, v]) => `${k}: ${v}`).join('\n')
      : '',
  }
}

function emptyServerForm(order: number): McpServerDraftForm {
  return {
    id: `srv-${uuid()}`,
    order,
    name: '',
    groupId: '',
    enabled: true,
    transport: 'stdio',
    command: '',
    args: '',
    env: '',
    url: '',
    headers: '',
  }
}

function parseEnvMap(value: string): Record<string, string> | null {
  const env: Record<string, string> = {}
  for (const line of value.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const eqIdx = trimmed.indexOf('=')
    if (eqIdx > 0) {
      env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim()
      continue
    }

    const jsonLike = trimmed.match(/^["']?([^"':=]+)["']?\s*:\s*["']?(.*?)["']?\s*,?$/)
    if (!jsonLike) continue

    const key = jsonLike[1]?.trim()
    const rawValue = jsonLike[2] ?? ''
    const normalizedValue = rawValue.replace(/["']\s*,?\s*$/, '').trim()
    if (key) {
      env[key] = normalizedValue
    }
  }
  return Object.keys(env).length > 0 ? env : null
}

function parseHeadersMap(value: string): Record<string, string> | null {
  const headers: Record<string, string> = {}
  for (const line of value.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const jsonLike = trimmed.match(/^["']?([^"':]+)["']?\s*:\s*["']?(.*?)["']?\s*,?$/)
    if (!jsonLike) continue

    const key = jsonLike[1]?.trim()
    const rawValue = jsonLike[2] ?? ''
    const normalizedValue = rawValue.replace(/["']\s*,?\s*$/, '').trim()

    if (key) {
      headers[key] = normalizedValue
    }
  }
  return Object.keys(headers).length > 0 ? headers : null
}

function parseArgsInput(value: string): string[] | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        const args = parsed
          .map((item) => (typeof item === 'string' ? item.trim() : String(item).trim()))
          .filter(Boolean)
        return args.length > 0 ? args : null
      }
    } catch {
      // Fall through to plain whitespace-separated parsing.
    }
  }

  const args = trimmed.split(/\s+/).filter(Boolean)
  return args.length > 0 ? args : null
}

function formToServer(form: McpServerDraftForm): McpServerCfg {
  return {
    id: form.id,
    order: form.order,
    name: form.name,
    groupId: form.groupId || null,
    enabled: form.enabled,
    transport: form.transport,
    command: form.command.trim() ? form.command : null,
    args: parseArgsInput(form.args),
    env: parseEnvMap(form.env),
    url: form.url.trim() ? form.url : null,
    headers: parseHeadersMap(form.headers),
  }
}

export const McpSettingsDialog: FC<McpSettingsDialogProps> = ({ open, onClose }) => {
  const { t } = useI18n()
  const [settings, setSettings] = useState<McpSettingsCfg>({ groups: [], servers: [] })
  const [runningServers, setRunningServers] = useState<McpRunningServerInfo[]>([])
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null)
  const [draftForm, setDraftForm] = useState<McpServerDraftForm>(() => emptyServerForm(0))
  const [isEditing, setIsEditing] = useState(false)
  const [error, setError] = useState('')
  const [testResult, setTestResult] = useState('')
  const [groupDraft, setGroupDraft] = useState('')
  const [showGroupInput, setShowGroupInput] = useState(false)
  const [, setActiveField] = useState<keyof McpServerDraftForm | null>(null)
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

  const { handleKeyDownCapture } = useDesktopTextEditingBridge({
    enabled: open,
    onPasteError: (message) => {
      console.warn('[McpSettingsDialog] native paste error:', message)
    },
  })

  const isServerRunning = useCallback(
    (id: string) => runningServers.some((s) => s.id === id),
    [runningServers],
  )

  const handleSelectServer = useCallback(
    (srv: McpServerCfg) => {
      setSelectedServerId(srv.id)
      setDraftForm(serverToForm(srv))
      setIsEditing(true)
      setError('')
      setTestResult('')
    },
    [],
  )

  const handleNewServer = useCallback(() => {
    setDraftForm(emptyServerForm(settings.servers.length))
    setSelectedServerId(null)
    setIsEditing(false)
    setError('')
    setTestResult('')
  }, [settings.servers.length])

  const handleSaveDraft = useCallback(() => {
    const draft = formToServer(draftForm)
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
  }, [draftForm, t])

  const handleDeleteServer = useCallback(
    (id: string) => {
      setSettings((prev) => ({
        ...prev,
        servers: prev.servers.filter((s) => s.id !== id),
      }))
      if (selectedServerId === id) {
        setSelectedServerId(null)
        setIsEditing(false)
        setDraftForm(emptyServerForm(0))
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
    const draft = formToServer(draftForm)
    setError('')
    setTestResult('')
    try {
      const tools = await mcpTestServer(draft)
      setTestResult(t('mcp.testSuccess', { count: String(tools.length) }))
    } catch (e) {
      setError(String(e))
    }
  }, [draftForm, t])

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

  const updateDraftForm = useCallback(
    <K extends keyof McpServerDraftForm>(field: K, value: McpServerDraftForm[K]) => {
      setDraftForm((prev) => ({ ...prev, [field]: value }))
    },
    [],
  )

  if (!open) return null

  return (
    <div className="modal-backdrop">
      <div className="modal modal-mcp-settings" onKeyDownCapture={handleKeyDownCapture}>
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
                  value={draftForm.name}
                  onFocus={() => setActiveField('name')}
                  onChange={(e) => updateDraftForm('name', e.target.value)}
                  placeholder="e.g. Filesystem"
                />
              </FieldGroup>

              <FieldGroup label={t('mcp.group')}>
                <select
                  className="field-select"
                  value={draftForm.groupId}
                  onChange={(e) => updateDraftForm('groupId', e.target.value)}
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
                  value={draftForm.transport}
                  onChange={(e) => updateDraftForm('transport', e.target.value as McpServerCfg['transport'])}
                >
                  <option value="stdio">stdio</option>
                  <option value="streamable-http">Streamable HTTP</option>
                  <option value="sse">SSE</option>
                </select>
              </FieldGroup>

              {draftForm.transport === 'stdio' && (
                <>
                  <FieldGroup label={t('mcp.command')}>
                    <input
                      className="field-input"
                      value={draftForm.command}
                      onFocus={() => setActiveField('command')}
                      onChange={(e) => updateDraftForm('command', e.target.value)}
                      placeholder="e.g. npx"
                    />
                  </FieldGroup>
                  <FieldGroup label={t('mcp.args')}>
                    <input
                      className="field-input"
                      value={draftForm.args}
                      onFocus={() => setActiveField('args')}
                      onChange={(e) => updateDraftForm('args', e.target.value)}
                      placeholder="-y @modelcontextprotocol/server-filesystem /path"
                    />
                  </FieldGroup>
                  <FieldGroup label={t('mcp.env')}>
                    <textarea
                      className="field-textarea"
                      rows={2}
                      value={draftForm.env}
                      onFocus={() => setActiveField('env')}
                      onChange={(e) => updateDraftForm('env', e.target.value)}
                      placeholder="KEY=value"
                    />
                  </FieldGroup>
                  <div className="mcp-stdio-help">{t('mcp.stdioVariables')}</div>
                </>
              )}

              {draftForm.transport === 'sse' && (
                <>
                  <FieldGroup label="URL">
                    <input
                      className="field-input"
                      value={draftForm.url}
                      onFocus={() => setActiveField('url')}
                      onChange={(e) => updateDraftForm('url', e.target.value)}
                      placeholder="http://localhost:3001/sse"
                    />
                  </FieldGroup>
                  <FieldGroup label="Headers">
                    <textarea
                      className="field-textarea"
                      rows={2}
                      value={draftForm.headers}
                      onFocus={() => setActiveField('headers')}
                      onChange={(e) => updateDraftForm('headers', e.target.value)}
                      placeholder="Authorization: Bearer xxx"
                    />
                  </FieldGroup>
                </>
              )}

              {draftForm.transport === 'streamable-http' && (
                <>
                  <FieldGroup label="URL">
                    <input
                      className="field-input"
                      value={draftForm.url}
                      onFocus={() => setActiveField('url')}
                      onChange={(e) => updateDraftForm('url', e.target.value)}
                      placeholder="http://localhost:3001/mcp"
                    />
                  </FieldGroup>
                  <FieldGroup label="Headers">
                    <textarea
                      className="field-textarea"
                      rows={2}
                      value={draftForm.headers}
                      onFocus={() => setActiveField('headers')}
                      onChange={(e) => updateDraftForm('headers', e.target.value)}
                      placeholder="Authorization: Bearer xxx"
                    />
                  </FieldGroup>
                </>
              )}

              <FieldGroup label={t('mcp.enabled')} inline>
                <input
                  type="checkbox"
                  checked={draftForm.enabled}
                  onChange={(e) => updateDraftForm('enabled', e.target.checked)}
                />
              </FieldGroup>

              {error && <div className="form-error">{error}</div>}
              {testResult && !error && <div className="form-success">{testResult}</div>}
            </div>

            <div className="mcp-form-actions">
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
