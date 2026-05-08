import usageDocs from '../../docs/使用说明.md?raw'
import type { IAiClient } from '../ai/client'
import type { ChatEntryMode, EntryContext } from '../ai/domain/chatSession'
import { docConversationService, type CompressionStatusEvent } from '../ai/application/docConversationService'
import { getDirKeyFromDocPath } from '../ai/domain/docPathUtils'
import type { CommandRegistry } from './types'

export type { AppCommand, CommandRegistry } from './types'

// ===== 命令上下文拆分（ISP） =====

type StatusContext = {
  setStatusMessage: (msg: string) => void
  t?: (key: string, params?: Record<string, string | number>) => string
}

/**
 * 布局相关命令所需的上下文。
 */
export type LayoutCommandContext = StatusContext & {
  layout: string
  setLayout: (layout: string) => void
  setShowPreview: (value: boolean | ((prev: boolean) => boolean)) => void
  aiChatMode: 'floating' | 'docked'
  setAiChatMode: (mode: 'floating' | 'docked') => void
  aiChatDockSide: 'left' | 'right'
  setAiChatDockSide: (side: 'left' | 'right') => void
  aiChatOpen: boolean
  openSearch?: () => void
  editorZoom: number
  setEditorZoom: (value: number | ((prev: number) => number)) => void
  editMode?: 'source' | 'wysiwyg'
  setEditMode?: (mode: 'source' | 'wysiwyg') => void
}

/**
 * 文件/标签相关命令所需的上下文。
 */
export type FileCommandContext = StatusContext & {
  confirmLoseChanges: () => boolean
  /**
   * 是否存在需要用户确认的未保存变更
   */
  hasUnsavedChanges: () => boolean
  newDocument: () => void
  setFilePath: (path: string) => void
  applyOpenedContent: (content: string) => void
  openFile: () => Promise<any>
  save: () => Promise<any>
  saveAs: () => Promise<any>
  handleShowRecent?: () => Promise<void>
  clearRecentAll: () => Promise<any>
  createTab: (opts?: { title?: string; path?: string; content?: string }) => void
  updateActiveMeta: (path: string, dirty: boolean) => void
  openFolderInSidebar?: () => Promise<void>
  /** 打开文件后，向 Sidebar 注入一个独立文件条目 */
  addStandaloneFile?: (path: string) => void
  /** 当通过命令系统打开 PDF 时，通知 WorkspaceShell 刷新 PDF 最近列表 */
  refreshPdfRecent?: () => Promise<void> | void
  /** 导出命令 */
  exportHtml?: () => Promise<void>
  exportPdf?: () => Promise<void>
  exportWord?: () => Promise<void>
  /** 打开最近文件模态窗的回调，由 WorkspaceShell 提供 */
  openRecentDialog?: () => void
}

/**
 * 应用生命周期相关命令（关闭标签、退出应用）所需的上下文。
 */
export type AppLifecycleCommandContext = StatusContext & {
  confirmLoseChanges: () => boolean
  toggleSidebarVisible?: () => void
  closeCurrentTab: () => void
  onRequestCloseCurrentTab?: () => void
  onRequestQuit?: () => void
}

/**
 * 帮助/文档相关命令所需的上下文。
 */
export type HelpCommandContext = StatusContext & {
  confirmLoseChanges: () => boolean
  newDocument: () => void
  applyOpenedContent: (content: string) => void
  setFilePath: (path: string) => void
  /** 打开关于对话框的回调，由 WorkspaceShell 提供 */
  openAboutDialog?: () => void
  /** 打开版本说明对话框的回调，由 WorkspaceShell 提供 */
  openReleaseNotesDialog?: () => void
  /** 打开问题报告对话框的回调，由 WorkspaceShell 提供 */
  openIssueReportDialog?: () => void
}

/**
 * AI 相关命令所需的上下文。
 */
