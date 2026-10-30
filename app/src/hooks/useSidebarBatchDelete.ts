import { useRef } from 'react'
import { operationEntries, type FileBrowserEntry } from '../domain/fileBrowserSelection'
import { runFileBatch, type FileBatchResult } from '../modules/files/application/fileBatchOperations'

export function useSidebarBatchDelete(options: {
  confirm: (entries: FileBrowserEntry[]) => Promise<boolean>
  remove: (entry: FileBrowserEntry) => Promise<void>
  onDeleted: (entries: FileBrowserEntry[]) => Promise<void>
  report: (result: FileBatchResult<void>) => void
  onError: (error: unknown) => void
}) {
  const busy = useRef(false)
  const latest = useRef(options)
  latest.current = options
  return async (selection: FileBrowserEntry[]) => {
    if (busy.current) return
    const entries = operationEntries(selection)
    if (!entries.length) return
    busy.current = true
    try {
      if (!await options.confirm(entries)) return
      const result = await runFileBatch(entries, options.remove)
      if (result.succeeded.length) await latest.current.onDeleted(result.succeeded.map(item => item.entry))
      latest.current.report(result)
    } catch (error) {
      latest.current.onError(error)
    } finally {
      busy.current = false
    }
  }
}
