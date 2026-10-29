export type MoveDocument = { path: string; content: string; hash: string; mtimeMs: number }
export type PreparedMove = { operationId: string; oldPath: string; newPath: string; documents: MoveDocument[] }
export type MovePatch = { path: string; expectedHash: string; content: string }
export type MoveOutcome = { oldPath: string; newPath: string; documents: MoveDocument[]; reconciliationRequired: boolean }
export interface FileMovePort {
  prepare(sourcePath: string, targetDirectory: string): Promise<PreparedMove>
  commit(operationId: string, patches: MovePatch[]): Promise<MoveOutcome>
  cancel(operationId: string): Promise<void>
}
export class FileMoveError extends Error {
  readonly code: string
  constructor(message: string, code: string) { super(message); this.code = code }
}
