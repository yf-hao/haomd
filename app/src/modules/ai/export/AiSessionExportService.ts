import type { DocConversationRecord } from '../domain/docConversations'
import { docConversationService, type DocConversationService } from '../application/docConversationService'
import {
  mapDocConversationToExportedSession,
  serializeExportedPayload,
  type ExportedAiSessionsPayload,
} from './AiSessionExportModel'
import { TauriAiSessionExportFileAdapter, type AiSessionExportFilePort } from './AiSessionExportFilePort'
import { buildSuggestedExportFileName } from './AiSessionExportFileName'

export interface AiSessionExportService {
  /**
   * 导出指定 docPath 下的 AI 会话历史为 JSON 文件。
   * - 若当前目录无会话记录，则静默返回，不弹出保存对话框。
   */
  exportDocSessionsToJson(
    docPath: string,
    options?: { currentSession?: ExportedAiSessionsPayload['currentSession'] },
  ): Promise<void>
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
    async exportDocSessionsToJson(docPath: string, options): Promise<void> {
      const trimmed = docPath.trim()
      if (!trimmed) return

      const record: DocConversationRecord | null = await docServiceImpl.getByDocPath(trimmed)
      const hasDirectoryHistory = !!record?.messages.length
      const hasCurrentSession = !!options?.currentSession?.messages.length
      if (!hasDirectoryHistory && !hasCurrentSession) {
        // 当前目录没有会话历史时直接返回，避免弹出空导出对话框
        return
      }

      const exportedSession = hasDirectoryHistory && record ? mapDocConversationToExportedSession(record) : null
      const payload: ExportedAiSessionsPayload = {
        version: 2,
        app: 'HaoMD',
        exportedAt: new Date().toISOString(),
        sessions: exportedSession ? [exportedSession] : [],
        currentSession: options?.currentSession ?? null,
      }

      const json = serializeExportedPayload(payload)
      const suggestedFileName = buildSuggestedExportFileName({
        prefix: 'AI Sessions',
        extension: 'json',
        docPath: trimmed,
        currentSessionTitle: options?.currentSession?.title,
        hasCurrentSession,
      })
      await filePortImpl.save(json, { suggestedFileName })
    },
  }
}

export const aiSessionExportService: AiSessionExportService = createAiSessionExportService()
