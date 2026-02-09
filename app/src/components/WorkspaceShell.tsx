import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { ConflictModal } from './ConflictModal'
import { ConfirmDialog } from './ConfirmDialog'
import { TabBar } from './TabBar'
import { Sidebar } from './Sidebar'
import { OutlinePanel } from './OutlinePanel'
import { Welcome } from './Welcome'
import { useOutline } from '../hooks/useOutline'
import type { OutlineItem } from '../modules/outline/parser'
import { useWorkspaceLayout } from '../hooks/useWorkspaceLayout'
import { AiChatDialog } from '../modules/ai/ui/AiChatDialog'
import type { ChatEntryMode, EntryContext } from '../modules/ai/domain/chatSession'
import { useFilePersistence } from '../hooks/useFilePersistence'
import { useTabs } from '../hooks/useTabs'
import { useCommandSystem } from '../hooks/useCommandSystem'
import { useSidebar } from '../hooks/useSidebar'
import { useSidebarActions } from '../hooks/useSidebarActions'
import { useConfirmDialog } from '../hooks/useConfirmDialogs'
import { onOpenRecentFile } from '../modules/platform/menuEvents'
import { deleteFsEntry } from '../modules/files/service'
import { useNativePaste } from '../hooks/useNativePaste'
import { registerEditorInsertBelow } from '../modules/ai/platform/editorInsertService'
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
  // 记录上一次激活的标签 id，用于避免在每次内容变更时重置 activeLine
  const prevActiveIdRef = useRef<string | null>(null)

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


  // 切换标签时，同步编辑内容和预览内容到当前标签
  useEffect(() => {
    if (!activeId) return

    // 仅在激活标签真正发生变更时才重置内容和 activeLine，
    // 避免因为 tabs 内容更新（打字）导致 activeLine 每次被重置为 1
    if (prevActiveIdRef.current === activeId) return
    prevActiveIdRef.current = activeId

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

    // 计算当前和之前的换行数
    const currentLineCount = (markdown.match(/\\n/g) || []).length
    const previousLineCount = (previewValue.match(/\\n/g) || []).length

    // 调试输出
    console.log('[PreviewUpdate]', {
      activeLine: activeLine,
      markdownLineCount: currentLineCount,
      previewLineCount: previousLineCount,
      markdownLength: markdown.length,
      previewLength: previewValue.length,
      hasCodeBlock: markdown.includes('```'),
      hasMath: markdown.includes('$'),
      hasHeading: markdown.startsWith('# '),
    })

    // 智能检测：判断是否需要渲染预览（暂时放宽为：只要内容变化就渲染）
    const shouldRender = true

    console.log('[PreviewUpdate] shouldRender:', shouldRender)

    if (shouldRender && previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current)
    }

    if (shouldRender) {
      // 换行或其他重大变化时，稍微延迟渲染
      previewTimerRef.current = window.setTimeout(() => {
        setPreviewValue(markdown)
        previewTimerRef.current = null
        console.log('[PreviewUpdate] Rendering preview...')
      }, 100)
    }

    return () => {
      if (previewTimerRef.current) {
        window.clearTimeout(previewTimerRef.current)
        previewTimerRef.current = null
      }
    }
  }, [markdown, previewValue, activeLine])

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


  const { confirmDialog, setConfirmDialog } = useConfirmDialog()

  // 退出确认对话框状态
  type QuitConfirmState = {
    unsavedCount: number
    onSaveAll: () => void
    onQuitWithoutSaving: () => void
  } | null

  const [quitConfirmDialog, setQuitConfirmDialog] = useState<QuitConfirmState>(null)

  const sidebarActions = useSidebarActions({
    tabs,
    setActiveTab,
    openFileInNewTab,
    sidebar,
    deleteFsEntry,
    setStatusMessage,
    closeTab,
    setConfirmDialog,
  })

  // 监听 Tauri 原生菜单中 File → Open Recent 子菜单点击事件
  // 行为：新建标签页并把文件加入 Sidebar 的单文件列表，不展开整个文件夹
  useEffect(() => {
    const unlisten = onOpenRecentFile(async (path) => {
      await sidebarActions.openRecentFileInNewTab(path)
    })

    return () => {
      unlisten()
    }
  }, [sidebarActions])

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
    onRequestQuit: () => {
      if (import.meta.env.DEV) {
        console.log('[App] handleQuit called')
      }

      const unsavedTabs = getUnsavedTabs()

      // 没有未保存文件：也弹一次确认，防止误触 Cmd+Q
      if (unsavedTabs.length === 0) {
        setConfirmDialog({
          title: 'Quit HaoMD?',
          message: 'Are you sure you want to quit HaoMD?',
          confirmText: 'Quit',
          cancelText: 'Cancel',
          onConfirm: () => {
            setConfirmDialog(null)
            if (isTauriEnv()) {
              void invoke('quit_app').catch((err) => {
                console.warn('[App] quit_app failed', err)
              })
            } else {
              window.close()
            }
          },
        })
        return
      }

      // 有未保存文件：使用原有的「Save All / Don't Save」对话框
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
            void invoke('quit_app').catch((err) => {
              console.warn('[App] quit_app failed', err)
            })
          } else {
            window.close()
          }
        },
        onQuitWithoutSaving: () => {
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
    },
    isTauriEnv,
  })

  // 监听来自原生剪贴板的粘贴事件（通过 Hook 封装）
  useNativePaste(editorViewRef, setStatusMessage)

  // 全局支持在输入框中使用 Cmd/Ctrl+A 全选，仅作用于 input/textarea
  useEffect(() => {
    const handleSelectAll = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey
      if (!isMeta) return

      const key = e.key.toLowerCase()
      if (key !== 'a') return

      const active = document.activeElement as HTMLElement | null
      if (!active) return

      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        e.preventDefault()
        e.stopPropagation()
        active.select()
      }
    }

    // 使用 capture 阶段，优先于其他监听器处理
    window.addEventListener('keydown', handleSelectAll, true)
    return () => {
      window.removeEventListener('keydown', handleSelectAll, true)
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
        // 搜索文本未找到是正常情况（防抖期间编辑器内容可能已变化），使用行号定位即可
        console.log('[scrollEditorToLineCenter] 搜索文本未找到，使用行号定位:', searchText)
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

      // 至少设置光标位置
      view.dispatch({
        selection: { anchor: lineInfo.from },
      })

      if (!rect) {
        // 如果无法获取坐标（可能视图未渲染），使用估算的行高滚动
        const estimatedLineHeight = 24 // CodeMirror 默认行高
        const estimatedPos = (targetLine - 1) * estimatedLineHeight
        const scrollRect = scrollDOM.getBoundingClientRect()
        const centerOffset = scrollRect.height / 2 - estimatedLineHeight / 2

        scrollDOM.scrollTo({ top: Math.max(0, estimatedPos - centerOffset) })
        console.log('[scrollEditorToLineCenter] 使用估算行高滚动，line:', targetLine)
        return
      }

      const scrollRect = scrollDOM.getBoundingClientRect()
      const lineCenter = rect.top + (rect.bottom - rect.top) / 2
      const delta = lineCenter - (scrollRect.top + scrollRect.height / 2)

      scrollDOM.scrollTo({ top: scrollDOM.scrollTop + delta })
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
      void sidebarActions.openRecentFileInNewTab(initialOpenRecentPath)
    } else {
      return
    }

    initialActionHandledRef.current = true
    onInitialActionHandled?.()
  }, [initialAction, initialOpenRecentPath, createTab, openFile, openFolderInSidebar, sidebarActions, onInitialActionHandled])

  return (
    <>
      {activeLeftPanel === 'files' && (
        <Sidebar
          standaloneFiles={sidebar.standaloneFiles}
          folderRoots={sidebar.folderRoots}
          treesByRoot={sidebar.treesByRoot}
          expanded={sidebar.expanded}
          onToggle={sidebar.toggleNode}
          onFileClick={sidebarActions.openFileFromSidebar}
          onContextAction={sidebarActions.handleSidebarContextAction}
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
              {effectiveLayout === 'preview-left' && (
                <>
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
                    />
                  </Suspense>
                  <section className="pane">
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
                </>
              )}

              {effectiveLayout === 'preview-right' && (
                <>
                  <section className="pane">
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
                    />
                  </Suspense>
                </>
              )}

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

              {effectiveLayout === 'preview-only' && (
                <Suspense
                  fallback={
                    <section className="pane preview" style={{ gridColumn: '1 / -1' }}>
                      <div className="preview-body" />
                    </section>
                  }
                >
                  <PreviewPaneLazy
                    value={previewValue}
                    activeLine={activeLine}
                    previewWidth={previewWidthForRender}
                    fullWidth
                  />
                </Suspense>
              )}

              {effectiveLayout === 'editor-only' && (
                <section className="pane" style={{ gridColumn: '1 / -1' }}>
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

      {aiChatState && (
        <AiChatDialog
          open={aiChatState.open}
          entryMode={aiChatState.entryMode}
          initialContext={aiChatState.initialContext}
          onClose={closeAiChatDialog}
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
    </>
  )
}

export default WorkspaceShell
