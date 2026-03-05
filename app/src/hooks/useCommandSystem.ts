import { useCallback, useEffect, useMemo } from 'react'
import type { CommandContext, CommandRegistry } from '../modules/commands/registry'
import { createCommandRegistry } from '../modules/commands/registry'
import { onMenuAction } from '../modules/platform/menuEvents'
import type { IAiClient } from '../modules/ai/client'
import { createDefaultAiClient } from '../modules/ai/client'

export type CommandSystemParams = CommandContext & {
  /**
   * 可选的环境检查函数，用于区分 Tauri / 非 Tauri 环境
   */
  isTauriEnv?: () => boolean
  onRequestCloseCurrentTab?: () => void
  onRequestQuit?: () => void
  /**
   * 可选的 AI 客户端实现，默认使用基于 AI Settings 的实现。
   */
  aiClient?: IAiClient
}

export function useCommandSystem(params: CommandSystemParams) {
  const {
    layout,
    setLayout,
    setShowPreview,
    setStatusMessage,
    aiChatMode,
    setAiChatMode,
    aiChatDockSide,
    setAiChatDockSide,
    aiChatOpen,
    confirmLoseChanges,
    hasUnsavedChanges,
    newDocument,
    setFilePath,
    applyOpenedContent,
    openFile,
    save,
    saveAs,
    handleShowRecent,
    clearRecentAll,
    createTab,
    updateActiveMeta,
    openFolderInSidebar,
    toggleSidebarVisible,
    closeCurrentTab,
    isTauriEnv,
    onRequestCloseCurrentTab,
    onRequestQuit,
    aiClient: aiClientFromParams,
    openAiChatDialog,
    openGlobalMemoryDialog,
    openAboutDialog,
    getCurrentMarkdown,
    getCurrentFileName,
    getCurrentSelectionText,
    getCurrentFilePath,
    openDocConversationsHistory,
    addStandaloneFile,
    refreshPdfRecent,
    exportHtml,
    exportPdf,
  } = params

  const aiClient = useMemo<IAiClient>(() => {
    return aiClientFromParams ?? createDefaultAiClient()
  }, [aiClientFromParams])

  const commands: CommandRegistry = useMemo(
    () =>
      createCommandRegistry({
        layout,
        setLayout,
        setShowPreview,
        setStatusMessage,
        aiChatMode,
        setAiChatMode,
        aiChatDockSide,
        setAiChatDockSide,
        aiChatOpen,
        confirmLoseChanges,
        hasUnsavedChanges,
        newDocument,
        setFilePath,
        applyOpenedContent,
        openFile,
        save,
        saveAs,
        handleShowRecent,
        clearRecentAll,
        createTab,
        updateActiveMeta,
        openFolderInSidebar,
        toggleSidebarVisible,
        closeCurrentTab,
        onRequestCloseCurrentTab,
        onRequestQuit,
        aiClient,
        openAiChatDialog,
        openGlobalMemoryDialog,
        openAboutDialog,
        getCurrentMarkdown,
        getCurrentFileName,
        getCurrentSelectionText,
        getCurrentFilePath,
        openDocConversationsHistory,
        addStandaloneFile,
        refreshPdfRecent,
        exportHtml,
        exportPdf,
      }),
    [
      layout,
      setLayout,
      setShowPreview,
      setStatusMessage,
      aiChatMode,
      setAiChatMode,
      aiChatDockSide,
      setAiChatDockSide,
      aiChatOpen,
      confirmLoseChanges,
      hasUnsavedChanges,
      newDocument,
      setFilePath,
      applyOpenedContent,
      openFile,
      save,
      saveAs,
      handleShowRecent,
      clearRecentAll,
      createTab,
      updateActiveMeta,
      openFolderInSidebar,
      toggleSidebarVisible,
      closeCurrentTab,
      onRequestCloseCurrentTab,
      onRequestQuit,
      aiClient,
      openAiChatDialog,
      openGlobalMemoryDialog,
      openAboutDialog,
      getCurrentMarkdown,
      getCurrentFileName,
      getCurrentSelectionText,
      getCurrentFilePath,
      openDocConversationsHistory,
      addStandaloneFile,
      refreshPdfRecent,
      exportHtml,
      exportPdf,
    ],
  )

  const dispatchAction = useCallback(
    async (action: string) => {
      const handler = commands[action]
      if (!handler) {
        setStatusMessage('暂未实现的菜单')
        return
      }
      await Promise.resolve(handler())
    },
    [commands, setStatusMessage],
  )

  // 统一处理快捷键映射
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      if (!meta) return

      // 避免在 Tauri Mac 中与系统菜单快捷键（会发 menu://action 事件）重复触发。
      // Windows/Linux 下原生菜单加速键响应不如 Mac 稳定，且 JS 处理与原生通常不冲突，因此仅在 Mac 下阻断。
      const tauriBlocks = ['s', 'o', 'n', 'w'] as const
      const isMac = typeof navigator !== 'undefined' && /macintosh|mac os x/i.test(navigator.userAgent)
      if (isTauriEnv && isTauriEnv() && isMac && tauriBlocks.includes(key as (typeof tauriBlocks)[number])) return

      if (key === 's') {
        e.preventDefault()
        if (e.shiftKey) {
          void dispatchAction('save_as')
        } else {
          void dispatchAction('save')
        }
      } else if (key === 'o') {
        e.preventDefault()
        if (e.shiftKey) {
          void dispatchAction('open_folder')
        } else {
          void dispatchAction('open_file')
        }
      } else if (key === 'n') {
        e.preventDefault()
        void dispatchAction('new_file')
      } else if (key === 'w') {
        e.preventDefault()
        void dispatchAction('close_file')
      } else if (key === 'p') {
        e.preventDefault()
        if (e.shiftKey) {
          void dispatchAction('toggle_preview_only')
        } else {
          void dispatchAction('toggle_preview')
        }
      } else if (key === 'c') {
        // 额外兜底一次复制命令，避免某些环境下系统菜单未生效
        void dispatchAction('copy')
      } else if (key === 'x') {
        // 额外兜底一次剪切命令，避免某些环境下系统菜单未生效
        void dispatchAction('cut')
      } else if (key === 'h') {
        if (e.altKey) {
          e.preventDefault()
          void dispatchAction('open_recent')
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dispatchAction, isTauriEnv])

  // 统一处理来自 Tauri 原生菜单的命令分发
  useEffect(() => {
    const unlisten = onMenuAction((actionId) => {
      // 这些菜单在 App 层或其他地方单独处理，这里忽略
      if (actionId === 'ai_settings' || actionId === 'ai_prompt_settings' || actionId === 'toggle_status_bar') return
      console.log('[useCommandSystem] Native menu action triggered:', actionId)
      void dispatchAction(actionId)
    })

    return () => {
      unlisten()
    }
  }, [dispatchAction])

  return { commands, dispatchAction }
}