export type AiCommandContext = StatusContext & {
  aiClient?: IAiClient
  hasOpenTabs?: () => boolean
  /**
   * 打开 AI Chat 对话框的 UI 回调，由 WorkspaceShell 提供。
   */
  openAiChatDialog?: (options: { entryMode: ChatEntryMode; initialContext?: EntryContext; forceMode?: 'floating' | 'docked' }) => void
  /**
   * 关闭 AI Chat 对话框的 UI 回调，由 WorkspaceShell 提供。
   * 用于实现快捷键/命令层的 toggle 行为。
   */
  closeAiChatDialog?: () => void
  /** 当前 AI Chat 是否处于打开状态（来自 LayoutCommandContext） */
  aiChatOpen?: boolean
  /** 同步 getter，避免 async 命令中读到过时的 aiChatOpen 闭包值 */
  isAiChatOpen?: () => boolean
  /** 防止 async openChat() 期间重复触发打开操作的守卫 getter/setter */
  isAiChatOpening?: () => boolean
  setAiChatOpening?: (opening: boolean) => void
  /** 打开 Global Memory 对话框的 UI 回调，由 WorkspaceShell 提供。 */
  openGlobalMemoryDialog?: (options: { initialTab: 'persona' | 'manage' }) => void
  /** 获取当前编辑器中的完整 Markdown 文本 */
  getCurrentMarkdown?: () => string
  /** 获取当前标签对应的文件名（用于展示给模型） */
  getCurrentFileName?: () => string | null
  /** 获取当前编辑器中选中的文本内容 */
  getCurrentSelectionText?: () => string | null
  /** 获取当前文档的完整路径（用于文档会话历史/清理/压缩） */
  getCurrentFilePath?: () => string | null
  /** 打开文档会话历史视图（由 WorkspaceShell 提供，当前版本可选） */
  openDocConversationsHistory?: (docPath: string) => void
  /** 以下字段来自 Help/File 上下文，在 CommandContext 中总是存在，这里标记为可选以便 AI 命令复用 */
  newDocument?: () => void
  applyOpenedContent?: (content: string) => void
  setFilePath?: (path: string) => void
}

/**
 * 编辑格式相关命令所需的 UI 上下文。
 */
export type FormatUiCommandContext = StatusContext & {
  /** 打开“插入表格”对话框的 UI 回调，由 WorkspaceShell 提供 */
  openInsertTableDialog?: () => void
  /** 打开"数学符号"对话框的 UI 回调，由 WorkspaceShell 提供 */
  openMathSymbolDialog?: (categoryKey: string) => void
  /** 打开“文字颜色”对话框的 UI 回调，由 WorkspaceShell 提供 */
  openTextColorDialog?: () => void
}

/**
 * 完整的命令上下文：各子上下文的并集。
 * 外层系统（如 useCommandSystem）只需要提供这一份，总体仍保持向后兼容。
 */
export type CommandContext = LayoutCommandContext &
  FileCommandContext &
  AppLifecycleCommandContext &
  HelpCommandContext &
  AiCommandContext &
  FormatUiCommandContext

// ===== 分组命令工厂 =====

let lastLayoutForPreviewOnly: string | null = null

const EDITOR_ZOOM_MIN = 0.75
const EDITOR_ZOOM_MAX = 1.5
const EDITOR_ZOOM_STEP = 0.1

const tr = (
  ctx: StatusContext,
  key: string,
  fallback: string,
  params?: Record<string, string | number>,
) => ctx.t?.(key, params) ?? fallback

function formatElapsedSeconds(elapsedMs: number): number {
  return Math.max(1, Math.round(elapsedMs / 1000))
}

