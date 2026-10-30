import { useCallback, useRef, useState } from 'react'
import { operationEntries, type FileBrowserEntry } from '../domain/fileBrowserSelection'
import { copyFileBatch, batchFailureDetails, type FileBatchResult } from '../modules/files/application/fileBatchOperations'
import { computeDirFromPath } from '../modules/workspace/selectionBaseDirectory'
import { useI18n } from '../modules/i18n/I18nContext'

export function useSidebarClipboard(options: {
  copyEntry: (source: string, directory: string) => Promise<string>
  notify: (message: string) => void
  onPasted: (items: FileBatchResult<string>['succeeded'], directory: string) => Promise<void>
}) {
  const { t } = useI18n()
  const copied = useRef<FileBrowserEntry[]>([])
  const busy = useRef(false)
  const latest = useRef(options)
  latest.current = options
  const [canPaste, setCanPaste] = useState(false)
  const copy = useCallback((target: FileBrowserEntry | readonly FileBrowserEntry[]) => {
    copied.current = operationEntries(Array.isArray(target) ? target : [target as FileBrowserEntry]).map(entry => ({ ...entry }))
    setCanPaste(!busy.current && copied.current.length > 0)
    options.notify(t('sidebar.entriesCopied', { count: copied.current.length }))
  }, [options.notify, t])
  const paste = useCallback(async (target: FileBrowserEntry) => {
    const source = copied.current
    if (!source.length || busy.current) return
    busy.current = true
    setCanPaste(false)
    const directory = target.kind === 'tree-dir' || target.kind === 'folder-root'
      ? target.path : computeDirFromPath(target.path)
    try {
      options.notify(t('sidebar.pasting'))
      const result = await copyFileBatch(source, directory, options.copyEntry, t('sidebar.invalidCopyDestination'))
      if (result.succeeded.length) await latest.current.onPasted(result.succeeded, directory)
      options.notify([
        t('sidebar.batchPasteResult', { succeeded: result.succeeded.length, failed: result.failed.length }),
        batchFailureDetails(result),
      ].filter(Boolean).join('\n'))
    } catch (error) {
      options.notify(error instanceof Error ? error.message : String(error))
    } finally {
      busy.current = false
      setCanPaste(copied.current.length > 0)
    }
  }, [options.copyEntry, options.notify, options.onPasted, t])
  return { copy, paste, canPaste }
}
