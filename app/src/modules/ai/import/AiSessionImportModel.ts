import type { ExportedAiSessionsPayload } from '../export/AiSessionExportModel'

export interface AiSessionsImportSummary {
  totalSessions: number
  importedSessions: number
  skippedSessions: number
  errors: string[]
}

export function parseExportedAiSessionsJson(jsonText: string): ExportedAiSessionsPayload {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch (e) {
    throw new Error('Invalid JSON: failed to parse AI sessions file')
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid AI sessions backup: root is not an object')
  }

  const root = parsed as Partial<ExportedAiSessionsPayload> & { [key: string]: unknown }

  if (root.app !== 'HaoMD') {
    throw new Error('Invalid AI sessions backup: app field mismatch')
  }

  if (typeof root.version !== 'number') {
    throw new Error('Invalid AI sessions backup: missing or invalid version')
  }

  // 当前仅支持 version = 1，未来可在这里做多版本兼容
  if (root.version !== 1) {
    throw new Error(`Unsupported AI sessions backup version: ${root.version}`)
  }

  if (!Array.isArray(root.sessions)) {
    throw new Error('Invalid AI sessions backup: sessions is not an array')
  }

  for (const [idx, session] of root.sessions.entries()) {
    if (!session || typeof session !== 'object') {
      throw new Error(`Invalid AI sessions backup: session[${idx}] is not an object`)
    }

    const s = session as any

    if (!Array.isArray(s.messages)) {
      throw new Error(`Invalid AI sessions backup: session[${idx}].messages is not an array`)
    }

    for (const [midx, m] of s.messages.entries()) {
      if (!m || typeof m !== 'object') {
        throw new Error(
          `Invalid AI sessions backup: session[${idx}].messages[${midx}] is not an object`,
        )
      }

      const msg = m as any
      if (msg.role !== 'user' && msg.role !== 'assistant' && msg.role !== 'system') {
        throw new Error(
          `Invalid AI sessions backup: session[${idx}].messages[${midx}].role is invalid`,
        )
      }
      if (typeof msg.content !== 'string') {
        throw new Error(
          `Invalid AI sessions backup: session[${idx}].messages[${midx}].content is not a string`,
        )
      }
    }
  }

  return root as ExportedAiSessionsPayload
}

export function isEmptySessionsPayload(payload: ExportedAiSessionsPayload): boolean {
  if (!payload.sessions || payload.sessions.length === 0) return true
  return payload.sessions.every((s) => !s.messages || s.messages.length === 0)
}
