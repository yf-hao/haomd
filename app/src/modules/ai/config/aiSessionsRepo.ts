import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../../platform/backendTypes'

// ─── Types matching Rust structs (camelCase via serde rename_all) ────

export type AiChatMessageCfg = {
  id: string
  role: string
  content: string
  timestamp: number
}

export type AiChatSessionCfg = {
  id: string
  title?: string | null
  entryMode?: string | null
  messages: AiChatMessageCfg[]
  providerType?: string | null
  activeRoleId?: string | null
  createdAt: number
  updatedAt: number
}

export type AiChatSessionIndexEntry = {
  id: string
  title?: string | null
  messageCount: number
  createdAt: number
  updatedAt: number
}

// ─── Invoke wrappers ────────────────────────────────────────────────

export async function loadSessionsIndex(): Promise<AiChatSessionIndexEntry[]> {
  const resp = await invoke<BackendResult<AiChatSessionIndexEntry[]>>('load_ai_sessions_index')
  if ('Ok' in resp) return resp.Ok.data
  console.warn('[ai/sessions] load_ai_sessions_index error', resp.Err.error)
  return []
}

export async function loadSession(id: string): Promise<AiChatSessionCfg | null> {
  const resp = await invoke<BackendResult<AiChatSessionCfg | null>>('load_ai_session', { id })
  if ('Ok' in resp) return resp.Ok.data
  console.warn('[ai/sessions] load_ai_session error', resp.Err.error)
  return null
}

export async function saveSession(session: AiChatSessionCfg): Promise<void> {
  const resp = await invoke<BackendResult<null>>('save_ai_session', { session })
  if ('Err' in resp) {
    console.warn('[ai/sessions] save_ai_session error', resp.Err.error)
  }
}

export async function deleteSession(id: string): Promise<void> {
  const resp = await invoke<BackendResult<null>>('delete_ai_session', { id })
  if ('Err' in resp) {
    console.warn('[ai/sessions] delete_ai_session error', resp.Err.error)
  }
}