function formatCompressionStatusMessage(ctx: StatusContext, event: CompressionStatusEvent): string {
  const seconds = formatElapsedSeconds(event.elapsedMs)
  const slow = event.elapsedMs >= 30_000

  switch (event.phase) {
    case 'preparing':
      return tr(
        ctx,
        slow ? 'commands.conversationCompressPreparingSlow' : 'commands.conversationCompressPreparing',
        slow ? `正在准备压缩会话历史，耗时较长…（${seconds}s）` : `正在准备压缩会话历史…（${seconds}s）`,
        { seconds },
      )
    case 'summarizing-batch':
      return tr(
        ctx,
        slow ? 'commands.conversationCompressBatchSlow' : 'commands.conversationCompressBatch',
        slow
          ? `正在压缩第 ${event.currentBatch}/${event.totalBatches} 批会话历史，耗时较长…（${seconds}s）`
          : `正在压缩第 ${event.currentBatch}/${event.totalBatches} 批会话历史…（${seconds}s）`,
        { current: event.currentBatch ?? 1, total: event.totalBatches ?? 1, seconds },
      )
    case 'summarizing-level2':
      return tr(
        ctx,
        slow ? 'commands.conversationCompressLevel2Slow' : 'commands.conversationCompressLevel2',
        slow ? `正在合并压缩摘要，耗时较长…（${seconds}s）` : `正在合并压缩摘要…（${seconds}s）`,
        { seconds },
      )
    case 'saving':
      return tr(
        ctx,
        slow ? 'commands.conversationCompressSavingSlow' : 'commands.conversationCompressSaving',
        slow ? `正在保存压缩结果，耗时较长…（${seconds}s）` : `正在保存压缩结果…（${seconds}s）`,
        { seconds },
      )
    case 'already-running':
      return tr(
        ctx,
        'commands.conversationCompressAlreadyRunning',
        `当前文档的会话压缩已在后台运行…（${seconds}s）`,
        { seconds },
      )
    case 'timeout':
      return tr(
        ctx,
        'commands.conversationCompressTimeout',
        `会话压缩超时，已停止。请检查模型连接后重试。（${seconds}s）`,
        { seconds },
      )
    case 'failed':
      return tr(
        ctx,
        'commands.conversationCompressFailed',
        '压缩文档会话历史失败，请检查控制台日志',
      )
    case 'completed':
      return tr(ctx, 'commands.conversationCompressed', '会话压缩完成 ✓')
    default:
      return tr(ctx, 'commands.conversationCompressing', '正在压缩会话历史…')
  }
}

