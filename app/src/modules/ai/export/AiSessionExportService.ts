import type { DocConversationRecord } from '../domain/docConversations'
import { docConversationService, type DocConversationService } from '../application/docConversationService'
import {
  mapDocConversationToExportedSession,
  serializeExportedPayload,
  type ExportedAiSessionsPayload,
} from './AiSessionExportModel'
import { TauriAiSessionExportFileAdapter, type AiSessionExportFilePort } from './AiSessionExportFilePort'

export interface AiSessionExportService {
  /**
   * 导出指定 docPath 下的 AI 会话历史为 JSON 文件。
   * - 若当前目录无会话记录，则静默返回，不弹出保存对话框。
   */
  exportDocSessionsToJson(docPath: string): Promise<void>
}

function buildSuggestedFileNameFromDocPath(docPath: string): string {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const mi = String(now.getMinutes()).padStart(2, '0')
  const ts = `${yyyy}${mm}${dd}-${hh}${mi}`

  const baseName = docPath.split(/[/\\]/).pop()?.replace(/\.[^./\\]+$/, '') || 'document'
  return `AI Sessions - ${baseName} - ${ts}.json`
}

export function createAiSessionExportService(
  deps?: {
    docService?: DocConversationService
    filePort?: AiSessionExportFilePort
  },
): AiSessionExportService {
  const docServiceImpl = deps?.docService ?? docConversationService
  const filePortImpl = deps?.filePort ?? new TauriAiSessionExportFileAdapter()

  return {
    async exportDocSessionsToJson(docPath: string): Promise<void> {
      const trimmed = docPath.trim()
      if (!trimmed) return

      const record: DocConversationRecord | null = await docServiceImpl.getByDocPath(trimmed)
      if (!record || !record.messages.length) {
        // 当前目录没有会话历史时直接返回，避免弹出空导出对话框
        return
      }

      const exportedSession = mapDocConversationToExportedSession(record)
      const payload: ExportedAiSessionsPayload = {
        version: 1,
        app: 'HaoMD',
        exportedAt: new Date().toISOString(),
        sessions: [exportedSession],
      }

      const json = serializeExportedPayload(payload)
      const suggestedFileName = buildSuggestedFileNameFromDocPath(trimmed)
      await filePortImpl.save(json, { suggestedFileName })
    },
  }
}

export const aiSessionExportService: AiSessionExportService = createAiSessionExportService()
