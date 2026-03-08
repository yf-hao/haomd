import usageDocs from '../../docs/使用说明.md?raw'
import type { IAiClient } from '../ai/client'
import type { ChatEntryMode, EntryContext } from '../ai/domain/chatSession'
import { docConversationService } from '../ai/application/docConversationService'
import { getDirKeyFromDocPath } from '../ai/domain/docPathUtils'

export type AppCommand = () => void | Promise<void>

export type CommandRegistry = Record<string, AppCommand>

// ===== 命令上下文拆分（ISP） =====

type StatusContext = {
  setStatusMessage: (msg: string) => void
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
}

/**
 * AI 相关命令所需的上下文。
 */
export type AiCommandContext = StatusContext & {
  aiClient?: IAiClient
  /**
   * 打开 AI Chat 对话框的 UI 回调，由 WorkspaceShell 提供。
   */
  openAiChatDialog?: (options: { entryMode: ChatEntryMode; initialContext?: EntryContext }) => void
  /**
   * 关闭 AI Chat 对话框的 UI 回调，由 WorkspaceShell 提供。
   * 用于实现快捷键/命令层的 toggle 行为。
   */
  closeAiChatDialog?: () => void
  /** 当前 AI Chat 是否处于打开状态（来自 LayoutCommandContext） */
  aiChatOpen?: boolean
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
 * 完整的命令上下文：各子上下文的并集。
 * 外层系统（如 useCommandSystem）只需要提供这一份，总体仍保持向后兼容。
 */
export type CommandContext = LayoutCommandContext &
  FileCommandContext &
  AppLifecycleCommandContext &
  HelpCommandContext &
  AiCommandContext

// ===== 分组命令工厂 =====

let lastLayoutForPreviewOnly: string | null = null

function createLayoutCommands(ctx: LayoutCommandContext): CommandRegistry {
  return {
    layout_preview_left: () => {
      ctx.setLayout('preview-left')
      ctx.setShowPreview(true)
      ctx.setStatusMessage('布局：预览在左')
    },
    layout_preview_right: () => {
      ctx.setLayout('preview-right')
      ctx.setShowPreview(true)
      ctx.setStatusMessage('布局：预览在右')
    },
    layout_editor_only: () => {
      ctx.setLayout('editor-only')
      ctx.setShowPreview(false)
      ctx.setStatusMessage('布局：仅编辑器')
    },
    layout_preview_only: () => {
      ctx.setLayout('preview-only')
      ctx.setShowPreview(true)
      ctx.setStatusMessage('布局：仅预览')
    },
    find: () => {
      ctx.openSearch?.()
    },
    toggle_preview_only: () => {
      if (ctx.layout === 'preview-only') {
        const target = lastLayoutForPreviewOnly ?? 'preview-right'
        ctx.setLayout(target)
        ctx.setShowPreview(true)
        ctx.setStatusMessage('布局：退出预览专注模式')
        return
      }

      lastLayoutForPreviewOnly = ctx.layout
      ctx.setLayout('preview-only')
      ctx.setShowPreview(true)
      ctx.setStatusMessage('布局：预览专注模式')
    },
    view_ai_chat_floating: () => {
      ctx.setAiChatMode('floating')
      ctx.setStatusMessage('AI Chat：浮动模式')
    },
    view_ai_chat_dock_left: () => {
      ctx.setAiChatMode('docked')
      ctx.setAiChatDockSide('left')
      ctx.setStatusMessage('AI Chat：Dock 在左侧')
    },
    view_ai_chat_dock_right: () => {
      ctx.setAiChatMode('docked')
      ctx.setAiChatDockSide('right')
      ctx.setStatusMessage('AI Chat：Dock 在右侧')
    },
    toggle_preview: () => {
      ctx.setShowPreview((v) => {
        if (!v && ctx.layout === 'editor-only') {
          ctx.setLayout('preview-right')
        }
        return !v
      })
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
        // 文本文件：保持原有行为，为每个打开的文件创建独立标签，并同步编辑器内容
        ctx.createTab({ path, content })
        ctx.applyOpenedContent(content)
        ctx.setFilePath(path)
        ctx.updateActiveMeta(path, false)
        if (ctx.addStandaloneFile) {
          ctx.addStandaloneFile(path)
        }
      } else if (import.meta.env.DEV) {
        console.warn('[commands.open_file] openFile returned non-ok or missing data', resp)
      }
    },
    open_folder: async () => {
      // 只有在确实存在未保存变更时才弹确认，避免「空文档」也被拦截
      if (ctx.hasUnsavedChanges() && !ctx.confirmLoseChanges()) return
      if (!ctx.openFolderInSidebar) {
        ctx.setStatusMessage('当前版本暂不支持 Sidebar 打开文件夹')
        return
      }
      await ctx.openFolderInSidebar()
    },
    open_recent: async () => {
      if (!ctx.handleShowRecent) {
        ctx.setStatusMessage('最近文件面板已移除，请使用菜单 File → Open Recent')
        return
      }
      await ctx.handleShowRecent()
    },
    clear_recent: async () => {
      const resp = await ctx.clearRecentAll()
      if (resp && resp.ok) {
        ctx.setStatusMessage('已清空最近文件')
      }
    },
    export_html: async () => {
      if (ctx.exportHtml) {
        await ctx.exportHtml()
      } else {
        ctx.setStatusMessage('当前版本 HTML 导出功能未挂载')
      }
    },
    export_pdf: async () => {
      alert('[Registry] export_pdf command triggered')
      if (ctx.exportPdf) {
        await ctx.exportPdf()
      } else {
        ctx.setStatusMessage('当前版本 PDF 导出功能未挂载')
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
        ctx.setStatusMessage('占位：Quit 未实现')
      }
    },
  }
}

