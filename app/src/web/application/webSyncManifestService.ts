import type { AiSettingsState } from '../../modules/ai/settings'
import type { WebLiteChatSession, WebLiteNote, WebLiteSyncSettings } from '../domain/models'

export type WebLiteSyncManifest = {
  version: 1
  exportedAt: number
  sessions: WebLiteChatSession[]
  notes: Array<{
    id: string
    title: string
    fileName: string
    updatedAt: number
    deletedAt?: number
  }>
  settings: {
    ai: AiSettingsState | null
    sync: Omit<WebLiteSyncSettings, 'password'> | null
  }
}

export type WebLiteSyncSnapshot = {
  manifest: WebLiteSyncManifest
  noteFiles: Array<{
    id: string
    fileName: string
    content: string
  }>
}

function slugifyTitle(title: string): string {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}\-_]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return normalized || 'note'
}

function sanitizeSyncSettings(sync: WebLiteSyncSettings | null | undefined): Omit<WebLiteSyncSettings, 'password'> | null {
  if (!sync) return null
  const { password: _password, ...rest } = sync
  return rest
}

function noteToMarkdown(note: WebLiteNote): string {
  const title = note.title.trim() || '未命名随笔'
  const body = note.content.trim()
  return body ? `# ${title}\n\n${body}\n` : `# ${title}\n`
}

export function createWebLiteSyncSnapshot(input: {
  sessions: WebLiteChatSession[]
  notes: WebLiteNote[]
  aiSettings: AiSettingsState | null
  syncSettings?: WebLiteSyncSettings | null
}): WebLiteSyncSnapshot {
  const exportedAt = Date.now()
  const noteFiles = input.notes.map((note) => ({
    id: note.id,
    fileName: `${note.id}-${slugifyTitle(note.title)}.md`,
    content: noteToMarkdown(note),
  }))

  return {
    manifest: {
      version: 1,
      exportedAt,
      sessions: input.sessions,
      notes: input.notes.map((note, index) => ({
        id: note.id,
        title: note.title,
        fileName: noteFiles[index]!.fileName,
        updatedAt: note.updatedAt,
        deletedAt: note.deletedAt,
      })),
      settings: {
        ai: input.aiSettings,
        sync: sanitizeSyncSettings(input.syncSettings),
      },
    },
    noteFiles,
  }
}

export function downloadWebLiteSyncSnapshot(snapshot: WebLiteSyncSnapshot): void {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `haomd-web-lite-sync-snapshot-${snapshot.manifest.exportedAt}.json`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
