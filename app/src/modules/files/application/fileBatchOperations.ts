import { entryContainsPath, isDirectoryEntry, operationEntries, type FileBrowserEntry } from '../../../domain/fileBrowserSelection'

export type FileBatchResult<T> = {
  succeeded: { entry: FileBrowserEntry; value: T }[]
  failed: { entry: FileBrowserEntry; message: string }[]
}

/** The operation port can use Tauri, a test double, or another filesystem adapter. */
export async function runFileBatch<T>(
  entries: readonly FileBrowserEntry[], operation: (entry: FileBrowserEntry) => Promise<T>,
): Promise<FileBatchResult<T>> {
  const result: FileBatchResult<T> = { succeeded: [], failed: [] }
  for (const entry of operationEntries(entries)) {
    try {
      result.succeeded.push({ entry, value: await operation(entry) })
    } catch (error) {
      result.failed.push({ entry, message: error instanceof Error ? error.message : String(error) })
    }
  }
  return result
}

export function copyFileBatch(
  entries: readonly FileBrowserEntry[], directory: string,
  copy: (source: string, directory: string) => Promise<string>, invalidDestinationMessage: string,
) {
  return runFileBatch(entries, async entry => {
    if (isDirectoryEntry(entry) && entryContainsPath(entry, directory)) throw new Error(invalidDestinationMessage)
    return copy(entry.path, directory)
  })
}

export function batchFailureDetails(result: FileBatchResult<unknown>): string {
  return result.failed.map(({ entry, message }) => `${entry.path}: ${message}`).join('\n')
}
