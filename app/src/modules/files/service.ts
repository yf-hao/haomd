import { invoke } from '@tauri-apps/api/core'
import { filesConfig } from '../../config/files'
import type {
  ErrorCode,
  FileEntry,
  FilePayload,
  RecentFile,
  Result,
  ServiceError,
  WriteResult,
  FileVirtualFolder,
  FileVirtualAssignment,
} from './types'
import type { BackendCode, BackendError, BackendResult } from '../platform/backendTypes'
import { isTauriEnv } from '../platform/runtime'

const isTauri = isTauriEnv

const makeTraceId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `trace_${Date.now()}_${Math.random().toString(16).slice(2)}`

type BackendFile = {
  path: string
  content: string
  encoding: string
  mtime_ms: number
  hash: string
}

type BackendWriteResult = {
  path: string
  mtime_ms: number
  hash: string
  code: BackendCode
  message?: string
}

type BackendRecent = {
  path: string
  display_name: string
  last_opened_at: number
  is_folder: boolean
}

type BackendFsEntryKind = 'file' | 'dir'

type BackendFsEntry = {
  path: string
  name: string
  kind: BackendFsEntryKind
}

type BackendFileVirtualFolder = {
  id: string
  name: string
  order: number
}

type BackendFileVirtualAssignment = {
  path: string
  folder_id: string | null
  updated_at: number
}

const mapCode = (code: BackendCode): ErrorCode => {
  switch (code) {
    case 'OK':
      return 'OK'
    case 'CANCELLED':
      return 'CANCELLED'
    case 'IoError':
      return 'IO_ERROR'
    case 'NotFound':
      return 'NOT_FOUND'
    case 'TooLarge':
      return 'TOO_LARGE'
    case 'CONFLICT':
      return 'CONFLICT'
    case 'InvalidPath':
      return 'INVALID_PATH'
    case 'UNSUPPORTED':
      return 'UNSUPPORTED'
    case 'UNKNOWN':
    default:
      return 'UNKNOWN'
  }
}

const toError = (error: BackendError, fallbackTrace?: string): ServiceError => ({
  code: mapCode(error.code),
  message: error.message,
  traceId: error.trace_id ?? fallbackTrace,
})

const toResult = <T, U>(resp: BackendResult<T>, mapData: (data: T) => U): Result<U> => {
  if ('Ok' in resp) {
    const traceId = resp.Ok.trace_id
    return { ok: true, data: mapData(resp.Ok.data), traceId }
  }
  const { error } = resp.Err
  return { ok: false, error: toError(error, error.trace_id) }
}

const notAvailable = (traceId: string): Result<never> => ({
  ok: false,
  error: { code: 'UNKNOWN', message: 'Tauri 后端不可用', traceId },
})

const mapFile = (data: BackendFile): FilePayload => ({
  path: data.path,
  content: data.content,
  encoding: 'utf-8',
  mtimeMs: data.mtime_ms,
  hash: data.hash,
})

const mapWriteResult = (data: BackendWriteResult): Result<WriteResult> => {
  if (data.code !== 'OK') {
    return {
      ok: false,
      error: {
        code: mapCode(data.code),
        message: data.message || '写入失败',
      },
    }
  }
  return {
    ok: true,
    data: {
      path: data.path,
      mtimeMs: data.mtime_ms,
      hash: data.hash,
      code: 'OK',
      message: undefined,
    },
  }
}

const mapRecent = (data: BackendRecent): RecentFile => ({
  path: data.path,
  displayName: data.display_name,
  lastOpenedAt: data.last_opened_at,
  isFolder: data.is_folder,
})

const mapFsEntry = (data: BackendFsEntry): FileEntry => ({
  path: data.path,
  name: data.name,
  // 后端 kind 已是 "file"/"dir"，这里保持一致
  kind: data.kind === 'dir' ? 'dir' : 'file',
})

export async function readFile(path: string, traceId = makeTraceId()): Promise<Result<FilePayload>> {
  if (!isTauri()) return notAvailable(traceId)
  try {
    const resp = await invoke<BackendResult<BackendFile>>('read_file', { path, trace_id: traceId })
    return toResult(resp, mapFile)
  } catch (error) {
    return normalizeInvokeError(error, traceId)
  }
}

