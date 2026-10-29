import { useCallback, useRef, useState } from 'react'
import type { SidebarContextActionPayload } from '../components/Sidebar'
import { copyFsEntry } from '../modules/files/service'
import { computeDirFromPath } from '../modules/workspace/selectionBaseDirectory'
import { useI18n } from '../modules/i18n/I18nContext'

type Target = Pick<SidebarContextActionPayload, 'path' | 'kind'>

export function useSidebarClipboard(options: {
  notify: (message: string) => void
  onPasted: (path: string, directory: string, isDirectory: boolean) => Promise<void>
}) {
  const { t } = useI18n()
  const copied = useRef<Target | null>(null)
  const busy = useRef(false)
  const [canPaste, setCanPaste] = useState(false)
  const copy = useCallback((target: Target) => {
    copied.current = target
    setCanPaste(!busy.current)
    options.notify(t('sidebar.entryCopied'))
  }, [options.notify, t])
  const paste = useCallback(async (target: Target) => {
    const source = copied.current
    if (!source || busy.current) return
    busy.current = true
    setCanPaste(false)
    const directory = target.kind === 'tree-dir' || target.kind === 'folder-root'
      ? target.path : computeDirFromPath(target.path)
    try {
      options.notify(t('sidebar.pasting'))
      const path = await copyFsEntry(source.path, directory)
      await options.onPasted(path, directory, source.kind === 'tree-dir' || source.kind === 'folder-root')
      options.notify(t('sidebar.entryPasted'))
    } catch (error) {
      options.notify(String(error instanceof Error ? error.message : error))
    } finally {
      busy.current = false
      setCanPaste(copied.current !== null)
    }
  }, [options.notify, options.onPasted, t])
  return { copy, paste, canPaste }
}
