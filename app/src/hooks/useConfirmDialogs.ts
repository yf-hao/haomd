import { useCallback, useState } from 'react'
import type { Result } from '../modules/files/types'

export type ConfirmState = {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  extraText?: string
  variant?: 'default' | 'stacked'
  onConfirm: () => void
  onExtra?: () => void
} | null

export type QuitConfirmState = {
  unsavedCount: number
  onSaveAll: () => void
  onQuitWithoutSaving: () => void
} | null

export function useConfirmDialog() {
  const [confirmDialog, setConfirmDialog] = useState<ConfirmState>(null)

  const showConfirm = useCallback(
    (options: Omit<NonNullable<ConfirmState>, 'onConfirm'> & { onConfirm: () => void }) => {
      setConfirmDialog({ ...options })
    },
    [],
  )

  const hideConfirm = useCallback(() => setConfirmDialog(null), [])

  return { confirmDialog, showConfirm, hideConfirm, setConfirmDialog }
}

export function useQuitConfirmDialog(options: {
  getUnsavedTabs: () => { id: string; title: string }[]
  isTauriEnv: () => boolean
  save: () => Promise<Result<unknown>>
  setActiveTab: (id: string) => void
  setStatusMessage: (msg: string) => void
}) {
  const { getUnsavedTabs, isTauriEnv, save, setActiveTab, setStatusMessage } = options
  const [quitConfirmDialog, setQuitConfirmDialog] = useState<QuitConfirmState>(null)

  const requestQuit = useCallback(() => {
    const unsavedTabs = getUnsavedTabs()

    if (unsavedTabs.length === 0) {
      if (isTauriEnv()) {
        ;(window as any).__TAURI__?.core.invoke('quit_app').catch((err: unknown) => {
          console.warn('[App] quit_app failed', err)
        })
      } else {
        window.close()
      }
      return
    }

    setQuitConfirmDialog({
      unsavedCount: unsavedTabs.length,
      onSaveAll: async () => {
        setQuitConfirmDialog(null)

        for (const tab of unsavedTabs) {
          setActiveTab(tab.id)
          await new Promise((resolve) => setTimeout(resolve, 10))
          const result = await save()
          if ((result as any)?.ok === false) {
            setStatusMessage(`保存 ${tab.title} 失败: ${(result as any)?.error?.message ?? '未知错误'}`)
            return
          }
        }

        if (isTauriEnv()) {
          ;(window as any).__TAURI__?.core.invoke('quit_app').catch((err: unknown) => {
            console.warn('[App] quit_app failed', err)
          })
        } else {
          window.close()
        }
      },
      onQuitWithoutSaving: () => {
        setQuitConfirmDialog(null)
        if (isTauriEnv()) {
          ;(window as any).__TAURI__?.core.invoke('quit_app').catch((err: unknown) => {
            console.warn('[App] quit_app failed', err)
          })
        } else {
          window.close()
        }
      },
    })
  }, [getUnsavedTabs, isTauriEnv, save, setActiveTab, setStatusMessage])

  return { quitConfirmDialog, setQuitConfirmDialog, requestQuit }
}
