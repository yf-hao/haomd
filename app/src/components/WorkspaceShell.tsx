import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { ConflictModal } from './ConflictModal'
import { ConfirmDialog } from './ConfirmDialog'
import { TabBar } from './TabBar'
import { Sidebar, type SidebarContextActionPayload } from './Sidebar'
import { OutlinePanel } from './OutlinePanel'
import { Welcome } from './Welcome'
import { useOutline } from '../hooks/useOutline'
import type { OutlineItem } from '../modules/outline/parser'
import { useWorkspaceLayout } from '../hooks/useWorkspaceLayout'
import { AiChatDialog } from '../modules/ai/ui/AiChatDialog'
import type { ChatEntryMode, EntryContext } from '../modules/ai/domain/chatSession'
import { registerEditorInsertBelow } from '../modules/ai/platform/editorInsertService'
import { useFilePersistence } from '../hooks/useFilePersistence'
import { useTabs } from '../hooks/useTabs'
import { useCommandSystem } from '../hooks/useCommandSystem'
import { useSidebar } from '../hooks/useSidebar'
import { onOpenRecentFile } from '../modules/platform/menuEvents'
import { deleteFsEntry } from '../modules/files/service'
import { useNativePaste } from '../hooks/useNativePaste'
import type { EditorTab } from '../types/tabs'

const EditorPaneLazy = lazy(() =>
  import('./EditorPane').then((m) => ({ default: m.EditorPane }))
)

const PreviewPaneLazy = lazy(() =>
  import('./PreviewPane').then((m) => ({ default: m.PreviewPane }))
)

export type LeftPanelId = 'files' | 'outline' | null

export type InitialWorkspaceAction = 'new' | 'open' | 'open_folder' | 'open_recent' | null

export interface WorkspaceShellProps {
  activeLeftPanel: LeftPanelId
  isTauriEnv: () => boolean
  initialAction: InitialWorkspaceAction
  initialOpenRecentPath?: string | null
  onInitialActionHandled?: () => void
}

const seed = ''
const DEFAULT_TITLE = '未命名.md'

function formatWindowTitleFromTab(tab: EditorTab | null): string {
  if (!tab) return DEFAULT_TITLE
  const path = tab.path
  const name = path ? path.split(/[/\\]/).pop() || path : tab.title || DEFAULT_TITLE
  const prefix = tab.dirty ? '*' : ''
  return `${prefix}${name}`
}