function createLayoutCommands(ctx: LayoutCommandContext): CommandRegistry {
  return {
    layout_preview_left: () => {
      ctx.setLayout('preview-left')
      ctx.setShowPreview(true)
      ctx.setStatusMessage(tr(ctx, 'commands.layoutPreviewLeft', '布局：预览在左'))
    },
    layout_preview_right: () => {
      ctx.setLayout('preview-right')
      ctx.setShowPreview(true)
      ctx.setStatusMessage(tr(ctx, 'commands.layoutPreviewRight', '布局：预览在右'))
    },
    layout_editor_only: () => {
      ctx.setLayout('editor-only')
      ctx.setShowPreview(false)
      ctx.setStatusMessage(tr(ctx, 'commands.layoutEditorOnly', '布局：仅编辑器'))
    },
    layout_preview_only: () => {
      ctx.setLayout('preview-only')
      ctx.setShowPreview(true)
      ctx.setStatusMessage(tr(ctx, 'commands.layoutPreviewOnly', '布局：仅预览'))
    },
    find: () => {
      ctx.openSearch?.()
    },
    toggle_preview_only: () => {
      if (ctx.layout === 'preview-only') {
        const target = lastLayoutForPreviewOnly ?? 'preview-right'
        ctx.setLayout(target)
        ctx.setShowPreview(true)
        ctx.setStatusMessage(tr(ctx, 'commands.layoutExitPreviewFocus', '布局：退出预览专注模式'))
        return
      }

      lastLayoutForPreviewOnly = ctx.layout
      ctx.setLayout('preview-only')
      ctx.setShowPreview(true)
      ctx.setStatusMessage(tr(ctx, 'commands.layoutPreviewFocus', '布局：预览专注模式'))
    },
    view_ai_chat_floating: () => {
      ctx.setAiChatMode('floating')
      ctx.setStatusMessage(tr(ctx, 'commands.aiChatFloating', 'AI Chat：浮动模式'))
    },
    view_ai_chat_dock_left: () => {
      ctx.setAiChatMode('docked')
      ctx.setAiChatDockSide('left')
      ctx.setStatusMessage(tr(ctx, 'commands.aiChatDockLeft', 'AI Chat：Dock 在左侧'))
    },
    view_ai_chat_dock_right: () => {
      ctx.setAiChatMode('docked')
      ctx.setAiChatDockSide('right')
      ctx.setStatusMessage(tr(ctx, 'commands.aiChatDockRight', 'AI Chat：Dock 在右侧'))
    },
    zoom_in: () => {
      ctx.setEditorZoom((prev) => {
        const next = Math.min(EDITOR_ZOOM_MAX, prev + EDITOR_ZOOM_STEP)
        const percent = Math.round(next * 100)
        ctx.setStatusMessage(tr(ctx, 'commands.editorZoomPercent', `Editor Zoom：${percent}%`, { percent }))
        return next
      })
    },
    zoom_out: () => {
      ctx.setEditorZoom((prev) => {
        const next = Math.max(EDITOR_ZOOM_MIN, prev - EDITOR_ZOOM_STEP)
        const percent = Math.round(next * 100)
        ctx.setStatusMessage(tr(ctx, 'commands.editorZoomPercent', `Editor Zoom：${percent}%`, { percent }))
        return next
      })
    },
    zoom_reset: () => {
      const next = 1.0
      ctx.setEditorZoom(next)
      ctx.setStatusMessage(tr(ctx, 'commands.editorZoomPercent', 'Editor Zoom：100%', { percent: 100 }))
    },
    toggle_preview: () => {
      ctx.setShowPreview((v) => {
        if (!v && ctx.layout === 'editor-only') {
          ctx.setLayout('preview-right')
        }
        return !v
      })
    },
    toggle_wysiwyg: () => {
      if (!ctx.setEditMode) return
      const next = ctx.editMode === 'wysiwyg' ? 'source' : 'wysiwyg'
      ctx.setEditMode(next)
      ctx.setStatusMessage(
        next === 'wysiwyg'
          ? tr(ctx, 'commands.editModeWysiwyg', '编辑模式：所见即所得')
          : tr(ctx, 'commands.editModeSource', '编辑模式：源码'),
      )
    },
  }
}

