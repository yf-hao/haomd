import type { ExportedAiSession, ExportedAiSessionsPayload } from '../export/AiSessionExportModel'

export interface AiSessionsImportSummary {
  totalSessions: number
  importedSessions: number
  skippedSessions: number
  importedCurrentMessages: number
  skippedCurrentMessages: number
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

  if (root.version !== 1 && root.version !== 2) {
    throw new Error(`Unsupported AI sessions backup version: ${root.version}`)
  }

  if (!Array.isArray(root.sessions)) {
    throw new Error('Invalid AI sessions backup: sessions is not an array')
  }

  const validateSession = (session: unknown, label: string): void => {
    if (!session || typeof session !== 'object') {
      throw new Error(`Invalid AI sessions backup: ${label} is not an object`)
    }

    const s = session as any

    if (!Array.isArray(s.messages)) {
      throw new Error(`Invalid AI sessions backup: ${label}.messages is not an array`)
    }

    for (const [midx, m] of s.messages.entries()) {
      if (!m || typeof m !== 'object') {
        throw new Error(
          `Invalid AI sessions backup: ${label}.messages[${midx}] is not an object`,
        )
      }

      const msg = m as any
      if (msg.role !== 'user' && msg.role !== 'assistant' && msg.role !== 'system') {
        throw new Error(
          `Invalid AI sessions backup: ${label}.messages[${midx}].role is invalid`,
        )
      }
      if (typeof msg.content !== 'string') {
        throw new Error(
          `Invalid AI sessions backup: ${label}.messages[${midx}].content is not a string`,
        )
      }
    }
  }

  for (const [idx, session] of root.sessions.entries()) {
    validateSession(session, `session[${idx}]`)
  }

  if (root.version === 2 && root.currentSession != null) {
    validateSession(root.currentSession, 'currentSession')
  }

  return root as ExportedAiSessionsPayload
}

export function isEmptySessionsPayload(payload: ExportedAiSessionsPayload): boolean {
  const hasDirectoryMessages = payload.sessions?.some((s) => s.messages?.length > 0) ?? false
  const hasCurrentMessages = payload.currentSession?.messages?.length ? true : false
  return !hasDirectoryMessages && !hasCurrentMessages
}

export function getCurrentSessionFromPayload(payload: ExportedAiSessionsPayload): ExportedAiSession | null {
  return payload.version >= 2 ? payload.currentSession ?? null : null
}