export async function writeFile(params: {
  path: string
  content: string
  expectedMtime?: number
  expectedHash?: string
  traceId?: string
}): Promise<Result<WriteResult>> {
  const traceId = params.traceId ?? makeTraceId()
  if (!isTauri()) return notAvailable(traceId)
  try {
    const resp = await invoke<BackendResult<BackendWriteResult>>('write_file', {
      path: params.path,
      content: params.content,
      expected_mtime: params.expectedMtime,
      expected_hash: params.expectedHash,
      trace_id: traceId,
    })
    if ('Ok' in resp) {
      return mapWriteResult(resp.Ok.data)
    }
    return { ok: false, error: toError(resp.Err.error, traceId) }
  } catch (error) {
    return normalizeInvokeError(error, traceId)
  }
}

export async function writeFileNoRecent(params: {
  path: string
  content: string
  expectedMtime?: number
  expectedHash?: string
  traceId?: string
}): Promise<Result<WriteResult>> {
  const traceId = params.traceId ?? makeTraceId()
  if (!isTauri()) return notAvailable(traceId)
  try {
    const resp = await invoke<BackendResult<BackendWriteResult>>('write_file_no_recent', {
      path: params.path,
      content: params.content,
      expected_mtime: params.expectedMtime,
      expected_hash: params.expectedHash,
      trace_id: traceId,
    })
    if ('Ok' in resp) {
      return mapWriteResult(resp.Ok.data)
    }
    return { ok: false, error: toError(resp.Err.error, traceId) }
  } catch (error) {
    return normalizeInvokeError(error, traceId)
  }
}

export async function listRecent(traceId = makeTraceId()): Promise<Result<RecentFile[]>> {
  // 兼容旧接口：默认请求第 0 页，limit 使用前端配置
  return listRecentPage(0, filesConfig.maxRecent, traceId)
}

export async function listRecentPage(
  offset: number,
  limit: number,
  traceId = makeTraceId(),
): Promise<Result<RecentFile[]>> {
  if (!isTauri()) return notAvailable(traceId)
  try {
    const resp = await invoke<BackendResult<BackendRecent[]>>('list_recent', {
      offset,
      limit,
      trace_id: traceId,
    })
    return toResult(resp, (list) => list.map(mapRecent))
  } catch (error) {
    return normalizeInvokeError(error, traceId)
  }
}

export async function logRecentFile(path: string, isFolder: boolean, traceId = makeTraceId()): Promise<Result<null>> {
  if (!isTauri()) return notAvailable(traceId)
  try {
    // 注意：Tauri 对 command 参数名较为严格，这里使用 isFolder 与后端命令签名保持一致
    const resp = await invoke<BackendResult<unknown>>('log_recent_file', { path, isFolder, trace_id: traceId })
    // 后端数据为空，直接返回 ok
    if ('Ok' in resp) {
      return { ok: true, data: null, traceId: resp.Ok.trace_id }
    }
    return { ok: false, error: toError(resp.Err.error, traceId) }
  } catch (error) {
    return normalizeInvokeError(error, traceId)
  }
}

export async function clearRecentRemote(traceId = makeTraceId()): Promise<Result<null>> {
  if (!isTauri()) return notAvailable(traceId)
  try {
    const resp = await invoke<BackendResult<unknown>>('clear_recent', { trace_id: traceId })
    if ('Ok' in resp) {
      return { ok: true, data: null, traceId: resp.Ok.trace_id }
    }
    return { ok: false, error: toError(resp.Err.error, traceId) }
  } catch (error) {
    return normalizeInvokeError(error, traceId)
  }
}

export async function deleteRecentRemote(path: string, traceId = makeTraceId()): Promise<Result<null>> {
  if (!isTauri()) return notAvailable(traceId)
  try {
    const resp = await invoke<BackendResult<unknown>>('delete_recent_entry', { path, trace_id: traceId })
    if ('Ok' in resp) {
      return { ok: true, data: null, traceId: resp.Ok.trace_id }
    }
    return { ok: false, error: toError(resp.Err.error, traceId) }
  } catch (error) {
    return normalizeInvokeError(error, traceId)
  }
}

