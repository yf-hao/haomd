import { useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { onOpenRecentFile } from '../modules/platform/menuEvents'
import { onExternalOpenFile, type ExternalOpenPayload } from '../modules/platform/externalOpenEvents'
import type { EditorTab } from '../types/tabs'
import { getFilePathIdentity } from '../modules/files/filePathState'

export type NativeBridgeOptions = {
    activeTab: EditorTab | null
    isTauriEnv: () => boolean
    sidebar: any
    openRecentFileInNewTab: (path: string) => Promise<any>
}

export function useNativeBridge(options: NativeBridgeOptions) {
    const {
        activeTab,
        isTauriEnv,
        sidebar,
        openRecentFileInNewTab,
    } = options
    const recentExternalOpenRef = useRef(new Map<string, number>())

    // Window Title：不在标题栏显示任何文字
    useEffect(() => {
        const title = ''
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

    useEffect(() => {
        if (!isTauriEnv()) return

        const dedupeWindowMs = 1500

        const handleExternalOpen = async ({ path, isFolder }: ExternalOpenPayload) => {
            const now = Date.now()
            const key = `${isFolder ? 'dir' : 'file'}:${getFilePathIdentity(path)}`
            const lastHandledAt = recentExternalOpenRef.current.get(key)
            if (lastHandledAt && now - lastHandledAt < dedupeWindowMs) return
            recentExternalOpenRef.current.set(key, now)

            if (isFolder) {
                await sidebar.openFolderAsRoot(path)
            } else {
                await openRecentFileInNewTab(path)
            }
        }

        const unlisten = onExternalOpenFile((payload) => {
            void handleExternalOpen(payload)
        })

        void invoke<ExternalOpenPayload[]>('take_pending_external_open_items')
            .then((items) => Promise.all(items.map((item) => handleExternalOpen(item))))
            .catch((err) => {
                console.warn('[useNativeBridge] take_pending_external_open_items failed', err)
            })

        return () => unlisten()
    }, [isTauriEnv, openRecentFileInNewTab, sidebar])
}