export function WorkspaceShell({
  activeLeftPanel,
  isTauriEnv,
  initialAction,
  initialOpenRecentPath,
  onInitialActionHandled,
}: WorkspaceShellProps) {
  const [markdown, setMarkdown] = useState(seed)
  const [previewValue, setPreviewValue] = useState(seed)
  const [activeLine, setActiveLine] = useState(1)
  const [aiChatState, setAiChatState] = useState<
    | {
        open: boolean
        entryMode: ChatEntryMode
        initialContext?: EntryContext
      }
    | null
  >(null)
  const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(260)
  const [isSidebarResizing, setIsSidebarResizing] = useState(false)
  const sidebarResizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const {
    layout,
    setLayout,
    showPreview,
    setShowPreview,
    dragging,
    workspaceRef,
    effectiveLayout,
    gridTemplateColumns,
    previewWidthForRender,
    startDragging,
  } = useWorkspaceLayout()

  const MIN_SIDEBAR_WIDTH = 150
  const MAX_SIDEBAR_WIDTH = 400

  // 使用 ref 存储关闭当前标签的回调，避免循环依赖
  const closeCurrentTabRef = useRef<(() => void) | null>(null)

  const handleSidebarResizeStart = useCallback((event: any) => {
    if (!activeLeftPanel) return
    sidebarResizeStateRef.current = { startX: event.clientX, startWidth: sidebarWidth }
    setIsSidebarResizing(true)
    event.preventDefault()
    event.stopPropagation()
  }, [activeLeftPanel, sidebarWidth])

  const {
    tabs,
    activeId,
    activeTab,
    createTab,
    setActiveTab,
    closeTab,
    closeCurrentTab,
    getUnsavedTabs,
    updateActiveContent,
    updateActiveMeta,
  } = useTabs({
    onRequestCloseCurrentTab: () => {
      if (closeCurrentTabRef.current) {
        closeCurrentTabRef.current()
      }
    },
  })

  const sidebar = useSidebar()
  const previewTimerRef = useRef<number | null>(null)
  const editorViewRef = useRef<EditorView | null>(null)

  // 注册“AI 插入到编辑器”实现：在当前光标所在行的下一行插入 Markdown 文本
  useEffect(() => {
    registerEditorInsertBelow(async (text: string) => {
      const view = editorViewRef.current
      if (!view) {
        console.warn('[editorInsertService] editorView not available, skip insertMarkdownAtCursorBelow')
        return
      }
      if (!text) return

      const { state } = view
      const { main } = state.selection
      const pos = main.head
      const doc = state.doc
      const line = doc.lineAt(pos)
      const lineText = doc.sliceString(line.from, line.to)
      const isEmptyLine = lineText.trim().length === 0

      let insertText = text
      let from = line.to
      let to = line.to

      if (isEmptyLine) {
        from = line.from
        to = line.to
        insertText = text
      } else {
        insertText = '\n' + text
      }

      const tr = state.update({
        changes: { from, to, insert: insertText },
        selection: { anchor: from + insertText.length },
        scrollIntoView: true,
      })

      view.dispatch(tr)
    })
  }, [])

  const openAiChatDialog = useCallback(
    (options: { entryMode: ChatEntryMode; initialContext?: EntryContext }) => {
      setAiChatState({ open: true, ...options })
    },
    [],
  )

  const closeAiChatDialog = useCallback(() => {
    setAiChatState((prev) => (prev ? { ...prev, open: false } : prev))
  }, [])

  const getCurrentMarkdown = useCallback(() => markdown, [markdown])

  const getCurrentFileName = useCallback(() => {
    const path = activeTab?.path
    if (!path) return null
    const name = path.split(/[/\\]/).pop() || path
    return name
  }, [activeTab])

  const getCurrentSelectionText = useCallback(() => {
    const view = editorViewRef.current
    if (!view) return null
    const { main } = view.state.selection
    if (main.empty) return null
    return view.state.doc.sliceString(main.from, main.to)
  }, [])

  const outlineItems = useOutline(markdown)

  useEffect(() => {
    if (!isSidebarResizing) return

    const handleMove = (e: MouseEvent) => {
      const state = sidebarResizeStateRef.current
      if (!state) return
      const delta = e.clientX - state.startX
      let next = state.startWidth + delta
      if (next < MIN_SIDEBAR_WIDTH) next = MIN_SIDEBAR_WIDTH
      if (next > MAX_SIDEBAR_WIDTH) next = MAX_SIDEBAR_WIDTH
      setSidebarWidth(next)
    }

    const handleUp = () => {
      setIsSidebarResizing(false)
      sidebarResizeStateRef.current = null
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)

    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevUserSelect
    }
  }, [isSidebarResizing, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH])

  // Confirm Dialog State
  type ConfirmState = {
    title: string
    message: string
    confirmText?: string
    cancelText?: string
    extraText?: string
    variant?: 'default' | 'stacked'
    onConfirm: () => void
    onExtra?: () => void
  } | null

  const [confirmDialog, setConfirmDialog] = useState<ConfirmState>(null)

  // Quit Confirm Dialog State
  type QuitConfirmState = {
    unsavedCount: number
    onSaveAll: () => void
    onQuitWithoutSaving: () => void
  } | null

  const [quitConfirmDialog, setQuitConfirmDialog] = useState<QuitConfirmState>(null)

  // 切换标签时，同步编辑内容和预览内容到当前标签
  useEffect(() => {
    if (!activeId) return
    const tab = tabs.find((t) => t.id === activeId) || null
    if (!tab) return
    setMarkdown(tab.content)
    setPreviewValue(tab.content)
    setActiveLine(1)
  }, [activeId, tabs])

  // 根据当前标签更新窗口标题
  useEffect(() => {
    const title = formatWindowTitleFromTab(activeTab ?? null)
    if (!isTauriEnv()) return
    void invoke('set_title', { title }).catch((err) => {
      console.warn('set_title failed', err)
    })
  }, [activeTab, isTauriEnv])

  // 调试：观察当前 activeLine 行号（仅开发环境）
  useEffect(() => {
    if (!import.meta.env.DEV) return
    console.log('[App] activeLine =', activeLine)
  }, [activeLine])

  const persistenceOptions = {
    onSaved: (path: string) => {
      updateActiveMeta(path, false)
    },
  }

  const {
    DEFAULT_PATH,
    filePath,
    setFilePath,
    setStatusMessage,
    conflictError,
    setConflictError,
    clearRecentAll,
    save,
    saveToPath,
    saveAs,
    openFile,
    openFromPath,
    markDirty,
    hasUnsavedChanges,
    confirmLoseChanges,
    newDocument,
  } = useFilePersistence(markdown, persistenceOptions)

  // 每个标签拥有自己的保存路径：切换标签时让持久化层跟随当前标签的路径
  useEffect(() => {
    if (!activeTab) return
    setFilePath(activeTab.path)
  }, [activeTab, setFilePath])

  const handleCurrentTabClose = useCallback(() => {
    if (import.meta.env.DEV) {
      console.log('[App] handleCurrentTabClose called', { activeId })
    }
    if (!activeId) {
      console.warn('[App] 没有激活标签，无法关闭')
      return
    }

    const tab = tabs.find((t) => t.id === activeId)
    if (!tab) {
      console.warn('[App] 未找到当前标签，无法关闭', { activeId })
      return
    }

    // 如果有未保存的变更，显示确认对话框
    if (tab.dirty) {
      if (import.meta.env.DEV) {
        console.log('[App] 当前标签有未保存变更，显示确认对话框', { tabId: tab.id, title: tab.title })
      }
      setConfirmDialog({
        title: `Do you want to save changes you made to ${tab.title}?`,
        message: "Your changes will be lost if you don't save them.",
        confirmText: 'Save',
        cancelText: 'Cancel',
        extraText: "Don't Save",
        variant: 'stacked',
        onConfirm: async () => {
          if (import.meta.env.DEV) {
            console.log('[App] 用户选择保存当前标签', { tabId: tab.id })
          }
          setConfirmDialog(null)
          const result = await save()
          if ((result as any)?.ok === false) {
            setStatusMessage((result as any)?.error?.message ?? '保存失败')
            return
          }
          if (import.meta.env.DEV) {
            console.log('[App] 保存成功，关闭当前标签', { tabId: tab.id })
          }
          closeTab(activeId)
        },
        onExtra: () => {
          console.log('[App] 用户选择不保存直接关闭', { tabId: tab.id })
          setConfirmDialog(null)
          closeTab(activeId)
        },
      })
      return
    }

    // 没有未保存变更，直接关闭
    if (import.meta.env.DEV) {
      console.log('[App] 当前标签无未保存变更，直接关闭', { tabId: tab.id, title: tab.title })
    }
    closeTab(activeId)
  }, [activeId, tabs, closeTab, save, setStatusMessage])

  const handleQuit = useCallback(() => {
    if (import.meta.env.DEV) {
      console.log('[App] handleQuit called')
    }
    const unsavedTabs = getUnsavedTabs()
    if (import.meta.env.DEV) {
      console.log('[App] 检测未保存标签', { count: unsavedTabs.length })
    }

    if (unsavedTabs.length === 0) {
      // 没有未保存变更，直接退出
      if (import.meta.env.DEV) {
        console.log('[App] 没有未保存变更，直接退出')
      }
      if (isTauriEnv()) {
        void invoke('quit_app').catch((err) => {
          console.warn('[App] quit_app failed', err)
        })
      } else {
        window.close()
      }
      return
    }

    // 有未保存变更，显示确认对话框
    setQuitConfirmDialog({
      unsavedCount: unsavedTabs.length,
      onSaveAll: async () => {
        if (import.meta.env.DEV) {
          console.log('[App] 用户选择保存所有标签')
        }
        setQuitConfirmDialog(null)

        // 切换到每个未保存的标签并保存
        for (const tab of unsavedTabs) {
          if (import.meta.env.DEV) {
            console.log('[App] 切换到标签并保存', { tabId: tab.id, title: tab.title })
          }
          setActiveTab(tab.id)
          // 等待状态更新
          await new Promise((resolve) => setTimeout(resolve, 10))
          const result = await save()
          if ((result as any)?.ok === false) {
            setStatusMessage(`保存 ${tab.title} 失败: ${(result as any)?.error?.message ?? '未知错误'}`)
            if (import.meta.env.DEV) {
              console.warn('[App] 保存失败，取消退出', { tabId: tab.id })
            }
            return
          }
          if (import.meta.env.DEV) {
            console.log('[App] 标签保存成功', { tabId: tab.id })
          }
        }

        if (import.meta.env.DEV) {
          console.log('[App] 所有文件保存成功，退出')
        }
        if (isTauriEnv()) {
          void invoke('quit_app').catch((err) => {
            console.warn('[App] quit_app failed', err)
          })
        } else {
          window.close()
        }
      },
      onQuitWithoutSaving: () => {
        if (import.meta.env.DEV) {
          console.log('[App] 用户选择不保存直接退出')
        }
        setQuitConfirmDialog(null)
        if (isTauriEnv()) {
          void invoke('quit_app').catch((err) => {
            console.warn('[App] quit_app failed', err)
          })
        } else {
          window.close()
        }
      },
    })
  }, [getUnsavedTabs, isTauriEnv, save, setActiveTab, setStatusMessage])

  // 更新 ref，使 useTabs 中的回调能够访问最新的 handleCurrentTabClose
  closeCurrentTabRef.current = handleCurrentTabClose

  const handleMarkdownChange = useCallback(
    (val: string) => {
      setMarkdown(val)
      markDirty()
      updateActiveContent(val)
    },
    [markDirty, updateActiveContent],
  )

  useEffect(() => {
    if (markdown === previewValue) return
    if (previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current)
    }
    previewTimerRef.current = window.setTimeout(() => {
      setPreviewValue(markdown)
      previewTimerRef.current = null
    }, 320)

    return () => {
      if (previewTimerRef.current) {
        window.clearTimeout(previewTimerRef.current)
        previewTimerRef.current = null
      }
    }
  }, [markdown, previewValue])

  const handleManualSave = async () => {
    // 冲突重试时，已命名文件应直接保存到原路径；未命名则走保存对话框
    if (filePath !== DEFAULT_PATH) {
      await saveToPath()
    } else {
      await saveAs()
    }
  }

  const applyOpenedContent = useCallback(
    (content: string) => {
      setMarkdown(content)
      setPreviewValue(content)
      setActiveLine(1)
      // 打开文件或新文档时同步更新当前标签内容，但保持 dirty 由持久化逻辑控制
      updateActiveContent(content)
    },
    [updateActiveContent],
  )

  // 在新标签中打开指定路径的文件：先通过持久化层读取，再创建带 path+content 的标签
  const openFileInNewTab = useCallback(
    async (path: string) => {
      const resp = await openFromPath(path)
      if (!resp.ok) return resp

      const { path: realPath, content } = resp.data

      // 为该文件创建一个独立标签，标题由路径自动推导
      createTab({ path: realPath, content })

      // 同步编辑区/预览区内容到新标签
      setMarkdown(content)
      setPreviewValue(content)
      setActiveLine(1)

      return resp
    },
    [createTab, openFromPath],
  )

  // 从 Sidebar 打开文件：若已有对应标签则只激活，否则创建新标签
  const openFileFromSidebar = useCallback(
    async (path: string) => {
      // 先检查是否已经有该路径的标签
      const existing = tabs.find((t) => t.path === path)
      if (existing) {
        setActiveTab(existing.id)
        return { ok: true, data: { path: existing.path } } as any
      }

      // 没有标签时，走统一的新标签打开逻辑
      return await openFileInNewTab(path)
    },
    [tabs, setActiveTab, openFileInNewTab],
  )

  // Open Recent 专用：仅将文件加入 Sidebar 的单文件列表，不加载整个目录树
  const openRecentFileInNewTab = useCallback(
    async (path: string) => {
      const resp = await openFileInNewTab(path)
      if (!resp || !resp.ok) return resp

      sidebar.addStandaloneFile(resp.data.path)
      return resp
    },
    [openFileInNewTab, sidebar],
  )

  const openFolderInSidebar = useCallback(async () => {
    if (!isTauriEnv()) {
      setStatusMessage('Open Folder 仅在桌面环境中可用')
      return
    }

    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: '选择文档文件夹',
    })

    if (!selected) {
      setStatusMessage('已取消选择文件夹')
      return
    }

    const path = Array.isArray(selected) ? selected[0] : selected

    await sidebar.openFolderAsRoot(path as string)
    setStatusMessage(`已打开文件夹：${path}`)
  }, [isTauriEnv, sidebar, setStatusMessage])

  const closeTabsByPath = useCallback(
    (targetPath: string) => {
      const norm = targetPath
      tabs.forEach((tab) => {
        if (tab.path === norm) {
          closeTab(tab.id)
        }
      })
    },
    [tabs, closeTab],
  )

  const handleSidebarContextAction = useCallback(
    async (payload: SidebarContextActionPayload) => {
      const { path, kind, action } = payload

      if (action === 'open') {
        await openFileFromSidebar(path)
        return
      }

      if (action === 'remove') {
        if (kind === 'standalone-file') {
          sidebar.removeStandaloneFile(path)
        } else if (kind === 'folder-root') {
          sidebar.removeFolderRoot(path)
        }
        return
      }

      if (action === 'delete') {
        setConfirmDialog({
          title: '确认删除',
          message: `确认删除该文件？此操作不可撤销。\n\n${path}`,
          confirmText: '删除',
          onConfirm: async () => {
            setConfirmDialog(null)
            const resp = await deleteFsEntry(path)
            if (!resp.ok) {
              setStatusMessage(resp.error.message)
              return
            }
            sidebar.removeStandaloneFile(path)
            closeTabsByPath(path)
          },
        })
        return
      }
    },
    [openFileFromSidebar, sidebar, setStatusMessage, closeTabsByPath],
  )

  // 监听 Tauri 原生菜单中 File → Open Recent 子菜单点击事件
  // 行为：新建标签页并把文件加入 Sidebar 的单文件列表，不展开整个文件夹
  useEffect(() => {
    const unlisten = onOpenRecentFile(async (path) => {
      await openRecentFileInNewTab(path)
    })

    return () => {
      unlisten()
    }
  }, [openRecentFileInNewTab])

  useCommandSystem({
    layout,
    setLayout: setLayout as unknown as (layout: string) => void,
    setShowPreview,
    setStatusMessage,
    confirmLoseChanges,
    hasUnsavedChanges,
    newDocument,
    setFilePath,
    applyOpenedContent,
    openFile,
    save,
    saveAs,
    handleShowRecent: undefined,
    clearRecentAll,
    createTab,
    updateActiveMeta,
    openFolderInSidebar,
    closeCurrentTab,
    openAiChatDialog,
    getCurrentMarkdown,
    getCurrentFileName,
    getCurrentSelectionText,
    onRequestCloseCurrentTab: () => {
      if (closeCurrentTabRef.current) {
        closeCurrentTabRef.current()
      }
    },
    onRequestQuit: handleQuit,
    isTauriEnv,
  })

  // 监听来自原生剪贴板的粘贴事件（通过 Hook 封装）
  useNativePaste(editorViewRef, setStatusMessage)

  // Global click logger for debugging tab-close issues（仅开发环境启用）
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const handler = (e: MouseEvent) => {
      const node = e.target as Node
      const element = node instanceof Element ? node : node.parentElement
      const isTabClose = element ? element.closest('.tab-close') !== null : false

      console.log('[GLOBAL CLICK]', {
        target: (element as HTMLElement | null)?.outerHTML?.slice(0, 160) ?? String(e.target),
        isTabClose,
      })
    }
    window.addEventListener('click', handler, true)
    return () => {
      window.removeEventListener('click', handler, true)
    }
  }, [])

  const scrollEditorToLineCenter = useCallback(
    (line: number, searchText?: string) => {
      const view = editorViewRef.current
      if (!view) {
        console.warn('[scrollEditorToLineCenter] editorView not available')
        return
      }

      const totalLines = view.state.doc.lines
      const targetLine = Math.min(Math.max(line, 1), totalLines)

      // 方案3：如果提供了搜索文本，优先通过文本精确定位
      if (searchText) {
        const doc = view.state.doc
        for (let searchLine = 1; searchLine <= doc.lines; searchLine++) {
          const lineInfo = doc.line(searchLine)
          const content = doc.sliceString(lineInfo.from, lineInfo.to).trim()
          // 移除 # 符号和空格后比较
          const cleanContent = content.replace(/^#{1,6}\s+/, '').trim()

          if (cleanContent === searchText) {
            console.log('[scrollEditorToLineCenter] 通过文本找到匹配行:', searchLine, cleanContent)
            const rect = view.coordsAtPos(lineInfo.from)
            const scrollDOM = view.scrollDOM

            if (rect) {
              // 滚动到该行
              const scrollRect = scrollDOM.getBoundingClientRect()
              const lineCenter = rect.top + (rect.bottom - rect.top) / 2
              const delta = lineCenter - (scrollRect.top + scrollRect.height / 2)
              scrollDOM.scrollTo({ top: scrollDOM.scrollTop + delta })

              // 设置光标位置
              view.dispatch({
                selection: { anchor: lineInfo.from },
              })
              return
            }
          }
        }
        console.warn('[scrollEditorToLineCenter] 未找到匹配的文本:', searchText)
      }

      // 方案1：回退到行号定位（改进后的行号计算）
      const lineInfo = view.state.doc.line(targetLine)

      // 校验：检查目标行是否真的是标题行
      const lineContent = view.state.doc.sliceString(lineInfo.from, lineInfo.to)
      const isHeading = /^(#{1,6})\s/.test(lineContent)

      console.log('[scrollEditorToLineCenter]', {
        targetLine,
        lineContent: lineContent.slice(0, 60),
        isHeading,
        totalLines,
      })

      // 如果不是标题行且有搜索文本，尝试向前查找最近的标题
      if (!isHeading && searchText && targetLine > 1) {
        console.log('[scrollEditorToLineCenter] 目标行不是标题，向前查找最近标题')
        for (let prevLine = targetLine - 1; prevLine >= 1; prevLine--) {
          const prevLineInfo = view.state.doc.line(prevLine)
          const prevContent = view.state.doc.sliceString(prevLineInfo.from, prevLineInfo.to)
          const prevClean = prevContent.replace(/^#{1,6}\s+/, '').trim()
          if (prevClean === searchText) {
            console.log('[scrollEditorToLineCenter] 向前找到匹配标题:', prevLine)
            const rect = view.coordsAtPos(prevLineInfo.from)
            if (rect) {
              const scrollDOM = view.scrollDOM
              const scrollRect = scrollDOM.getBoundingClientRect()
              const lineCenter = rect.top + (rect.bottom - rect.top) / 2
              const delta = lineCenter - (scrollRect.top + scrollRect.height / 2)
              scrollDOM.scrollTo({ top: scrollDOM.scrollTop + delta })

              view.dispatch({
                selection: { anchor: prevLineInfo.from },
              })
              return
            }
          }
        }
      }

      // 使用编辑器内坐标 + DOM 计算，将目标行尽量滚动到编辑区中间
      const rect = view.coordsAtPos(lineInfo.from)
      const scrollDOM = view.scrollDOM
      if (!rect) {
        console.warn('[scrollEditorToLineCenter] 无法获取行坐标，line:', targetLine)
        return
      }

      const scrollRect = scrollDOM.getBoundingClientRect()
      const lineCenter = rect.top + (rect.bottom - rect.top) / 2
      const delta = lineCenter - (scrollRect.top + scrollRect.height / 2)

      scrollDOM.scrollTo({ top: scrollDOM.scrollTop + delta })

      view.dispatch({
        selection: { anchor: lineInfo.from },
      })
    },
    [editorViewRef],
  )

  const handleOutlineSelect = useCallback(
    (item: OutlineItem) => {
      setActiveOutlineId(item.id)
      scrollEditorToLineCenter(item.line, item.searchText)
    },
    [scrollEditorToLineCenter],
  )

  const handleTabClose = useCallback(
    (id: string) => {
      closeTab(id)
    },
    [closeTab],
  )

  const handleTabSaveAndClose = useCallback(
    async (id: string) => {
      console.log('[App] handleTabSaveAndClose called', { id, activeId, tabsCount: tabs.length })
      const isActive = id === activeId

      // 非激活标签：目前不支持跨标签保存，提示用户可能丢失修改
      if (!isActive) {
        console.log('[App] non-active tab save+close requested', { id, activeId })
        const tab = tabs.find((t) => t.id === id)
        setConfirmDialog({
          title: '无法保存非激活标签',
          message: `标签 "${tab?.title || '未命名'}" 有未保存的更改，但只能保存当前激活的标签。\n\n关闭将丢弃所有更改，是否继续？`,
          confirmText: '丢弃并关闭',
          onConfirm: () => {
            setConfirmDialog(null)
            closeTab(id)
          },
        })
        return
      }

      console.log('[App] active tab save+close requested, showing save confirm', { id })
      const tab = tabs.find((t) => t.id === id)
      const displayName = tab?.title || 'Untitled'
      setConfirmDialog({
        title: `Do you want to save the changes you made to ${displayName}?`,
        message: "Your changes will be lost if you don't save them.",
        confirmText: 'Save',
        cancelText: 'Cancel',
        extraText: "Don't Save",
        variant: 'stacked',
        onConfirm: async () => {
          setConfirmDialog(null)
          const result = await save()
          console.log('[App] save result for tab', { id, result })
          if ((result as any)?.ok === false) {
            setStatusMessage((result as any)?.error?.message ?? '保存失败')
            return
          }
          console.log('[App] save succeeded, closing tab', { id })
          closeTab(id)
        },
        onExtra: () => {
          setConfirmDialog(null)
          console.log('[App] discard changes and close tab', { id })
          closeTab(id)
        },
      })
      return
    },
    [activeId, closeTab, save, setStatusMessage, tabs],
  )

  // 根据 initialAction 在第一次进入工作区时执行新建/打开/打开文件夹/打开最近文件
  const initialActionHandledRef = useRef(false)
  useEffect(() => {
    if (!initialAction || initialActionHandledRef.current) return

    if (initialAction === 'new') {
      createTab()
    } else if (initialAction === 'open') {
      void openFile()
    } else if (initialAction === 'open_folder') {
      void openFolderInSidebar()
    } else if (initialAction === 'open_recent' && initialOpenRecentPath) {
      void openRecentFileInNewTab(initialOpenRecentPath)
    } else {
      return
    }

    initialActionHandledRef.current = true
    onInitialActionHandled?.()
  }, [initialAction, initialOpenRecentPath, createTab, openFile, openFolderInSidebar, openRecentFileInNewTab, onInitialActionHandled])

  return (
    <>
      {activeLeftPanel === 'files' && (
        <Sidebar
          standaloneFiles={sidebar.standaloneFiles}
          folderRoots={sidebar.folderRoots}
          treesByRoot={sidebar.treesByRoot}
          expanded={sidebar.expanded}
          onToggle={sidebar.toggleNode}
          onFileClick={openFileFromSidebar}
          onContextAction={handleSidebarContextAction}
          activePath={activeTab?.path ?? null}
          panelWidth={sidebarWidth}
        />
      )}

      {activeLeftPanel === 'outline' && (
        <OutlinePanel
          items={outlineItems}
          activeId={activeOutlineId}
          onSelect={handleOutlineSelect}
          panelWidth={sidebarWidth}
        />
      )}

      {(activeLeftPanel === 'files' || activeLeftPanel === 'outline') && (
        <div
          className={`sidebar-resizer ${isSidebarResizing ? 'active' : ''}`}
          onMouseDown={handleSidebarResizeStart}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
        />
      )}

      <div className="workspace-column">
        {tabs.length === 0 ? (
          <Welcome
            onNewFile={() => createTab()}
            onOpenFile={() => openFile()}
          />
        ) : (
          <>
            <TabBar
              tabs={tabs}
              activeId={activeId}
              onTabClick={setActiveTab}
              onTabClose={handleTabClose}
              onRequestSaveAndClose={handleTabSaveAndClose}
            />
            <main
              className={`workspace ${dragging ? 'dragging' : ''}`}
              style={{ gridTemplateColumns }}
              ref={workspaceRef}
            >
              <section
                className="pane"
                style={
                  effectiveLayout === 'preview-only'
                    ? { display: 'none' }
                    : effectiveLayout === 'preview-left'
                      ? { gridColumn: '2 / 3', gridRow: '1 / 2' }
                      : effectiveLayout === 'preview-right'
                        ? { gridColumn: '1 / 2', gridRow: '1 / 2' }
                        : { gridColumn: '1 / -1', gridRow: '1 / 2' }
                }
              >
                <Suspense fallback={<div className="code-editor" />}>
                  <EditorPaneLazy
                    markdown={markdown}
                    onChange={handleMarkdownChange}
                    onCursorChange={setActiveLine}
                    showPreview={showPreview}
                    setShowPreview={setShowPreview}
                    editorViewRef={editorViewRef}
                  />
                </Suspense>
              </section>

              <Suspense
                fallback={
                  <section className="pane preview">
                    <div className="preview-body" />
                  </section>
                }
              >
                <PreviewPaneLazy
                  value={previewValue}
                  activeLine={activeLine}
                  previewWidth={previewWidthForRender}
                  effectiveLayout={effectiveLayout}
                />
              </Suspense>

              {(effectiveLayout === 'preview-left' || effectiveLayout === 'preview-right') && (
                <div
                  className={`divider-hotzone ${dragging ? 'active' : ''}`}
                  style={{
                    left:
                      effectiveLayout === 'preview-left'
                        ? `${previewWidthForRender}%`
                        : `${100 - previewWidthForRender}%`,
                  }}
                  onMouseDown={startDragging}
                >
                  <div className="divider-rail">
                    <span className="divider-handle" />
                  </div>
                </div>
              )}
            </main>
          </>
        )}
      </div>

      {conflictError && (
        <ConflictModal
          error={conflictError}
          onRetrySave={handleManualSave}
          onCancel={() => setConflictError(null)}
        />
      )}

      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmText={confirmDialog.confirmText}
          cancelText={confirmDialog.cancelText}
          extraText={confirmDialog.extraText}
          variant={confirmDialog.variant}
          onConfirm={confirmDialog.onConfirm}
          onExtra={confirmDialog.onExtra}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {quitConfirmDialog && (
        <ConfirmDialog
          title={
            quitConfirmDialog.unsavedCount === 1
              ? 'Do you want to save the changes you made to 1 file?'
              : `Do you want to save the changes you made to ${quitConfirmDialog.unsavedCount} files?`
          }
          message="Your changes will be lost if you don't save them."
          confirmText="Save All"
          cancelText="Cancel"
          extraText="Don't Save"
          variant="stacked"
          onConfirm={quitConfirmDialog.onSaveAll}
          onExtra={quitConfirmDialog.onQuitWithoutSaving}
          onCancel={() => setQuitConfirmDialog(null)}
        />
      )}

      {aiChatState && (
        <AiChatDialog
          open={aiChatState.open}
          entryMode={aiChatState.entryMode}
          initialContext={aiChatState.initialContext}
          onClose={closeAiChatDialog}
        />
      )}
    </>
  )
}

export default WorkspaceShell
