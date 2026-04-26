import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../platform/backendTypes'
import { isTauriEnv } from '../platform/runtime'
import type { SearchRequest, SearchResponse } from './types'

export type SearchServiceResult =
  | { ok: true; data: SearchResponse }
  | { ok: false; message: string }

export async function searchWorkspaceContents(request: SearchRequest): Promise<SearchServiceResult> {
  if (!isTauriEnv()) {
    return { ok: false, message: 'Tauri 后端不可用，无法执行文件内容搜索。' }
  }

  try {
    const resp = await invoke<BackendResult<SearchResponse>>('search_workspace_contents', {
      request,
    })

    if ('Ok' in resp) {
      return { ok: true, data: resp.Ok.data }
    }

    return {
      ok: false,
      message: resp.Err.error.message || '搜索失败',
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
