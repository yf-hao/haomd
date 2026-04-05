import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { CommandContext, CommandRegistry } from '../modules/commands/registry'
import { createCommandRegistry } from '../modules/commands/registry'
import { onMenuAction } from '../modules/platform/menuEvents'
import type { IAiClient } from '../modules/ai/client'
import { createDefaultAiClient } from '../modules/ai/client'
import {
  getUiTypographySettings,
  loadEditorSettings,
  saveEditorSettings,
} from '../modules/settings/editorSettings'
import { applyUiTypography, emitUiTypographyChanged } from '../modules/settings/uiTypographyRuntime'

export type CommandSystemParams = CommandContext & {
  /**
   * 可选的环境检查函数，用于区分 Tauri / 非 Tauri 环境
   */
  isTauriEnv?: () => boolean
  onRequestCloseCurrentTab?: () => void
  onRequestQuit?: () => void
  /**
   * 由 WorkspaceShell 提供，用于命令系统层关闭 AI Chat（实现 Cmd+K toggle）。
   */
  closeAiChatDialog?: () => void
  /**
   * 打开“插入表格”对话框的 UI 回调，由 WorkspaceShell 提供。
   */
  openInsertTableDialog?: () => void
  /**
   * 打开"数学符号"对话框的 UI 回调，由 WorkspaceShell 提供。
   */
  openMathSymbolDialog?: (categoryKey: string) => void
  /**
   * 打开最近文件模态窗的 UI 回调，由 WorkspaceShell 提供。
   */
  openRecentDialog?: () => void
  /**
   * 可选的 AI 客户端实现，默认使用基于 AI Settings 的实现。
   */
  aiClient?: IAiClient
  t?: (key: string, params?: Record<string, string | number>) => string
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
    aiChatOpenRef,
    editorZoom,
    setEditorZoom,
    editMode,
    setEditMode,
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
    exportWord,
    openSearch,
    closeAiChatDialog,
    openInsertTableDialog,
    openMathSymbolDialog,
    openRecentDialog,
    t,
  } = params

  const aiChatOpeningRef = useRef(false)
  const isAiChatOpen = useCallback(() => aiChatOpenRef?.current ?? aiChatOpen, [aiChatOpenRef, aiChatOpen])
  const isAiChatOpening = useCallback(() => aiChatOpeningRef.current, [])
  const setAiChatOpening = useCallback((opening: boolean) => {
    aiChatOpeningRef.current = opening
  }, [])

  const aiClient = useMemo<IAiClient>(() => {
    return aiClientFromParams ?? createDefaultAiClient()
  }, [aiClientFromParams])

  const adjustWysiwygFontSize = useCallback(async (delta: number) => {
    const typography = await getUiTypographySettings()
    const next = Math.min(24, Math.max(10, typography.wysiwygFontSize + delta))
    if (next === typography.wysiwygFontSize) return

    const nextTypography = {
      ...typography,
      wysiwygFontSize: next,
    }

    applyUiTypography(nextTypography)
    emitUiTypographyChanged(nextTypography)

    const settings = await loadEditorSettings()
    await saveEditorSettings({
      ...settings,
      uiTypography: {
        ...(settings.uiTypography ?? {}),
        wysiwygFontSize: next,
      },
    })
    setStatusMessage(`WYSIWYG Font: ${next}px`)
  }, [setStatusMessage])

  const commands: CommandRegistry = useMemo(
    () =>
      // createCommandRegistry only stores callbacks; ref access happens later in command handlers, not during render.
      // eslint-disable-next-line react-hooks/refs
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
        isAiChatOpen,
        isAiChatOpening,
        setAiChatOpening,
        editorZoom,
        setEditorZoom,
        editMode,
        setEditMode,
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
        exportWord,
        openSearch,
        openInsertTableDialog,
        openMathSymbolDialog,
        closeAiChatDialog,
        openRecentDialog,
        t,
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
      isAiChatOpen,
      isAiChatOpening,
      setAiChatOpening,
      editorZoom,
      setEditorZoom,
      editMode,
      setEditMode,
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
      exportWord,
      openSearch,
      openInsertTableDialog,
      openMathSymbolDialog,
      closeAiChatDialog,
      t,
    ],
  )

  const dispatchAction = useCallback(
    async (action: string) => {
      const handler = commands[action]
      if (!handler) {
        setStatusMessage(t?.('commands.menuNotImplemented') ?? '暂未实现的菜单')
        return
      }
      await Promise.resolve(handler())
    },
    [commands, setStatusMessage],
  )

  // 统一处理快捷键映射
  useEffect(() => {
    const isEditableElement = (el: Element | null): boolean => {
      if (!el) return false
      const tag = el.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return true
      if (el instanceof HTMLElement && el.isContentEditable) return true
      return false
    }

    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      if (!meta) return

      const isMac = typeof navigator !== 'undefined' && /macintosh|mac os x/i.test(navigator.userAgent)
      const isTauri = typeof isTauriEnv === 'function' && !!isTauriEnv()
      const isWysiwygMode = editMode === 'wysiwyg'

      // 避免在 Tauri Mac 中与系统菜单快捷键（会发 menu://action 事件）重复触发。
      // Windows/Linux 下原生菜单加速键响应不如 Mac 稳定，且 JS 处理与原生通常不冲突，因此仅在 Mac 下阻断。
      const tauriBlocks = ['s', 'o', 'n', 'w', 'k', 'l', 'd', 'f'] as const
      if (isTauri && isMac && tauriBlocks.includes(key as (typeof tauriBlocks)[number])) return

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
      } else if (key === 'c' && e.altKey) {
        if (isWysiwygMode) return
        e.preventDefault()
        void dispatchAction('format_insert_code_block')
      } else if (key === 'c') {
        // Tauri 下的复制交给系统 / WebView 处理，避免与原生快捷键或菜单重复触发。
        if (isTauri) return
        const active = (typeof document !== 'undefined'
          ? (document.activeElement as Element | null)
          : null)
        if (isEditableElement(active)) {
          void dispatchAction('copy')
        }
      } else if (key === 'x') {
        // Tauri 下的剪切交给系统 / WebView 处理，避免与原生快捷键或菜单重复触发。
        if (isTauri) return
        const active = (typeof document !== 'undefined'
          ? (document.activeElement as Element | null)
          : null)
        if (isEditableElement(active)) {
          void dispatchAction('cut')
        }
      } else if (key === 'k') {
        e.preventDefault()
        e.stopPropagation()
        if (typeof document !== 'undefined') {
          const active = document.activeElement
          if (isEditableElement(active)) {
            ;(active as HTMLElement).blur()
          }
        }
        void dispatchAction('ai_chat')
      } else if (key === 'd') {
        e.preventDefault()
        void dispatchAction('ai_ask_file')
      } else if (key === 'l') {
        e.preventDefault()
        void dispatchAction('ai_ask_selection')
      } else if (key === 'h') {
        if (e.altKey) {
          e.preventDefault()
          void dispatchAction('open_recent')
        }
      } else if (key === 'f') {
        e.preventDefault()
        void dispatchAction('find')
      } else if (key === '=' || key === '+') {
        if (isWysiwygMode) {
          e.preventDefault()
          void adjustWysiwygFontSize(1)
          return
        }
        // Zoom In: Ctrl+=  (Windows/Linux 下原生菜单加速键不稳定，需 JS 兜底；
        // 同时 preventDefault 阻止 WebView2 默认缩放)
        if (isTauri && isMac && !isWysiwygMode) return
        e.preventDefault()
        void dispatchAction('zoom_in')
      } else if (key === '-') {
        if (isWysiwygMode) {
          e.preventDefault()
          void adjustWysiwygFontSize(-1)
          return
        }
        // Zoom Out: Ctrl+-
        if (isTauri && isMac && !isWysiwygMode) return
        e.preventDefault()
        void dispatchAction('zoom_out')
      } else if (key === '0' && e.shiftKey) {
        // Reset Zoom: Ctrl+Shift+0
        if (isTauri && isMac && editMode !== 'wysiwyg') return
        e.preventDefault()
        void dispatchAction('zoom_reset')
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [adjustWysiwygFontSize, dispatchAction, editMode, isTauriEnv])

  // 统一处理来自 Tauri 原生菜单的命令分发
  useEffect(() => {
    const unlisten = onMenuAction((actionId) => {
      // 这些菜单在 App 层或其他地方单独处理，这里忽略
      if (actionId === 'haomd_settings' || actionId === 'ai_settings' || actionId === 'agent_settings' || actionId === 'ai_prompt_settings' || actionId === 'toggle_status_bar') return
      void dispatchAction(actionId)
    })

    return () => {
      unlisten()
    }
  }, [dispatchAction])

  return { commands, dispatchAction }
}
