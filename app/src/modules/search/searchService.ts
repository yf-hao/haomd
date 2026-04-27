import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../platform/backendTypes'
import { isTauriEnv } from '../platform/runtime'
import type { SearchRequest, SearchResponse, SearchScope } from './types'

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

export async function rebuildSearchIndex(scope: SearchScope): Promise<{ ok: true; indexed: number } | { ok: false; message: string }> {
  if (!isTauriEnv()) {
    return { ok: false, message: 'Tauri 后端不可用，无法重建搜索索引。' }
  }

  try {
    const resp = await invoke<BackendResult<number>>('rebuild_search_index', {
      scope,
    })

    if ('Ok' in resp) {
      return { ok: true, indexed: resp.Ok.data }
    }

    return {
      ok: false,
      message: resp.Err.error.message || '重建搜索索引失败',
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
