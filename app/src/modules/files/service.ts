import { invoke } from '@tauri-apps/api/core'
import { filesConfig } from '../../config/files'
import type { ErrorCode, FileEntry, FilePayload, RecentFile, Result, ServiceError, WriteResult } from './types'
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
    const resp = await invoke<BackendResult<unknown>>('log_recent_file', { path, is_folder: isFolder, trace_id: traceId })
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
