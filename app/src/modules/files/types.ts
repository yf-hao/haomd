export type ErrorCode =
  | 'OK'
  | 'CANCELLED'
  | 'IO_ERROR'
  | 'NOT_FOUND'
  | 'TOO_LARGE'
  | 'CONFLICT'
  | 'INVALID_PATH'
  | 'UNSUPPORTED'
  | 'UNKNOWN'

export interface FilePayload {
  path: string
  content: string
  encoding: 'utf-8'
  mtimeMs: number // 毫秒精度
  hash: string // SHA-256 hex
}

export interface WriteResult {
  path: string
  mtimeMs: number
  hash: string
  code: ErrorCode
  message?: string
}

export interface RecentFile {
  path: string
  displayName: string
  lastOpenedAt: number
  isFolder?: boolean
}

export interface SnapshotMeta {
  path: string // 原始文件路径
  snapshotPath: string // 历史文件实际路径
  createdAt: number
  hash: string
  sizeBytes: number
}

export interface ServiceError {
  code: ErrorCode
  message: string
  traceId?: string
}

export type Result<T> = { ok: true; data: T; traceId?: string } | { ok: false; error: ServiceError }
