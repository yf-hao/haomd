import type { AiSettingsState } from '../../modules/ai/settings'
import type { WebLiteChatSession, WebLiteNote, WebLiteSyncSettings } from '../domain/models'
import { parseMarkdownToNote } from './webNoteMarkdownService'
import { createWebLiteSyncSnapshot, type WebLiteSyncManifest } from './webSyncManifestService'

type SyncSummary = {
  sessions: number
  notes: number
}

type WebLiteRemoteState = {
  manifest: WebLiteSyncManifest
  notes: WebLiteNote[]
}

type WebLiteSyncMode = 'push' | 'pull' | 'sync'

export type WebLiteSyncResult = {
  mode: WebLiteSyncMode
  syncedAt: number
  sessions: number
  notes: number
}

function buildBasicAuthHeader(settings: WebLiteSyncSettings): string {
  return `Basic ${btoa(`${settings.username}:${settings.password}`)}`
}

function normalizeRemoteRoot(remoteRoot: string): string {
  const trimmed = remoteRoot.trim().replace(/^\/+|\/+$/g, '')
  return trimmed ? `/${trimmed}` : ''
}

function buildRemoteUrl(settings: WebLiteSyncSettings, path: string): string {
  const base = settings.endpoint.replace(/\/+$/, '')
  const root = normalizeRemoteRoot(settings.remoteRoot)
  const normalizedPath = path.replace(/^\/+/, '')
  return `${base}${root}/${normalizedPath}`
}

async function requestWebDav(settings: WebLiteSyncSettings, path: string, init?: RequestInit): Promise<Response> {
  return fetch(buildRemoteUrl(settings, path), {
    ...init,
    headers: {
      Authorization: buildBasicAuthHeader(settings),
      ...(init?.headers ?? {}),
    },
  })
}

async function ensureCollection(settings: WebLiteSyncSettings, path: string): Promise<void> {
  const response = await requestWebDav(settings, path, { method: 'MKCOL' })
  if ([200, 201, 204, 301, 405].includes(response.status)) return
  if (response.status === 409) {
    throw new Error(`无法创建远端目录：${path}。请先确认上级目录存在。`)
  }
  throw new Error(`创建远端目录失败：${response.status}`)
}

async function uploadJson(settings: WebLiteSyncSettings, path: string, payload: unknown): Promise<void> {
  const response = await requestWebDav(settings, path, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json;charset=utf-8',
    },
    body: JSON.stringify(payload, null, 2),
  })
  if (!response.ok) {
    throw new Error(`上传 ${path} 失败：${response.status}`)
  }
}

async function uploadText(settings: WebLiteSyncSettings, path: string, content: string, contentType: string): Promise<void> {
  const response = await requestWebDav(settings, path, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
    },
    body: content,
  })
  if (!response.ok) {
    throw new Error(`上传 ${path} 失败：${response.status}`)
  }
}

async function downloadJson<T>(settings: WebLiteSyncSettings, path: string): Promise<T | null> {
  const response = await requestWebDav(settings, path)
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`下载 ${path} 失败：${response.status}`)
  }
  return response.json() as Promise<T>
}

async function downloadText(settings: WebLiteSyncSettings, path: string): Promise<string | null> {
  const response = await requestWebDav(settings, path)
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`下载 ${path} 失败：${response.status}`)
  }
  return response.text()
}

function isDeleted<T extends { deletedAt?: number }>(item: T): boolean {
  return typeof item.deletedAt === 'number'
}

function createConflictTitle(title: string): string {
  const base = title.trim() || '未命名'
  return `${base}（冲突副本）`
}