function createClipboardCommands(ctx: StatusContext): CommandRegistry {
  return {
    paste: () => {
      // 粘贴由原生菜单 -> native://paste 事件负责，这里不再调用 execCommand
    },
    copy: () => {
      if (typeof document !== 'undefined') {
        try {
          const ok = document.execCommand('copy')
          if (!ok) ctx.setStatusMessage('复制未生效')
        } catch (err) {
          console.warn('execCommand copy failed', err)
          ctx.setStatusMessage('复制未生效')
        }
      } else {
        ctx.setStatusMessage('复制未生效')
      }
    },
    cut: () => {
      if (typeof document !== 'undefined') {
        try {
          const ok = document.execCommand('cut')
          if (!ok) ctx.setStatusMessage('剪切未生效')
        } catch (err) {
          console.warn('execCommand cut failed', err)
          ctx.setStatusMessage('剪切未生效')
        }
      } else {
        ctx.setStatusMessage('剪切未生效')
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
        ctx.setStatusMessage('HaoMD · 关于（占位）')
      }
    },
    help_docs: () => {
      if (!ctx.confirmLoseChanges()) return
      ctx.newDocument()
      ctx.applyOpenedContent(usageDocs)
      // 将逻辑文件名设置为“使用说明.md”，用于窗口标题等展示
      ctx.setFilePath('使用说明.md')
      ctx.setStatusMessage('已打开使用说明')
    },
    help_release: () => {
      ctx.setStatusMessage('HaoMD · 菜单占位/帮助')
    },
    help_issue: () => {
      ctx.setStatusMessage('HaoMD · 菜单占位/帮助')
    },
    help_about: () => {
      ctx.setStatusMessage('HaoMD · 菜单占位/帮助')
    },
  }
}