export async function listFolder(path: string, traceId = makeTraceId()): Promise<Result<FileEntry[]>> {
  if (!isTauri()) return notAvailable(traceId)
  try {
    const resp = await invoke<BackendResult<BackendFsEntry[]>>('list_folder', { path, trace_id: traceId })
    return toResult(resp, (list) => list.map(mapFsEntry))
  } catch (error) {
    return normalizeInvokeError(error, traceId)
  }
}

export async function deleteFsEntry(path: string, traceId = makeTraceId()): Promise<Result<null>> {
  if (!isTauri()) return notAvailable(traceId)
  try {
    const resp = await invoke<BackendResult<unknown>>('delete_fs_entry', { path, trace_id: traceId })
    if ('Ok' in resp) {
      return { ok: true, data: null, traceId: resp.Ok.trace_id }
    }
    return { ok: false, error: toError(resp.Err.error, traceId) }
  } catch (error) {
    return normalizeInvokeError(error, traceId)
  }
}

export async function createFolder(path: string, traceId = makeTraceId()): Promise<Result<null>> {
  if (!isTauri()) return notAvailable(traceId)
  try {
    const resp = await invoke<BackendResult<unknown>>('create_folder', { path, trace_id: traceId })
    if ('Ok' in resp) {
      return { ok: true, data: null, traceId: resp.Ok.trace_id }
    }
    return { ok: false, error: toError(resp.Err.error, traceId) }
  } catch (error) {
    return normalizeInvokeError(error, traceId)
  }
}

const normalizeInvokeError = (err: unknown, traceId?: string): Result<never> => {
  const obj = err as Record<string, unknown> | null
  const msg = obj && typeof obj.message === 'string' ? obj.message : err instanceof Error ? err.message : String(err)
  const code = obj && typeof obj.code === 'string' ? (obj.code as BackendCode) : 'UNKNOWN'
  return { ok: false, error: { code: mapCode(code), message: msg || '调用失败', traceId } }
}

export const mergeRecent = (list: RecentFile[], entry: RecentFile, limit = filesConfig.maxRecent): RecentFile[] => {
  const merged = [entry, ...list.filter((item) => item.path !== entry.path)]
  merged.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  return merged.slice(0, limit)
}

export async function loadFileVirtualFolders(
  traceId = makeTraceId(),
): Promise<Result<FileVirtualFolder[]>> {
  // 在 Tauri 环境下优先使用后端 JSON 文件，成功后会与 localStorage 合并；如失败则回退到浏览器存储
  if (isTauri()) {
    try {
      const resp = await invoke<BackendResult<BackendFileVirtualFolder[]>>('load_file_virtual_folders', {
        trace_id: traceId,
      })
      const tauriResult = toResult(resp, (list) =>
        list
          .map((f) => ({ id: f.id, name: f.name, order: f.order }))
          .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
      )

      if (tauriResult.ok) {
        let data = tauriResult.data
        const trace = tauriResult.traceId

        // 如果后端数据为空，而浏览器 localStorage 里有旧数据，则优先使用 localStorage
        try {
          if (typeof localStorage !== 'undefined') {
            const raw = localStorage.getItem('haomd:fileVirtualFolders:v1')
            if (raw) {
              const parsed = JSON.parse(raw) as FileVirtualFolder[]
              const localList = Array.isArray(parsed) ? parsed : []
              if (data.length === 0 && localList.length > 0) {
                data = localList.slice().sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
              }
              // 反向同步一份合并结果到 localStorage，避免两侧长期不一致
              const toStore = data.map((f) => ({ id: f.id, name: f.name, order: f.order }))
              localStorage.setItem('haomd:fileVirtualFolders:v1', JSON.stringify(toStore))
            }
          }
        } catch (e) {
          console.warn('[files.service] loadFileVirtualFolders merge with localStorage failed', e)
        }

        return { ok: true, data, traceId: trace }
      }

      console.warn('[files.service] loadFileVirtualFolders tauri error, fallback to localStorage', tauriResult.error)
    } catch (error) {
      console.warn('[files.service] loadFileVirtualFolders tauri invoke failed, fallback to localStorage', error)
    }
  }

  // 浏览器环境或 Tauri 失败时：从 localStorage 读取 Files 虚拟文件夹
  try {
    if (typeof localStorage === 'undefined') {
      return { ok: true, data: [] }
    }
    const raw = localStorage.getItem('haomd:fileVirtualFolders:v1')
    if (!raw) {
      return { ok: true, data: [] }
    }
    const parsed = JSON.parse(raw) as FileVirtualFolder[]
    const list = Array.isArray(parsed) ? parsed : []
    const sorted = list.slice().sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    return { ok: true, data: sorted }
  } catch (error) {
    console.warn('[files.service] loadFileVirtualFolders local fallback failed', error)
    return { ok: true, data: [] }
  }
}

