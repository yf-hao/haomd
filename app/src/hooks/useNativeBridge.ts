import { useEffect, type RefObject } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { EditorView } from '@codemirror/view'
import { onOpenRecentFile } from '../modules/platform/menuEvents'
import { onNativePasteImage } from '../modules/platform/clipboardEvents'
import { loadDefaultImagePathStrategyConfig, resolveImageTarget } from '../modules/images/imagePasteStrategy'
import type { EditorTab } from '../types/tabs'

export type NativeBridgeOptions = {
    activeTab: EditorTab | null
    isTauriEnv: () => boolean
    sidebar: any
    openRecentFileInNewTab: (path: string) => Promise<any>
    editorViewRef: RefObject<EditorView | null>
    filePath: string | null
    setStatusMessage: (msg: string) => void
    setConfirmDialog: (dialog: any) => void
}

export function useNativeBridge(options: NativeBridgeOptions) {
    const {
        activeTab,
        isTauriEnv,
        sidebar,
        openRecentFileInNewTab,
        editorViewRef,
        filePath,
        setStatusMessage,
        setConfirmDialog,
    } = options

    // Window Title
    useEffect(() => {
        const DEFAULT_TITLE = 'undefined.md'
        const formatWindowTitleFromTab = (tab: EditorTab | null): string => {
            if (!tab) return DEFAULT_TITLE
            const path = tab.path
            const name = path ? path.split(/[/\\]/).pop() || path : tab.title || DEFAULT_TITLE
            const prefix = tab.dirty ? '*' : ''
            return `${prefix}${name}`
        }

        const title = formatWindowTitleFromTab(activeTab)
        if (isTauriEnv()) {
            void invoke('set_title', { title }).catch(() => { })
        }
    }, [activeTab, isTauriEnv])

    // Recent Files
    useEffect(() => {
        const unlisten = onOpenRecentFile(({ path, isFolder }) => {
            if (isFolder) {
                void sidebar.openFolderAsRoot(path)
            } else {
                void openRecentFileInNewTab(path)
            }
        })
        return () => unlisten()
    }, [openRecentFileInNewTab, sidebar])

    // Paste Image
    useEffect(() => {
        const unlisten = onNativePasteImage(async () => {
            const view = editorViewRef.current
            if (!view) return

            if (typeof document !== 'undefined') {
                const active = document.activeElement
                const contains = active ? view.dom.contains(active) : false
                if (active && !contains) return
            }

            if (!filePath || filePath === 'untitled.md') {
                setConfirmDialog({
                    title: 'Cannot Insert Image',
                    message: 'Please save the file first (Ctrl/Cmd+S) before inserting images.',
                    confirmText: 'OK',
                    onConfirm: () => setConfirmDialog(null),
                })
                return
            }

            const cfg = loadDefaultImagePathStrategyConfig()
            const { targetDir, relDir } = resolveImageTarget(filePath, null, cfg)

            const fileBaseName = (() => {
                const pathPart = filePath.split(/[/\\]/).pop() || ''
                const withoutExt = pathPart.replace(/\.[^./\\]+$/, '')
                return withoutExt || 'untitled'
            })()
            const suggestedName = `image_${fileBaseName}`

            try {
                const result = await invoke('save_clipboard_image_to_dir', {
                    targetDir,
                    suggestedName,
                }) as any

                const okPart = result && 'Ok' in result ? result.Ok : null
                if (!okPart) {
                    setStatusMessage(result?.Err?.error?.message || '粘贴图片失败：后端错误')
                    return
                }

                const fileName = okPart?.data?.file_name
                const relPath = `${relDir}/${fileName}`
                const snippet = `\n![图片](${relPath})\n`

                const { state } = view
                const { from, to } = state.selection.main
                view.dispatch(state.update({
                    changes: { from, to, insert: snippet },
                    selection: { anchor: from + snippet.length },
                    scrollIntoView: true,
                }))
            } catch (err) {
                setStatusMessage(`粘贴图片失败：${String(err)}`)
            }
        })

        return () => unlisten()
    }, [editorViewRef, filePath, setStatusMessage, setConfirmDialog])
}
