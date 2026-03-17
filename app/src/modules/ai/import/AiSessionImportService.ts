import { docConversationService, type DocConversationService } from '../application/docConversationService'
import type { AiSessionsImportSummary } from './AiSessionImportModel'
import { parseExportedAiSessionsJson, isEmptySessionsPayload } from './AiSessionImportModel'
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
  importDocSessionsFromJsonForDoc(docPath: string): Promise<AiSessionsImportSummary>
}

export function createAiSessionImportService(deps?: {
  filePort?: AiSessionImportFilePort
  docService?: DocConversationService
}): AiSessionImportService {
  const filePortImpl = deps?.filePort ?? new TauriAiSessionImportFileAdapter()
  const docServiceImpl = deps?.docService ?? docConversationService

  return {
    async importDocSessionsFromJsonForDoc(docPath: string): Promise<AiSessionsImportSummary> {
      const trimmed = docPath.trim()
      if (!trimmed) {
        return { totalSessions: 0, importedSessions: 0, skippedSessions: 0, errors: [] }
      }

      // 1. 打开文件对话框并读取 JSON 文本
      const jsonText = await filePortImpl.openAndReadJsonWithDialog({
        title: 'Import AI Sessions JSON',
      })

      if (jsonText == null) {
        // 用户取消选择，视为无操作
        return { totalSessions: 0, importedSessions: 0, skippedSessions: 0, errors: [] }
      }

      // 2. 解析与校验 JSON
      const payload = parseExportedAiSessionsJson(jsonText)
      if (isEmptySessionsPayload(payload)) {
        return { totalSessions: payload.sessions.length, importedSessions: 0, skippedSessions: payload.sessions.length, errors: [] }
      }

      const totalSessions = payload.sessions.length

      // 3. 构造导入消息（使用当前 docPath 作为初始 docPath，稍后在服务中归一化为稳定 key）
      const importedMessages = buildImportedMessagesFromPayload(payload, trimmed)
      if (!importedMessages.length) {
        return { totalSessions, importedSessions: 0, skippedSessions: totalSessions, errors: [] }
      }

      // 4. 交给 docConversationService 追加到当前文档记录中
      await docServiceImpl.appendImportedMessagesForDoc({
        docPath: trimmed,
        messages: importedMessages,
      })

      return {
        totalSessions,
        importedSessions: totalSessions,
        skippedSessions: 0,
        errors: [],
      }
    },
  }
}

export const aiSessionImportService: AiSessionImportService = createAiSessionImportService()
