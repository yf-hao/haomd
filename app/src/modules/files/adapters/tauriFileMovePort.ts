import { invoke } from '@tauri-apps/api/core'
import type { BackendResult } from '../../platform/backendTypes'
import { FileMoveError, type FileMovePort, type PreparedMove, type MoveOutcome } from '../ports/fileMovePort'

function unwrap<T>(result: BackendResult<T>): T {
  if ('Ok' in result) return result.Ok.data
  throw new FileMoveError(result.Err.error.message, result.Err.error.code)
}

export const tauriFileMovePort: FileMovePort = {
  async prepare(sourcePath, targetDirectory) {
    return unwrap(await invoke<BackendResult<PreparedMove>>('prepare_file_move', { sourcePath, targetDirectory }))
  },
  async commit(operationId, patches) {
    return unwrap(await invoke<BackendResult<MoveOutcome>>('commit_file_move', { operationId, patches }))
  },
  cancel: operationId => invoke('cancel_file_move', { operationId }),
}