function createFileCommands(ctx: FileCommandContext): CommandRegistry {
  return {
    new_file: () => {
      // 总是新建一个空白标签页，不打断当前未保存的标签
      ctx.createTab()
      ctx.newDocument()
    },
    save: async () => {
      await ctx.save()
    },
    save_as: async () => {
      await ctx.saveAs()
    },
    open_file: async () => {
      const resp = await ctx.openFile()
      if (import.meta.env.DEV) {
        console.log('[commands.open_file] openFile resp =', resp)
      }
      if (resp && resp.ok && resp.data) {
        const data: any = resp.data as any
        const path = data.path as string | undefined
        if (!path) {
          if (import.meta.env.DEV) {
            console.warn('[commands.open_file] resp.ok but missing data.path, skip')
          }
          return
        }
        const isPdf = typeof path === 'string' && path.toLowerCase().endsWith('.pdf')
        if (import.meta.env.DEV) {
          console.log('[commands.open_file] resolved path =', path, 'isPdf =', isPdf)
        }

        if (isPdf) {
          // PDF：不走文本管线，直接用正确的 path 创建只读标签
          if (import.meta.env.DEV) {
            console.log('[commands.open_file] createTab for PDF with path', path)
          }
          ctx.createTab({ path, content: '' })
          // 注意：不将 PDF 注入 File Browser 的独立文件列表，仅在 PDF 面板中展示
          if (ctx.refreshPdfRecent) {
            console.log('[commands.open_file] will refreshPdfRecent immediately, hasFn =', typeof ctx.refreshPdfRecent === 'function')
            // 有些后端实现可能在 openFile 返回后才异步写入最近文件，这里做一次轻量延时刷新
            void ctx.refreshPdfRecent()
            setTimeout(() => {
              console.log('[commands.open_file] delayed refreshPdfRecent fired')
              if (ctx.refreshPdfRecent) {
                void ctx.refreshPdfRecent()
              }
            }, 500)
          } else if (import.meta.env.DEV) {
            console.warn('[commands.open_file] refreshPdfRecent is not provided in ctx')
          }
          return
        }

        const content = data.content as string
        // 文本文件：createTab 已设置 path/title/content，只需同步编辑器与持久化状态。
        // 注意：不能调用 updateActiveMeta / updateActiveContent，因为 createTab 内部
        // 通过 setActiveId 切换了激活标签，但这些回调闭包中的 activeId 仍指向旧标签，
        // 会把旧标签的 path/title/content 覆写为新文件的，从而产生两个相同标签。
        ctx.createTab({ path, content })
        ctx.applyOpenedContent(content)
        ctx.setFilePath(path)
        if (ctx.addStandaloneFile) {
          ctx.addStandaloneFile(path)
        }
      } else if (import.meta.env.DEV) {
        console.warn('[commands.open_file] openFile returned non-ok or missing data', resp)
      }
    },
    open_folder: async () => {
      // 打开文件夹不会直接丢失当前文档内容，这里不再拦截未保存变更
      if (!ctx.openFolderInSidebar) {
        ctx.setStatusMessage(tr(ctx, 'commands.openFolderSidebarUnsupported', '当前版本暂不支持 Sidebar 打开文件夹'))
        return
      }
      await ctx.openFolderInSidebar()
    },
    open_recent: async () => {
      if (!ctx.handleShowRecent) {
        ctx.setStatusMessage(tr(ctx, 'commands.recentPanelRemoved', '最近文件面板已移除，请使用菜单 File → Open Recent'))
        return
      }
      await ctx.handleShowRecent()
    },
    open_recent_dialog: () => {
      if (ctx.openRecentDialog) {
        ctx.openRecentDialog()
      } else {
        ctx.setStatusMessage(tr(ctx, 'commands.recentDialogUnavailable', '当前版本未挂载最近文件模态窗'))
      }
    },
    clear_recent: async () => {
      const resp = await ctx.clearRecentAll()
      if (resp && resp.ok) {
        ctx.setStatusMessage(tr(ctx, 'commands.recentCleared', '已清空最近文件'))
      }
    },
    export_html: async () => {
      if (ctx.exportHtml) {
        await ctx.exportHtml()
      } else {
        ctx.setStatusMessage(tr(ctx, 'commands.exportHtmlUnavailable', '当前版本 HTML 导出功能未挂载'))
      }
    },
    export_pdf: async () => {
      if (ctx.exportPdf) {
        await ctx.exportPdf()
      } else {
        ctx.setStatusMessage(tr(ctx, 'commands.exportPdfUnavailable', '当前版本 PDF 导出功能未挂载'))
      }
    },
    export_word: async () => {
      if (ctx.exportWord) {
        await ctx.exportWord()
      } else {
        ctx.setStatusMessage(tr(ctx, 'commands.exportWordUnavailable', '当前版本 Word 导出功能未挂载'))
      }
    },
  }
}

function createLifecycleCommands(ctx: AppLifecycleCommandContext): CommandRegistry {
  return {
    close_file: () => {
      // 优先使用 App 层的确认对话框（与 TabBar 一致）
      if (ctx.onRequestCloseCurrentTab) {
        ctx.onRequestCloseCurrentTab()
      } else {
        // 回退到基础实现
        ctx.closeCurrentTab()
      }
    },
    quit: () => {
      if (ctx.onRequestQuit) {
        ctx.onRequestQuit()
      } else {
        // 回退实现：如果有未保存变更，使用浏览器确认对话框
        if (!ctx.confirmLoseChanges()) return
        ctx.setStatusMessage(tr(ctx, 'commands.quitPlaceholder', '占位：Quit 未实现'))
      }
    },
  }
}

