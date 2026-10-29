import { FileMoveError, type FileMovePort, type MoveOutcome, type PreparedMove } from '../ports/fileMovePort'
import { relocateMarkdown, sameFilePath, type FileRelocation } from '../../markdown/references/relocationPlanner'
import type { DocumentOperationQueue } from '../../document/documentOperationCoordinator'

export type MoveProgress = { phase: 'waiting' | 'preparing' | 'analyzing' | 'committing' | 'applying'; completed?: number; total?: number }
export type AnalysisProgress = { completed: number; total: number }
export type RelocationPlanner = (documents: PreparedMove['documents'], move: FileRelocation, progress?: (value: AnalysisProgress) => void) => Promise<string[]>

export const planOnMainThread: RelocationPlanner = async (documents, move) =>
  documents.map(document => relocateMarkdown(document.content, document.path, move, true))

export async function moveWorkspaceFile(args: {
  sourcePath: string; targetDirectory: string
}, dependencies: {
  files: FileMovePort
  operations: DocumentOperationQueue
  plan: RelocationPlanner
  validateOpenDocuments: (move: FileRelocation) => void
  apply: (outcome: MoveOutcome) => void
  onProgress?: (progress: MoveProgress) => void
}): Promise<MoveOutcome> {
  dependencies.onProgress?.({ phase: 'waiting' })
  return dependencies.operations.run(async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      dependencies.onProgress?.({ phase: 'preparing' })
      const prepared = await dependencies.files.prepare(args.sourcePath, args.targetDirectory)
      let committed = false
      try {
        if (prepared.documents.length !== 1 || !sameFilePath(prepared.documents[0].path, prepared.oldPath)) {
          throw new FileMoveError('移动计划只能包含被移动文件，请更新后端后重试', 'INVALID_PLAN')
        }
        const move = { oldPath: prepared.oldPath, newPath: prepared.newPath }
        dependencies.validateOpenDocuments(move)
        dependencies.onProgress?.({ phase: 'analyzing', completed: 0, total: prepared.documents.length })
        const rewritten = prepared.oldPath === prepared.newPath
          ? prepared.documents.map(d => d.content) : await dependencies.plan(prepared.documents, move,
            progress => dependencies.onProgress?.({ phase: 'analyzing', ...progress }))
        const patches = prepared.documents.flatMap((document, index) =>
          document.content === rewritten[index] ? [] : [{ path: document.path, expectedHash: document.hash, content: rewritten[index] }])
        dependencies.onProgress?.({ phase: 'committing' })
        const outcome = await dependencies.files.commit(prepared.operationId, patches)
        committed = true
        // This runs before a queued save can observe the old path.
        dependencies.onProgress?.({ phase: 'applying' })
        dependencies.apply(outcome)
        return outcome
      } catch (error) {
        if (committed) throw new Error(`文件已移动至 ${prepared.newPath}，但界面同步失败：${String(error)}`)
        if (!(error instanceof FileMoveError) || error.code !== 'CONFLICT' || attempt === 7) throw error
      } finally {
        // Commit consumes its plan. Abandoned-plan cleanup must not hold the
        // save queue or delay an already completed move's success notification.
        if (!committed) void dependencies.files.cancel(prepared.operationId).catch(() => {})
      }
    }
    throw new Error('文件名持续被占用，请稍后重试')
  })
}
