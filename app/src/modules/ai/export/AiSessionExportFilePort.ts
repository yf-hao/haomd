import { invoke } from '@tauri-apps/api/core'

export interface AiSessionExportFilePort {
  save(payloadJson: string, options?: { suggestedFileName?: string }): Promise<void>
}

function buildDefaultFileName(suggested?: string): string {
  if (suggested && suggested.trim()) return suggested.trim()

  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const mi = String(now.getMinutes()).padStart(2, '0')
  const ts = `${yyyy}${mm}${dd}-${hh}${mi}`

  return `AI Sessions - ${ts}.json`
}

export class TauriAiSessionExportFileAdapter implements AiSessionExportFilePort {
  async save(payloadJson: string, options?: { suggestedFileName?: string }): Promise<void> {
    const defaultFileName = buildDefaultFileName(options?.suggestedFileName)

    await invoke('save_ai_sessions_json_with_dialog', {
      defaultFileName,
      content: payloadJson,
    })
  }
}