export async function saveFileVirtualFolders(
  folders: FileVirtualFolder[],
  traceId = makeTraceId(),
): Promise<Result<null>> {
  // Tauri 环境：优先写入后端 JSON 文件，失败时回退到 localStorage
  if (isTauri()) {
    try {
      const payload = folders.map((f) => ({
        id: f.id,
        name: f.name,
        order: f.order,
      }))
      const resp = await invoke<BackendResult<unknown>>('save_file_virtual_folders', {
        folders: payload,
        trace_id: traceId,
      })
      if ('Ok' in resp) {
        // 同步一份到 localStorage，方便调试和作为兜底
        try {
          if (typeof localStorage !== 'undefined') {
            const toStore = folders.map((f) => ({ id: f.id, name: f.name, order: f.order }))
            localStorage.setItem('haomd:fileVirtualFolders:v1', JSON.stringify(toStore))
          }
        } catch (e) {
          console.warn('[files.service] saveFileVirtualFolders mirror to localStorage failed', e)
        }
        return { ok: true, data: null, traceId: resp.Ok.trace_id }
      }
      console.warn('[files.service] saveFileVirtualFolders tauri error, fallback to localStorage', resp.Err.error)
      // 继续走下面的 localStorage 分支
    } catch (error) {
      console.warn('[files.service] saveFileVirtualFolders tauri invoke failed, fallback to localStorage', error)
      // 继续走下面的 localStorage 分支
    }
  }

  // 浏览器环境或 Tauri 失败：写入 localStorage
  try {
    if (typeof localStorage === 'undefined') {
      return { ok: true, data: null }
    }
    const toStore = folders.map((f) => ({ id: f.id, name: f.name, order: f.order }))
    localStorage.setItem('haomd:fileVirtualFolders:v1', JSON.stringify(toStore))
    return { ok: true, data: null }
  } catch (error) {
    console.warn('[files.service] saveFileVirtualFolders local fallback failed', error)
    return {
      ok: false,
      error: {
        code: 'UNKNOWN',
        message: '保存虚拟文件夹失败：浏览器存储不可用',
        traceId,
      },
    }
  }
}

export async function listFileVirtualAssignments(
  traceId = makeTraceId(),
): Promise<Result<FileVirtualAssignment[]>> {
  // 先尝试从浏览器 localStorage 读取分配；如果有数据，则直接使用它作为权威源
  try {
    if (typeof localStorage !== 'undefined') {
      const rawLocal = localStorage.getItem('haomd:fileVirtualAssignments:v1')
      if (rawLocal) {
        const parsed = JSON.parse(rawLocal) as FileVirtualAssignment[]
        const localList = Array.isArray(parsed) ? parsed : []
        if (localList.length > 0) {
          return { ok: true, data: localList }
        }
      }
    }
  } catch (e) {
    console.warn('[files.service] listFileVirtualAssignments read localStorage failed', e)
  }

  // localStorage 中没有有效数据时，再在 Tauri 环境里尝试从后端读取
  if (isTauri()) {
    try {
      const resp = await invoke<BackendResult<BackendFileVirtualAssignment[]>>(
        'list_file_virtual_assignments',
        { trace_id: traceId },
      )
      const tauriResult = toResult(resp, (list) =>
        list.map((item) => ({
          path: item.path,
          folderId: item.folder_id,
          updatedAt: item.updated_at,
        })),
      )

      if (tauriResult.ok) {
        const data = tauriResult.data
        const trace = tauriResult.traceId

        // 将后端数据同步一份到 localStorage，供后续优先使用
        try {
          if (typeof localStorage !== 'undefined' && data.length > 0) {
            localStorage.setItem('haomd:fileVirtualAssignments:v1', JSON.stringify(data))
          }
        } catch (e) {
          console.warn('[files.service] listFileVirtualAssignments sync tauri data to localStorage failed', e)
        }

        return { ok: true, data, traceId: trace }
      }

      console.warn('[files.service] listFileVirtualAssignments tauri error', tauriResult.error)
    } catch (error) {
      console.warn('[files.service] listFileVirtualAssignments tauri invoke failed', error)
    }
  }

  // 都没有成功时，返回空列表
  return { ok: true, data: [] }
}

