import { invoke } from '@tauri-apps/api/core'
import { filesConfig } from '../../config/files'
import type {
  ErrorCode,
  FilePayload,
  WriteResult,
  SnapshotMeta,
  RecentFile,
  Result,
  ServiceError,
} from './types'

const isTauri = () =>
  typeof window !== 'undefined' &&
  (Boolean((window as any).__TAURI_INTERNALS__) || Boolean((window as any).__TAURI__))

const makeTraceId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `trace_${Date.now()}_${Math.random().toString(16).slice(2)}`

type BackendCode =
  | 'OK'
  | 'CANCELLED'
  | 'IoError'
  | 'NotFound'
  | 'TooLarge'
  | 'CONFLICT'
  | 'InvalidPath'
  | 'UNSUPPORTED'
  | 'UNKNOWN'

type BackendError = { code: BackendCode; message: string; trace_id?: string }

type BackendOk<T> = { data: T; trace_id?: string }

type BackendResult<T> = { Ok: BackendOk<T> } | { Err: { error: BackendError } }

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

type BackendSnapshot = {
  path: string
  snapshot_path: string
  created_at: number
  hash: string
  size_bytes: number
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

const mapSnapshot = (data: BackendSnapshot): SnapshotMeta => ({
  path: data.path,
  snapshotPath: data.snapshot_path,
  createdAt: data.created_at,
  hash: data.hash,
  sizeBytes: data.size_bytes,
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
  if (!isTauri()) return notAvailable(traceId)
  try {
    const resp = await invoke<BackendResult<BackendRecent[]>>('list_recent', { trace_id: traceId })
    return toResult(resp, (list) => list.map(mapRecent))
  } catch (error) {
    return normalizeInvokeError(error, traceId)
  }
}

export async function makeSnapshot(path: string, traceId = makeTraceId()): Promise<Result<SnapshotMeta>> {
  if (!isTauri()) return notAvailable(traceId)
  try {
    const resp = await invoke<BackendResult<BackendSnapshot>>('make_snapshot', { path, trace_id: traceId })
    return toResult(resp, mapSnapshot)
  } catch (error) {
    return normalizeInvokeError(error, traceId)
  }
}

export async function listSnapshots(path: string, traceId = makeTraceId()): Promise<Result<SnapshotMeta[]>> {
  if (!isTauri()) return notAvailable(traceId)
  try {
    const resp = await invoke<BackendResult<BackendSnapshot[]>>('list_snapshots', { path, trace_id: traceId })
    return toResult(resp, (list) => list.map(mapSnapshot))
  } catch (error) {
    return normalizeInvokeError(error, traceId)
  }
}

export async function restoreSnapshot(params: {
  snapshotPath: string
  targetPath?: string
  traceId?: string
}): Promise<Result<WriteResult>> {
  const traceId = params.traceId ?? makeTraceId()
  if (!isTauri()) return notAvailable(traceId)
  try {
    const resp = await invoke<BackendResult<BackendWriteResult>>('restore_snapshot', {
      snapshot_path: params.snapshotPath,
      target_path: params.targetPath,
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

const normalizeInvokeError = (err: unknown, traceId?: string): Result<never> => {
  const obj = err as Record<string, unknown> | null
  const msg = obj && typeof obj.message === 'string' ? obj.message : err instanceof Error ? err.message : String(err)
  const code = obj && typeof obj.code === 'string' ? (obj.code as BackendCode) : 'UNKNOWN'
  return { ok: false, error: { code: mapCode(code), message: msg || '调用失败', traceId } }
}

export const mergeRecent = (list: RecentFile[], entry: RecentFile, limit = filesConfig.maxSnapshots): RecentFile[] => {
  const merged = [entry, ...list.filter((item) => item.path !== entry.path)]
  merged.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  return merged.slice(0, limit)
}
