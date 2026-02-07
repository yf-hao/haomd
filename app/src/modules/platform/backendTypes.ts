export type BackendCode =
  | 'OK'
  | 'CANCELLED'
  | 'IoError'
  | 'NotFound'
  | 'TooLarge'
  | 'CONFLICT'
  | 'InvalidPath'
  | 'UNSUPPORTED'
  | 'UNKNOWN'

export type BackendError = { code: BackendCode; message: string; trace_id?: string }

export type BackendOk<T> = { data: T; trace_id?: string }

export type BackendResult<T> = { Ok: BackendOk<T> } | { Err: { error: BackendError } }