export async function updateFileVirtualFolderForPath(
  path: string,
  folderId: string | null,
  traceId = makeTraceId(),
): Promise<Result<FileVirtualAssignment>> {
  // Tauri 环境：必须调用后端命令更新 JSON，失败时直接返回错误，不再静默回退到 localStorage
  if (isTauri()) {
    try {
      console.log('[files.service] updateFileVirtualFolderForPath invoke args', { path, folderId, traceId })
      const resp = await invoke<BackendResult<BackendFileVirtualAssignment>>(
        'update_file_virtual_folder_for_path',
        {
          path,
          // 同时传 camelCase 和 snake_case，兼容不同版本的后端签名
          folderId,
          folder_id: folderId,
          traceId,
          trace_id: traceId,
        },
      )
      console.log('[files.service] updateFileVirtualFolderForPath raw resp', resp)
      const result = toResult(resp, (item) => ({
        path: item.path,
        folderId: item.folder_id,
        updatedAt: item.updated_at,
      }))
      if (result.ok) {
        // 同步一份到 localStorage，确保在后端异常时也能恢复
        try {
          if (typeof localStorage !== 'undefined') {
            const raw = localStorage.getItem('haomd:fileVirtualAssignments:v1')
            const parsed = raw ? (JSON.parse(raw) as FileVirtualAssignment[]) : []
            const list = Array.isArray(parsed) ? parsed : []

            const idx = list.findIndex((item) => item.path === path)
            const now = Date.now()
            if (folderId === null) {
              if (idx >= 0) {
                list.splice(idx, 1)
              }
            } else if (idx >= 0) {
              list[idx] = { ...list[idx], folderId, updatedAt: now }
            } else {
              list.push({ path, folderId, updatedAt: now })
            }

            localStorage.setItem('haomd:fileVirtualAssignments:v1', JSON.stringify(list))
          }
        } catch (e) {
          console.warn('[files.service] updateFileVirtualFolderForPath mirror to localStorage failed', e)
        }
        return result
      }
      console.error('[files.service] updateFileVirtualFolderForPath tauri error', result.error)
      return result
    } catch (error) {
      console.error('[files.service] updateFileVirtualFolderForPath tauri invoke failed', error)
      return normalizeInvokeError(error, traceId)
    }
  }

  // 浏览器环境：在 localStorage 里维护分配列表
  try {
    if (typeof localStorage === 'undefined') {
      const now = Date.now()
      return {
        ok: true,
        data: { path, folderId, updatedAt: now },
      }
    }

    const raw = localStorage.getItem('haomd:fileVirtualAssignments:v1')
    const parsed = raw ? (JSON.parse(raw) as FileVirtualAssignment[]) : []
    const list = Array.isArray(parsed) ? parsed : []

    const now = Date.now()
    const idx = list.findIndex((item) => item.path === path)
    if (folderId === null) {
      if (idx >= 0) {
        list.splice(idx, 1)
      }
    } else if (idx >= 0) {
      list[idx] = { ...list[idx], folderId, updatedAt: now }
    } else {
      list.push({ path, folderId, updatedAt: now })
    }

    localStorage.setItem('haomd:fileVirtualAssignments:v1', JSON.stringify(list))

    return {
      ok: true,
      data: { path, folderId, updatedAt: now },
    }
  } catch (error) {
    console.warn('[files.service] updateFileVirtualFolderForPath local fallback failed', error)
    const now = Date.now()
    return {
      ok: true,
      data: { path, folderId, updatedAt: now },
    }
  }
}
