import type { WebLiteChatSession, WebLiteNote, WebLiteSettings } from '../domain/models'

export type WebLiteExportBundle = {
  version: 1
  exportedAt: number
  sessions: WebLiteChatSession[]
  notes: WebLiteNote[]
  settings: WebLiteSettings | null
}

export function createWebLiteExportBundle(input: {
  sessions: WebLiteChatSession[]
  notes: WebLiteNote[]
  settings: WebLiteSettings | null
}): WebLiteExportBundle {
  return {
    version: 1,
    exportedAt: Date.now(),
    sessions: input.sessions,
    notes: input.notes,
    settings: input.settings,
  }
}

export async function parseWebLiteImportBundle(file: File): Promise<WebLiteExportBundle> {
  const text = await file.text()
  const parsed = JSON.parse(text) as Partial<WebLiteExportBundle>
  if (parsed.version !== 1 || !Array.isArray(parsed.sessions) || !Array.isArray(parsed.notes)) {
    throw new Error('导入文件格式无效')
  }
  return {
    version: 1,
    exportedAt: typeof parsed.exportedAt === 'number' ? parsed.exportedAt : Date.now(),
    sessions: parsed.sessions,
    notes: parsed.notes,
    settings: parsed.settings ?? null,
  }
}

export function downloadWebLiteExportBundle(bundle: WebLiteExportBundle): void {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `haomd-web-lite-export-${bundle.exportedAt}.json`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function mergeByUpdatedAt<T extends { id: string; updatedAt: number }>(local: T[], incoming: T[]): T[] {
  const merged = new Map<string, T>()
  for (const item of local) merged.set(item.id, item)
  for (const item of incoming) {
    const existing = merged.get(item.id)
    if (!existing || item.updatedAt >= existing.updatedAt) {
      merged.set(item.id, item)
    }
  }
  return [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function mergeWebLiteImportBundle(input: {
  localSessions: WebLiteChatSession[]
  localNotes: WebLiteNote[]
  localSettings: WebLiteSettings | null
  incoming: WebLiteExportBundle
}): {
  sessions: WebLiteChatSession[]
  notes: WebLiteNote[]
  settings: WebLiteSettings | null
} {
  const incomingAi = input.incoming.settings?.ai ?? null
  const localAi = input.localSettings?.ai ?? null
  return {
    sessions: mergeByUpdatedAt(input.localSessions, input.incoming.sessions),
    notes: mergeByUpdatedAt(input.localNotes, input.incoming.notes),
    settings: {
      ai: incomingAi?.providers?.length ? incomingAi : (localAi ?? { providers: [], defaultProviderId: undefined }),
      sync: input.incoming.settings?.sync ?? input.localSettings?.sync ?? null,
    },
  }
}
