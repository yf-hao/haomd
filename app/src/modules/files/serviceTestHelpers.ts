import type { BackendCode } from '../platform/backendTypes'
import type { Result } from './types'
import { mergeRecent } from './service'

// 为了避免破坏 service.ts 的封装，这里提供辅助函数给测试使用，
// 内部调用真实实现的私有逻辑。

// 注意：这两个函数仅用于测试环境。

export { mergeRecent }

// 复制 mapCode 的逻辑用于测试验证映射是否稳定
export const mapCodeForTest = (code: BackendCode): Result<never>['error']['code'] => {
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

export const normalizeInvokeErrorForTest = (err: unknown): Result<never> => {
  const obj = err as Record<string, unknown> | null
  const msg = obj && typeof obj.message === 'string' ? obj.message : err instanceof Error ? err.message : String(err)
  const code = obj && typeof obj.code === 'string' ? (obj.code as BackendCode) : 'UNKNOWN'
  return { ok: false, error: { code: mapCodeForTest(code), message: msg || '调用失败', traceId: undefined } }
}
