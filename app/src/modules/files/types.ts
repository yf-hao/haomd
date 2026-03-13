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
  /**
   * PDF 面板使用的虚拟文件夹 id。
   * - 对于普通最近文件列表，可忽略此字段。
   * - 对于 PDF 最近列表，undefined 表示在面板根列表中。
   */
  folderId?: string
}

export type FileKind = 'file' | 'dir'

export interface FileEntry {
  path: string
  name: string
  kind: FileKind
}

export interface ServiceError {
  code: ErrorCode
  message: string
  traceId?: string
}

export type Result<T> = { ok: true; data: T; traceId?: string } | { ok: false; error: ServiceError }

export interface FileVirtualFolder {
  id: string
  name: string
  order: number
}

export interface FileVirtualAssignment {
  path: string
  folderId: string | null
  updatedAt: number
}
