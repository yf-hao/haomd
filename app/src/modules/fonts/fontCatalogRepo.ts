import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../platform/backendTypes'

export type SystemFontOption = {
  family: string
  displayName: string
  source: 'system'
}

export async function listSystemFonts(): Promise<SystemFontOption[]> {
  const resp = await invoke<BackendResult<SystemFontOption[]>>('list_system_fonts')
  if ('Ok' in resp) {
    return resp.Ok.data ?? []
  }

  throw new Error(resp.Err.error.message || 'Failed to load system fonts')
}