function createAiCommands(ctx: AiCommandContext): CommandRegistry {
  return {
    ai_chat: async () => {
      // 如果当前 AI Chat 已经打开，并且提供了关闭回调，则作为 toggle 行为优先关闭
      if (ctx.aiChatOpen && ctx.closeAiChatDialog) {
        ctx.closeAiChatDialog()
        ctx.setStatusMessage('AI Chat：已关闭')
        return
      }

      try {
        if (!ctx.aiClient) {
          ctx.setStatusMessage('AI Chat 未配置：AI 客户端未初始化')
          return
        }
        const resp = await ctx.aiClient.openChat()
        ctx.setStatusMessage(resp.message)
        if (!resp.ok) {
          // 配置不完整时只提示状态栏，不打开对话框
          return
        }
        if (!ctx.openAiChatDialog) {
          ctx.setStatusMessage('AI Chat UI 未初始化')
          return
        }
        ctx.openAiChatDialog({ entryMode: 'chat' })
      } catch (err) {
        console.error('[commands] ai_chat error', err)
        ctx.setStatusMessage('AI Chat 调用出错，请检查控制台日志')
      }
    },
    ai_ask_file: async () => {
      if (!ctx.aiClient) {
        ctx.setStatusMessage('Ask AI About File 未配置：AI 客户端未初始化')
        return
      }
      const resp = await ctx.aiClient.askAboutFile()
      ctx.setStatusMessage(resp.message)
      if (!resp.ok) return
      if (!ctx.openAiChatDialog || !ctx.getCurrentMarkdown) {
        ctx.setStatusMessage('当前编辑器状态不可用，无法发起 Ask AI About File')
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
      if (!ctx.aiClient) {
        ctx.setStatusMessage('Ask AI About Selection 未配置：AI 客户端未初始化')
        return
      }
      const resp = await ctx.aiClient.askAboutSelection()
      ctx.setStatusMessage(resp.message)
      if (!resp.ok) return
      if (!ctx.openAiChatDialog || !ctx.getCurrentSelectionText) {
        ctx.setStatusMessage('当前编辑器状态不可用，无法发起 Ask AI About Selection')
        return
      }
      const selection = ctx.getCurrentSelectionText()?.trim()
      if (!selection) {
        ctx.setStatusMessage('当前没有选中的文本')
        return
      }
      ctx.openAiChatDialog({
        entryMode: 'selection',
        initialContext: { type: 'selection', content: selection },
      })
    },
    ai_conversation_history: async () => {
      try {
        if (!ctx.getCurrentFilePath) {
          ctx.setStatusMessage('当前编辑器状态不可用，无法打开文档会话历史')
          return
        }
        const filePath = ctx.getCurrentFilePath()
        if (!filePath) {
          ctx.setStatusMessage('请先打开并保存一个文档，再使用 History 查看会话历史')
          return
        }
        if (!ctx.openDocConversationsHistory) {
          ctx.setStatusMessage('当前版本未注册 History 浮窗，无法展示文档会话历史')
          return
        }
        const docPath = getDirKeyFromDocPath(filePath) ?? filePath
        ctx.openDocConversationsHistory(docPath)
      } catch (err) {
        console.error('[commands] ai_conversation_history error', err)
        ctx.setStatusMessage('打开文档会话历史失败，请检查控制台日志')
      }
    },
    ai_conversation_clear: async () => {
      try {
        if (!ctx.getCurrentFilePath) {
          ctx.setStatusMessage('当前编辑器状态不可用，无法清空文档会话历史')
          return
        }
        const filePath = ctx.getCurrentFilePath()
        if (!filePath) {
          ctx.setStatusMessage('请先打开一个已保存的文档，再使用 Clear 会话历史')
          return
        }
        const docPath = getDirKeyFromDocPath(filePath) ?? filePath
        await docConversationService.clearByDocPath(docPath)
        ctx.setStatusMessage('已清空当前目录的 AI 会话历史')
      } catch (err) {
        console.error('[commands] ai_conversation_clear error', err)
        ctx.setStatusMessage('清空文档会话历史失败，请检查控制台日志')
      }
    },
    ai_conversation_compress: async () => {
      try {
        if (!ctx.getCurrentFilePath) {
          ctx.setStatusMessage('当前编辑器状态不可用，无法压缩文档会话历史')
          return
        }
        const filePath = ctx.getCurrentFilePath()
        if (!filePath) {
          ctx.setStatusMessage('请先打开一个已保存的文档，再使用 Compress')
          return
        }
        const docPath = getDirKeyFromDocPath(filePath) ?? filePath
        await docConversationService.compressByDocPath(docPath)
        ctx.setStatusMessage('已触发当前目录会话压缩，并加入全局记忆学习队列（若已开启）')
      } catch (err) {
        console.error('[commands] ai_conversation_compress error', err)
        ctx.setStatusMessage('压缩文档会话历史失败，请检查控制台日志')
      }
    },
    ai_session_globalMemory_userPersona: () => {
      if (!ctx.openGlobalMemoryDialog) {
        ctx.setStatusMessage('当前版本未注册 Global Memory 对话框')
        return
      }
      ctx.openGlobalMemoryDialog({ initialTab: 'persona' })
    },
    ai_session_globalMemory_manage: () => {
      if (!ctx.openGlobalMemoryDialog) {
        ctx.setStatusMessage('当前版本未注册 Global Memory 对话框')
        return
      }
      ctx.openGlobalMemoryDialog({ initialTab: 'manage' })
    },
  }
}

// ===== 总的命令注册表 =====

export const createCommandRegistry = (ctx: CommandContext): CommandRegistry => ({
  ...createLayoutCommands(ctx),
  ...createFileCommands(ctx),
  ...createLifecycleCommands(ctx),
  ...createClipboardCommands(ctx),
  ...createHelpCommands(ctx),
  ...createAiCommands(ctx),
})
