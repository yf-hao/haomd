import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../platform/backendTypes'
import type { AiChatMessageCfg } from '../ai/config/aiSessionsRepo'

export type PdfChatSessionCfg = {
  id: string
  sourcePath?: string | null
  pdfHash?: string | null
  title?: string | null
  entryMode?: string | null
  messages: AiChatMessageCfg[]
  providerType?: string | null
  activeRoleId?: string | null
  createdAt: number
  updatedAt: number
}

export async function loadPdfSessions(): Promise<PdfChatSessionCfg[]> {
  const resp = await invoke<BackendResult<PdfChatSessionCfg[]>>('load_pdf_sessions')
  if ('Ok' in resp) return resp.Ok.data
  console.warn('[pdf/sessions] load_pdf_sessions error', resp.Err.error)
  return []
}

export async function loadPdfSession(id: string): Promise<PdfChatSessionCfg | null> {
  const resp = await invoke<BackendResult<PdfChatSessionCfg | null>>('load_pdf_session', { id })
  if ('Ok' in resp) return resp.Ok.data
  console.warn('[pdf/sessions] load_pdf_session error', resp.Err.error)
  return null
}

export async function savePdfSession(session: PdfChatSessionCfg): Promise<void> {
  const resp = await invoke<BackendResult<null>>('save_pdf_session', { session })
  if ('Err' in resp) {
    console.warn('[pdf/sessions] save_pdf_session error', resp.Err.error)
  }
}

export async function deletePdfSession(id: string): Promise<void> {
  const resp = await invoke<BackendResult<null>>('delete_pdf_session', { id })
  if ('Err' in resp) {
    console.warn('[pdf/sessions] delete_pdf_session error', resp.Err.error)
  }
}