function createClipboardCommands(ctx: StatusContext): CommandRegistry {
  const isEditableElement = (el: Element | null): boolean => {
    if (!el) return false
    const tag = el.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return true
    if (el instanceof HTMLElement && el.isContentEditable) return true
    return false
  }

  return {
    paste: () => {
      // 粘贴由原生菜单 -> native://paste 事件负责，这里不再调用 execCommand
    },
    copy: () => {
      if (typeof document === 'undefined') {
        ctx.setStatusMessage(tr(ctx, 'commands.copyFailed', '复制未生效'))
        return
      }
      try {
        const ok = document.execCommand('copy')
        if (!ok) ctx.setStatusMessage(tr(ctx, 'commands.copyFailed', '复制未生效'))
      } catch (err) {
        console.warn('execCommand copy failed', err)
        ctx.setStatusMessage(tr(ctx, 'commands.copyFailed', '复制未生效'))
      }
    },
    cut: () => {
      if (typeof document === 'undefined') {
        ctx.setStatusMessage(tr(ctx, 'commands.cutFailed', '剪切未生效'))
        return
      }

      const active = document.activeElement as Element | null

      // 只在可编辑区域兜底剪切；否则退化为 copy
      if (!isEditableElement(active)) {
        try {
          const okCopy = document.execCommand('copy')
          if (!okCopy) ctx.setStatusMessage(tr(ctx, 'commands.cutFailed', '剪切未生效'))
        } catch (err) {
          console.warn('fallback copy for cut failed', err)
          ctx.setStatusMessage(tr(ctx, 'commands.cutFailed', '剪切未生效'))
        }
        return
      }

      try {
        const ok = document.execCommand('cut')
        if (!ok) {
          const okCopy = document.execCommand('copy')
          if (!okCopy) ctx.setStatusMessage(tr(ctx, 'commands.cutFailed', '剪切未生效'))
        }
      } catch (err) {
        console.warn('execCommand cut failed', err)
        try {
          const okCopy = document.execCommand('copy')
          if (!okCopy) ctx.setStatusMessage(tr(ctx, 'commands.cutFailed', '剪切未生效'))
        } catch (err2) {
          console.warn('fallback copy after cut failed', err2)
          ctx.setStatusMessage(tr(ctx, 'commands.cutFailed', '剪切未生效'))
        }
      }
    },
  }
}

function createHelpCommands(ctx: HelpCommandContext): CommandRegistry {
  return {
    haomd_about: () => {
      if (ctx.openAboutDialog) {
        ctx.openAboutDialog()
      } else {
        ctx.setStatusMessage(tr(ctx, 'commands.aboutPlaceholder', 'HaoMD · 关于（占位）'))
      }
    },
    help_docs: () => {
      if (!ctx.confirmLoseChanges()) return
      ctx.newDocument()
      ctx.applyOpenedContent(usageDocs)
      // 将逻辑文件名设置为“使用说明.md”，用于窗口标题等展示
      ctx.setFilePath('使用说明.md')
      ctx.setStatusMessage(tr(ctx, 'commands.usageOpened', '已打开使用说明'))
    },
    help_release: () => {
      if (ctx.openReleaseNotesDialog) {
        ctx.openReleaseNotesDialog()
        ctx.setStatusMessage(tr(ctx, 'commands.changelogOpened', '已打开更新日志'))
        return
      }
      ctx.setStatusMessage(tr(ctx, 'commands.changelogDialogUnavailable', '版本说明对话框未注册'))
    },
    help_issue: () => {
      if (ctx.openIssueReportDialog) {
        ctx.openIssueReportDialog()
        ctx.setStatusMessage(tr(ctx, 'commands.issueDialogOpened', '已打开问题反馈'))
        return
      }
      ctx.setStatusMessage(tr(ctx, 'commands.issueDialogUnavailable', '问题反馈对话框未注册'))
    },
    help_about: () => {
      ctx.setStatusMessage(tr(ctx, 'commands.helpPlaceholder', 'HaoMD · 菜单占位/帮助'))
    },
  }
}

