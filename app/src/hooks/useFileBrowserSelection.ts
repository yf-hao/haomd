import { useCallback, useMemo, useState } from 'react'
import { emptyFileSelection, entryKey, selectFileEntry, type FileBrowserEntry } from '../domain/fileBrowserSelection'

export function useFileBrowserSelection() {
  const [selection, setSelection] = useState(emptyFileSelection)
  const select = useCallback((target: FileBrowserEntry, visible: FileBrowserEntry[], mode: Parameters<typeof selectFileEntry>[3]) => {
    setSelection(previous => selectFileEntry(previous, target, visible, mode))
  }, [])
  const prune = useCallback((visible: FileBrowserEntry[]) => {
    const keys = new Set(visible.map(entryKey))
    setSelection(previous => {
      const entries = previous.entries.filter(entry => keys.has(entryKey(entry)))
      return entries.length === previous.entries.length ? previous : {
        entries, anchor: previous.anchor && keys.has(previous.anchor) ? previous.anchor : null,
      }
    })
  }, [])
  const selectedPaths = useMemo(() => new Set(selection.entries.map(entryKey)), [selection.entries])
  return { entries: selection.entries, selectedPaths, select, prune }
}
