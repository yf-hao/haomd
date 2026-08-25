import { docConversationService, type DocConversationService } from '../application/docConversationService'
import type { AiSessionsImportSummary } from './AiSessionImportModel'
import { getCurrentSessionFromPayload, parseExportedAiSessionsJson, isEmptySessionsPayload } from './AiSessionImportModel'
import type { ExportedAiSession } from '../export/AiSessionExportModel'
import type { AiSessionImportFilePort } from './AiSessionImportFilePort'
import { TauriAiSessionImportFileAdapter } from './AiSessionImportFilePort'
import { buildImportedMessagesFromPayload } from './AiSessionImportMapper'

export interface AiSessionImportService {
  /**
   * 从 JSON 文件导入会话到指定 docPath。
   * - 用户取消选择文件时，返回 0 条导入记录且不抛错；
   * - 导入成功时，返回导入统计信息；
   * - 解析/校验/持久化失败时抛出错误，由 UI 决定如何提示。
   */
  importDocSessionsFromJsonForDoc(
    docPath: string,
    options?: { onCurrentSession?: (session: ExportedAiSession) => Promise<{ imported: number; skipped: number }> },
  ): Promise<AiSessionsImportSummary>
}

export function createAiSessionImportService(deps?: {
  filePort?: AiSessionImportFilePort
  docService?: DocConversationService
}): AiSessionImportService {
  const filePortImpl = deps?.filePort ?? new TauriAiSessionImportFileAdapter()
  const docServiceImpl = deps?.docService ?? docConversationService

  return {
    async importDocSessionsFromJsonForDoc(docPath: string, options): Promise<AiSessionsImportSummary> {
      const trimmed = docPath.trim()
      if (!trimmed) {
        return { totalSessions: 0, importedSessions: 0, skippedSessions: 0, importedCurrentMessages: 0, skippedCurrentMessages: 0, errors: [] }
      }

      // 1. 打开文件对话框并读取 JSON 文本
      const jsonText = await filePortImpl.openAndReadJsonWithDialog({
        title: 'Import AI Sessions JSON',
      })

      if (jsonText == null) {
        // 用户取消选择，视为无操作
        return { totalSessions: 0, importedSessions: 0, skippedSessions: 0, importedCurrentMessages: 0, skippedCurrentMessages: 0, errors: [] }
      }

      // 2. 解析与校验 JSON
      const payload = parseExportedAiSessionsJson(jsonText)
      if (isEmptySessionsPayload(payload)) {
        return { totalSessions: payload.sessions.length, importedSessions: 0, skippedSessions: payload.sessions.length, importedCurrentMessages: 0, skippedCurrentMessages: 0, errors: [] }
      }

      const totalSessions = payload.sessions.length

      // 3. 构造导入消息（使用当前 docPath 作为初始 docPath，稍后在服务中归一化为稳定 key）
      const importedMessages = buildImportedMessagesFromPayload(payload, trimmed)
      if (importedMessages.length > 0) {
        // 4. 交给 docConversationService 追加到当前文档记录中
        await docServiceImpl.appendImportedMessagesForDoc({
          docPath: trimmed,
          messages: importedMessages,
        })
      }

      const currentSession = getCurrentSessionFromPayload(payload)
      let importedCurrentMessages = 0
      let skippedCurrentMessages = 0
      if (currentSession?.messages.length) {
        if (options?.onCurrentSession) {
          const result = await options.onCurrentSession(currentSession)
          importedCurrentMessages = result.imported
          skippedCurrentMessages = result.skipped
        } else {
          skippedCurrentMessages = currentSession.messages.length
        }
      }

      return {
        totalSessions,
        importedSessions: importedMessages.length > 0 ? totalSessions : 0,
        skippedSessions: importedMessages.length > 0 ? 0 : totalSessions,
        importedCurrentMessages,
        skippedCurrentMessages,
        errors: [],
      }
    },
  }
}

export const aiSessionImportService: AiSessionImportService = createAiSessionImportService()