function createAiCommands(ctx: AiCommandContext): CommandRegistry {
  return {
    ai_chat: async () => {
      // 优先使用同步 getter（不受闭包过时影响），降级使用闭包值
      const isOpen = ctx.isAiChatOpen ? ctx.isAiChatOpen() : ctx.aiChatOpen

      // 如果当前 AI Chat 已经打开，并且提供了关闭回调，则作为 toggle 行为优先关闭
      if (isOpen && ctx.closeAiChatDialog) {
        ctx.closeAiChatDialog()
        ctx.setStatusMessage(tr(ctx, 'commands.aiChatClosed', 'AI Chat：已关闭'))
        return
      }

      // 防止 async openChat() 期间重复触发
      if (ctx.isAiChatOpening?.()) return

      ctx.setAiChatOpening?.(true)
      try {
        if (!ctx.aiClient) {
          ctx.setStatusMessage(tr(ctx, 'commands.aiChatUnconfigured', 'AI Chat 未配置：AI 客户端未初始化'))
          return
        }
        const resp = await ctx.aiClient.openChat()
        ctx.setStatusMessage(resp.message)
        if (!resp.ok) {
          // 配置不完整时只提示状态栏，不打开对话框
          return
        }
        if (!ctx.openAiChatDialog) {
          ctx.setStatusMessage(tr(ctx, 'commands.aiChatUiUnavailable', 'AI Chat UI 未初始化'))
          return
        }
        ctx.openAiChatDialog({
          entryMode: 'chat',
          forceMode: ctx.hasOpenTabs?.() === false ? 'floating' : undefined,
        })
      } catch (err) {
        console.error('[commands] ai_chat error', err)
        ctx.setStatusMessage(tr(ctx, 'commands.aiChatError', 'AI Chat 调用出错，请检查控制台日志'))
      } finally {
        ctx.setAiChatOpening?.(false)
      }
    },
    ai_ask_file: async () => {
      if (!ctx.aiClient) {
        ctx.setStatusMessage(tr(ctx, 'commands.askAiAboutFileUnconfigured', 'Ask AI About File 未配置：AI 客户端未初始化'))
        return
      }
      const resp = await ctx.aiClient.askAboutFile()
      ctx.setStatusMessage(resp.message)
      if (!resp.ok) return
      if (!ctx.openAiChatDialog || !ctx.getCurrentMarkdown) {
        ctx.setStatusMessage(tr(ctx, 'commands.askAiAboutFileUnavailable', '当前编辑器状态不可用，无法发起 Ask AI About File'))
        return
      }
      const content = ctx.getCurrentMarkdown()
      const fileName = ctx.getCurrentFileName ? ctx.getCurrentFileName() ?? undefined : undefined
      ctx.openAiChatDialog({
        entryMode: 'file',
        initialContext: { type: 'file', content, fileName },
      })
    },
    ai_ask_selection: async () => {
      if (!ctx.aiClient) return
      const resp = await ctx.aiClient.askAboutSelection()
      if (!resp.ok) return
      if (!ctx.openAiChatDialog || !ctx.getCurrentSelectionText) return
      const selection = ctx.getCurrentSelectionText()?.trim()
      if (!selection) return
      ctx.openAiChatDialog({
        entryMode: 'selection',
        initialContext: { type: 'selection', content: selection },
      })
    },
    ai_conversation_history: async () => {
      try {
        if (!ctx.getCurrentFilePath) {
          ctx.setStatusMessage(tr(ctx, 'commands.conversationHistoryUnavailable', '当前编辑器状态不可用，无法打开文档会话历史'))
          return
        }
        const filePath = ctx.getCurrentFilePath()
        if (!filePath) {
          ctx.setStatusMessage(tr(ctx, 'commands.conversationHistoryNeedsSavedDoc', '请先打开并保存一个文档，再使用 History 查看会话历史'))
          return
        }
        if (!ctx.openDocConversationsHistory) {
          ctx.setStatusMessage(tr(ctx, 'commands.conversationHistoryDialogUnavailable', '当前版本未注册 History 浮窗，无法展示文档会话历史'))
          return
        }
        const docPath = getDirKeyFromDocPath(filePath) ?? filePath
        ctx.openDocConversationsHistory(docPath)
      } catch (err) {
        console.error('[commands] ai_conversation_history error', err)
        ctx.setStatusMessage(tr(ctx, 'commands.conversationHistoryOpenFailed', '打开文档会话历史失败，请检查控制台日志'))
      }
    },
    ai_conversation_clear: async () => {
      try {
        if (!ctx.getCurrentFilePath) {
          ctx.setStatusMessage(tr(ctx, 'commands.conversationClearUnavailable', '当前编辑器状态不可用，无法清空文档会话历史'))
          return
        }
        const filePath = ctx.getCurrentFilePath()
        if (!filePath) {
          ctx.setStatusMessage(tr(ctx, 'commands.conversationClearNeedsSavedDoc', '请先打开一个已保存的文档，再使用 Clear 会话历史'))
          return
        }
        const docPath = getDirKeyFromDocPath(filePath) ?? filePath
        await docConversationService.clearByDocPath(docPath)
        ctx.setStatusMessage(tr(ctx, 'commands.conversationCleared', '已清空当前目录的 AI 会话历史'))
      } catch (err) {
        console.error('[commands] ai_conversation_clear error', err)
        ctx.setStatusMessage(tr(ctx, 'commands.conversationClearFailed', '清空文档会话历史失败，请检查控制台日志'))
      }
    },
    ai_conversation_compress: async () => {
      try {
        if (!ctx.getCurrentFilePath) {
          ctx.setStatusMessage(tr(ctx, 'commands.conversationCompressUnavailable', '当前编辑器状态不可用，无法压缩文档会话历史'))
          return
        }
        const filePath = ctx.getCurrentFilePath()
        if (!filePath) {
          ctx.setStatusMessage(tr(ctx, 'commands.conversationCompressNeedsSavedDoc', '请先打开一个已保存的文档，再使用 Compress'))
          return
        }
        const docPath = getDirKeyFromDocPath(filePath) ?? filePath
        // fire-and-forget: don't await, let user continue chatting
        void docConversationService.compressByDocPath(docPath, {
          onStatus: (event) => {
            ctx.setStatusMessage(formatCompressionStatusMessage(ctx, event))
          },
        }).catch((err) => {
          console.error('[commands] ai_conversation_compress error', err)
        })
      } catch (err) {
        console.error('[commands] ai_conversation_compress error', err)
        ctx.setStatusMessage(tr(ctx, 'commands.conversationCompressFailed', '压缩文档会话历史失败，请检查控制台日志'))
      }
    },
    ai_session_globalMemory_userPersona: () => {
      if (!ctx.openGlobalMemoryDialog) {
        ctx.setStatusMessage(tr(ctx, 'commands.globalMemoryDialogUnavailable', '当前版本未注册 Global Memory 对话框'))
        return
      }
      ctx.openGlobalMemoryDialog({ initialTab: 'persona' })
    },
    ai_session_globalMemory_manage: () => {
      if (!ctx.openGlobalMemoryDialog) {
        ctx.setStatusMessage(tr(ctx, 'commands.globalMemoryDialogUnavailable', '当前版本未注册 Global Memory 对话框'))
        return
      }
      ctx.openGlobalMemoryDialog({ initialTab: 'manage' })
    },
  }
}

// ===== 总的命令注册表 =====

import { createFormatCommands } from './formatCommands'

export const createCommandRegistry = (ctx: CommandContext): CommandRegistry => ({
  ...createLayoutCommands(ctx),
  ...createFileCommands(ctx),
  ...createLifecycleCommands(ctx),
  ...createClipboardCommands(ctx),
  ...createHelpCommands(ctx),
  ...createAiCommands(ctx),
  ...createFormatCommands(ctx),
})