function areSessionsEquivalent(left: WebLiteChatSession, right: WebLiteChatSession): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function areNotesEquivalent(left: WebLiteNote, right: WebLiteNote): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function mergeSessions(local: WebLiteChatSession[], remote: WebLiteChatSession[], baseline: number): WebLiteChatSession[] {
  const merged = new Map<string, WebLiteChatSession>()
  const allIds = new Set([...local.map((item) => item.id), ...remote.map((item) => item.id)])

  for (const id of allIds) {
    const localItem = local.find((item) => item.id === id) ?? null
    const remoteItem = remote.find((item) => item.id === id) ?? null
    if (!localItem && remoteItem) {
      merged.set(id, remoteItem)
      continue
    }
    if (localItem && !remoteItem) {
      merged.set(id, localItem)
      continue
    }
    if (!localItem || !remoteItem) continue

    const localChanged = localItem.updatedAt > baseline
    const remoteChanged = remoteItem.updatedAt > baseline
    if (localChanged && remoteChanged && !areSessionsEquivalent(localItem, remoteItem)) {
      const primary = localItem.updatedAt >= remoteItem.updatedAt ? localItem : remoteItem
      const secondary = primary === localItem ? remoteItem : localItem
      merged.set(id, primary)
      if (!isDeleted(secondary)) {
        merged.set(`${secondary.id}:conflict:${secondary.updatedAt}`, {
          ...secondary,
          id: crypto.randomUUID(),
          title: createConflictTitle(secondary.title),
          updatedAt: Date.now(),
        })
      }
      continue
    }

    if (remoteItem.updatedAt >= localItem.updatedAt) merged.set(id, remoteItem)
    else merged.set(id, localItem)
  }

  return [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

function mergeNotes(local: WebLiteNote[], remote: WebLiteNote[], baseline: number): WebLiteNote[] {
  const merged = new Map<string, WebLiteNote>()
  const allIds = new Set([...local.map((item) => item.id), ...remote.map((item) => item.id)])

  for (const id of allIds) {
    const localItem = local.find((item) => item.id === id) ?? null
    const remoteItem = remote.find((item) => item.id === id) ?? null
    if (!localItem && remoteItem) {
      merged.set(id, remoteItem)
      continue
    }
    if (localItem && !remoteItem) {
      merged.set(id, localItem)
      continue
    }
    if (!localItem || !remoteItem) continue

    const localChanged = localItem.updatedAt > baseline
    const remoteChanged = remoteItem.updatedAt > baseline
    if (localChanged && remoteChanged && !areNotesEquivalent(localItem, remoteItem)) {
      const primary = localItem.updatedAt >= remoteItem.updatedAt ? localItem : remoteItem
      const secondary = primary === localItem ? remoteItem : localItem
      merged.set(id, primary)
      if (!isDeleted(secondary)) {
        merged.set(`${secondary.id}:conflict:${secondary.updatedAt}`, {
          ...secondary,
          id: crypto.randomUUID(),
          title: createConflictTitle(secondary.title),
          updatedAt: Date.now(),
        })
      }
      continue
    }

    if (remoteItem.updatedAt >= localItem.updatedAt) merged.set(id, remoteItem)
    else merged.set(id, localItem)
  }

  return [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

function mergeAiSettings(local: AiSettingsState | null, remote: AiSettingsState | null): AiSettingsState | null {
  return remote?.providers?.length ? remote : local
}

function summarizeState(input: { sessions: WebLiteChatSession[]; notes: WebLiteNote[] }): SyncSummary {
  return {
    sessions: input.sessions.filter((item) => !item.deletedAt).length,
    notes: input.notes.filter((item) => !item.deletedAt).length,
  }
}

async function loadRemoteState(sync: WebLiteSyncSettings): Promise<WebLiteRemoteState | null> {
  const manifest = await downloadJson<WebLiteSyncManifest>(sync, 'manifest.json')
  if (!manifest) return null

  const notes = await Promise.all(
    manifest.notes.map(async (entry) => {
      if (entry.deletedAt) {
        return {
          id: entry.id,
          title: entry.title,
          content: '',
          createdAt: entry.updatedAt,
          updatedAt: entry.updatedAt,
          deletedAt: entry.deletedAt,
        } satisfies WebLiteNote
      }
      const markdown = await downloadText(sync, `notes/${entry.fileName}`)
      if (markdown == null) {
        throw new Error(`远端笔记缺失：notes/${entry.fileName}`)
      }
      const parsed = parseMarkdownToNote({
        fileName: entry.fileName,
        content: markdown,
      })
      return {
        id: entry.id,
        title: entry.title || parsed.title,
        content: parsed.content,
        createdAt: entry.updatedAt,
        updatedAt: entry.updatedAt,
        deletedAt: entry.deletedAt,
      } satisfies WebLiteNote
    }),
  )

  return {
    manifest,
    notes,
  }
}

async function uploadRemoteState(input: {
  sync: WebLiteSyncSettings
  sessions: WebLiteChatSession[]
  notes: WebLiteNote[]
  aiSettings: AiSettingsState | null
}): Promise<void> {
  const snapshot = createWebLiteSyncSnapshot({
    sessions: input.sessions,
    notes: input.notes,
    aiSettings: input.aiSettings,
    syncSettings: input.sync,
  })

  await ensureCollection(input.sync, '')
  await ensureCollection(input.sync, 'notes')
  await uploadJson(input.sync, 'manifest.json', snapshot.manifest)
  await Promise.all(
    snapshot.noteFiles
      .filter((file) => !input.notes.find((note) => note.id === file.id)?.deletedAt)
      .map((file) => uploadText(input.sync, `notes/${file.fileName}`, file.content, 'text/markdown;charset=utf-8')),
  )
}

export async function pushWebLiteToWebDav(input: {
  sync: WebLiteSyncSettings
  sessions: WebLiteChatSession[]
  notes: WebLiteNote[]
  aiSettings: AiSettingsState | null
}): Promise<WebLiteSyncResult> {
  await uploadRemoteState(input)
  const syncedAt = Date.now()
  const summary = summarizeState(input)
  return {
    mode: 'push',
    syncedAt,
    ...summary,
  }
}

export async function pullWebLiteFromWebDav(input: {
  sync: WebLiteSyncSettings
  localAiSettings: AiSettingsState | null
}): Promise<{
  result: WebLiteSyncResult
  sessions: WebLiteChatSession[]
  notes: WebLiteNote[]
  aiSettings: AiSettingsState | null
}> {
  const remote = await loadRemoteState(input.sync)
  if (!remote) {
    throw new Error('远端还没有同步数据')
  }
  const syncedAt = Date.now()
  const sessions = remote.manifest.sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  const notes = remote.notes.sort((a, b) => b.updatedAt - a.updatedAt)
  return {
    result: {
      mode: 'pull',
      syncedAt,
      ...summarizeState({ sessions, notes }),
    },
    sessions,
    notes,
    aiSettings: mergeAiSettings(input.localAiSettings, remote.manifest.settings.ai),
  }
}

export async function syncWebLiteWithWebDav(input: {
  sync: WebLiteSyncSettings
  localSessions: WebLiteChatSession[]
  localNotes: WebLiteNote[]
  localAiSettings: AiSettingsState | null
}): Promise<{
  result: WebLiteSyncResult
  sessions: WebLiteChatSession[]
  notes: WebLiteNote[]
  aiSettings: AiSettingsState | null
}> {
  const remote = await loadRemoteState(input.sync)
  if (!remote) {
    await uploadRemoteState({
      sync: input.sync,
      sessions: input.localSessions,
      notes: input.localNotes,
      aiSettings: input.localAiSettings,
    })
    const syncedAt = Date.now()
    return {
      result: {
        mode: 'sync',
        syncedAt,
        ...summarizeState({ sessions: input.localSessions, notes: input.localNotes }),
      },
      sessions: input.localSessions,
      notes: input.localNotes,
      aiSettings: input.localAiSettings,
    }
  }

  const baseline = input.sync.lastSyncedAt ?? 0
  const sessions = mergeSessions(input.localSessions, remote.manifest.sessions, baseline)
  const notes = mergeNotes(input.localNotes, remote.notes, baseline)
  const aiSettings = mergeAiSettings(input.localAiSettings, remote.manifest.settings.ai)
  await uploadRemoteState({
    sync: input.sync,
    sessions,
    notes,
    aiSettings,
  })
  const syncedAt = Date.now()
  return {
    result: {
      mode: 'sync',
      syncedAt,
      ...summarizeState({ sessions, notes }),
    },
    sessions,
    notes,
    aiSettings,
  }
}
